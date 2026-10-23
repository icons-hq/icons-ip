import { describe, expect, it, vi } from 'vitest';

import { createAdultVerificationCompleteHandler } from './route';

const NONCE = 'n'.repeat(43);
const request = new Request(`https://icons.example/api/identity/adult/complete/${NONCE}`);

function context(nonce = NONCE) {
  return { params: Promise.resolve({ nonce }) };
}

const sessionRpc = vi.fn(async () => vi.fn());

describe('/api/identity/adult/complete/[nonce]', () => {
  it('로그인 세션으로 확정하고 결과·표시 방식·돌아갈 경로를 결과 화면에 싣는다', async () => {
    const complete = vi.fn(async () => ({ outcome: 'verified' as const, presentation: 'popup' as const, returnPath: '/shop/g1?x=1' }));
    const handler = createAdultVerificationCompleteHandler({ sessionRpc, complete });

    const response = await handler(request, context());

    expect(complete).toHaveBeenCalledWith(NONCE, expect.any(Function));
    expect(response.status).toBe(303);
    expect(response.headers.get('location'))
      .toBe('/my/adult-verification/result?status=verified&mode=popup&next=%2Fshop%2Fg1%3Fx%3D1');
  });

  it('로그인 세션이 없으면 아무것도 확정하지 않는다', async () => {
    const complete = vi.fn();
    const handler = createAdultVerificationCompleteHandler({ sessionRpc: vi.fn(async () => null), complete });

    const response = await handler(request, context());

    expect(complete).not.toHaveBeenCalled();
    expect(response.headers.get('location')).toBe('/my/adult-verification/result?status=login_required');
  });

  it('형식이 깨진 nonce는 세션을 만들기 전에 거절한다', async () => {
    const localSession = vi.fn(async () => vi.fn());
    const handler = createAdultVerificationCompleteHandler({ sessionRpc: localSession, complete: vi.fn() });

    const response = await handler(request, context('not-a-nonce'));

    expect(localSession).not.toHaveBeenCalled();
    expect(response.headers.get('location')).toBe('/my/adult-verification/result?status=invalid');
  });

  it('다른 계정의 세션·모르는 nonce는 invalid다', async () => {
    const handler = createAdultVerificationCompleteHandler({
      sessionRpc,
      complete: vi.fn(async () => ({ outcome: 'not_found' as const })),
    });
    const response = await handler(request, context());
    expect(response.headers.get('location')).toBe('/my/adult-verification/result?status=invalid');
  });

  it('조회가 아직 진행 중이면 짧게 다시 확인한다', async () => {
    const complete = vi.fn()
      .mockResolvedValueOnce({ outcome: 'pending', presentation: 'page', returnPath: '/my' })
      .mockResolvedValueOnce({ outcome: 'underage', presentation: 'page', returnPath: '/my' });
    const sleep = vi.fn(async () => undefined);
    const handler = createAdultVerificationCompleteHandler({ sessionRpc, complete, sleep });

    const response = await handler(request, context());

    expect(complete).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(response.headers.get('location')).toBe('/my/adult-verification/result?status=underage&mode=page&next=%2Fmy');
  });

  it('끝까지 진행 중이면 pending 결과로 보낸다', async () => {
    const complete = vi.fn(async () => ({ outcome: 'pending' as const, presentation: 'page' as const, returnPath: '/my' }));
    const handler = createAdultVerificationCompleteHandler({ sessionRpc, complete, sleep: vi.fn(async () => undefined) });

    const response = await handler(request, context());

    expect(complete).toHaveBeenCalledTimes(4);
    expect(response.headers.get('location')).toBe('/my/adult-verification/result?status=pending&mode=page&next=%2Fmy');
  });

  it('DB 장애는 error 결과로 보낸다', async () => {
    const handler = createAdultVerificationCompleteHandler({
      sessionRpc,
      complete: vi.fn(async () => { throw new Error('db down'); }),
    });
    const response = await handler(request, context());
    expect(response.headers.get('location')).toBe('/my/adult-verification/result?status=error');
  });
});
