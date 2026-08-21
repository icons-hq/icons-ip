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

  it('uses Next 16 preload for first-view hero media, and only allows preset avatars', () => {
    expect(source).toContain("import Image from 'next/image'");
    expect(source).toContain('className={styles.heroImage} src={AOUAD_IMAGES.hero} alt="비 내린 밤의 효산고등학교" fill preload sizes="100vw"');
    expect(source.match(/preload/g)).toHaveLength(2);
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
  });

  it('keeps a static alternative for the animated cafeteria timing action', () => {
    expect(source).toContain('cafeteriaActionForPreference(reduced, running)');
    expect(source).toContain("if (!running || reduced) return undefined");
    expect(source).toContain('조용히 지나가기');
  });
});
