import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC } from './channels.js';
import { readPlanForWorktree, startPlanWatcher, stopAllPlanWatchers } from './plans.js';

let worktreePath: string;
let taskId: string;
let previousGitOptionalLocks: string | undefined;
const PLAN_EVENT_TIMEOUT_MS = 10_000;
const PLAN_DEBOUNCE_MS = 200;

beforeEach(() => {
  previousGitOptionalLocks = process.env.GIT_OPTIONAL_LOCKS;
  // `git status` may refresh its index and emit a root fs.watch event on
  // macOS. Disable that optional write so startup recovery is not mistaken
  // for a live plan edit by the test harness.
  process.env.GIT_OPTIONAL_LOCKS = '0';
  worktreePath = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-detection-'));
  taskId = `task-${path.basename(worktreePath)}`;
  git('init', '--quiet');
});

afterEach(() => {
  stopAllPlanWatchers();
  fs.rmSync(worktreePath, { recursive: true, force: true });
  vi.restoreAllMocks();
  if (previousGitOptionalLocks === undefined) delete process.env.GIT_OPTIONAL_LOCKS;
  else process.env.GIT_OPTIONAL_LOCKS = previousGitOptionalLocks;
});

function git(...args: string[]): void {
  execFileSync('git', args, { cwd: worktreePath, stdio: 'pipe' });
}

function commitFiles(): void {
  git('add', '.');
  git(
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.com',
    'commit',
    '--quiet',
    '-m',
    'Initial files',
  );
}

function writeFile(relativePath: string, content = '# Theme plan'): void {
  const filePath = path.join(worktreePath, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function watchPlans() {
  const send = vi.fn();
  startPlanWatcher(send, taskId, worktreePath);
  return send;
}

async function waitForPlanCall(
  send: ReturnType<typeof vi.fn>,
  expectedPayload: unknown,
  fromCall = 0,
): Promise<void> {
  await vi.waitFor(
    () =>
      expect(send.mock.calls.slice(fromCall)).toContainEqual([IPC.PlanContent, expectedPayload]),
    { timeout: PLAN_EVENT_TIMEOUT_MS, interval: 50 },
  );
}

type WatchCallback = (eventType: string, fileName: string | Buffer | null) => void;

function stubFsWatch(): {
  emit: (directory: string, fileName: string) => void;
  isWatching: (directory: string) => boolean;
} {
  const callbacks = new Map<string, WatchCallback[]>();
  vi.spyOn(fs, 'watch').mockImplementation(((directory: fs.PathLike, callback: WatchCallback) => {
    const key = directory.toString();
    const entries = callbacks.get(key) ?? [];
    entries.push(callback);
    callbacks.set(key, entries);
    const watcher = {
      close: vi.fn(),
      on: vi.fn().mockReturnThis(),
    } as unknown as fs.FSWatcher;
    return watcher;
  }) as typeof fs.watch);
  return {
    emit: (directory, fileName) => {
      for (const callback of callbacks.get(directory) ?? []) callback('change', fileName);
    },
    isWatching: (directory) => callbacks.has(directory),
  };
}

describe('root-level plan files', { timeout: 15_000 }, () => {
  it.each(['example-plan.md', 'PLAN.md', 'implementation_plan.md', 'plan.v2.md'])(
    'reads %s for plan review and restores it by filename',
    (fileName) => {
      writeFile(fileName);
      const expected = { content: '# Theme plan', fileName, relativePath: fileName };
      expect(readPlanForWorktree(worktreePath)).toEqual(expected);
      expect(readPlanForWorktree(worktreePath, fileName)).toEqual(expected);
    },
  );

  it('does not treat unrelated root Markdown files as plans', () => {
    for (const file of ['README.md', 'AGENTS.md', 'explanation.md', 'planet.md']) writeFile(file);
    expect(readPlanForWorktree(worktreePath)).toBeNull();
    expect(readPlanForWorktree(worktreePath, 'README.md')).toBeNull();
  });

  it('compares root plans with the existing plan directories by modification time', () => {
    writeFile('.claude/plans/random-name.md', '# Old plan');
    fs.utimesSync(path.join(worktreePath, '.claude/plans/random-name.md'), 1, 1);
    writeFile('example-plan.md');
    expect(readPlanForWorktree(worktreePath)?.relativePath).toBe('example-plan.md');
    expect(readPlanForWorktree(worktreePath, 'random-name.md')?.content).toBe('# Old plan');
  });

  it('publishes a root plan when it is created, edited, and removed', async () => {
    const watched = stubFsWatch();
    const send = watchPlans();
    writeFile('example-plan.md');
    watched.emit(worktreePath, 'example-plan.md');
    await waitForPlanCall(send, {
      taskId,
      content: '# Theme plan',
      fileName: 'example-plan.md',
      relativePath: 'example-plan.md',
    });
    let fromCall = send.mock.calls.length;
    writeFile('example-plan.md', '# Updated plan');
    watched.emit(worktreePath, 'example-plan.md');
    await waitForPlanCall(send, expect.objectContaining({ content: '# Updated plan' }), fromCall);
    fromCall = send.mock.calls.length;
    fs.unlinkSync(path.join(worktreePath, 'example-plan.md'));
    watched.emit(worktreePath, 'example-plan.md');
    await waitForPlanCall(
      send,
      {
        taskId,
        content: null,
        fileName: null,
        relativePath: null,
      },
      fromCall,
    );
  });

  it('does not publish inherited plans on startup or unrelated root changes', async () => {
    writeFile('example-plan.md', '# Inherited plan');
    commitFiles();
    const watched = stubFsWatch();
    const send = watchPlans();
    writeFile('README.md');
    writeFile('package.json', '{}');
    // A live plan event is an observable barrier: once it is received, the
    // asynchronous startup recovery has either completed or has been
    // superseded by a real filesystem change. This avoids a timing sleep.
    writeFile('probe-plan.md', '# Watcher barrier');
    watched.emit(worktreePath, 'probe-plan.md');
    await waitForPlanCall(
      send,
      expect.objectContaining({
        content: '# Watcher barrier',
        relativePath: 'probe-plan.md',
      }),
    );
    expect(send.mock.calls.map((call) => call[1])).not.toContainEqual(
      expect.objectContaining({ content: '# Inherited plan' }),
    );
  });

  it.each(['example-plan.md', '.claude/plans/random-name.md', 'docs/plans/design.md'])(
    'discovers an existing uncommitted plan at startup: %s',
    async (relativePath) => {
      writeFile('.gitignore', '.claude/\n');
      writeFile(relativePath);
      const send = watchPlans();
      await waitForPlanCall(
        send,
        expect.objectContaining({ relativePath, content: '# Theme plan' }),
      );
    },
  );

  it('recovers a changed tracked plan while ignoring a newer inherited plan', async () => {
    writeFile('example-plan.md', '# Original');
    writeFile('docs/plans/inherited.md', '# Inherited');
    commitFiles();
    writeFile('example-plan.md', '# Task changes');
    fs.utimesSync(path.join(worktreePath, 'example-plan.md'), 1, 1);
    stubFsWatch();
    const send = watchPlans();
    await waitForPlanCall(
      send,
      expect.objectContaining({ relativePath: 'example-plan.md', content: '# Task changes' }),
    );
  });

  it('marks a plan found at startup as recovered, and a later write as live', async () => {
    writeFile('.gitignore', '.claude/\n');
    writeFile('.claude/plans/leftover.md', '# Leftover');
    const watched = stubFsWatch();
    const send = watchPlans();
    await waitForPlanCall(
      send,
      expect.objectContaining({ relativePath: '.claude/plans/leftover.md', recovered: true }),
    );

    const fromCall = send.mock.calls.length;
    writeFile('.claude/plans/fresh.md');
    watched.emit(path.join(worktreePath, '.claude/plans'), 'fresh.md');
    await waitForPlanCall(
      send,
      {
        taskId,
        content: '# Theme plan',
        fileName: 'fresh.md',
        relativePath: '.claude/plans/fresh.md',
      },
      fromCall,
    );
  });

  // A plan directory the agent creates mid-run is how an agent without hooks
  // (Codex) delivers its first plan, so the attach publish stays live.
  it('publishes a plan in a directory that only appears later as live', async () => {
    const send = watchPlans();
    writeFile('docs/plans/first.md');
    await waitForPlanCall(send, {
      taskId,
      content: '# Theme plan',
      fileName: 'first.md',
      relativePath: 'docs/plans/first.md',
    });
  });

  // An agent that runs `mkdir -p docs/plans` a step before writing into it must
  // not resurrect a leftover from `.claude/plans` in the meantime.
  it('publishes nothing when a new plan directory only exposes an older plan', async () => {
    writeFile('.gitignore', '.claude/\n');
    writeFile('.claude/plans/leftover.md', '# Leftover');
    const watched = stubFsWatch();
    const send = watchPlans();
    await waitForPlanCall(
      send,
      expect.objectContaining({ relativePath: '.claude/plans/leftover.md', recovered: true }),
    );

    const docsPlans = path.join(worktreePath, 'docs/plans');
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    fs.mkdirSync(docsPlans, { recursive: true });
    await vi.waitFor(() => expect(watched.isWatching(docsPlans)).toBe(true), {
      timeout: PLAN_EVENT_TIMEOUT_MS,
      interval: 50,
    });

    // The directory-poll callback has now scheduled the debounced publish.
    // Invoke that exact callback instead of sleeping for a poll interval plus
    // an assumed scheduling margin.
    let debounceCall = -1;
    for (let index = timeoutSpy.mock.calls.length - 1; index >= 0; index -= 1) {
      if (timeoutSpy.mock.calls[index]?.[1] !== PLAN_DEBOUNCE_MS) continue;
      debounceCall = index;
      break;
    }
    expect(debounceCall).toBeGreaterThanOrEqual(0);
    const debounceTimer = timeoutSpy.mock.results[debounceCall]?.value as
      | ReturnType<typeof setTimeout>
      | undefined;
    if (debounceTimer) clearTimeout(debounceTimer);
    const publish = timeoutSpy.mock.calls[debounceCall]?.[0];
    if (typeof publish !== 'function') throw new Error('Plan publish callback was not scheduled');
    publish();
    expect(send).toHaveBeenCalledTimes(1);
    timeoutSpy.mockRestore();
  });

  it.each(['.claude/plans/random-name.md', 'docs/plans/design.md'])(
    'still publishes changes in %s',
    async (relativePath) => {
      fs.mkdirSync(path.dirname(path.join(worktreePath, relativePath)), { recursive: true });
      const watched = stubFsWatch();
      const send = watchPlans();
      writeFile(relativePath);
      watched.emit(
        path.dirname(path.join(worktreePath, relativePath)),
        path.basename(relativePath),
      );
      await waitForPlanCall(
        send,
        expect.objectContaining({ relativePath, content: '# Theme plan' }),
      );
    },
  );
});
