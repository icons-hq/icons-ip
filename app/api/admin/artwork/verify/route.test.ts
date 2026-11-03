import { beforeEach, describe, expect, it, vi } from 'vitest';
import { configuredOperatorAccessFixture } from '@/lib/admin/access.test-fixtures';
import { POST } from './route';

const ACTOR = 'a1030000-0000-4000-8000-000000000001';
const UUID = 'a1030000-0000-4000-8000-000000000101';
const PATH = `catalog/good/${UUID}.png`;
const VERIFY_ERROR = '이미지 파일을 확인하지 못했습니다. 다시 업로드해주세요.';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn(), verify: vi.fn() }));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: mocks.auth }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('@/lib/admin/artwork.server', () => ({ verifyAndPromoteAdminArtwork: mocks.verify }));

const body = { kind: 'good', mimeType: 'image/png', path: PATH, size: 8 };
function request(payload: unknown = body, init: { origin?: string; contentType?: string; site?: string } = {}) {
  const headers: Record<string, string> = { host: 'icons.test', origin: init.origin ?? 'https://icons.test', 'Content-Type': init.contentType ?? 'application/json' };
  if (init.site) headers['sec-fetch-site'] = init.site;
  return new Request('https://icons.test/api/admin/artwork/verify', { method: 'POST', headers, body: typeof payload === 'string' ? payload : JSON.stringify(payload) });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ isConfigured: true, user: { id: ACTOR }, isStaff: true, operatorAccess: configuredOperatorAccessFixture('deputy') });
  mocks.verify.mockResolvedValue({ imagePath: `public-media/${PATH}` });
  mocks.rpc.mockImplementation(async (_name: string, args: { p_id: string }) => ({ data: { id: args.p_id, revision: 1 }, error: null }));
});

describe('업로드 확인 API (서버 액션 대기열 밖)', () => {
  it('같은 출처의 현재 운영자 업로드를 확인하고 공개 경로만 돌려준다', async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, imagePath: `public-media/${PATH}` });
    expect(mocks.verify).toHaveBeenCalledExactlyOnceWith({ actorId: ACTOR, kind: 'good', mimeType: 'image/png', path: PATH, size: 8 });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['다른 출처', { origin: 'https://evil.test' }],
    ['교차 사이트 요청', { site: 'cross-site' }],
  ])('%s는 인증 조회나 확인 전에 막는다', async (_label, init) => {
    expect((await POST(request(body, init))).status).toBe(403);
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it.each([
    ['JSON이 아닌 본문 형식', request(body, { contentType: 'text/plain' }), 415],
    ['깨진 JSON', request('{', {}), 400],
    ['배열 본문', request([body]), 400],
    ['모르는 키', request({ ...body, actorId: ACTOR }), 400],
    ['형식이 틀린 경로', request({ ...body, path: `public-media/${PATH}` }), 400],
  ])('%s는 확인하지 않는다', async (_label, input, status) => {
    const response = await POST(input);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ ok: false, error: VERIFY_ERROR });
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it('로그아웃 상태는 401, 권한 없는 운영자는 403, 바뀐 계정은 409다', async () => {
    mocks.auth.mockResolvedValueOnce({ isConfigured: true, user: null, isStaff: false });
    expect((await POST(request())).status).toBe(401);
    mocks.auth.mockResolvedValueOnce({ isConfigured: true, user: { id: ACTOR }, isStaff: true, operatorAccess: configuredOperatorAccessFixture('logistics') });
    expect((await POST(request())).status).toBe(403);
    expect((await POST(request({ ...body, expectedActorId: 'a1030000-0000-4000-8000-000000000002' }))).status).toBe(409);
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it('운영자별 확인 한도는 429와 이유 문구로 돌려준다', async () => {
    mocks.verify.mockResolvedValue({ blockedReason: 'verification_rate_limited' });
    const response = await POST(request());
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ ok: false, error: '1분에 올릴 수 있는 사진 수를 넘었습니다. 잠시 뒤 다시 시도해주세요.' });
  });

  it('요청한 상품 이미지 업로드는 사진 보관함에도 등록한다', async () => {
    const response = await POST(request({ ...body, library: { name: 'a.png' } }));
    expect(await response.json()).toEqual({ ok: true, imagePath: `public-media/${PATH}`, library: { ok: true, id: UUID } });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('admin_save_goods_photo', expect.objectContaining({ p_id: UUID, p_name: 'a.png', p_expected_revision: 0 }));
  });

  it('예상하지 못한 실패는 내부 내용을 숨긴다', async () => {
    mocks.auth.mockRejectedValue(new Error('private auth detail'));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain('private');
  });
});
