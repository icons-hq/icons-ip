import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const temporaryDirectories: string[] = [];
const root = process.cwd();

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('Last Bell committed route and character delivery validator', () => {
  it('validates provenance and review evidence on a clean runner without ignored raw source files', () => {
    const directory = mkdtempSync(join(tmpdir(), 'last-bell-clean-runner-validator-'));
    temporaryDirectories.push(directory);
    const reportPath = join(directory, 'report.json');
    const missingRawSourceRoot = join(directory, 'raw-sources-not-present');

    execFileSync(process.execPath, [
      resolve(root, 'scripts/last-bell-route-assets/validate.mjs'),
      resolve(root, 'public/generated/last-bell/3d'),
      reportPath,
    ], {
      env: { ...process.env, LAST_BELL_RAW_SOURCE_ROOT: missingRawSourceRoot },
      stdio: 'pipe',
    });

    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    expect(report.build_id).toBe('last-bell-route-character-99f9d262441685b4');
    expect(report.validation).toBe('pass');
    expect(report.blenderkit_private_inputs.raw_source_files_revalidated).toBe(0);
    expect(report.blenderkit_private_inputs.committed_provenance_evidence).toContain('release-evidence');
    expect(report.blenderkit_private_inputs.committed_visual_gate_evidence).toContain('release-evidence');
  });
});
