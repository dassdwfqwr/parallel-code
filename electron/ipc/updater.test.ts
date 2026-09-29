import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getVersion } = vi.hoisted(() => ({ getVersion: vi.fn(() => '3.1.0-custom.1') }));

vi.mock('electron', () => ({ app: { getVersion } }));
vi.mock('../log.js', () => ({ debug: vi.fn() }));

import {
  checkForUpdates,
  downloadUpdate,
  getUpdateStatus,
  initAutoUpdater,
  quitAndInstallUpdate,
} from './updater.js';

describe('personal Custom update policy', () => {
  beforeEach(() => getVersion.mockClear());

  it('always reports manual-only without constructing an updater or scheduling a check', async () => {
    const send = vi.fn();
    initAutoUpdater({ webContents: { send } } as never);

    const expected = {
      phase: 'unsupported',
      currentVersion: '3.1.0-custom.1',
      latestVersion: null,
      downloadPercent: 0,
      error: null,
    };
    expect(getUpdateStatus()).toEqual(expected);
    expect(await checkForUpdates()).toEqual(expected);
    expect(await downloadUpdate()).toEqual(expected);
    expect(() => quitAndInstallUpdate()).not.toThrow();
    expect(send).toHaveBeenCalledWith('update_status_changed', expected);
  });
});
