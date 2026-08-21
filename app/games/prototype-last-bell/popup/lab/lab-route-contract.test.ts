import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sources = [
  readFileSync(new URL('./page.tsx', import.meta.url), 'utf8'),
  readFileSync(new URL('./infection-record/page.tsx', import.meta.url), 'utf8'),
  readFileSync(new URL('./survival-arcade/page.tsx', import.meta.url), 'utf8'),
];

describe('AOUAD G2 comparison lab routes', () => {
  it('keeps every candidate route request-time gated and unindexable', () => {
    for (const source of sources) {
      expect(source).toContain("robots: { index: false, follow: false }");
      expect(source).toContain('await connection()');
      expect(source).toContain('isLastBellPrototypeEnabled()');
      expect(source).toContain('notFound()');
    }
  });

  it('keeps Three and the game runtime out of the cheap comparison routes', () => {
    for (const source of sources) {
      expect(source).not.toMatch(/three|LastBellRuntime|@react-three/i);
    }
  });
});
