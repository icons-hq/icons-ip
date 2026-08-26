import { describe, expect, it } from 'vitest';
import {
  LAST_BELL_LOCAL_QA_PATH,
  LAST_BELL_VERIFIED_EXPERIENCE_PATH,
  LAST_BELL_VERIFIED_STORE_PATH,
  isLastBellVerifiedCatalogEligible,
  isLastBellVerifiedExperienceEnabled,
  lastBellGameHref,
} from './game-entry';

describe('Last Bell popup game entry', () => {
  it('fails closed to the local non-authoritative QA host', () => {
    expect(isLastBellVerifiedExperienceEnabled({})).toBe(false);
    expect(lastBellGameHref({})).toBe(LAST_BELL_LOCAL_QA_PATH);
  });

  it('selects the verified host only when the feature gate and catalog eligibility are both explicit', () => {
    expect(lastBellGameHref({ ICONS_LAST_BELL_VERIFIED_EXPERIENCE: '1' })).toBe(LAST_BELL_LOCAL_QA_PATH);
    expect(lastBellGameHref({ ICONS_LAST_BELL_VERIFIED_CATALOG: '1' })).toBe(LAST_BELL_LOCAL_QA_PATH);
    const environment = {
      ICONS_LAST_BELL_VERIFIED_EXPERIENCE: '1',
      ICONS_LAST_BELL_VERIFIED_CATALOG: '1',
    };
    expect(isLastBellVerifiedCatalogEligible(environment)).toBe(true);
    expect(isLastBellVerifiedExperienceEnabled(environment)).toBe(true);
    expect(lastBellGameHref(environment)).toBe(LAST_BELL_VERIFIED_EXPERIENCE_PATH);
    expect(LAST_BELL_VERIFIED_STORE_PATH).toBe(`${LAST_BELL_VERIFIED_EXPERIENCE_PATH}/store`);
  });
});
