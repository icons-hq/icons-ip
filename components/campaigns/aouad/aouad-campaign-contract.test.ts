import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./AouadCampaignPopup.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('./aouad-campaign.module.css', import.meta.url), 'utf8');

describe('AOUAD popup shell contract', () => {
  it('keeps the heavy gameplay runtime outside the popup shell and avoids eager game prefetching', () => {
    expect(source).not.toContain('LastBellRuntime');
    expect(source).not.toContain('@react-three/fiber');
    expect(source).not.toContain("from 'three'");
    expect(source).toContain('prefetch={false}');
  });

  it('preloads only the currently visible first-view hero and only allows preset avatars', () => {
    expect(source).toContain("import Image from 'next/image'");
    expect(source).toContain('src={AOUAD_IMAGES.theater} alt="" fill preload sizes="100vw"');
    expect(source).toContain('className={styles.heroImage} src={AOUAD_IMAGES.hero} alt="비 내린 밤의 효산고등학교" fill preload={state.openingSeen} sizes="100vw"');
    expect(source).toContain('src={item.image} alt="" fill sizes="100vw" preload={state.openingSeen}');
    expect(source).not.toContain(' priority ');
    expect(source).not.toContain('type="file"');
    expect(source).not.toContain('data:');
  });

  it('keeps touch target and reduced-motion protections in the local CSS contract', () => {
    expect(css).toContain('min-height: 48px');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('@media (max-width: 640px)');
  });

  it('makes the opening a contained modal with focus recovery', () => {
    expect(source).toContain('role="dialog" aria-modal="true"');
    expect(source).toContain("event.key !== 'Tab'");
    expect(source).toContain("document.addEventListener('keydown', trapFocus)");
    expect(source).toContain('previousFocusRef.current?.focus()');
    expect(source).toContain('primaryFocusRef.current');
    expect(source).toContain('skipFocusRef.current');
    expect(source).toContain('isAouadOpeningReady(ready, reduced)');
    expect(source).toContain("if (event.key === 'Escape')");
    expect(source).toContain("skipFromKeyboard();");
    expect(source).toContain("complete('skip')");
  });

  it('keeps a static alternative available without relying on motion preferences', () => {
    expect(source).toContain('cafeteriaActionForPreference(reduced, running, staticAlternative)');
    expect(source).toContain("if (!running || reduced) return undefined");
    expect(source).toContain('조용히 지나가기');
    expect(source).toContain('정적 안내로 지나가기');
    expect(source).toContain('aria-describedby="cafeteria-static-help"');
    expect(source).toContain('aria-live="polite"');
  });

  it('keeps prototype copy honest and avoids an unconfirmed canonical class', () => {
    expect(source).toContain('압축 수직 슬라이스 · 내부 비교 후보');
    expect(source).toContain('학급 미확정');
    expect(source).not.toContain('5–7분의 생존 이야기');
    expect(source).not.toContain('2학년 5반');
  });
});
