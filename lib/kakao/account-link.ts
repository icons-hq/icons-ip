/*
 * 마이페이지 카카오 계정 연결과 카카오톡 채널 친구 추가 쿠폰(10/14 회의 1014-014, 리뷰 F10)의 화면 판정·안내.
 *
 * 이메일·Google·Apple로 가입한 회원도 설정의 [카카오 계정 연결]로 카카오 identity를 붙이면서 같은 카카오 동의 화면에서
 * ICONS 카카오톡 채널을 추가할 수 있다. 연결은 Supabase identity linking(manual linking)이고, 끝나면 /auth/callback이
 * 채널 관계를 다시 확인해 쿠폰을 한 번 발급한 뒤 /settings?kakao_link=<결과>로 돌려보낸다.
 * 쿼리는 누구나 만들 수 있으므로 설정 화면은 '연결했어요'를 실제 카카오 identity가 있을 때만, 실패 안내는 아직
 * 연결되지 않았을 때만 보인다. 이 파일은 서버·클라이언트 어디서나 읽을 수 있는 순수 모듈이다.
 */

export const KAKAO_LINK_SETTINGS_PATH = '/settings';
export const KAKAO_LINK_RESULT_PARAM = 'kakao_link';

export type KakaoLinkResult = 'linked' | 'cancelled' | 'identity_taken' | 'failed';

/** 채널 관계 확인·쿠폰 발급 결과(lib/kakao/channel-reward.server.ts). */
export type KakaoRewardOutcome =
  | 'disabled'
  | 'no_coupon'
  | 'no_kakao_identity'
  | 'not_friend'
  | 'relation_unknown'
  | 'granted'
  | 'already_granted'
  | 'unavailable';

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** 로그인 사용자의 identity 목록에 카카오가 있는지. */
export function hasKakaoIdentity(identities: unknown): boolean {
  return Array.isArray(identities) && identities.some((identity) => record(identity)?.provider === 'kakao');
}

/**
 * 연결이 실패하고 돌아온 오류 코드(GoTrue error_code 또는 카카오 error)를 화면 결과로 줄인다.
 * identity_already_exists는 그 카카오 계정이 이미 다른 회원에게 연결돼 있다는 뜻이다.
 */
export function kakaoLinkFailure(code: string | null | undefined): Exclude<KakaoLinkResult, 'linked'> {
  switch (code?.trim()) {
    case 'identity_already_exists':
      return 'identity_taken';
    case 'access_denied':
      return 'cancelled';
    default:
      return 'failed';
  }
}

export function kakaoLinkResultPath(result: KakaoLinkResult): string {
  return `${KAKAO_LINK_SETTINGS_PATH}?${KAKAO_LINK_RESULT_PARAM}=${result}`;
}

export function readKakaoLinkResult(value: string | string[] | undefined): KakaoLinkResult | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === 'linked' || raw === 'cancelled' || raw === 'identity_taken' || raw === 'failed' ? raw : null;
}

export interface KakaoLinkNotice {
  tone: 'status' | 'alert';
  message: string;
}

/**
 * 연결 결과 안내. 쿼리는 위조할 수 있어 실제 연결 상태와 맞을 때만 돌려준다 — 연결됐다는 안내는 카카오 identity가
 * 있을 때만, 실패 안내는 아직 없을 때만.
 */
export function kakaoLinkNotice(result: KakaoLinkResult | null, linked: boolean, couponOffered: boolean): KakaoLinkNotice | null {
  if (!result || (result === 'linked') !== linked) return null;
  switch (result) {
    case 'linked':
      return {
        tone: 'status',
        message: couponOffered
          ? '카카오 계정을 연결했어요. 동의 화면에서 채널을 추가했다면 친구 추가 쿠폰이 쿠폰함에 들어가요.'
          : '카카오 계정을 연결했어요.',
      };
    case 'cancelled':
      return { tone: 'alert', message: '카카오 계정 연결을 취소했어요.' };
    case 'identity_taken':
      return { tone: 'alert', message: '이 카카오 계정은 이미 다른 ICONS 계정에 연결돼 있어요. 다른 카카오 계정으로 연결해주세요.' };
    case 'failed':
      return { tone: 'alert', message: '카카오 계정을 연결하지 못했어요. 잠시 후 다시 시도해주세요.' };
  }
}

/** [친구 추가 쿠폰 받기] 결과 안내. 발급과 이미 받음만 성공 안내이고 나머지는 이유를 알린다. */
export function kakaoChannelRewardNotice(outcome: KakaoRewardOutcome): { message: string } | { error: string } {
  switch (outcome) {
    case 'granted':
      return { message: '카카오톡 채널 친구 추가 쿠폰을 쿠폰함에 넣었어요.' };
    case 'already_granted':
      return { message: '이미 친구 추가 쿠폰을 받았어요. 쿠폰함에서 확인해주세요.' };
    case 'not_friend':
      return { error: '아직 ICONS 카카오톡 채널이 친구로 추가되지 않았어요. 채널을 추가한 뒤 다시 눌러주세요.' };
    case 'no_kakao_identity':
      return { error: '카카오 계정을 먼저 연결해주세요.' };
    case 'no_coupon':
      return { error: '지금은 친구 추가 쿠폰을 드리지 않아요.' };
    case 'disabled':
    case 'relation_unknown':
    case 'unavailable':
      return { error: '지금은 쿠폰을 확인할 수 없어요. 잠시 후 다시 시도해주세요.' };
  }
}

/** 카카오톡 채널 친구 추가 페이지. */
export function kakaoChannelAddUrl(channelPublicId: string): string {
  return `https://pf.kakao.com/${encodeURIComponent(channelPublicId)}/friend`;
}
