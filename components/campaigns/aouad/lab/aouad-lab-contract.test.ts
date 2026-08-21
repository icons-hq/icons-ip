import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const hub = readFileSync(new URL('./ComparisonLabHub.tsx', import.meta.url), 'utf8');
const infection = readFileSync(new URL('./InfectionRecordPrototype.tsx', import.meta.url), 'utf8');
const arcade = readFileSync(new URL('./SurvivalArcadePrototype.tsx', import.meta.url), 'utf8');
const resultActions = readFileSync(new URL('./ComparisonResultActions.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('./aouad-lab.module.css', import.meta.url), 'utf8');

describe('AOUAD G2 lab client contracts', () => {
  it('keeps the three candidates visible from one comparison hub', () => {
    expect(hub).toContain("id: 'last-bell'");
    expect(hub).toContain("id: 'infection-record'");
    expect(hub).toContain("id: 'survival-arcade'");
    expect(hub).toContain("prefetch={candidate.id === 'last-bell' ? false : undefined}");
  });

  it('keeps the low-cost candidates free of Three/R3F and uses Next Image references', () => {
    for (const source of [hub, infection, arcade]) {
      expect(source).toContain("from 'next/image'");
      expect(source).not.toContain(' priority ');
      expect(source).not.toMatch(/@react-three|three|LastBellRuntime/i);
    }
    expect(hub).toContain('loading="eager"');
    expect(infection).toContain('loading="eager"');
    expect(arcade).toContain('loading="eager"');
    expect([hub, infection, arcade].join('\n')).not.toContain('preload');
  });

  it('keeps the arcade clock visible-only while simulation stays fixed-step', () => {
    expect(infection).toContain("from '@/lib/campaigns/aouad/lab/active-clock'");
    expect(infection).toContain("document.addEventListener('visibilitychange', onVisibilityChange)");
    expect(infection).toContain("document.visibilityState === 'visible'");
    expect(infection).not.toContain('performance.now() - (view.run?.startedPerformance');
    expect(arcade).toContain("document.visibilityState === 'visible'");
    expect(arcade).toContain("document.addEventListener('visibilitychange', onVisibilityChange)");
    expect(arcade).toContain("from '@/lib/campaigns/aouad/lab/active-clock'");
    expect(arcade).toContain('pendingActiveDurationRef.current += next.activeDurationMs');
    expect(arcade).not.toContain('activeClockRef.current = createAouadActiveClock();');
    expect(arcade).toContain('stepSurvivalArcadeSimulation(next, inputRef.current, SURVIVAL_ARCADE_FIXED_STEP_MS)');
  });

  it('moves focus to each completed candidate result and announces it to assistive technology', () => {
    for (const source of [infection, arcade]) {
      expect(source).toContain('resultHeadingRef.current?.focus()');
      expect(source).toContain('tabIndex={-1} ref={resultHeadingRef}');
      expect(source).toContain('role="status" aria-live="polite"');
    }
  });

  it('keeps G2 result persistence usable when browser storage is unavailable', () => {
    for (const source of [infection, arcade]) {
      expect(source).toContain("from '@/lib/campaigns/aouad/browser-storage'");
      expect(source).toContain('getOptionalStorage()');
      expect(source).not.toContain('saveAouadComparisonResult(window.localStorage');
    }
  });

  it('shows a replacement focus ring for the keyboard-focusable arcade arena', () => {
    expect(arcade).toContain('tabIndex={0}');
    expect(css).toContain('.arcadeArena:focus-visible');
    expect(css).toContain('outline-offset: 4px');
  });

  it('gives every result the same retry, share, popup, and store exit actions', () => {
    expect(resultActions).toContain('다시 하기');
    expect(resultActions).toContain('결과 공유');
    expect(resultActions).toContain('팝업으로 돌아가기');
    expect(resultActions).toContain('매점 미리보기');
  });
});
