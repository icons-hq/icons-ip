import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';
const mocks = vi.hoisted(() => ({ loadPublishedFaq: vi.fn() }));
vi.mock('@/lib/faq.server', () => ({ loadPublishedFaq: mocks.loadPublishedFaq }));
beforeEach(() => { mocks.loadPublishedFaq.mockReset(); });
describe('문의 전 FAQ 제안 API', () => {
  it('위젯의 첫 화면은 키워드 없이도 공개 FAQ를 먼저 보여준다', async () => {
    mocks.loadPublishedFaq.mockResolvedValue({ entries: [{ id: 'intro' }] });
    expect(await (await GET(new NextRequest('http://localhost/api/help?featured=1'))).json()).toEqual({ entries: [{ id: 'intro' }] });
    expect(mocks.loadPublishedFaq).toHaveBeenCalledWith(expect.objectContaining({ query: '', page: 1 }), 6);
  });
  it('제목 키워드를 공개 FAQ 검색에 보내 최대 3개를 제안한다', async () => {
    mocks.loadPublishedFaq.mockResolvedValue({ entries: [{ id: 'shipping' }] });
    const response = await GET(new NextRequest('http://localhost/api/help?q=배송%20언제'));
    expect(response.status).toBe(200);
    expect(mocks.loadPublishedFaq).toHaveBeenCalledWith(expect.objectContaining({ query: '배송 언제', page: 1 }), 3);
    expect(await response.json()).toEqual({ entries: [{ id: 'shipping' }] });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('짧거나 빈 제목은 DB 조회 없이 빈 제안이다', async () => {
    expect(await (await GET(new NextRequest('http://localhost/api/help?q=배'))).json()).toEqual({ entries: [] });
    expect(mocks.loadPublishedFaq).not.toHaveBeenCalled();
  });
  it('조회 실패를 오류 상태로 돌려 본 문의 작성이 계속될 수 있다', async () => {
    mocks.loadPublishedFaq.mockRejectedValue(new Error('db unreachable'));
    const response = await GET(new NextRequest('http://localhost/api/help?q=배송'));
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain('db unreachable');
  });
});
