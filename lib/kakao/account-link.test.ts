import { describe, expect, it } from 'vitest';
import {
  hasKakaoIdentity,
  kakaoChannelAddUrl,
  kakaoChannelRewardNotice,
  kakaoLinkFailure,
  kakaoLinkNotice,
  kakaoLinkResultPath,
  readKakaoLinkResult,
  type KakaoRewardOutcome,
} from './account-link';

/* 1014-014·리뷰 F10 — 설정의 카카오 계정 연결 결과와 친구 추가 쿠폰 확인 결과 안내. */
describe('kakao account link', () => {
  it('detects a Kakao identity among the member identities', () => {
    expect(hasKakaoIdentity([{ provider: 'email' }, { provider: 'kakao' }])).toBe(true);
    expect(hasKakaoIdentity([{ provider: 'google' }])).toBe(false);
    expect(hasKakaoIdentity(undefined)).toBe(false);
    expect(hasKakaoIdentity([null, 'kakao'])).toBe(false);
  });

  it('maps link failures to the settings result without leaking provider detail', () => {
    expect(kakaoLinkFailure('identity_already_exists')).toBe('identity_taken');
    expect(kakaoLinkFailure('access_denied')).toBe('cancelled');
    expect(kakaoLinkFailure('manual_linking_disabled')).toBe('failed');
    expect(kakaoLinkFailure(undefined)).toBe('failed');
    expect(kakaoLinkResultPath('identity_taken')).toBe('/settings?kakao_link=identity_taken');
  });

  it('reads only known results from the query', () => {
    expect(readKakaoLinkResult('linked')).toBe('linked');
    expect(readKakaoLinkResult(['cancelled', 'linked'])).toBe('cancelled');
    expect(readKakaoLinkResult('granted')).toBeNull();
    expect(readKakaoLinkResult(undefined)).toBeNull();
  });

  /* 쿼리는 누구나 만들 수 있다 — 실제 연결 상태와 맞을 때만 안내한다. */
  it('shows a result notice only when it matches the real link state', () => {
    expect(kakaoLinkNotice('linked', true, true)).toEqual({
      tone: 'status',
      message: '카카오 계정을 연결했어요. 동의 화면에서 채널을 추가했다면 친구 추가 쿠폰이 쿠폰함에 들어가요.',
    });
    expect(kakaoLinkNotice('linked', true, false)?.message).toBe('카카오 계정을 연결했어요.');
    expect(kakaoLinkNotice('linked', false, true)).toBeNull();
    expect(kakaoLinkNotice('identity_taken', false, true)).toMatchObject({ tone: 'alert', message: expect.stringContaining('이미 다른 ICONS 계정에 연결') });
    expect(kakaoLinkNotice('cancelled', false, true)).toMatchObject({ tone: 'alert' });
    expect(kakaoLinkNotice('failed', true, true)).toBeNull();
    expect(kakaoLinkNotice(null, true, true)).toBeNull();
  });

  it('explains every reward outcome and treats only grants as success', () => {
    const outcomes: KakaoRewardOutcome[] = ['disabled', 'no_coupon', 'no_kakao_identity', 'not_friend', 'relation_unknown', 'granted', 'already_granted', 'unavailable'];
    const successes = outcomes.filter((outcome) => 'message' in kakaoChannelRewardNotice(outcome));
    expect(successes).toEqual(['granted', 'already_granted']);
    expect(kakaoChannelRewardNotice('not_friend')).toEqual({ error: expect.stringContaining('채널을 추가한 뒤 다시 눌러주세요') });
  });

  it('links to the channel friend page', () => {
    expect(kakaoChannelAddUrl('_IconsTest')).toBe('https://pf.kakao.com/_IconsTest/friend');
  });
});
