import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), list: vi.fn(), thread: vi.fn() }));
vi.mock('@/lib/auth/server', () => ({ getCurrentAuthState: mocks.auth }));
vi.mock('@/lib/inquiries.server', () => ({ loadMyInquiries: mocks.list, loadMyInquiryThread: mocks.thread }));
beforeEach(() => { vi.resetAllMocks(); mocks.auth.mockResolvedValue({ user: { id: 'owner-a' } }); });
describe('상담 위젯의 개인 문의 조회', () => {
  it('클라이언트 userId를 무시하고 로그인한 소유자만 읽으며 응답을 캐시하지 않는다', async () => {
    mocks.list.mockResolvedValue([{ id: 'own-thread' }]);
    const response = await GET(new NextRequest('http://localhost/api/inquiries?userId=other'));
    expect(await response.json()).toEqual({ userId: 'owner-a', inquiries: [{ id: 'own-thread' }] });
    expect(mocks.list).toHaveBeenCalledWith('owner-a');
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it('비로그인은 조회하지 않고, 남의 문의와 없는 문의를 구분하지 않는다', async () => {
    mocks.auth.mockResolvedValue({ user: null });
    expect((await GET(new NextRequest('http://localhost/api/inquiries'))).status).toBe(401);
    expect(mocks.list).not.toHaveBeenCalled();
    mocks.auth.mockResolvedValue({ user: { id: 'owner-a' } }); mocks.thread.mockResolvedValue(null);
    expect((await GET(new NextRequest('http://localhost/api/inquiries?inquiryId=10000000-0000-4000-8000-000000004321'))).status).toBe(404);
  });
});
