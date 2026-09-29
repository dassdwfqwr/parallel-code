import { Show, createMemo, createSignal, onMount } from 'solid-js';
import { getProject, setActiveTask, setTaskFocusedPanel, isPanelFocused } from '../store/store';
import { CommitTreeOverlay } from './CommitTreeOverlay';
import {
  CommitNavBar,
  isCommitHashSelection,
  isUncommittedSelection,
  type CommitSelection,
} from './CommitNavBar';
import { theme } from '../lib/theme';
import { sf } from '../lib/fontScale';
import { useFocusRegistration } from '../lib/focus-registration';
import type { Task } from '../store/types';
import type { CommitInfo } from '../ipc/types';
import type { ChangeTourController } from '../lib/create-change-tour';
import { getTaskDiffBaseBranch } from '../lib/load-task-diff';
import { ChangeTourButton } from './ChangeTourButton';
import { ChangedFilesInventory, type ChangedFilesInventoryState } from './ChangedFilesInventory';

interface TaskChangedFilesSectionProps {
  tour?: ChangeTourController;
  onTourClick?: () => void;
  tourDisabled?: boolean;
  task: Task;
  isActive: boolean;
  commitList: CommitInfo[];
  selectedCommit: CommitSelection;
  onCommitNavigate: (selection: CommitSelection) => void;
  onReviewClick: () => void;
  /** Shrink to the review entry when no other support content needs the space. */
  compact?: boolean;
  onFileCountChange?: (count: number) => void;
}

export function TaskChangedFilesSection(props: TaskChangedFilesSectionProps) {
  const [inventory, setInventory] = createSignal<ChangedFilesInventoryState>({
    status: 'loading',
    count: 0,
  });
  const diffBaseBranch = () =>
    getTaskDiffBaseBranch(props.task.gitIsolation, props.task.baseBranch);
  const hasCommitNav = () =>
    props.task.gitIsolation === 'worktree' || props.task.gitIsolation === 'direct';
  // The tree button only earns its place once a branch has history to graph — a
  // single commit is already covered by the file list + nav bar.
  const canShowTree = () => hasCommitNav() && props.commitList.length > 1;
  const selectedCommitInfo = () =>
    isCommitHashSelection(props.selectedCommit) && hasCommitNav()
      ? props.commitList.find((c) => c.hash === props.selectedCommit)
      : undefined;
  const showUncommittedBanner = () =>
    isUncommittedSelection(props.selectedCommit) && hasCommitNav();
  const focusChangedFilesPanel = () => {
    setActiveTask(props.task.id);
    setTaskFocusedPanel(props.task.id, 'changed-files');
  };
  const reviewLabel = createMemo(() => {
    const state = inventory();
    if (state.status === 'loading') return 'Loading changes…';
    if (state.status === 'error') return 'Changes unavailable';
    if (state.count === 0) return 'No changes';
    return `Review ${state.count}`;
  });
  const reviewReady = () => inventory().status === 'ready' && inventory().count > 0;
  const updateInventory = (state: ChangedFilesInventoryState) => {
    setInventory(state);
    props.onFileCountChange?.(state.count);
  };

  let reviewButtonRef: HTMLButtonElement | undefined;

  onMount(() => {
    const id = props.task.id;
    useFocusRegistration(`${id}:changed-files`, () => {
      reviewButtonRef?.focus();
    });
  });

  return (
    <div
      class="task-changed-files-section focusable-panel"
      data-panel-focused={isPanelFocused(props.task.id, 'changed-files') ? 'true' : 'false'}
      style={{
        // Review is a content-sized launcher. The full list and coverage UI
        // mount only inside DiffViewerDialog after the launcher is activated.
        'min-height': '42px',
        'min-width': '0',
        background: theme.taskPanelBg,
        display: 'flex',
        'flex-direction': 'column',
      }}
      onClick={focusChangedFilesPanel}
    >
      <Show when={hasCommitNav() && (props.commitList.length > 0 || props.selectedCommit !== null)}>
        <div
          style={{
            padding: '4px 8px',
            'font-size': sf(11),
            'font-weight': '600',
            color: theme.fgMuted,
            'text-transform': 'uppercase',
            'letter-spacing': '0.05em',
            'border-bottom': `1px solid ${theme.border}`,
            'flex-shrink': '0',
            display: 'flex',
            'align-items': 'center',
            gap: '6px',
          }}
        >
          <span
            title="Changed Files"
            style={{
              flex: '1',
              'min-width': '0',
              overflow: 'hidden',
              'white-space': 'nowrap',
              'text-overflow': 'ellipsis',
            }}
          >
            Changed Files
          </span>
          <div style={{ display: 'flex', 'align-items': 'center', gap: '6px', 'flex-shrink': '0' }}>
            <Show when={canShowTree()}>
              <CommitTreeOverlay
                commits={props.commitList}
                worktreePath={props.task.worktreePath}
                baseBranch={diffBaseBranch()}
                selectedCommit={props.selectedCommit}
                onSelectCommit={props.onCommitNavigate}
              />
            </Show>
            <CommitNavBar
              commits={props.commitList}
              selectedCommitHash={props.selectedCommit}
              onNavigate={props.onCommitNavigate}
              compact={true}
            />
          </div>
        </div>
      </Show>
      <Show when={selectedCommitInfo()}>
        {(commit) => (
          <div
            title={`${commit().hash.slice(0, 7)} ${commit().message}`}
            style={{
              padding: '4px 8px',
              'font-size': sf(11),
              'font-family': "'JetBrains Mono', monospace",
              color: theme.fgMuted,
              'border-bottom': `1px solid ${theme.border}`,
              'flex-shrink': '0',
              'white-space': 'nowrap',
              overflow: 'hidden',
              'text-overflow': 'ellipsis',
            }}
          >
            <span style={{ color: theme.accent, 'font-weight': '600' }}>
              {commit().hash.slice(0, 7)}
            </span>{' '}
            {commit().message}
          </div>
        )}
      </Show>
      <Show when={showUncommittedBanner()}>
        <div
          style={{
            padding: '4px 8px',
            'font-size': sf(11),
            'font-family': "'JetBrains Mono', monospace",
            color: theme.fgMuted,
            'border-bottom': `1px solid ${theme.border}`,
            'flex-shrink': '0',
            'white-space': 'nowrap',
            overflow: 'hidden',
            'text-overflow': 'ellipsis',
          }}
        >
          Uncommitted changes only
        </div>
      </Show>
      <button
        ref={(el) => (reviewButtonRef = el)}
        type="button"
        class="task-review-changes-button"
        onClick={(event) => {
          event.stopPropagation();
          focusChangedFilesPanel();
          if (reviewReady()) props.onReviewClick();
        }}
        aria-disabled={!reviewReady()}
        aria-busy={inventory().status === 'loading'}
        aria-live="polite"
        title={inventory().status === 'error' ? 'Could not load changed files' : undefined}
        style={{
          margin: '6px 8px',
          padding: '5px 8px',
          border: `1px solid ${theme.border}`,
          'border-radius': 'var(--radius-sm)',
          background: theme.bgElevated,
          color: theme.fg,
          'font-size': sf(12),
          'font-weight': '600',
          'text-align': 'left',
          cursor: reviewReady() ? 'pointer' : 'default',
          opacity: inventory().status === 'error' ? '0.75' : '1',
          'flex-shrink': '0',
        }}
      >
        {reviewLabel()}
      </button>
      <ChangedFilesInventory
        worktreePath={props.task.worktreePath}
        projectRoot={getProject(props.task.projectId)?.path}
        branchName={props.task.branchName}
        baseBranch={diffBaseBranch()}
        isActive={props.isActive}
        selectedCommit={props.selectedCommit}
        onChange={updateInventory}
      />
      <Show when={!props.compact ? props.tour : undefined}>
        {(tour) => (
          <ChangeTourButton
            tour={tour()}
            disabled={props.tourDisabled}
            onClick={() => props.onTourClick?.()}
          />
        )}
      </Show>
    </div>
  );
}
