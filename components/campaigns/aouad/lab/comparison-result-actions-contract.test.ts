import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./ComparisonResultActions.tsx', import.meta.url), 'utf8');

describe('AOUAD comparison result photo consent contract', () => {
  it('reads transient consent at click time for every shared ComparisonResultActions consumer', () => {
    expect(source).toContain('getAouadStudentPhotoSession()');
    expect(source).toContain('comparisonSharePhotoFromSession(getAouadStudentPhotoSession())');
    expect(source).toContain('window.location.href, { photo }');
  });
});
