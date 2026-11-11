import { describe, expect, it, vi } from 'vitest';
import { kakaoChannelConfig, type KakaoChannelConfig } from './channel-config.server';
import {
  fetchKakaoChannelRelation,
  handleKakaoChannelWebhook,
  hasKakaoIdentity,
  syncKakaoChannelFriendReward,
} from './channel-reward.server';

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => {
    throw new Error('tests inject the service client');
  },
}));

const ADMIN_KEY = '0123456789abcdef0123456789abcdef';
const CONFIG: KakaoChannelConfig = { channelPublicId: '_IconsTest', adminKey: ADMIN_KEY, couponCode: 'KAKAO-FRIEND' };
const USER_ID = '00000000-0000-4000-8000-000000000801';
const KAKAO_ID = '1234567890';
const ENABLED_ENV = {
  ICONS_KAKAO_CHANNEL_ENABLED: 'true',
  KAKAO_CHANNEL_PUBLIC_ID: '_IconsTest',
  KAKAO_ADMIN_KEY: ADMIN_KEY,
  ICONS_KAKAO_CHANNEL_COUPON_CODE: 'KAKAO-FRIEND',
};

function relationFetch(relation: string | null, status = 200) {
  return vi.fn(async (input: string, init?: RequestInit) => {
    void input;
    void init;
    return new Response(JSON.stringify({
      user_id: Number(KAKAO_ID),
      channels: relation === null ? [] : [{ channel_uuid: '@icons', channel_public_id: '_IconsTest', relation }],
    }), { status });
  });
}

function service(responses: Record<string, { data: unknown; error: unknown }>) {
  const rpc = vi.fn(async (name: string) => responses[name] ?? { data: null, error: { message: 'unexpected' } });
  return { rpc, client: { rpc } as never };
}

describe('kakaoChannelConfig — 스위치 OFF 기본', () => {
  it('is null unless the switch, channel id and admin key are all valid', () => {
    expect(kakaoChannelConfig({})).toBeNull();
    expect(kakaoChannelConfig({ ...ENABLED_ENV, ICONS_KAKAO_CHANNEL_ENABLED: '1' })).toBeNull();
    expect(kakaoChannelConfig({ ...ENABLED_ENV, KAKAO_CHANNEL_PUBLIC_ID: 'IconsTest' })).toBeNull();
    expect(kakaoChannelConfig({ ...ENABLED_ENV, KAKAO_ADMIN_KEY: 'short' })).toBeNull();
    expect(kakaoChannelConfig({ ...ENABLED_ENV, ICONS_KAKAO_CHANNEL_COUPON_CODE: 'lower-case' })).toBeNull();
    expect(kakaoChannelConfig({ ...ENABLED_ENV, VERCEL_ENV: 'production' })).toBeNull();
    expect(kakaoChannelConfig(ENABLED_ENV)).toEqual(CONFIG);
    expect(kakaoChannelConfig({ ...ENABLED_ENV, ICONS_KAKAO_CHANNEL_COUPON_CODE: '' })).toEqual({ ...CONFIG, couponCode: null });
  });
});

describe('fetchKakaoChannelRelation', () => {
  it('asks Kakao by member number with the admin key and reads the configured channel', async () => {
    const fetchMock = relationFetch('ADDED');

    expect(await fetchKakaoChannelRelation({ adminKey: ADMIN_KEY, kakaoUserId: KAKAO_ID, channelPublicId: '_IconsTest' }, fetchMock)).toBe('ADDED');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const parsed = new URL(url);
    expect(`${parsed.origin}${parsed.pathname}`).toBe('https://kapi.kakao.com/v2/api/talk/channels');
    expect(Object.fromEntries(parsed.searchParams)).toEqual({
      target_id_type: 'user_id',
      target_id: KAKAO_ID,
      channel_id_type: 'channel_public_id',
      channel_ids: '_IconsTest',
    });
    expect((init.headers as Record<string, string>).Authorization).toBe(`KakaoAK ${ADMIN_KEY}`);
  });

  it('returns null for errors, unknown shapes, other channels and bad member numbers', async () => {
    expect(await fetchKakaoChannelRelation({ adminKey: ADMIN_KEY, kakaoUserId: KAKAO_ID, channelPublicId: '_IconsTest' }, relationFetch('ADDED', 401))).toBeNull();
    expect(await fetchKakaoChannelRelation({ adminKey: ADMIN_KEY, kakaoUserId: KAKAO_ID, channelPublicId: '_IconsTest' }, relationFetch(null))).toBeNull();
    expect(await fetchKakaoChannelRelation({ adminKey: ADMIN_KEY, kakaoUserId: KAKAO_ID, channelPublicId: '_IconsTest' }, relationFetch('FRIEND'))).toBeNull();
    expect(await fetchKakaoChannelRelation({ adminKey: ADMIN_KEY, kakaoUserId: 'abc', channelPublicId: '_IconsTest' }, relationFetch('ADDED'))).toBeNull();
    expect(await fetchKakaoChannelRelation({ adminKey: ADMIN_KEY, kakaoUserId: KAKAO_ID, channelPublicId: '_IconsTest' }, vi.fn(async () => { throw new Error('timeout'); }))).toBeNull();
  });
});

describe('syncKakaoChannelFriendReward', () => {
  it('does nothing while the switch is off or no coupon is configured', async () => {
    const db = service({});
    expect(await syncKakaoChannelFriendReward({ userId: USER_ID, via: 'login' }, { config: null, service: db.client })).toBe('disabled');
    expect(await syncKakaoChannelFriendReward({ userId: USER_ID, via: 'login' }, { config: { ...CONFIG, couponCode: null }, service: db.client })).toBe('no_coupon');
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('grants through the database only after Kakao confirms the friendship', async () => {
    const db = service({
      service_member_kakao_identity: { data: KAKAO_ID, error: null },
      service_grant_kakao_channel_friend_coupon: { data: { status: 'granted', userCouponId: 'c-1' }, error: null },
    });

    expect(await syncKakaoChannelFriendReward({ userId: USER_ID, via: 'onboarding' }, { config: CONFIG, service: db.client, fetch: relationFetch('ADDED') })).toBe('granted');
    expect(db.rpc).toHaveBeenLastCalledWith('service_grant_kakao_channel_friend_coupon', {
      p_user_id: USER_ID, p_channel_public_id: '_IconsTest', p_coupon_code: 'KAKAO-FRIEND', p_granted_via: 'onboarding',
    });
  });

  it.each([
    ['BLOCKED', 'not_friend'],
    ['NONE', 'not_friend'],
    [null, 'relation_unknown'],
  ] as const)('does not grant when the relation is %s', async (relation, outcome) => {
    const db = service({ service_member_kakao_identity: { data: KAKAO_ID, error: null } });
    expect(await syncKakaoChannelFriendReward({ userId: USER_ID, via: 'login' }, { config: CONFIG, service: db.client, fetch: relationFetch(relation) })).toBe(outcome);
    expect(db.rpc.mock.calls.map(([name]) => name)).not.toContain('service_grant_kakao_channel_friend_coupon');
  });

  it('skips members without a Kakao identity and reports replays and refusals', async () => {
    const noIdentity = service({ service_member_kakao_identity: { data: null, error: null } });
    expect(await syncKakaoChannelFriendReward({ userId: USER_ID, via: 'login' }, { config: CONFIG, service: noIdentity.client, fetch: relationFetch('ADDED') })).toBe('no_kakao_identity');

    const replay = service({
      service_member_kakao_identity: { data: KAKAO_ID, error: null },
      service_grant_kakao_channel_friend_coupon: { data: { status: 'already_granted', userCouponId: 'c-1' }, error: null },
    });
    expect(await syncKakaoChannelFriendReward({ userId: USER_ID, via: 'login' }, { config: CONFIG, service: replay.client, fetch: relationFetch('ADDED') })).toBe('already_granted');

    const refused = service({
      service_member_kakao_identity: { data: KAKAO_ID, error: null },
      service_grant_kakao_channel_friend_coupon: { data: { status: 'unavailable', reason: 'coupon_exhausted' }, error: null },
    });
    expect(await syncKakaoChannelFriendReward({ userId: USER_ID, via: 'login' }, { config: CONFIG, service: refused.client, fetch: relationFetch('ADDED') })).toBe('unavailable');
  });

  it('recognizes a Kakao identity in the signed-in user', () => {
    expect(hasKakaoIdentity([{ provider: 'email' }, { provider: 'kakao' }])).toBe(true);
    expect(hasKakaoIdentity([{ provider: 'google' }])).toBe(false);
    expect(hasKakaoIdentity(undefined)).toBe(false);
  });
});

describe('handleKakaoChannelWebhook', () => {
  const added = JSON.stringify({ event: 'added', id: KAKAO_ID, id_type: 'app_user_id', channel_public_id: '_IconsTest', channel_uuid: '@icons', updated_at: '2026-11-11T00:00:00Z' });

  it('is absent while the switch is off and rejects a wrong admin key', () => {
    expect(handleKakaoChannelWebhook({ authorization: `KakaoAK ${ADMIN_KEY}`, body: added }, { config: null })).toEqual({ status: 404 });
    expect(handleKakaoChannelWebhook({ authorization: null, body: added }, { config: CONFIG })).toEqual({ status: 401 });
    expect(handleKakaoChannelWebhook({ authorization: `KakaoAK ${ADMIN_KEY.slice(1)}x`, body: added }, { config: CONFIG })).toEqual({ status: 401 });
    expect(handleKakaoChannelWebhook({ authorization: `Bearer ${ADMIN_KEY}`, body: added }, { config: CONFIG })).toEqual({ status: 401 });
  });

  it('answers 200 without work for blocks, other channels and members not linked by Kakao login', () => {
    for (const body of [
      JSON.stringify({ event: 'blocked', id: KAKAO_ID, id_type: 'app_user_id', channel_public_id: '_IconsTest' }),
      JSON.stringify({ event: 'added', id: KAKAO_ID, id_type: 'open_id', channel_public_id: '_IconsTest' }),
      JSON.stringify({ event: 'added', id: KAKAO_ID, id_type: 'app_user_id', channel_public_id: '_Other' }),
    ]) {
      expect(handleKakaoChannelWebhook({ authorization: `KakaoAK ${ADMIN_KEY}`, body }, { config: CONFIG })).toEqual({ status: 200 });
    }
    expect(handleKakaoChannelWebhook({ authorization: `KakaoAK ${ADMIN_KEY}`, body: 'not json' }, { config: CONFIG })).toEqual({ status: 400 });
  });

  it('re-checks the relation after answering and grants to the linked member', async () => {
    const db = service({
      service_kakao_identity_user: { data: USER_ID, error: null },
      service_grant_kakao_channel_friend_coupon: { data: { status: 'granted', userCouponId: 'c-1' }, error: null },
    });
    const fetchMock = relationFetch('ADDED');

    const result = handleKakaoChannelWebhook({ authorization: `KakaoAK ${ADMIN_KEY}`, body: added }, { config: CONFIG, service: db.client, fetch: fetchMock });
    expect(result.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await result.work?.()).toBe('granted');
    expect(db.rpc).toHaveBeenCalledWith('service_kakao_identity_user', { p_kakao_user_id: KAKAO_ID });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(db.rpc.mock.calls.map(([name]) => name)).not.toContain('service_member_kakao_identity');
  });

  it('accepts a numeric member number and ignores a member who never signed in with Kakao', async () => {
    const db = service({ service_kakao_identity_user: { data: null, error: null } });
    const body = JSON.stringify({ event: 'added', id: Number(KAKAO_ID), id_type: 'app_user_id', channel_public_id: '_IconsTest' });

    const result = handleKakaoChannelWebhook({ authorization: `KakaoAK ${ADMIN_KEY}`, body }, { config: CONFIG, service: db.client });
    expect(await result.work?.()).toBe('no_kakao_identity');
  });
});
