import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ session: vi.fn(), download: vi.fn() }));
vi.mock('@/lib/inquiry-files.server', () => ({ inquiryFileSession: mocks.session, downloadInquiryFile: mocks.download }));
import { GET } from './route';
const id = 'f1100000-0000-4000-8000-000000000301', messageId = 'f1100000-0000-4000-8000-000000000401';
const request = () => new Request(`https://icons.example/api/inquiries/files?fileId=${id}&messageId=${messageId}`);
beforeEach(() => { vi.clearAllMocks(); mocks.session.mockResolvedValue({ actor: 'current-customer', sessionId: 'current-session' }); });
describe('상담 파일 HTTP 경계', () => {
  it('비로그인은 파일 조회 전에 401로 거절한다', async () => {
    mocks.session.mockResolvedValue(null); expect((await GET(request())).status).toBe(401); expect(mocks.download).not.toHaveBeenCalled();
  });
  it('다른 고객·유효하지 않은 메시지는 같은 403을 돌려준다', async () => {
    mocks.download.mockResolvedValue(null); expect((await GET(request())).status).toBe(403);
    expect(mocks.download).toHaveBeenCalledWith('current-customer', 'current-session', id, messageId);
  });
  it('문서는 공개 URL 대신 캐시하지 않는 인증 응답으로 다운로드한다', async () => {
    mocks.download.mockResolvedValue({ file: { id, name: '안내.pdf', mimeType: 'application/pdf', size: 3 }, bytes: new Uint8Array([1, 2, 3]).buffer });
    const result = await GET(request());
    expect(result.status).toBe(200); expect(result.headers.get('Cache-Control')).toContain('no-store');
    expect(result.headers.get('Content-Disposition')).toMatch(/^attachment;/); expect(result.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(new Uint8Array(await result.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });
});
