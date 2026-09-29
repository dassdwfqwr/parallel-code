import { createEffect, onCleanup } from 'solid-js';
import { IPC } from '../../electron/ipc/channels';
import { invoke } from '../lib/ipc';
import { isWindowVisible } from '../lib/windowVisibility';
import type { ChangedFile } from '../ipc/types';
import {
  isCommitHashSelection,
  isUncommittedSelection,
  type CommitSelection,
} from './CommitNavBar';

export type ChangedFilesInventoryState =
  | { status: 'loading'; count: 0 }
  | { status: 'ready'; count: number }
  | { status: 'error'; count: 0 };

interface ChangedFilesInventoryProps {
  worktreePath: string;
  projectRoot?: string;
  branchName?: string | null;
  baseBranch?: string;
  selectedCommit?: CommitSelection;
  isActive?: boolean;
  onChange: (state: ChangedFilesInventoryState) => void;
}

/**
 * Poll only the changed-file inventory needed by the collapsed Review entry.
 * The full ChangedFilesList (tree, coverage, row actions) belongs to the review
 * dialog and is deliberately not mounted in the task column.
 */
export function ChangedFilesInventory(props: ChangedFilesInventoryProps) {
  createEffect(() => {
    const path = props.worktreePath;
    const projectRoot = props.projectRoot;
    const branchName = props.branchName;
    const baseBranch = props.baseBranch;
    const selection = props.selectedCommit;
    const singleCommitHash = isCommitHashSelection(selection) ? selection : null;
    const uncommittedOnly = isUncommittedSelection(selection);
    let cancelled = false;
    let inFlight = false;
    let usingBranchFallback = false;

    props.onChange({ status: 'loading', count: 0 });

    async function refresh() {
      if (inFlight) return;
      inFlight = true;
      try {
        if (singleCommitHash) {
          if (!path) throw new Error('A worktree is required to inspect a commit.');
          const files = await invoke<ChangedFile[]>(IPC.GetCommitChangedFiles, {
            worktreePath: path,
            commitHash: singleCommitHash,
          });
          if (!cancelled) props.onChange({ status: 'ready', count: files.length });
          return;
        }

        if (uncommittedOnly && path) {
          const files = await invoke<ChangedFile[]>(IPC.GetUncommittedChangedFiles, {
            worktreePath: path,
          });
          if (!cancelled) props.onChange({ status: 'ready', count: files.length });
          return;
        }

        if (path && !usingBranchFallback) {
          try {
            const files = await invoke<ChangedFile[]>(IPC.GetChangedFiles, {
              worktreePath: path,
              baseBranch,
            });
            if (!cancelled) props.onChange({ status: 'ready', count: files.length });
            return;
          } catch {
            // A restored task can outlive its worktree. Try its branch below.
          }
        }

        if (!usingBranchFallback && projectRoot && branchName) {
          usingBranchFallback = true;
          const files = await invoke<ChangedFile[]>(IPC.GetChangedFilesFromBranch, {
            projectRoot,
            branchName,
            baseBranch,
          });
          if (!cancelled) {
            const count = uncommittedOnly
              ? files.filter((file) => !file.committed).length
              : files.length;
            props.onChange({ status: 'ready', count });
          }
          return;
        }

        throw new Error('No repository is available for the changed-file inventory.');
      } catch {
        if (!cancelled) props.onChange({ status: 'error', count: 0 });
      } finally {
        inFlight = false;
      }
    }

    void refresh();
    const shouldPoll = singleCommitHash === null && props.isActive;
    const timer = shouldPoll
      ? setInterval(() => {
          if (!usingBranchFallback && isWindowVisible()) void refresh();
        }, 5000)
      : undefined;
    onCleanup(() => {
      cancelled = true;
      if (timer !== undefined) clearInterval(timer);
    });
  });

  return null;
}
