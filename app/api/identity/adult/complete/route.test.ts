import { describe, expect, it, vi } from 'vitest';

import { createAdultVerificationCompleteHandler, maxDuration } from './route';

const NONCE = 'n'.repeat(43);
const TOKEN = 't'.repeat(43);
const TICKET = { nonce: NONCE, token: TOKEN };
const CLEARED = 'icons_adult_verification=; Path=/api/identity/adult/complete; Max-Age=0; HttpOnly; SameSite=Lax; Secure';

function request(cookie: string | null = `sb-auth=x; icons_adult_verification=${NONCE}.${TOKEN}`) {
  return new Request('https://icons.example/api/identity/adult/complete', {
    headers: cookie === null ? {} : { cookie },
  });
}

const sessionRpc = vi.fn(async () => vi.fn());

describe('/api/identity/adult/complete', () => {
  it('pending 재확인 대기(최대 12초)를 담는 실행 예산을 둔다', () => {
    expect(maxDuration).toBe(30);
  });

  it('티켓 쿠키와 로그인 세션으로 확정하고 결과·표시 방식·돌아갈 경로를 결과 화면에 싣는다', async () => {
    const complete = vi.fn(async () => ({ outcome: 'verified' as const, presentation: 'popup' as const, returnPath: '/shop/g1?x=1' }));
    const handler = createAdultVerificationCompleteHandler({ sessionRpc, complete });

    const response = await handler(request());

    expect(complete).toHaveBeenCalledWith(TICKET, expect.any(Function));
    expect(response.status).toBe(303);
    expect(response.headers.get('location'))
      .toBe('/my/adult-verification/result?status=verified&mode=popup&next=%2Fshop%2Fg1%3Fx%3D1');
    expect(response.headers.get('set-cookie')).toBe(CLEARED);
  });

  it('티켓 쿠키가 없거나 깨졌거나 겹치면 세션을 만들기 전에 거절한다', async () => {
    const localSession = vi.fn(async () => vi.fn());
    const handler = createAdultVerificationCompleteHandler({ sessionRpc: localSession, complete: vi.fn() });

    for (const cookie of [
      null,
      'icons_adult_verification=not-a-ticket',
      `icons_adult_verification=${NONCE}.${TOKEN}; icons_adult_verification=${NONCE}.${TOKEN}`,
    ]) {
      const response = await handler(request(cookie));
      expect(response.headers.get('location')).toBe('/my/adult-verification/result?status=invalid');
    }
    expect(localSession).not.toHaveBeenCalled();
  });

  /* 로그인 뒤 "결과 확인하기"가 같은 티켓으로 이어지도록 쿠키를 남긴다. */
  it('로그인 세션이 없으면 아무것도 확정하지 않고 티켓을 남긴다', async () => {
    const complete = vi.fn();
    const handler = createAdultVerificationCompleteHandler({ sessionRpc: vi.fn(async () => null), complete });

    const response = await handler(request());

    expect(complete).not.toHaveBeenCalled();
    expect(response.headers.get('location')).toBe('/my/adult-verification/result?status=login_required');
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('다른 계정의 세션·맞지 않는 티켓은 invalid다', async () => {
    const handler = createAdultVerificationCompleteHandler({
      sessionRpc,
      complete: vi.fn(async () => ({ outcome: 'not_found' as const })),
    });
    const response = await handler(request());
    expect(response.headers.get('location')).toBe('/my/adult-verification/result?status=invalid');
  });

  it('쓰기가 막힌 계정은 실패로 끝내고 티켓을 지운다', async () => {
    const handler = createAdultVerificationCompleteHandler({
      sessionRpc,
      complete: vi.fn(async () => ({ outcome: 'blocked' as const })),
    });
    const response = await handler(request());
    expect(response.headers.get('location')).toBe('/my/adult-verification/result?status=failed');
    expect(response.headers.get('set-cookie')).toBe(CLEARED);
  });

  it('확정 직전에 로그인이 끊기면 login_required로 보낸다', async () => {
    const handler = createAdultVerificationCompleteHandler({
      sessionRpc,
      complete: vi.fn(async () => ({ outcome: 'login_required' as const })),
    });
    const response = await handler(request());
    expect(response.headers.get('location')).toBe('/my/adult-verification/result?status=login_required');
  });

  it('조회가 아직 진행 중이면 짧게 다시 확인한다', async () => {
    const complete = vi.fn()
      .mockResolvedValueOnce({ outcome: 'pending', presentation: 'page', returnPath: '/my' })
      .mockResolvedValueOnce({ outcome: 'underage', presentation: 'page', returnPath: '/my' });
    const sleep = vi.fn(async () => undefined);
    const handler = createAdultVerificationCompleteHandler({ sessionRpc, complete, sleep });

    const response = await handler(request());

    expect(complete).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(response.headers.get('location')).toBe('/my/adult-verification/result?status=underage&mode=page&next=%2Fmy');
  });

  /* KCP 조회 시한(10초)보다 길게 기다린 뒤에도 진행 중이면 결과 화면에서 다시 확인하게 한다. */
  it('끝까지 진행 중이면 티켓을 남긴 채 pending 결과로 보낸다', async () => {
    const complete = vi.fn(async () => ({ outcome: 'pending' as const, presentation: 'page' as const, returnPath: '/my' }));
    const sleep = vi.fn(async (ms: number) => { void ms; });
    const handler = createAdultVerificationCompleteHandler({ sessionRpc, complete, sleep });

    const response = await handler(request());

    expect(complete).toHaveBeenCalledTimes(6);
    expect(sleep.mock.calls.reduce((total, [ms]) => total + ms, 0)).toBeGreaterThanOrEqual(12_000);
    expect(response.headers.get('location')).toBe('/my/adult-verification/result?status=pending&mode=page&next=%2Fmy');
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('DB 장애는 티켓을 남긴 채 error 결과로 보낸다', async () => {
    const handler = createAdultVerificationCompleteHandler({
      sessionRpc,
      complete: vi.fn(async () => { throw new Error('db down'); }),
    });
    const response = await handler(request());
    expect(response.headers.get('location')).toBe('/my/adult-verification/result?status=error');
    expect(response.headers.get('set-cookie')).toBeNull();
  });
});
