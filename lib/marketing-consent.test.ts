import { describe, expect, it } from 'vitest';
import {
  MARKETING_CONSENT_NOTICE,
  marketingChannelChoices,
  marketingChannelConsentLabel,
  marketingConsentNoticeFor,
  marketingConsentResultMessage,
  marketingKakaoVisible,
  parseMarketingConsentState,
  readMarketingChannelChoices,
  type MarketingChannelConsent,
} from './marketing-consent';

const email: MarketingChannelConsent = { agreed: true, agreedAt: '2026-10-27T01:00:00.123456+00:00', withdrawnAt: null, noticeVersion: 'marketing-channels-v1', source: 'settings' };

describe('marketing consent state', () => {
  it('accepts the DB document and rejects a derived flag that disagrees with the channels', () => {
    expect(parseMarketingConsentState({ noticeVersion: 'marketing-channels-v1', marketing: true, email, sms: null }))
      .toEqual({ marketing: true, email, sms: null, kakao: null });
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

/* 1014-010 — 카카오톡 수신 동의는 카카오톡 채널 스위치가 켜졌을 때만 받는다. 꺼져 있으면 예전 두 수단 그대로다. */
describe('kakao marketing channel', () => {
  const kakao: MarketingChannelConsent = { ...email, noticeVersion: 'marketing-channels-v2' };

  function form(values: Record<string, string>) {
    const data = new FormData();
    for (const [key, value] of Object.entries(values)) data.set(key, value);
    return data;
  }

  it('parses the kakao channel and counts it in the derived flag', () => {
    expect(parseMarketingConsentState({ marketing: true, email: null, sms: null, kakao }))
      .toEqual({ marketing: true, email: null, sms: null, kakao });
    expect(parseMarketingConsentState({ marketing: false, email: null, sms: null, kakao })).toBeNull();
    expect(parseMarketingConsentState({ marketing: true, email: null, sms: null, kakao: { ...kakao, agreed: 'yes' } })).toBeNull();
  });

  it('keeps the two-channel choices unless the kakao row is drawn', () => {
    const state = { marketing: true, email, sms: null, kakao };
    expect(marketingChannelChoices(state)).toEqual({ email: true, sms: false });
    expect(marketingChannelChoices(state, { withKakao: true })).toEqual({ email: true, sms: false, kakao: true });
  });

  it('draws the kakao row while the switch is on, or while a member still has a kakao consent to withdraw', () => {
    expect(marketingKakaoVisible(false, null)).toBe(false);
    expect(marketingKakaoVisible(false, { marketing: true, email, sms: null, kakao: null })).toBe(false);
    expect(marketingKakaoVisible(true, null)).toBe(true);
    expect(marketingKakaoVisible(false, { marketing: true, email: null, sms: null, kakao })).toBe(true);
  });

  it('reads kakao only from a form that drew the row, and takes only a withdrawal while the switch is off', () => {
    expect(readMarketingChannelChoices(form({ marketingEmail: 'on', marketingKakao: 'on' }))).toEqual({ email: true, sms: false });
    expect(readMarketingChannelChoices(form({ marketingKakaoOffered: '1', marketingKakao: 'on' }), { kakaoChannelOn: true }))
      .toEqual({ email: false, sms: false, kakao: true });
    expect(readMarketingChannelChoices(form({ marketingKakaoOffered: '1', marketingKakao: 'on' }), { kakaoChannelOn: false }))
      .toEqual({ email: false, sms: false });
    expect(readMarketingChannelChoices(form({ marketingKakaoOffered: '1' }), { kakaoChannelOn: false }))
      .toEqual({ email: false, sms: false, kakao: false });
  });

  it('uses the v2 notice only with kakao and keeps the v1 notice text otherwise', () => {
    expect(marketingConsentNoticeFor(['email', 'sms'])).toMatchObject({ version: 'marketing-channels-v1', notice: { ...MARKETING_CONSENT_NOTICE, kakao: '' } });
    const withKakao = marketingConsentNoticeFor(['email', 'sms', 'kakao']);
    expect(withKakao.version).toBe('marketing-channels-v2');
    expect(withKakao.notice.inApp).toContain('이메일·SMS·카카오톡 중 하나라도');
  });

  it('reports the kakao choice in the saved-result message', () => {
    const at = new Date('2026-11-11T03:00:00Z');
    expect(marketingConsentResultMessage({ email: false, sms: false, kakao: true }, at))
      .toBe('ICONS 마케팅 정보 수신 설정을 저장했어요 · 이메일 수신 거부 · SMS 수신 거부 · 카카오톡 수신 동의 · 2026. 11. 11. 처리');
    expect(marketingConsentResultMessage({ email: false, sms: false, kakao: false }, at)).toContain('알림함 마케팅 소식도 받지 않아요');
  });
});
