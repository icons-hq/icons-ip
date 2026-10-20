import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AdminHomeAttention } from '@/lib/admin/home-attention';
import { HomeAttention } from './HomeAttention';

vi.mock('../screens/QnaActionPanel', () => ({ QnaActionPanel: () => null }));
vi.mock('../screens/ReviewActionPanel', () => ({ ReviewActionPanel: () => null }));

const data: AdminHomeAttention = {
  inquiries: { total: 0, rows: [] }, questions: { total: 0, rows: [] },
  lowReviews: { total: 0, rows: [] }, unansweredReviews: { total: 0, rows: [] },
  unreadChats: { total: 1, counts: { all: 8, open: 3, answered: 4, closed: 1 }, rows: [{
    id: 'a20c9000-0000-4000-8000-000000000201', reference: 1, title: '합성 문의', category: 'order', status: 'open',
    buyerName: '합성 고객', assigneeId: null, assigneeName: null, lastMessageAt: '2026-10-20T00:00:00Z',
    preview: '첨부 확인 부탁드립니다', previewAuthor: 'user', unreadCount: 3,
  }] },
  reviewInsights: { asOf: '2026-10-19', counts: { all: 10, photo: 2, coverage: 4, rating: 0, unanswered: 5 } },
};

describe('홈 상담·리뷰 바로가기', () => {
  it('운영자별 읽지 않은 대화를 바로 열고 상태/기간/읽음 필터를 정확히 연결한다', () => {
    const html = renderToStaticMarkup(<HomeAttention data={data} />);
    expect(html).toContain('읽지 않은 상담 <strong>1</strong>');
    expect(html).toContain('읽지 않은 메시지 3개');
    expect(html).toContain('href="/admin/cs/chat?period=all&amp;read=unread&amp;inquiryId=a20c9000-0000-4000-8000-000000000201"');
    expect(html).toContain('href="/admin/cs/chat?status=answered&amp;period=all"');
    expect(html).toContain('aria-label="진행중 상담 4건"');
    expect(html).toContain('전체 기간 · 현재 대화 상태 기준');
  });

  it('리뷰 인사이트의 기준일과 동일한 조건별 상품 수를 연결한다', () => {
    const html = renderToStaticMarkup(<HomeAttention data={data} />);
    expect(html).toContain('2026-10-19 기준 · 조건별 상품 수');
    expect(html).toContain('aria-label="평점 4.6 미만 상품 0개"');
    expect(html).toContain('href="/admin/cs/review-insights?focus=rating&amp;q=&amp;sort=analysis&amp;page=1&amp;size=20"');
    expect(html).toContain('aria-label="주문 대비 리뷰가 적은 상품 4개"');
  });

  it('조회 실패가 0건·빈 목록처럼 보이지 않는다', () => {
    const html = renderToStaticMarkup(<HomeAttention data={{ ...data, unreadChats: null, reviewInsights: null }} />);
    expect(html).toContain('읽지 않은 상담 <strong>확인 필요</strong>');
    expect(html).toContain('상담 현황을 불러오지 못했습니다.');
    expect(html).toContain('리뷰 분석을 불러오지 못했습니다.');
    expect(html).not.toContain('전체 상담 0건');
  });
});
