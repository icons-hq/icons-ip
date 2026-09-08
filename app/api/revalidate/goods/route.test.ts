import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* 경계 알림 라우트의 계약: 비밀이 맞을 때만, 상품 id 가 있을 때만, **캐시만** 버린다. */
const mocks = vi.hoisted(() => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidateTag: mocks.revalidateTag,
  revalidatePath: mocks.revalidatePath,
}));

const { POST } = await import('./route');

function request(body: unknown, secret: string | null = 'shh') {
  return new Request('http://localhost/api/revalidate/goods', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(secret === null ? {} : { 'x-revalidate-secret': secret }),
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('/api/revalidate/goods', () => {
  beforeEach(() => {
    process.env.GOODS_REVALIDATE_SECRET = 'shh';
    mocks.revalidateTag.mockReset();
    mocks.revalidatePath.mockReset();
  });
  afterEach(() => {
    delete process.env.GOODS_REVALIDATE_SECRET;
  });

  it('비밀이 없거나 다르면 401 이고 아무것도 버리지 않는다', async () => {
    expect((await POST(request({ goodId: 'g1' }, null))).status).toBe(401);
    expect((await POST(request({ goodId: 'g1' }, 'wrong'))).status).toBe(401);
    /* 서버에 비밀이 설정돼 있지 않으면 어떤 요청도 통과하지 못한다 — 빈 값끼리 같다고 열리면 안 된다. */
    delete process.env.GOODS_REVALIDATE_SECRET;
    expect((await POST(request({ goodId: 'g1' }, ''))).status).toBe(401);
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
  });

  it('본문이 깨졌거나 상품 id 가 없으면 400', async () => {
    expect((await POST(request('not json'))).status).toBe(400);
    expect((await POST(request({ at: 'now' }))).status).toBe(400);
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
  });

  it('목록 집계 태그와 그 상품 상세·목록 경로를 즉시 만료한다', async () => {
    const response = await POST(request({ goodId: 'g1', kind: 'sale_start' }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, goodId: 'g1' });
    expect(mocks.revalidateTag).toHaveBeenCalledWith('catalog:goods', { expire: 0 });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/shop/g1');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/shop');
    expect(response.headers.get('Cache-Control')).toContain('no-store');
  });
});
