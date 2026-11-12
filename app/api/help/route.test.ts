import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';
const mocks = vi.hoisted(() => ({ loadPublishedFaq: vi.fn(), loadFaqWidgetTopicAnswer: vi.fn() }));
vi.mock('@/lib/faq.server', () => ({ loadPublishedFaq: mocks.loadPublishedFaq, loadFaqWidgetTopicAnswer: mocks.loadFaqWidgetTopicAnswer }));
beforeEach(() => { mocks.loadPublishedFaq.mockReset(); mocks.loadFaqWidgetTopicAnswer.mockReset(); });
describe('상담 위젯 유형 버튼 답 API (0901-044)', () => {
  it('정해진 유형만 받아 대표 FAQ 또는 유형 목록을 그대로 돌려준다', async () => {
    const answer = { topic: 'delivery', entry: { id: 'shipping' }, entries: [] };
    mocks.loadFaqWidgetTopicAnswer.mockResolvedValue(answer);
    const response = await GET(new NextRequest('http://localhost/api/help?topic=delivery'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(answer);
    expect(mocks.loadFaqWidgetTopicAnswer).toHaveBeenCalledWith('delivery');
    expect(mocks.loadPublishedFaq).not.toHaveBeenCalled();
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('모르는 유형은 DB를 읽지 않고 거절하고, 조회 실패는 내부 오류를 숨긴 503이다', async () => {
    const unknown = await GET(new NextRequest('http://localhost/api/help?topic=refund'));
    expect(unknown.status).toBe(400);
    expect(mocks.loadFaqWidgetTopicAnswer).not.toHaveBeenCalled();
    mocks.loadFaqWidgetTopicAnswer.mockRejectedValue(new Error('db unreachable'));
    const failed = await GET(new NextRequest('http://localhost/api/help?topic=cancel'));
    expect(failed.status).toBe(503);
    expect(JSON.stringify(await failed.json())).not.toContain('db unreachable');
  });
});
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
