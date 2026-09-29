import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockStoreHarness } from './test-helpers';
import type { UsageState } from './types';
import type { UsageProvider, UsageResult } from '../ipc/types';

const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }));
const core = vi.hoisted(() => ({
  harness: undefined as MockStoreHarness<{ usage: Record<UsageProvider, UsageState> }> | undefined,
}));

const IDLE: UsageState = {
  groups: [],
  fetchedAt: null,
  status: 'idle',
  error: null,
};

vi.mock('./core', async () => {
  const { createMockStoreHarness } = await import('./test-helpers');
  core.harness = createMockStoreHarness({
    usage: {
      claude: { ...IDLE },
      codex: { ...IDLE },
      antigravity: { ...IDLE },
    },
  });
  return core.harness.moduleMock();
});
vi.mock('../lib/ipc', () => ({ invoke: mockInvoke }));
vi.mock('../../electron/ipc/channels', () => ({
  IPC: {
    GetClaudeUsage: 'get_claude_usage',
    GetCodexUsage: 'get_codex_usage',
    GetAntigravityUsage: 'get_antigravity_usage',
  },
}));

type Slice = typeof import('./usage');

const OK: UsageResult = {
  status: 'ok',
  groups: [
    {
      id: 'default',
      label: 'Default',
      fiveHour: { usedPercent: 40, resetsAt: 1_000 },
      sevenDay: { usedPercent: 10, resetsAt: 2_000 },
    },
  ],
  fetchedAt: 500,
};

function state(provider: UsageProvider = 'claude'): UsageState {
  if (!core.harness) throw new Error('store harness not initialised');
  return core.harness.state().usage[provider];
}

describe('usage store slice', () => {
  let slice: Slice;
  let visibilityState: DocumentVisibilityState;
  let fakeDocument: EventTarget;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-02T12:00:00Z'));
    mockInvoke.mockReset();
    visibilityState = 'visible';
    fakeDocument = new EventTarget();
    Object.defineProperty(fakeDocument, 'visibilityState', {
      configurable: true,
      get: () => visibilityState,
    });
    vi.stubGlobal('document', fakeDocument);
    core.harness?.reset({
      usage: {
        claude: { ...IDLE },
        codex: { ...IDLE },
        antigravity: { ...IDLE },
      },
    });
    // The slice keeps its throttles and timer in module scope, so every test gets a fresh copy.
    vi.resetModules();
    slice = await import('./usage');
  });

  afterEach(() => {
    slice.stopUsagePolling();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('applies an ok result to the requested provider only', async () => {
    mockInvoke.mockResolvedValueOnce(OK);
    await slice.refreshUsage('codex');
    expect(mockInvoke).toHaveBeenCalledWith('get_codex_usage');
    expect(state('codex')).toEqual({
      groups: OK.groups,
      fetchedAt: 500,
      status: 'ok',
      error: null,
    });
    expect(state('claude')).toEqual(IDLE);
  });

  it('reads Antigravity through its own IPC channel', async () => {
    mockInvoke.mockResolvedValueOnce(OK);
    await slice.refreshUsage('antigravity');
    expect(mockInvoke).toHaveBeenCalledWith('get_antigravity_usage');
    expect(state('antigravity')).toMatchObject({ groups: OK.groups, status: 'ok' });
    expect(state('claude')).toEqual(IDLE);
    expect(state('codex')).toEqual(IDLE);
  });

  it('drops the snapshot entirely when the login goes away', async () => {
    mockInvoke.mockResolvedValueOnce(OK);
    await slice.refreshUsage('claude');
    mockInvoke.mockResolvedValueOnce({ status: 'unavailable', reason: 'logged out' });
    await slice.refreshUsage('claude', { force: true });
    expect(state()).toEqual({
      groups: [],
      fetchedAt: null,
      status: 'unavailable',
      error: 'logged out',
    });
  });

  it('keeps the last snapshot on a transient error', async () => {
    mockInvoke.mockResolvedValueOnce(OK);
    await slice.refreshUsage('claude');
    mockInvoke.mockResolvedValueOnce({ status: 'error', message: 'HTTP 429' });
    await slice.refreshUsage('claude', { force: true });
    expect(state()).toMatchObject({ groups: OK.groups, status: 'error', error: 'HTTP 429' });
  });

  it('turns a rejected IPC call into an error state', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('bridge down'));
    await slice.refreshUsage('claude');
    expect(state()).toMatchObject({ status: 'error', error: 'bridge down' });
  });

  it('coalesces concurrent refreshes of one provider into one request', async () => {
    mockInvoke.mockResolvedValue(OK);
    await Promise.all([slice.refreshUsage('claude'), slice.refreshUsage('claude')]);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it('throttles back-to-back refreshes per provider unless forced', async () => {
    mockInvoke.mockResolvedValue(OK);
    await slice.refreshUsage('claude');
    vi.advanceTimersByTime(10_000);
    await slice.refreshUsage('claude');
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    // Another provider's throttle is independent.
    await slice.refreshUsage('codex');
    expect(mockInvoke).toHaveBeenCalledTimes(2);
    await slice.refreshUsage('claude', { force: true });
    expect(mockInvoke).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(30_000);
    await slice.refreshUsage('claude');
    expect(mockInvoke).toHaveBeenCalledTimes(4);
  });

  it('polls every provider every five minutes, starts once, and stops cleanly', async () => {
    mockInvoke.mockResolvedValue(OK);
    slice.startUsagePolling();
    slice.startUsagePolling();
    await vi.advanceTimersByTimeAsync(0);
    expect(mockInvoke.mock.calls.map(([channel]) => channel)).toEqual([
      'get_claude_usage',
      'get_codex_usage',
      'get_antigravity_usage',
    ]);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(mockInvoke).toHaveBeenCalledTimes(6);
    slice.stopUsagePolling();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(mockInvoke).toHaveBeenCalledTimes(6);
  });

  it('pauses automatic polling while hidden and refreshes immediately when visible', async () => {
    mockInvoke.mockResolvedValue(OK);
    visibilityState = 'hidden';
    slice.startUsagePolling();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(mockInvoke).not.toHaveBeenCalled();

    visibilityState = 'visible';
    fakeDocument.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(mockInvoke).toHaveBeenCalledTimes(3);

    visibilityState = 'hidden';
    fakeDocument.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(mockInvoke).toHaveBeenCalledTimes(3);
  });

  it('backs off unavailable providers without blocking manual refreshes', async () => {
    mockInvoke.mockImplementation((channel: string) =>
      Promise.resolve(
        channel === 'get_antigravity_usage'
          ? { status: 'unavailable', reason: 'not installed' }
          : OK,
      ),
    );
    slice.startUsagePolling();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(
      mockInvoke.mock.calls.filter(([channel]) => channel === 'get_antigravity_usage'),
    ).toHaveLength(1);

    await slice.refreshUsage('antigravity', { force: true });
    expect(
      mockInvoke.mock.calls.filter(([channel]) => channel === 'get_antigravity_usage'),
    ).toHaveLength(2);
  });

  it('backs off transient failures before retrying automatically', async () => {
    let antigravityAttempts = 0;
    mockInvoke.mockImplementation((channel: string) => {
      if (channel !== 'get_antigravity_usage') return Promise.resolve(OK);
      antigravityAttempts += 1;
      return Promise.resolve(
        antigravityAttempts === 1 ? { status: 'error', message: 'temporary' } : OK,
      );
    });
    slice.startUsagePolling();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(antigravityAttempts).toBe(1);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(antigravityAttempts).toBe(2);
  });

  it('maps the bundled Claude Code and Codex agents to their meters', () => {
    expect(slice.usageProviderForAgent('claude-code')).toBe('claude');
    expect(slice.usageProviderForAgent('codex')).toBe('codex');
    expect(slice.usageProviderForAgent('antigravity')).toBe('antigravity');
    expect(slice.usageProviderForAgent('gemini')).toBeNull();
  });
});
