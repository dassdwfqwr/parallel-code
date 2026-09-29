import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PARALLEL_CODE_PROTOCOL } from './shared/super-productivity.js';
import { CUSTOM_USER_DATA_NAME } from './user-data-dir.js';

interface PackageBuildIdentity {
  appId?: string;
  productName?: string;
  extraMetadata?: { name?: string };
  protocols?: Array<{ name?: string; schemes?: string[] }>;
  publish?: unknown;
  mac?: { notarize?: boolean };
}

interface PackageIdentity {
  version?: string;
  build?: PackageBuildIdentity;
}

const pkg = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as PackageIdentity;

describe('personal Custom release identity', () => {
  it('keeps package, runtime profile and URL scheme independent from upstream', () => {
    expect(pkg.version).toMatch(/-custom\./);
    expect(pkg.build).toMatchObject({
      appId: 'com.parallel-code.custom',
      productName: 'Parallel Code Custom',
      extraMetadata: { name: 'parallel-code-custom' },
      protocols: [
        {
          name: 'Parallel Code Custom',
          schemes: [PARALLEL_CODE_PROTOCOL],
        },
      ],
      mac: { notarize: false },
    });
    expect(CUSTOM_USER_DATA_NAME).toBe('Parallel Code Custom');
  });

  it('does not package an upstream release feed', () => {
    expect(pkg.build?.publish).toBeUndefined();
  });
});
