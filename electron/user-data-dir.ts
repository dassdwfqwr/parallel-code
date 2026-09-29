import { app } from 'electron';
import path from 'path';

export const CUSTOM_USER_DATA_NAME = 'Parallel Code Custom';

/**
 * Per-instance data directory, given Electron's `userData` path.
 *
 * A dev run gets its own `<name>-dev` directory so `npm run dev` does not read
 * or write the installed build's data. Pure and parameterised so the rule can be
 * tested without an Electron runtime, and so there is exactly one copy of it.
 */
export function resolveUserDataDir(userDataPath: string, isPackaged: boolean): string {
  if (isPackaged) return userDataPath;
  const base = path.basename(userDataPath);
  return path.join(path.dirname(userDataPath), `${base}-dev`);
}

/**
 * Give the personal distribution a stable profile before it takes the
 * single-instance lock or creates any Chromium storage. This prevents both the
 * upstream app and development runs from reading or writing the Custom data.
 */
export function configureUserDataDir(): string {
  const base = path.join(app.getPath('appData'), CUSTOM_USER_DATA_NAME);
  const resolved = resolveUserDataDir(base, app.isPackaged);
  app.setPath('userData', resolved);
  return resolved;
}

/**
 * The per-instance data directory for this process.
 *
 * `configureUserDataDir` has already selected either the packaged Custom
 * profile or its `-dev` sibling before any caller can reach this helper.
 */
export function getUserDataDir(): string {
  return app.getPath('userData');
}
