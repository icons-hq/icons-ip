import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const temporaryDirectories: string[] = [];
const root = process.cwd();

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('Last Bell opening delivery validator', () => {
  it('accepts the retained authored first-bay semantic roles without requiring candidate-only node names', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'last-bell-opening-validator-'));
    temporaryDirectories.push(directory);
    const delivery = join(directory, '3d');
    await cp(resolve(root, 'public/generated/last-bell/3d'), delivery, { recursive: true });

    const output = execFileSync(process.execPath, [
      resolve(root, 'scripts/last-bell-3d/validate.mjs'),
      delivery,
    ], { encoding: 'utf8' });

    const report = JSON.parse(output);
    expect(report.build_id).toBe('last-bell-3d-e3367030b580e17d');
    expect(report.models.find((model: { file: string }) => model.file === 'first-bay.glb')).toBeTruthy();
  });
});
