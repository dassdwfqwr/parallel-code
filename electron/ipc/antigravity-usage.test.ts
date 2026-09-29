import { describe, expect, it, vi } from 'vitest';
import {
  fetchAntigravityUsage,
  isSupportedAntigravityVersion,
  parseAntigravityUsageResponse,
  parseAntigravityVersion,
  type AntigravityExec,
} from './antigravity-usage.js';

const NOW = 1_700_000_000_000;

function usageEnvelope(): unknown {
  return {
    status: 'SUCCESS',
    num_turns: 0,
    usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    command: {
      name: 'usage',
      data: {
        // Deliberately reverse both groups and buckets: window names, not order, are authoritative.
        groups: [
          {
            name: 'Claude and GPT models',
            buckets: [
              {
                id: '3p-weekly',
                window: 'weekly',
                remaining_fraction: 0.1,
                reset_time: '2026-10-05T07:00:00Z',
              },
              {
                id: '3p-5h',
                window: '5h',
                remaining_fraction: 0.6,
                reset_time: 1_738_425_600,
              },
            ],
          },
          {
            name: 'Gemini Models',
            buckets: [
              {
                id: 'gemini-weekly',
                window: 'weekly',
                remaining_fraction: 0.8,
                reset_time: null,
              },
              {
                id: 'gemini-5h',
                window: '5h',
                remaining_fraction: 0.25,
                reset_time: '2026-09-29T18:00:00Z',
              },
            ],
          },
        ],
      },
    },
  };
}

describe('parseAntigravityVersion', () => {
  it('accepts the safe boundary and rejects the previous release', () => {
    expect(parseAntigravityVersion('agy version 1.1.11')).toEqual([1, 1, 11]);
    expect(isSupportedAntigravityVersion('1.1.10')).toBe(false);
    expect(isSupportedAntigravityVersion('1.1.11')).toBe(true);
    expect(isSupportedAntigravityVersion('v1.2.0-beta.1')).toBe(true);
  });

  it('rejects output without a semantic version', () => {
    expect(parseAntigravityVersion('development build')).toBeNull();
    expect(isSupportedAntigravityVersion('development build')).toBe(false);
  });
});

describe('parseAntigravityUsageResponse', () => {
  it('returns canonical groups and maps remaining fractions by named window', () => {
    expect(parseAntigravityUsageResponse(usageEnvelope(), NOW)).toEqual({
      status: 'ok',
      groups: [
        {
          id: 'gemini',
          label: 'Gemini Models',
          fiveHour: {
            usedPercent: 75,
            resetsAt: Date.parse('2026-09-29T18:00:00Z'),
          },
          sevenDay: { usedPercent: 20, resetsAt: null },
        },
        {
          id: 'third-party',
          label: 'Claude and GPT Models',
          fiveHour: { usedPercent: 40, resetsAt: 1_738_425_600_000 },
          sevenDay: {
            usedPercent: 90,
            resetsAt: Date.parse('2026-10-05T07:00:00Z'),
          },
        },
      ],
      fetchedAt: NOW,
    });
  });

  it('identifies groups from bucket ids when display names change', () => {
    const body = usageEnvelope() as {
      command: { data: { groups: Array<{ name: string }> } };
    };
    body.command.data.groups[0].name = 'External pool';
    body.command.data.groups[1].name = 'First-party pool';
    const result = parseAntigravityUsageResponse(body, NOW);
    expect(result?.status).toBe('ok');
    if (result?.status === 'ok')
      expect(result.groups.map((group) => group.id)).toEqual(['gemini', 'third-party']);
  });

  it('requires the safe zero-turn usage command envelope', () => {
    const base = usageEnvelope() as Record<string, unknown>;
    expect(parseAntigravityUsageResponse({ ...base, status: 'ERROR' }, NOW)).toBeNull();
    expect(parseAntigravityUsageResponse({ ...base, num_turns: 1 }, NOW)).toBeNull();
    expect(parseAntigravityUsageResponse({ ...base, usage: undefined }, NOW)).toBeNull();
    expect(
      parseAntigravityUsageResponse({
        ...base,
        usage: { input_tokens: 0, output_tokens: 0 },
      }),
    ).toBeNull();
    expect(parseAntigravityUsageResponse({ ...base, usage: { total_tokens: 1 } }, NOW)).toBeNull();
    expect(
      parseAntigravityUsageResponse({
        ...base,
        usage: { input_tokens: 0, output_tokens: 1, total_tokens: 0 },
      }),
    ).toBeNull();
    expect(
      parseAntigravityUsageResponse({
        ...base,
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          total_tokens: 0,
          details: { cached_tokens: 1 },
        },
      }),
    ).toBeNull();
    expect(
      parseAntigravityUsageResponse({
        ...base,
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          total_tokens: 0,
          model_breakdown: [{ name: 'gemini', token_count: 0 }, { reasoning_tokens: 1 }],
        },
      }),
    ).toBeNull();
    expect(
      parseAntigravityUsageResponse({
        ...base,
        command: { ...(base.command as object), name: 'prompt' },
      }),
    ).toBeNull();
  });

  it('returns null for unknown groups or missing group data', () => {
    expect(
      parseAntigravityUsageResponse({
        status: 'SUCCESS',
        num_turns: 0,
        command: { name: 'usage', data: { groups: [{ name: 'Unknown', buckets: [] }] } },
      }),
    ).toBeNull();
    expect(
      parseAntigravityUsageResponse({
        ...(usageEnvelope() as object),
        command: {
          name: 'usage',
          data: {
            groups: [
              { name: 'Gemini Models', buckets: [{ window: 'monthly', remaining_fraction: 1 }] },
            ],
          },
        },
      }),
    ).toBeNull();
    expect(parseAntigravityUsageResponse(null)).toBeNull();
  });
});

describe('fetchAntigravityUsage', () => {
  it('uses fixed argv and bounded execFile options, then caches a valid version probe', async () => {
    const exec = vi.fn<AntigravityExec>();
    exec.mockResolvedValueOnce({ stdout: '1.1.11\n' });
    exec.mockResolvedValue({ stdout: JSON.stringify(usageEnvelope()) });

    await expect(fetchAntigravityUsage(exec, NOW)).resolves.toMatchObject({ status: 'ok' });
    await expect(fetchAntigravityUsage(exec, NOW + 1)).resolves.toMatchObject({ status: 'ok' });

    expect(exec).toHaveBeenCalledTimes(3);
    expect(exec.mock.calls[0]?.slice(0, 2)).toEqual(['agy', ['--version']]);
    expect(exec.mock.calls[1]?.slice(0, 2)).toEqual([
      'agy',
      ['-p', '/usage', '--output-format', 'json'],
    ]);
    expect(exec.mock.calls[1]?.[2]).toMatchObject({
      encoding: 'utf8',
      timeout: 20_000,
      maxBuffer: 1024 * 1024,
    });
  });

  it('does not run /usage on an old or unparseable CLI', async () => {
    const old = vi.fn<AntigravityExec>().mockResolvedValue({ stdout: '1.1.10\n' });
    await expect(fetchAntigravityUsage(old)).resolves.toEqual({
      status: 'unavailable',
      reason: 'Antigravity CLI 1.1.11 or newer is required for safe usage checks',
    });
    expect(old).toHaveBeenCalledTimes(1);

    const unknown = vi.fn<AntigravityExec>().mockResolvedValue({ stdout: 'dev\n' });
    await expect(fetchAntigravityUsage(unknown)).resolves.toEqual({
      status: 'unavailable',
      reason: 'Unable to verify the installed Antigravity CLI version',
    });
    expect(unknown).toHaveBeenCalledTimes(1);
  });

  it('distinguishes a missing CLI without exposing command output', async () => {
    const missing = vi.fn<AntigravityExec>().mockRejectedValue(
      Object.assign(new Error('developer@example.com'), {
        code: 'ENOENT',
        stdout: 'secret stdout',
        stderr: 'secret stderr',
      }),
    );
    const result = await fetchAntigravityUsage(missing);
    expect(result).toEqual({ status: 'unavailable', reason: 'Antigravity CLI was not found' });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(JSON.stringify(result)).not.toContain('developer@example.com');
  });

  it('maps a killed usage command to a sanitized timeout error', async () => {
    const timeout = vi.fn<AntigravityExec>();
    timeout.mockResolvedValueOnce({ stdout: '1.2.0\n' });
    timeout.mockRejectedValueOnce(
      Object.assign(new Error('developer@example.com'), {
        code: 'ETIMEDOUT',
        killed: true,
        stdout: 'secret stdout',
        stderr: 'secret stderr',
      }),
    );
    const result = await fetchAntigravityUsage(timeout);
    expect(result).toEqual({ status: 'error', message: 'Antigravity usage check timed out' });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(JSON.stringify(result)).not.toContain('developer@example.com');
  });

  it('keeps malformed output recoverable without echoing CLI output', async () => {
    const invalidJson = vi.fn<AntigravityExec>();
    invalidJson.mockResolvedValueOnce({ stdout: '1.2.0\n' });
    invalidJson.mockResolvedValueOnce({ stdout: 'not json developer@example.com' });
    await expect(fetchAntigravityUsage(invalidJson)).resolves.toEqual({
      status: 'error',
      message: 'Antigravity returned invalid usage JSON',
    });

    const commandFailure = vi.fn<AntigravityExec>();
    commandFailure.mockResolvedValueOnce({ stdout: '1.2.0\n' });
    commandFailure.mockRejectedValueOnce(
      Object.assign(new Error('secret token developer@example.com'), { code: 7 }),
    );
    await expect(fetchAntigravityUsage(commandFailure)).resolves.toEqual({
      status: 'error',
      message: 'Antigravity usage command failed (7)',
    });
  });
});
