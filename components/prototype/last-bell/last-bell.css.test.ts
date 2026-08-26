import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./last-bell.module.css', import.meta.url), 'utf8');

describe('last bell shell CSS contract', () => {
  it('stacks the entry, status, and orientation layers deterministically', () => {
    expect(css).toMatch(/\.entryOverlay\s*\{[^}]*z-index:\s*4;/);
    expect(css).toMatch(/\.statusOverlay\s*\{[^}]*z-index:\s*5;/);
    expect(css).toMatch(/\.rotateHint\s*\{[^}]*z-index:\s*10;/);
    expect(css).toMatch(/\.root\[data-portrait='true'\]\s+\.rotateHint\s*\{\s*display:\s*grid;\s*\}/);
  });

  it('uses the bounded reduced-motion crossfade and applies brightness to the Canvas wrapper', () => {
    expect(css).toContain('filter: brightness(var(--scene-brightness));');
    expect(css).toMatch(/\.root\[data-reduced-motion='true'\]\s+\.entryAperture\s*\{\s*animation:\s*entryCrossfade 320ms/);
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('keeps the compact landscape HUD separated, touch-safe, and safe-area aware', () => {
    expect(css).toContain('env(safe-area-inset-left)');
    expect(css).toContain('grid-template-columns: 50px 64px;');
    expect(css).toContain('min-height: 50px;');
    expect(css).toContain('.actionButtonPrimary { grid-row: span 2;');
    expect(css).toContain('.topbar { top: max(.75rem, env(safe-area-inset-top)); left: auto;');
    expect(css).toContain('.objective { max-width: 100%; margin-left: auto;');
    expect(css).toContain('.pointerLockHint { display: none; }');
    expect(css).toContain('.prompt { right: max(.75rem, env(safe-area-inset-right));');
    expect(css).toContain('bottom: max(11.5rem, calc(env(safe-area-inset-bottom) + 10.75rem));');
  });

  it('keeps asset recovery controls above the touch HUD', () => {
    const assetStatusLayer = css.match(/\.campaignAssetStatus\s*\{[^}]*z-index:\s*(\d+);/)?.[1];
    const touchHudLayer = css.match(/\.campaignMobileControls\s*\{[^}]*z-index:\s*(\d+);/)?.[1];

    expect(assetStatusLayer).toBeDefined();
    expect(touchHudLayer).toBeDefined();
    expect(Number(assetStatusLayer)).toBeGreaterThan(Number(touchHudLayer));
  });
});
