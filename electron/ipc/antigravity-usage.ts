import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { UsageGroup, UsageResult, UsageWindow } from './shared-types.js';
import { clampPercent, finite, parseResetsAt } from './usage-shared.js';

const MINIMUM_VERSION = [1, 1, 11] as const;
const COMMAND_TIMEOUT_MS = 20_000;
const COMMAND_MAX_BUFFER = 1024 * 1024;

interface ExecOptions {
  cwd: string;
  encoding: 'utf8';
  maxBuffer: number;
  timeout: number;
}

/** Injectable command boundary. Production always invokes the fixed `agy` executable and argv. */
export type AntigravityExec = (
  file: string,
  args: string[],
  options: ExecOptions,
) => Promise<{ stdout: string; stderr?: string }>;

const execFileAsync = promisify(execFile) as AntigravityExec;
const supportedExecutors = new WeakSet<AntigravityExec>();

function commandOptions(): ExecOptions {
  return {
    cwd: os.homedir(),
    encoding: 'utf8',
    maxBuffer: COMMAND_MAX_BUFFER,
    timeout: COMMAND_TIMEOUT_MS,
  };
}

/** Reads the first semantic version from `agy --version`. */
export function parseAntigravityVersion(output: string): [number, number, number] | null {
  const match = /(?:^|\s|v)(\d+)\.(\d+)\.(\d+)(?:\b|[-+])/i.exec(output.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function isSupportedAntigravityVersion(output: string): boolean {
  const version = parseAntigravityVersion(output);
  if (!version) return false;
  for (let i = 0; i < MINIMUM_VERSION.length; i += 1) {
    if (version[i] > MINIMUM_VERSION[i]) return true;
    if (version[i] < MINIMUM_VERSION[i]) return false;
  }
  return true;
}

async function hasSupportedVersion(exec: AntigravityExec): Promise<boolean> {
  if (supportedExecutors.has(exec)) return true;
  try {
    const { stdout } = await exec('agy', ['--version'], commandOptions());
    if (!isSupportedAntigravityVersion(stdout)) return false;
    supportedExecutors.add(exec);
    return true;
  } catch {
    return false;
  }
}

interface ParsedBucket {
  kind: 'fiveHour' | 'sevenDay';
  window: UsageWindow;
}

function parseBucket(value: unknown): ParsedBucket | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as {
    window?: unknown;
    remaining_fraction?: unknown;
    reset_time?: unknown;
  };
  const kind = raw.window === '5h' ? 'fiveHour' : raw.window === 'weekly' ? 'sevenDay' : null;
  const remaining = finite(raw.remaining_fraction);
  if (!kind || remaining === null) return null;
  const usedPercent = Math.round(clampPercent((1 - remaining) * 100) * 1_000_000) / 1_000_000;
  return {
    kind,
    window: {
      usedPercent,
      resetsAt: parseResetsAt(raw.reset_time),
    },
  };
}

type AntigravityGroupId = 'gemini' | 'third-party';

function identifyGroup(value: unknown): AntigravityGroupId | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as { name?: unknown; buckets?: unknown };
  const name = typeof raw.name === 'string' ? raw.name.toLowerCase() : '';
  const bucketIds = Array.isArray(raw.buckets)
    ? raw.buckets
        .map((bucket) => {
          if (typeof bucket !== 'object' || bucket === null) return '';
          const id = (bucket as { id?: unknown }).id;
          return typeof id === 'string' ? id.toLowerCase() : '';
        })
        .filter(Boolean)
    : [];
  if (name.includes('gemini') || bucketIds.some((id) => id.startsWith('gemini-'))) {
    return 'gemini';
  }
  if (
    bucketIds.some((id) => id.startsWith('3p-')) ||
    (name.includes('claude') && name.includes('gpt'))
  ) {
    return 'third-party';
  }
  return null;
}

function parseGroup(value: unknown, id: AntigravityGroupId): UsageGroup | null {
  if (typeof value !== 'object' || value === null) return null;
  const buckets = (value as { buckets?: unknown }).buckets;
  if (!Array.isArray(buckets)) return null;
  let fiveHour: UsageWindow | null = null;
  let sevenDay: UsageWindow | null = null;
  for (const value of buckets) {
    const bucket = parseBucket(value);
    if (!bucket) continue;
    if (bucket.kind === 'fiveHour') fiveHour = bucket.window;
    else sevenDay = bucket.window;
  }
  return {
    id,
    label: id === 'gemini' ? 'Gemini Models' : 'Claude and GPT Models',
    fiveHour,
    sevenDay,
  };
}

/**
 * Parses only the read-only `/usage` command envelope. The zero-turn/token checks
 * prevent a future CLI regression from treating `/usage` as a paid model prompt.
 */
export function parseAntigravityUsageResponse(body: unknown, now = Date.now()): UsageResult | null {
  if (typeof body !== 'object' || body === null) return null;
  const envelope = body as {
    status?: unknown;
    num_turns?: unknown;
    usage?: unknown;
    command?: unknown;
  };
  if (envelope.status !== 'SUCCESS' || envelope.num_turns !== 0) return null;
  if (envelope.usage !== undefined) {
    if (typeof envelope.usage !== 'object' || envelope.usage === null) return null;
    const totalTokens = (envelope.usage as { total_tokens?: unknown }).total_tokens;
    if (totalTokens !== undefined && totalTokens !== 0) return null;
  }
  if (typeof envelope.command !== 'object' || envelope.command === null) return null;
  const command = envelope.command as { name?: unknown; data?: unknown };
  if (command.name !== 'usage' || typeof command.data !== 'object' || command.data === null) {
    return null;
  }
  const rawGroups = (command.data as { groups?: unknown }).groups;
  if (!Array.isArray(rawGroups)) return null;

  const parsed = new Map<AntigravityGroupId, UsageGroup>();
  for (const value of rawGroups) {
    const id = identifyGroup(value);
    if (!id) continue;
    const group = parseGroup(value, id);
    if (group) parsed.set(id, group);
  }
  const groups = (['gemini', 'third-party'] as const).flatMap((id) => {
    const group = parsed.get(id);
    return group ? [group] : [];
  });
  if (groups.length === 0) return null;
  return { status: 'ok', groups, fetchedAt: now };
}

function usageCommandError(err: unknown): string {
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? (err as { code?: unknown }).code
      : undefined;
  if (code === 'ENOENT') return 'Antigravity CLI was not found';
  const killed =
    typeof err === 'object' && err !== null && 'killed' in err
      ? (err as { killed?: unknown }).killed
      : false;
  if (killed) return 'Antigravity usage check timed out';
  if (typeof code === 'number' || typeof code === 'string') {
    return `Antigravity usage command failed (${String(code)})`;
  }
  return 'Antigravity usage command failed';
}

export async function fetchAntigravityUsage(
  exec: AntigravityExec = execFileAsync,
  now = Date.now(),
): Promise<UsageResult> {
  if (!(await hasSupportedVersion(exec))) {
    return {
      status: 'unavailable',
      reason: 'Antigravity CLI 1.1.11 or newer is required for safe usage checks',
    };
  }
  try {
    const { stdout } = await exec(
      'agy',
      ['-p', '/usage', '--output-format', 'json'],
      commandOptions(),
    );
    let body: unknown;
    try {
      body = JSON.parse(stdout) as unknown;
    } catch {
      return { status: 'error', message: 'Antigravity returned invalid usage JSON' };
    }
    return (
      parseAntigravityUsageResponse(body, now) ?? {
        status: 'error',
        message: 'Antigravity returned an unrecognized usage response',
      }
    );
  } catch (err) {
    // Do not expose stdout/stderr: the CLI response may contain account details.
    return { status: 'error', message: usageCommandError(err) };
  }
}
