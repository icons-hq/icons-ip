import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HelpScreen } from './HelpScreen';
import { FaqSuggestionList } from './FaqSuggestions';
import { normalizeFaqFilters, type FaqEntry } from '@/lib/faq';
const entry: FaqEntry = { id: 'faq-1', category: 'order', question: '배송은 언제 되나요?', answer: '주문 상세에서 확인해주세요.\n<script>alert(1)</script>', sortOrder: 1, published: true, updatedAt: '2026-09-08T01:00:00Z' };

describe('공개 FAQ 화면', () => {
  it('로그인 없이 질문·답변·검색·유형을 제공하고 문의를 연결한다', () => {
    const html = renderToStaticMarkup(<HelpScreen data={{ entries: [entry], total: 1, filters: normalizeFaqFilters({}) }} />);
    expect(html).toContain('action="/help"');
    expect(html).toContain('배송은 언제 되나요?');
    expect(html).toContain('FAQ 카테고리');
    expect(html).toContain('href="/my/inquiries/new"');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });
  it('다음 페이지와 카테고리 링크가 검색 조건을 보존한다', () => {
    const html = renderToStaticMarkup(<HelpScreen data={{ entries: [entry], total: 21, filters: normalizeFaqFilters({ q: '배송', category: 'order' }) }} />);
    expect(html).toContain('category=order&amp;page=2');
    expect(html).toContain('q=%EB%B0%B0%EC%86%A1');
  });
  it('조회 실패를 빈 목록과 구별하고 재시도와 문의 진입을 남긴다', () => {
    const html = renderToStaticMarkup(<HelpScreen failed data={{ entries: [], total: 0, filters: normalizeFaqFilters({}) }} />);
    expect(html).toContain('FAQ를 불러오지 못했습니다.');
    expect(html).toContain('다시 시도');
    expect(html).not.toContain('아직 등록된 FAQ가 없습니다.');
  });
  it('문의 전 제안은 페이지 이동 없이 답변을 펼칠 수 있다', () => {
    const html = renderToStaticMarkup(<FaqSuggestionList entries={[entry]} />);
    expect(html).toContain('<details');
    expect(html).toContain('<summary>배송은 언제 되나요?</summary>');
    expect(html).toContain('주문 상세에서 확인해주세요.');
  });
});
