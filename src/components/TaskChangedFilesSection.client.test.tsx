import { createEffect, onCleanup } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import type { Task } from '../store/types';
import { TaskChangedFilesSection } from './TaskChangedFilesSection';
import type { ChangedFilesInventoryState } from './ChangedFilesInventory';

const inventory = vi.hoisted(() => ({
  mounts: 0,
  disposals: 0,
  report: (_state: ChangedFilesInventoryState) => {},
}));
const registeredFocus = vi.hoisted(() => ({ run: () => {} }));

vi.mock('../store/store', () => ({
  getProject: () => undefined,
  setActiveTask: vi.fn(),
  setTaskFocusedPanel: vi.fn(),
  isPanelFocused: () => false,
  openCanvasDocument: vi.fn(),
}));
vi.mock('../lib/theme', () => ({ theme: {} }));
vi.mock('../lib/fontScale', () => ({ sf: (size: number) => `${size}px` }));
vi.mock('../lib/focus-registration', () => ({
  useFocusRegistration: (_id: string, focus: () => void) => {
    registeredFocus.run = focus;
  },
}));
vi.mock('./CommitTreeOverlay', () => ({ CommitTreeOverlay: () => null }));
vi.mock('./CommitNavBar', () => ({
  CommitNavBar: () => null,
  isCommitHashSelection: (value: unknown) => typeof value === 'string',
  isUncommittedSelection: (value: unknown) => value === 'uncommitted',
}));
vi.mock('./ChangeTourButton', () => ({ ChangeTourButton: () => null }));
vi.mock('./ChangedFilesInventory', () => ({
  ChangedFilesInventory: (props: { onChange: (state: ChangedFilesInventoryState) => void }) => {
    inventory.mounts++;
    createEffect(() => {
      const report = props.onChange;
      inventory.report = (state) => report(state);
    });
    onCleanup(() => inventory.disposals++);
    return null;
  },
}));

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.replaceChildren();
});

const task: Task = {
  id: 'task',
  name: 'Task',
  projectId: 'project',
  agentIds: [],
  shellAgentIds: [],
  notes: '',
  gitIsolation: 'worktree',
  branchName: 'task/review',
  worktreePath: '/tmp/task',
  lastPrompt: '',
};

it('uses a lightweight inventory and exposes explicit review states', () => {
  const beforeMounts = inventory.mounts;
  const beforeDisposals = inventory.disposals;
  const onReviewClick = vi.fn();
  const onFileCountChange = vi.fn();
  const container = document.createElement('div');
  document.body.append(container);
  dispose = render(
    () => (
      <TaskChangedFilesSection
        task={task}
        isActive
        commitList={[]}
        selectedCommit={null}
        onCommitNavigate={() => {}}
        onReviewClick={onReviewClick}
        onFileCountChange={onFileCountChange}
        compact
      />
    ),
    container,
  );

  expect(inventory.mounts).toBe(beforeMounts + 1);
  expect(inventory.disposals).toBe(beforeDisposals);
  expect(container.querySelector('.changed-files-list-panel')).toBeNull();
  expect(container.querySelector('.file-row')).toBeNull();

  const review = container.querySelector<HTMLButtonElement>('.task-review-changes-button');
  expect(review?.textContent).toBe('Loading changes…');
  expect(review?.getAttribute('aria-disabled')).toBe('true');

  inventory.report({ status: 'ready', count: 0 });
  expect(review?.textContent).toBe('No changes');
  expect(review?.getAttribute('aria-disabled')).toBe('true');

  inventory.report({ status: 'error', count: 0 });
  expect(review?.textContent).toBe('Changes unavailable');
  expect(review?.getAttribute('title')).toBe('Could not load changed files');

  inventory.report({ status: 'ready', count: 4 });
  expect(review?.textContent).toBe('Review 4');
  expect(review?.getAttribute('aria-disabled')).toBe('false');
  expect(onFileCountChange).toHaveBeenCalledWith(4);

  registeredFocus.run();
  expect(document.activeElement).toBe(review);
  review?.click();
  expect(onReviewClick).toHaveBeenCalledOnce();
  expect(inventory.disposals).toBe(beforeDisposals);
});
