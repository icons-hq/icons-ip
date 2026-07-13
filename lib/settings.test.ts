import { describe, expect, it } from 'vitest';
import type { OnboardingConsents } from './auth/onboarding';
import { mergeMarketingConsent } from './settings';

describe('mergeMarketingConsent', () => {
  it('updates only the marketing key and preserves stored required consents', () => {
    expect(mergeMarketingConsent({ terms: true, privacy: true, marketing: false }, true)).toEqual({
      terms: true,
      privacy: true,
      marketing: true,
    });
    expect(mergeMarketingConsent({ terms: true, privacy: true, marketing: true }, false)).toEqual({
      terms: true,
      privacy: true,
      marketing: false,
    });
  });

  it('preserves non-true stored values instead of coercing them', () => {
    expect(mergeMarketingConsent({ terms: null, privacy: false }, true)).toEqual({
      terms: null,
      privacy: false,
      marketing: true,
    });
  });

  it('preserves unknown keys stored in the consents jsonb', () => {
    const stored = { terms: true, privacy: true, marketing: false, locale: 'ko' } as OnboardingConsents;

    expect(mergeMarketingConsent(stored, true)).toEqual({
      terms: true,
      privacy: true,
      marketing: true,
      locale: 'ko',
    });
  });

  it('handles a missing consents value', () => {
    expect(mergeMarketingConsent(null, true)).toEqual({ marketing: true });
    expect(mergeMarketingConsent(undefined, false)).toEqual({ marketing: false });
  });
});
