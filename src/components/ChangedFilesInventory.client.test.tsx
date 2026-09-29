import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { IPC } from '../../electron/ipc/channels';
import { invoke } from '../lib/ipc';
import { ChangedFilesInventory, type ChangedFilesInventoryState } from './ChangedFilesInventory';

vi.mock('../lib/ipc', () => ({ invoke: vi.fn() }));
vi.mock('../lib/windowVisibility', () => ({ isWindowVisible: () => true }));

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  vi.mocked(invoke).mockReset();
});

async function flush(): Promise<void> {
  for (let i = 0; i < 4; i += 1) await Promise.resolve();
}

it('loads only a lightweight count for the collapsed Review entry', async () => {
  vi.mocked(invoke).mockResolvedValueOnce([{ path: 'src/a.ts' }, { path: 'src/b.ts' }]);
  const states: ChangedFilesInventoryState[] = [];

  dispose = render(
    () => (
      <ChangedFilesInventory
        worktreePath="/task"
        branchName="task/review"
        onChange={(state) => states.push(state)}
      />
    ),
    document.createElement('div'),
  );
  await flush();

  expect(states).toEqual([
    { status: 'loading', count: 0 },
    { status: 'ready', count: 2 },
  ]);
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(invoke).toHaveBeenCalledWith(IPC.GetChangedFiles, {
    worktreePath: '/task',
    baseBranch: undefined,
  });
  expect(vi.mocked(invoke).mock.calls.some(([channel]) => channel === IPC.GetCoverageSummary)).toBe(
    false,
  );
});

it('falls back to the saved branch and reports a terminal error explicitly', async () => {
  vi.mocked(invoke)
    .mockRejectedValueOnce(new Error('worktree gone'))
    .mockResolvedValueOnce([{ path: 'src/a.ts', committed: true }]);
  const fallbackStates: ChangedFilesInventoryState[] = [];

  dispose = render(
    () => (
      <ChangedFilesInventory
        worktreePath="/missing"
        projectRoot="/repo"
        branchName="task/review"
        onChange={(state) => fallbackStates.push(state)}
      />
    ),
    document.createElement('div'),
  );
  await flush();

  expect(fallbackStates.at(-1)).toEqual({ status: 'ready', count: 1 });
  expect(invoke).toHaveBeenLastCalledWith(IPC.GetChangedFilesFromBranch, {
    projectRoot: '/repo',
    branchName: 'task/review',
    baseBranch: undefined,
  });

  dispose();
  dispose = undefined;
  vi.mocked(invoke).mockReset();
  const errorStates: ChangedFilesInventoryState[] = [];
  dispose = render(
    () => <ChangedFilesInventory worktreePath="" onChange={(state) => errorStates.push(state)} />,
    document.createElement('div'),
  );
  await flush();

  expect(errorStates).toEqual([
    { status: 'loading', count: 0 },
    { status: 'error', count: 0 },
  ]);
});
