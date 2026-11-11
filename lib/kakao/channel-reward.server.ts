import 'server-only';

import { timingSafeEqual } from 'node:crypto';
import { createServiceClient } from '@/lib/supabase/service';
import { kakaoChannelConfig, type KakaoChannelConfig } from './channel-config.server';

/*
 * 카카오톡 채널 친구 추가 쿠폰(10/14 회의 1014-014). 스위치(ICONS_KAKAO_CHANNEL_ENABLED)가 꺼져 있으면 아무것도 하지 않는다.
 *
 * 확인 근거는 카카오 채널 관계 조회 API(GET /v2/api/talk/channels, 어드민 키 방식 — 회원번호로 조회)뿐이다.
 * 확인하는 때는 셋이다: 카카오 로그인 직후(동의 화면에서 채널을 추가한 회원), 온보딩을 마친 직후(첫 가입은
 * 온보딩 전이라 발급 대상이 아니다), 채널 웹훅(added) 수신 때. 웹훅 본문은 확인을 시작하는 신호일 뿐이다.
 * 발급은 DB(service_grant_kakao_channel_friend_coupon)가 회원·채널당 한 번으로 멱등 처리한다. 이 확인이 실패해도
 * 로그인·온보딩은 막지 않는다 — 다음 확인 때 다시 시도된다.
 */

const KAKAO_CHANNELS_API = 'https://kapi.kakao.com/v2/api/talk/channels';
const KAKAO_TIMEOUT_MS = 1500;
const KAKAO_USER_ID = /^[1-9]\d{0,19}$/;

export type KakaoChannelRelation = 'ADDED' | 'BLOCKED' | 'NONE';

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type ServiceClient = ReturnType<typeof createServiceClient>;

export interface KakaoRewardDependencies {
  config?: KakaoChannelConfig | null;
  service?: ServiceClient;
  fetch?: FetchLike;
}

/** 회원번호로 채널 관계를 조회한다(어드민 키 방식). 응답이 이상하거나 시간이 넘으면 null이다. */
export async function fetchKakaoChannelRelation(
  input: { adminKey: string; kakaoUserId: string; channelPublicId: string },
  fetchImpl: FetchLike = fetch,
): Promise<KakaoChannelRelation | null> {
  if (!KAKAO_USER_ID.test(input.kakaoUserId)) return null;
  const url = new URL(KAKAO_CHANNELS_API);
  url.searchParams.set('target_id_type', 'user_id');
  url.searchParams.set('target_id', input.kakaoUserId);
  url.searchParams.set('channel_id_type', 'channel_public_id');
  url.searchParams.set('channel_ids', input.channelPublicId);
  try {
    const response = await fetchImpl(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `KakaoAK ${input.adminKey}`,
        'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(KAKAO_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const body = await response.json() as { channels?: unknown };
    if (!Array.isArray(body.channels)) return null;
    const channel = body.channels.find((candidate) => candidate && typeof candidate === 'object'
      && (candidate as Record<string, unknown>).channel_public_id === input.channelPublicId) as Record<string, unknown> | undefined;
    const relation = channel?.relation;
    return relation === 'ADDED' || relation === 'BLOCKED' || relation === 'NONE' ? relation : null;
  } catch {
    return null;
  }
}

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

/** 회원의 카카오 identity가 있으면 채널 관계를 확인하고, 친구면 쿠폰을 한 번 발급한다. 던지지 않는다. */
export async function syncKakaoChannelFriendReward(
  input: { userId: string; via: 'login' | 'onboarding' | 'webhook'; kakaoUserId?: string },
  deps: KakaoRewardDependencies = {},
): Promise<KakaoRewardOutcome> {
  const config = deps.config === undefined ? kakaoChannelConfig() : deps.config;
  if (!config) return 'disabled';
  if (!config.couponCode) return 'no_coupon';
  try {
    const service = deps.service ?? createServiceClient();
    let kakaoUserId = input.kakaoUserId;
    if (!kakaoUserId) {
      const { data, error } = await service.rpc('service_member_kakao_identity', { p_user_id: input.userId });
      if (error) return 'unavailable';
      kakaoUserId = typeof data === 'string' ? data : undefined;
    }
    if (!kakaoUserId) return 'no_kakao_identity';

    const relation = await fetchKakaoChannelRelation(
      { adminKey: config.adminKey, kakaoUserId, channelPublicId: config.channelPublicId },
      deps.fetch,
    );
    if (relation === null) return 'relation_unknown';
    if (relation !== 'ADDED') return 'not_friend';

    const { data, error } = await service.rpc('service_grant_kakao_channel_friend_coupon', {
      p_user_id: input.userId,
      p_channel_public_id: config.channelPublicId,
      p_coupon_code: config.couponCode,
      p_granted_via: input.via,
    });
    const result = record(data);
    if (error || !result) return 'unavailable';
    if (result.status === 'granted') return 'granted';
    if (result.status === 'already_granted') return 'already_granted';
    return 'unavailable';
  } catch {
    return 'unavailable';
  }
}

/** 로그인 사용자의 identity 목록에 카카오가 있는지. 있을 때만 로그인 직후 확인한다(카카오 API 호출을 줄인다). */
export function hasKakaoIdentity(identities: unknown): boolean {
  return Array.isArray(identities) && identities.some((identity) => record(identity)?.provider === 'kakao');
}

function keysMatch(actual: string, expected: string) {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

export type KakaoWebhookResult = {
  status: 200 | 401 | 404 | 400;
  /** 응답을 보낸 뒤 할 일(채널 관계 재확인·발급). 카카오의 3초 응답 제한에 묶이지 않게 라우트가 after()로 돌린다. */
  work?: () => Promise<KakaoRewardOutcome>;
};

/*
 * 카카오톡 채널 웹훅(추가·차단). 카카오는 대표 어드민 키로 Authorization: KakaoAK <키>를 붙이고, 3초 안에 2xx를 기대한다.
 * 스위치가 꺼져 있으면 404(경로가 없는 것과 같다). 인증이 맞지 않으면 401, 본문이 JSON 객체가 아니면 400.
 * 그 밖에는 바로 200을 돌려준다 — 발급은 멱등이고 다음 로그인·온보딩 확인이 다시 시도하므로 재전송을 부를 이유가 없다.
 * 채널 추가(added)이고 카카오 로그인으로 연결된 회원(id_type app_user_id)일 때만, 응답 뒤에 관계 조회 API로 다시
 * 확인하고 발급한다. 웹훅 본문은 확인을 시작하는 신호일 뿐 발급 근거가 아니다.
 */
export function handleKakaoChannelWebhook(
  input: { authorization: string | null; body: string },
  deps: KakaoRewardDependencies = {},
): KakaoWebhookResult {
  const config = deps.config === undefined ? kakaoChannelConfig() : deps.config;
  if (!config) return { status: 404 };
  if (!input.authorization || !keysMatch(input.authorization, `KakaoAK ${config.adminKey}`)) return { status: 401 };

  let payload: Record<string, unknown> | null;
  try {
    payload = record(JSON.parse(input.body));
  } catch {
    return { status: 400 };
  }
  if (!payload) return { status: 400 };
  /* 회원번호는 문자열로 오지만 숫자로 와도 같은 값으로 읽는다. */
  const kakaoUserId = typeof payload.id === 'number' && Number.isSafeInteger(payload.id) ? String(payload.id) : payload.id;
  if (payload.event !== 'added' || payload.id_type !== 'app_user_id' || payload.channel_public_id !== config.channelPublicId
    || typeof kakaoUserId !== 'string' || !KAKAO_USER_ID.test(kakaoUserId)) {
    return { status: 200 };
  }

  return {
    status: 200,
    work: async () => {
      try {
        const service = deps.service ?? createServiceClient();
        const { data, error } = await service.rpc('service_kakao_identity_user', { p_kakao_user_id: kakaoUserId });
        if (error) return 'unavailable';
        if (typeof data !== 'string') return 'no_kakao_identity';
        return await syncKakaoChannelFriendReward({ userId: data, via: 'webhook', kakaoUserId }, { ...deps, config, service });
      } catch {
        return 'unavailable';
      }
    },
  };
}
