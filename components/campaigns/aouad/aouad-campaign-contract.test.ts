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
    expect(source).not.toContain('<AouadCampaignProvider>');
  });

  it('preloads only the currently visible first-view hero and keeps student photo input local and opt-in', () => {
    expect(source).toContain("import Image from 'next/image'");
    expect(source).toContain('src={AOUAD_IMAGES.theater} alt="" fill preload sizes="100vw"');
    expect(source).toContain('className={styles.heroImage} src={AOUAD_IMAGES.hero} alt="비 내린 밤의 효산고등학교" fill preload={preloadHero && state.openingSeen} sizes="100vw"');
    expect(source).toContain('src={item.image} alt="" fill sizes="100vw" preload={preloadHero && state.openingSeen}');
    expect(source).toContain('preloadHero={!openingOpen}');
    expect(source).not.toContain(' priority ');
    expect(source).toContain('type="file" accept="image/jpeg,image/png,image/webp"');
    expect(source).toContain('validateAouadStudentPhoto(file)');
    expect(source).toContain('URL.createObjectURL(file)');
    expect(source).toContain('setAouadStudentPhotoUrl(next)');
    expect(source).toContain('getAouadStudentPhotoSession');
    expect(source).not.toContain('URL.revokeObjectURL');
    expect(source).toContain('사진은 이 브라우저 메모리에만 잠시 보관됩니다.');
    expect(source).toContain('공유 카드에 내 사진을 포함합니다');
    expect(source).toContain('photo: includeStudentPhotoInShare && studentPhotoUrl ? { src: studentPhotoUrl } : undefined');
    expect(source).not.toContain('FileReader');
    expect(source).not.toContain('localStorage');
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
    expect(source).toContain('const isRevisit = state.openingSeen;');
    expect(source).toContain("효산고 재소집");
    expect(source).toContain('다시 들어가기');
    expect(source).toContain('const isOpen = !dismissed;');
    expect(source).toContain('if (!isOpen) return null;');
    expect(source).toContain('markAouadOpeningDismissedInDocument();');
    expect(source).toContain('const showOpeningForDocument = !isAouadOpeningDismissedInDocument();');
    expect(source).not.toContain('claimAouadOpeningForDocument');
    expect(source).not.toContain("'지난 기록은 이 기기에 남아 있어.<br />짧게 확인하고 다시 들어가자.'");
    expect(source).toContain('<>지난 기록은 이 기기에 남아 있어.<br />짧게 확인하고 다시 들어가자.</>');
    expect(source).toContain('<StudentPhotoControls');
    expect(source).toContain('compact');
    expect(css).toContain('align-items: safe center;');
    expect(css).toContain('max-height: calc(var(--opening-viewport-height) - var(--opening-max-height-offset));');
    expect(css).toContain('overflow-y: auto;');
  });

  it('keeps the six student-ID seals wrapped within a narrow card', () => {
    expect(css).toContain('.sealRow {\n  gap: 8px;\n  flex-wrap: wrap;');
  });

  it('keeps five rally seals distinct from the Last Bell survival seal and shares approved route labels', () => {
    expect(source).toContain('LAST_BELL_ROUTE_LABELS[lastBellCompletion.routeId]');
    expect(source).toContain('AOUAD_RALLY_ZONE_IDS.map((zone) => {');
    expect(source).toContain('>마지막 종{lastBellCompletion ?');
    expect(source).toContain("aria-label={`마지막 종 인장 ${lastBellCompletion ? '획득' : '미획득'}`}");
    expect(source).toContain("aria-label={`${AOUAD_ZONES[zone].name} 인장 ${acquired ? '획득' : '미획득'}`}");
    expect(source).toContain('className={styles.sealStatus} aria-hidden="true"> ✓</span>');
    expect(source).toContain("lastBellCompletion ? '다시 플레이' : '게임 시작'");
  });

  it('gives each student photo input stable descriptions and an error status', () => {
    expect(source).toContain('useId');
    expect(source).toContain('const photoFieldId = useId();');
    expect(source).toContain('const photoDescribedBy = photoError ? `${photoPrivacyId} ${photoErrorId}` : photoPrivacyId;');
    expect(source).toContain('aria-describedby={photoDescribedBy} aria-invalid={photoError ? true : undefined}');
    expect(source).toContain('id={photoErrorId} className={styles.photoError} role="status" aria-live="polite"');
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
