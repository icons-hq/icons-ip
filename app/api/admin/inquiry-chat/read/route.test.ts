import { beforeEach, describe, expect, it, vi } from 'vitest';
import { configuredOperatorAccessFixture } from '@/lib/admin/access.test-fixtures';
import { POST } from './route';

const ACCOUNT = 'a20c0000-0000-4000-8000-000000000002';
const INQUIRY = 'a20c0000-0000-4000-8000-000000000201';
const MESSAGE = 'a20c0000-0000-4000-8000-000000000301';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn(), createClient: vi.fn() }));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: mocks.auth }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));

function request(body: unknown = { accountId: ACCOUNT, inquiryId: INQUIRY, messageIds: [MESSAGE] }, origin = 'https://icons.test') {
  return new Request('https://icons.test/api/admin/inquiry-chat/read', { method: 'POST', headers: { host: 'icons.test', origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.auth.mockResolvedValue({ isConfigured: true, user: { id: ACCOUNT }, isStaff: true, operatorAccess: configuredOperatorAccessFixture('deputy') });
  mocks.rpc.mockResolvedValue({ data: 1, error: null }); mocks.createClient.mockResolvedValue({ rpc: mocks.rpc });
});

describe('상담 읽음 API', () => {
  it('같은 출처·현재 운영자·화면에 표시된 ID만 RPC에 보낸다', async () => {
    const response = await POST(request({ accountId: ACCOUNT, inquiryId: INQUIRY, messageIds: [MESSAGE, MESSAGE] }));
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ userId: ACCOUNT, marked: 1 });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_mark_inquiry_chat_read', { p_inquiry_id: INQUIRY, p_message_ids: [MESSAGE] });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
  it('다른 출처는 인증 조회나 DB 요청 전에 차단한다', async () => {
    expect((await POST(request(undefined, 'https://other.test'))).status).toBe(403);
    expect(mocks.auth).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('고객과 상담 권한 없는 운영자는 변경하지 못한다', async () => {
    mocks.auth.mockResolvedValue({ isConfigured: true, user: { id: ACCOUNT }, isStaff: true, operatorAccess: configuredOperatorAccessFixture('logistics') });
    expect((await POST(request())).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('로그아웃 상태를 401로 돌려준다', async () => {
    mocks.auth.mockResolvedValue({ isConfigured: true, user: null });
    expect((await POST(request())).status).toBe(401); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('계정 전환 후 남은 이전 화면의 읽음 요청은 저장하지 않는다', async () => {
    expect((await POST(request({ accountId: 'a20c0000-0000-4000-8000-000000000003', inquiryId: INQUIRY, messageIds: [MESSAGE] }))).status).toBe(409);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([[], ['bad'], Array.from({ length: 501 }, () => MESSAGE)])('유효하지 않은 메시지 목록은 저장하지 않는다', async messageIds => {
    expect((await POST(request({ accountId: ACCOUNT, inquiryId: INQUIRY, messageIds }))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('DB 실패를 읽음 완료로 응답하지 않는다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'denied' } });
    expect((await POST(request())).status).toBe(503);
  });
});
