import { setStore } from './core';
import { invoke } from '../lib/ipc';
import { IPC } from '../../electron/ipc/channels';
import type { UsageProvider, UsageResult } from '../ipc/types';

// The usage endpoints rate-limit eager pollers, so refresh slowly and let
// agent session exits and manual clicks fill in between ticks.
const POLL_INTERVAL_MS = 5 * 60_000;
const MIN_REFRESH_GAP_MS = 30_000;
const ERROR_BACKOFF_MS = [10 * 60_000, 30 * 60_000, 60 * 60_000] as const;
const UNAVAILABLE_BACKOFF_MS = 60 * 60_000;

/** Render order of the providers in the status bar. */
export const USAGE_PROVIDERS: readonly UsageProvider[] = ['claude', 'codex', 'antigravity'];

const CHANNELS: Record<UsageProvider, IPC> = {
  claude: IPC.GetClaudeUsage,
  codex: IPC.GetCodexUsage,
  antigravity: IPC.GetAntigravityUsage,
};

// Only bundled agents with a safe, read-only usage source are mapped here.
const AGENT_PROVIDERS: Record<string, UsageProvider> = {
  'claude-code': 'claude',
  codex: 'codex',
  antigravity: 'antigravity',
};

let pollTimer: ReturnType<typeof setInterval> | null = null;
let pollingStarted = false;
const lastRequestAt: Record<UsageProvider, number> = { claude: 0, codex: 0, antigravity: 0 };
const inFlight: Partial<Record<UsageProvider, Promise<void>>> = {};
const automaticFailures: Record<UsageProvider, number> = { claude: 0, codex: 0, antigravity: 0 };
const nextAutomaticAt: Record<UsageProvider, number> = { claude: 0, codex: 0, antigravity: 0 };

/** The usage meter an agent's sessions move, if the app tracks one for it. */
export function usageProviderForAgent(agentDefId: string): UsageProvider | null {
  return AGENT_PROVIDERS[agentDefId] ?? null;
}

function applyResult(provider: UsageProvider, result: UsageResult): void {
  if (result.status === 'ok') {
    automaticFailures[provider] = 0;
    nextAutomaticAt[provider] = 0;
    setStore('usage', provider, {
      groups: result.groups,
      fetchedAt: result.fetchedAt,
      status: 'ok',
      error: null,
    });
  } else if (result.status === 'unavailable') {
    automaticFailures[provider] = 0;
    nextAutomaticAt[provider] = Date.now() + UNAVAILABLE_BACKOFF_MS;
    // Full reset: setStore merges, and a surviving snapshot would keep the bar visible after logout.
    setStore('usage', provider, {
      groups: [],
      fetchedAt: null,
      status: 'unavailable',
      error: result.reason,
    });
  } else {
    const failures = Math.min(automaticFailures[provider] + 1, ERROR_BACKOFF_MS.length);
    automaticFailures[provider] = failures;
    nextAutomaticAt[provider] = Date.now() + ERROR_BACKOFF_MS[failures - 1];
    setStore('usage', provider, { status: 'error', error: result.message });
  }
}

function applyRejectedRequest(provider: UsageProvider, err: unknown): void {
  const failures = Math.min(automaticFailures[provider] + 1, ERROR_BACKOFF_MS.length);
  automaticFailures[provider] = failures;
  nextAutomaticAt[provider] = Date.now() + ERROR_BACKOFF_MS[failures - 1];
  setStore('usage', provider, {
    status: 'error',
    error: err instanceof Error ? err.message : String(err),
  });
}

/** Re-reads one provider's usage. Coalesces concurrent calls and, unless forced,
 *  skips refreshes that land within MIN_REFRESH_GAP_MS of the previous request — the
 *  guard is for bursts of agent exits, so the poll tick and user clicks force. */
export function refreshUsage(
  provider: UsageProvider,
  opts: { force?: boolean } = {},
): Promise<void> {
  const pending = inFlight[provider];
  if (pending) return pending;
  if (!opts.force && Date.now() - lastRequestAt[provider] < MIN_REFRESH_GAP_MS) {
    return Promise.resolve();
  }
  lastRequestAt[provider] = Date.now();
  const request = invoke<UsageResult>(CHANNELS[provider])
    .then((result) => applyResult(provider, result))
    .catch((err: unknown) => applyRejectedRequest(provider, err))
    .finally(() => {
      delete inFlight[provider];
    });
  inFlight[provider] = request;
  return request;
}

function refreshAll(ignoreBackoff = false): void {
  const now = Date.now();
  for (const provider of USAGE_PROVIDERS) {
    if (!ignoreBackoff && now < nextAutomaticAt[provider]) continue;
    void refreshUsage(provider, { force: true });
  }
}

function documentIsHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

function clearPollTimer(): void {
  if (!pollTimer) return;
  clearInterval(pollTimer);
  pollTimer = null;
}

function schedulePollTimer(): void {
  if (!pollingStarted || pollTimer || documentIsHidden()) return;
  pollTimer = setInterval(() => refreshAll(), POLL_INTERVAL_MS);
}

function handleVisibilityChange(): void {
  if (documentIsHidden()) {
    clearPollTimer();
    return;
  }
  // A visible window should immediately catch up even if a prior automatic
  // check was backed off. Failures after this attempt restore the backoff.
  refreshAll(true);
  schedulePollTimer();
}

export function startUsagePolling(): void {
  if (pollingStarted) return;
  pollingStarted = true;
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleVisibilityChange);
  }
  if (documentIsHidden()) return;
  refreshAll(true);
  schedulePollTimer();
}

export function stopUsagePolling(): void {
  if (!pollingStarted) return;
  pollingStarted = false;
  clearPollTimer();
  if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  }
}
