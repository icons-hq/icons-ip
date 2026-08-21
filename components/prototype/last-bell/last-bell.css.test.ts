import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./last-bell.module.css', import.meta.url), 'utf8');

describe('last bell portrait rotation overlay contract', () => {
  it('keeps the overlay above the scene, cinematic, and status layers', () => {
    expect(css).toMatch(/\.rotateHint\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?z-index:\s*10;/);
    expect(css).toMatch(/\.cinematic\s*\{[\s\S]*?z-index:\s*4;/);
    expect(css).toMatch(/\.statusOverlay\s*\{[\s\S]*?z-index:\s*5;/);
  });

  it('only displays for the portrait state and hides in landscape', () => {
    expect(css).toMatch(/\.rotateHint\s*\{[\s\S]*?display:\s*none;/);
    expect(css).toMatch(/\.root\[data-portrait='true'\]\s+\.rotateHint\s*\{\s*display:\s*grid;\s*\}/);
    expect(css).toMatch(/\.root\[data-portrait='false'\]\s+\.rotateHint\s*\{\s*display:\s*none;\s*\}/);
  });
});
