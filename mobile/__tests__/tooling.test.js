import { expect, it } from '@jest/globals';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { loadNycConfig } = require('@istanbuljs/load-nyc-config');

it('loads YAML coverage configuration through the security-overridden parser', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'epickem-nyc-'));
  const config = join(directory, '.nycrc.yml');
  writeFileSync(config, 'include:\n  - src/**/*.tsx\nall: true\n');

  try {
    await expect(
      loadNycConfig({ cwd: directory, nycrcPath: config }),
    ).resolves.toMatchObject({ include: ['src/**/*.tsx'], all: true });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
