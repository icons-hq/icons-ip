import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./EntryOverlay.tsx', import.meta.url), 'utf8');

describe('Last Bell entry overlay', () => {
  it('uses the actual Hyosan entrance presentation instead of a logo or concept raster card', () => {
    expect(source).toContain('효산고등학교');
    expect(source).toContain('깨진 유리 너머');
    expect(source).not.toContain("from 'next/image'");
    expect(source).not.toContain('LAST_BELL_ASSETS.logo');
    expect(source).not.toContain('ch1-entry-brand-v1.png');
    expect(source).not.toContain('ch1-cold-open-seated-v1.png');
  });

  it('provides one accessible start gesture plus the later skip and checkpoint paths', () => {
    expect(source).toContain('onClick={onStart}');
    expect(source).not.toContain('disabled={!sceneReady}');
    expect(source).toContain("sceneReady ? '입장' : '입장 예약'");
    expect(source).toContain('onClick={onSkip}');
    expect(source).toContain('checkpointAction');
    expect(source).toContain('aria-expanded={settingsOpen}');
  });

  it('only covers preflight and brand; the cold-open leaves the Canvas visible', () => {
    expect(source).toContain('(isPreflight || isBrand) && <div className={styles.entryBlackout}');
    expect(source).toContain('{isColdOpen && (');
    expect(source).toContain('{isAperture && <div className={styles.entryAperture}');
  });

  it('keeps visible entry controls in a keyboard focus trap while the canvas is gated', () => {
    expect(source).toContain('data-entry-focus-trap="true"');
    expect(source).toContain('role="dialog"');
    expect(source).toContain('FOCUSABLE_SELECTOR');
    expect(source).toContain('const trapEntryTab');
  });
});
