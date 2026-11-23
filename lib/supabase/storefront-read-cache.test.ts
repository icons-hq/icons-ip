import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  STOREFRONT_READ_CACHE_TTL_MS,
  classifyStorefrontRead,
  createStorefrontReadCacheFetch,
  resetStorefrontReadCacheForTests,
} from './storefront-read-cache';

const BASE = 'https://example.supabase.co';
const KEY = 'sb_publishable_test';
const ANON = `Bearer ${KEY}`;
const USER = 'Bearer user-jwt';

type Call = { url: string; init: RequestInit | undefined };

function setup(options: { adultFull?: boolean; status?: number; now?: () => number } = {}) {
  const calls: Call[] = [];
  const viewerSeesAdultGoods = vi.fn(async () => options.adultFull === true);
  const baseFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify({ n: calls.length }), {
      status: options.status ?? 200,
      headers: { 'content-type': 'application/json', 'content-range': '0-0/1' },
    });
  }) as unknown as typeof fetch;
  const cachedFetch = createStorefrontReadCacheFetch({ anonKey: KEY, viewerSeesAdultGoods, baseFetch, now: options.now });
  return { calls, baseFetch, cachedFetch, viewerSeesAdultGoods };
}

const rpc = (name: string, authorization: string, body = '{"p_good_id":"a"}') => [
  `${BASE}/rest/v1/rpc/${name}`,
  { method: 'POST', body, headers: new Headers({ apikey: KEY, authorization, 'content-type': 'application/json' }) },
] as const;

afterEach(() => resetStorefrontReadCacheForTests());

describe('classifyStorefrontRead', () => {
  it('허용 목록의 RPC만 등급을 준다', () => {
    expect(classifyStorefrontRead('POST', `${BASE}/rest/v1/rpc/get_goods_transaction_offers_v3`)).toBe('public');
    expect(classifyStorefrontRead('POST', `${BASE}/rest/v1/rpc/get_good_media`)).toBe('adult');
    expect(classifyStorefrontRead('POST', `${BASE}/rest/v1/rpc/get_good_group_reviews_v3`)).toBe('anonymous');
    expect(classifyStorefrontRead('POST', `${BASE}/rest/v1/rpc/place_direct_order`)).toBeNull();
    expect(classifyStorefrontRead('POST', `${BASE}/rest/v1/rpc/my_review_targets_v3`)).toBeNull();
    expect(classifyStorefrontRead('PATCH', `${BASE}/rest/v1/rpc/get_good_media`)).toBeNull();
  });

  it('goods 표는 공개·비보관 필터가 붙은 조회만, 쓰기는 어떤 표든 받지 않는다', () => {
    expect(classifyStorefrontRead('GET', `${BASE}/rest/v1/goods?select=id&archived_at=is.null&published_at=not.is.null`)).toBe('adult');
    expect(classifyStorefrontRead('GET', `${BASE}/rest/v1/goods?select=id&archived_at=is.null`)).toBeNull();
    expect(classifyStorefrontRead('GET', `${BASE}/rest/v1/ips?select=id`)).toBe('public');
    expect(classifyStorefrontRead('GET', `${BASE}/rest/v1/home_curations?select=id`)).toBe('anonymous');
    expect(classifyStorefrontRead('GET', `${BASE}/rest/v1/wishlists?select=good_id`)).toBeNull();
    expect(classifyStorefrontRead('PATCH', `${BASE}/rest/v1/ips?id=eq.x`)).toBeNull();
    expect(classifyStorefrontRead('HEAD', `${BASE}/rest/v1/ips?select=id`)).toBeNull();
    expect(classifyStorefrontRead('GET', `${BASE}/storage/v1/object/sign/x`)).toBeNull();
    expect(classifyStorefrontRead('GET', 'not a url')).toBeNull();
  });
});

describe('createStorefrontReadCacheFetch', () => {
  it('허용 목록 밖의 요청은 손대지 않고 그대로 보낸다', async () => {
    const { calls, cachedFetch, viewerSeesAdultGoods } = setup();
    const [url, init] = rpc('place_direct_order', USER);
    await cachedFetch(url, init);
    await cachedFetch(url, init);
    expect(calls).toHaveLength(2);
    expect(calls[0].init).toBe(init);
    expect(viewerSeesAdultGoods).not.toHaveBeenCalled();
  });

  it('공개 조회는 로그인 여부와 관계없이 익명 요청으로 바꿔 한 번만 읽고 본문·헤더를 그대로 돌려준다', async () => {
    const { calls, cachedFetch, viewerSeesAdultGoods } = setup();
    const first = await cachedFetch(...rpc('get_goods_transaction_offers_v3', USER));
    const second = await cachedFetch(...rpc('get_goods_transaction_offers_v3', ANON));
    expect(calls).toHaveLength(1);
    expect(new Headers(calls[0].init?.headers).get('authorization')).toBe(ANON);
    expect(await first.json()).toEqual({ n: 1 });
    expect(await second.json()).toEqual({ n: 1 });
    expect(second.headers.get('content-range')).toBe('0-0/1');
    expect(viewerSeesAdultGoods).not.toHaveBeenCalled();
  });

  it('본문이 다르면 따로 읽는다', async () => {
    const { calls, cachedFetch } = setup();
    await cachedFetch(...rpc('get_good_media', ANON, '{"p_good_id":"a"}'));
    await cachedFetch(...rpc('get_good_media', ANON, '{"p_good_id":"b"}'));
    expect(calls).toHaveLength(2);
  });

  it('성인 등급: 19금이 열린 회원은 자기 세션으로 매번 읽고, 그 밖의 회원은 익명 결과를 공유한다', async () => {
    const adult = setup({ adultFull: true });
    await adult.cachedFetch(...rpc('get_good_media', USER));
    await adult.cachedFetch(...rpc('get_good_media', USER));
    expect(adult.calls).toHaveLength(2);
    expect(new Headers(adult.calls[0].init?.headers).get('authorization')).toBe(USER);

    resetStorefrontReadCacheForTests();
    const member = setup({ adultFull: false });
    await member.cachedFetch(...rpc('get_good_media', USER));
    await member.cachedFetch(...rpc('get_good_media', ANON));
    expect(member.calls).toHaveLength(1);
    expect(new Headers(member.calls[0].init?.headers).get('authorization')).toBe(ANON);
    /* 비로그인 요청은 성인 판정을 묻지 않는다. */
    expect(member.viewerSeesAdultGoods).toHaveBeenCalledTimes(1);
  });

  it('성인 판정이 실패하면 공유하지 않고 자기 세션으로 읽는다', async () => {
    const { calls, cachedFetch, viewerSeesAdultGoods } = setup();
    viewerSeesAdultGoods.mockRejectedValue(new Error('auth unavailable'));
    await cachedFetch(...rpc('get_good_media', USER));
    await cachedFetch(...rpc('get_good_media', USER));
    expect(calls).toHaveLength(2);
    expect(new Headers(calls[0].init?.headers).get('authorization')).toBe(USER);
  });

  it('본인 표시가 섞인 조회는 로그인한 요청을 캐시하지 않는다', async () => {
    const { calls, cachedFetch } = setup();
    await cachedFetch(...rpc('get_good_group_reviews_v3', USER));
    await cachedFetch(...rpc('get_good_group_reviews_v3', USER));
    expect(calls).toHaveLength(2);
    expect(new Headers(calls[0].init?.headers).get('authorization')).toBe(USER);
    await cachedFetch(...rpc('get_good_group_reviews_v3', ANON));
    await cachedFetch(...rpc('get_good_group_reviews_v3', ANON));
    expect(calls).toHaveLength(3);
  });

  it('유효 시간이 지나면 다시 읽는다', async () => {
    let clock = 1_000;
    const { calls, cachedFetch } = setup({ now: () => clock });
    await cachedFetch(...rpc('get_good_media', ANON));
    clock += STOREFRONT_READ_CACHE_TTL_MS - 1;
    await cachedFetch(...rpc('get_good_media', ANON));
    expect(calls).toHaveLength(1);
    clock += 2;
    await cachedFetch(...rpc('get_good_media', ANON));
    expect(calls).toHaveLength(2);
  });

  it('200이 아닌 응답은 담지 않는다', async () => {
    const { calls, cachedFetch } = setup({ status: 503 });
    const response = await cachedFetch(...rpc('get_good_media', ANON));
    expect(response.status).toBe(503);
    await cachedFetch(...rpc('get_good_media', ANON));
    expect(calls).toHaveLength(2);
  });

  it('같은 키의 동시 요청은 DB 호출 하나를 함께 기다린다', async () => {
    const { calls, cachedFetch } = setup();
    const responses = await Promise.all(Array.from({ length: 20 }, () => cachedFetch(...rpc('get_good_media', ANON))));
    expect(calls).toHaveLength(1);
    expect(await Promise.all(responses.map(response => response.json()))).toEqual(Array.from({ length: 20 }, () => ({ n: 1 })));
  });

  it('호출자의 중단 신호는 함께 기다리는 요청에 넘기지 않는다', async () => {
    const { calls, cachedFetch } = setup();
    const [url, init] = rpc('get_good_media', ANON);
    await cachedFetch(url, { ...init, signal: new AbortController().signal });
    expect(calls[0].init?.signal).toBeUndefined();
  });
});
