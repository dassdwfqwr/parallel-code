import { createEffect, onCleanup } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import type { Task } from '../store/types';
import { TaskChangedFilesSection } from './TaskChangedFilesSection';

const inventory = vi.hoisted(() => ({
  mounts: 0,
  disposals: 0,
  report: (_count: number) => {},
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
vi.mock('./ChangedFilesList', () => ({
  ChangedFilesList: (props: { onFileCountChange?: (count: number) => void }) => {
    inventory.mounts++;
    createEffect(() => {
      const reportCount = props.onFileCountChange;
      inventory.report = (count) => reportCount?.(count);
    });
    onCleanup(() => inventory.disposals++);
    return <div class="test-mounted-file-list" />;
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

it('keeps the inventory mounted while exposing a focusable compact review count', () => {
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
        onDiffFileClick={() => {}}
        onReviewClick={onReviewClick}
        onFileCountChange={onFileCountChange}
        compact
      />
    ),
    container,
  );

  expect(inventory.mounts).toBe(beforeMounts + 1);
  expect(inventory.disposals).toBe(beforeDisposals);
  expect(container.querySelector('.test-mounted-file-list')).not.toBeNull();
  expect(container.querySelector('.file-row')).toBeNull();

  inventory.report(4);
  const review = container.querySelector<HTMLButtonElement>('.task-review-changes-button');
  expect(review?.textContent).toContain('Review changes (4)');
  expect(onFileCountChange).toHaveBeenCalledWith(4);

  registeredFocus.run();
  expect(document.activeElement).toBe(review);
  review?.click();
  expect(onReviewClick).toHaveBeenCalledOnce();
  expect(inventory.disposals).toBe(beforeDisposals);
});
