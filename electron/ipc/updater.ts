// Parallel Code Custom is a personal distribution with an intentionally
// manual release process. Keep the upstream updater IPC contract so the UI and
// future merges remain simple, but never instantiate electron-updater or touch
// a release feed from this build.

import { app, type BrowserWindow } from 'electron';
import { IPC } from './channels.js';
import type { UpdateStatus } from './shared-types.js';
import { debug } from '../log.js';

const LOG = 'updater';

const status: UpdateStatus = {
  phase: 'unsupported',
  currentVersion: '',
  latestVersion: null,
  downloadPercent: 0,
  error: null,
};

function snapshot(): UpdateStatus {
  return { ...status };
}

/**
 * Publish the manual-update policy to the renderer. No updater singleton is
 * created and no startup timer or network request is scheduled.
 */
export function initAutoUpdater(win: BrowserWindow): void {
  status.currentVersion = app?.getVersion?.() ?? '';
  status.phase = 'unsupported';
  win.webContents.send(IPC.UpdateStatusChanged, snapshot());
  debug(LOG, 'automatic updates disabled for the personal Custom build');
}

/** Manual-policy no-op retained for the existing renderer IPC surface. */
export async function checkForUpdates(): Promise<UpdateStatus> {
  return snapshot();
}

/** Manual-policy no-op retained for the existing renderer IPC surface. */
export async function downloadUpdate(): Promise<UpdateStatus> {
  return snapshot();
}

/** Manual-policy no-op retained for the existing renderer IPC surface. */
export function quitAndInstallUpdate(): void {}

export function getUpdateStatus(): UpdateStatus {
  return snapshot();
}
