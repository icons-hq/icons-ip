import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./HyosanMemories.module.css', import.meta.url), 'utf8');

describe('Hyosan access gate styles', () => {
  it('keeps the title legible when global editorial heading styles are loaded', () => {
    const surfaceRule = css.match(/\.game,\s*\.loading,\s*\.accessGate\s*\{([^}]*)\}/)?.[1];
    const titleRule = css.match(/\.accessGate h1\s*\{([^}]*)\}/)?.[1];

    expect(surfaceRule).toMatch(/color:\s*#eef5f1\s*;/);
    expect(titleRule).toBeDefined();
    expect(titleRule).toMatch(/color:\s*inherit\s*;/);
  });
});
