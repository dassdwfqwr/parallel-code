import { describe, expect, it } from 'vitest';
import path from 'path';
import { CUSTOM_USER_DATA_NAME, resolveUserDataDir } from './user-data-dir.js';

describe('resolveUserDataDir', () => {
  const userData = path.join('/home', 'someone', '.config', 'parallel-code');

  it('uses the userData path as-is in a packaged build', () => {
    expect(resolveUserDataDir(userData, true)).toBe(userData);
  });

  it('appends -dev to the last segment in a dev run', () => {
    expect(resolveUserDataDir(userData, false)).toBe(
      path.join('/home', 'someone', '.config', 'parallel-code-dev'),
    );
  });

  // Suffixing the whole path instead of the last segment would put dev's data
  // in a sibling of the config root rather than beside the packaged profile.
  it('keeps the parent directory', () => {
    expect(path.dirname(resolveUserDataDir(userData, false))).toBe(path.dirname(userData));
  });

  it('uses a stable Custom profile name', () => {
    expect(CUSTOM_USER_DATA_NAME).toBe('Parallel Code Custom');
  });
});
