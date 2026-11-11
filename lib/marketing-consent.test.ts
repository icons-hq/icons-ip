import { describe, expect, it } from 'vitest';
import {
  marketingChannelConsentLabel,
  marketingConsentResultMessage,
  parseMarketingConsentState,
  type MarketingChannelConsent,
} from './marketing-consent';

const email: MarketingChannelConsent = { agreed: true, agreedAt: '2026-10-27T01:00:00.123456+00:00', withdrawnAt: null, noticeVersion: 'marketing-channels-v1', source: 'settings' };

describe('marketing consent state', () => {
  it('accepts the DB document and rejects a derived flag that disagrees with the channels', () => {
    expect(parseMarketingConsentState({ noticeVersion: 'marketing-channels-v1', marketing: true, email, sms: null }))
      .toEqual({ marketing: true, email, sms: null });
    expect(parseMarketingConsentState({ marketing: false, email, sms: null })).toBeNull();
    expect(parseMarketingConsentState({ marketing: true, email: { ...email, source: 'unknown' }, sms: null })).toBeNull();
    expect(parseMarketingConsentState({ marketing: true, email: { ...email, agreedAt: null }, sms: null })).toBeNull();
  });

  /* 이관 동의(source legacy)는 실제 동의 시각이 기록된 적이 없다. */
  it('labels consent dates but never a migrated consent date', () => {
    expect(marketingChannelConsentLabel(email)).toBe('2026. 10. 27. 동의');
    expect(marketingChannelConsentLabel({ ...email, noticeVersion: 'marketing-legacy-v0', source: 'legacy' })).toBe('기존 동의(기록 전)');
    expect(marketingChannelConsentLabel({ ...email, agreed: false, agreedAt: null })).toBeNull();
    expect(marketingChannelConsentLabel(null)).toBeNull();
  });

  /* 인앱 알림함은 하나라도 동의하면 받는다 — 모두 끄면 그것도 끊긴다는 것을 결과에서 말한다. */
  it('says the in-app feed stops only when both channels are off', () => {
    const at = new Date('2026-10-27T03:00:00Z');
    expect(marketingConsentResultMessage({ email: false, sms: true }, at)).not.toContain('알림함');
    expect(marketingConsentResultMessage({ email: false, sms: false }, at))
      .toBe('ICONS 마케팅 정보 수신 설정을 저장했어요 · 이메일 수신 거부 · SMS 수신 거부 · 2026. 10. 27. 처리 · 알림함 마케팅 소식도 받지 않아요');
  });
});
