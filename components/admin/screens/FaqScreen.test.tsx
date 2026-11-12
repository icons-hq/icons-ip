import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { normalizeFaqFilters } from '@/lib/faq';
import { FaqScreen } from './FaqScreen';
vi.mock('@/app/admin/faq-actions', () => ({ saveFaqAction: vi.fn(), deleteFaqAction: vi.fn() }));
describe('FAQ 운영 화면', () => {
  it('필터·등록·수정의 카테고리는 상품으로 표시하고 작성한 질문은 보존한다', () => {
    const html = renderToStaticMarkup(<FaqScreen data={{ total: 1, filters: normalizeFaqFilters({ category: 'good' }), entries: [{ id: 'faq-1', category: 'good', question: '굿즈 교환이 가능한가요?', answer: '주문 상세에서 확인하세요.', sortOrder: 0, published: true, updatedAt: '2026-09-08T00:00:00Z' }] }} />);
    expect(html.match(/<option value="good"(?: selected="")?>상품<\/option>/g)).toHaveLength(3);
    expect(html).toMatch(/<summary[^>]*><span[^>]*>상품<\/span>/);
    expect(html).toMatch(/<strong[^>]*>굿즈 교환이 가능한가요\?<\/strong>/);
  });
  it('새 FAQ 등록은 화면 머리의 버튼이고 게시 상태는 공개·비공개가 색으로 갈린다', () => {
    const entry = { id: 'faq-1', category: 'order', question: '배송 확인', answer: '주문 상세', sortOrder: 3, updatedAt: '2026-09-08T00:00:00Z' } as const;
    const html = renderToStaticMarkup(<FaqScreen data={{ total: 2, filters: normalizeFaqFilters({}), entries: [{ ...entry, published: true }, { ...entry, id: 'faq-2', published: false }] }} />);
    expect(html).toMatch(/<button(?=[^>]*type="button")[^>]*>(?:<svg[\s\S]*?<\/svg>)?새 FAQ 등록<\/button>/);
    expect(html).not.toContain('group/create');
    expect(html).toContain('<dialog');
    expect(html).toMatch(/data-tone="neutral"[^>]*>비공개</);
    expect(html).toMatch(/data-tone="success"[^>]*>공개</);
  });

  it('검색·카테고리·게시 필터와 등록·수정·삭제 확인을 연결한다', () => {
    const html = renderToStaticMarkup(<FaqScreen data={{ total: 1, filters: normalizeFaqFilters({}), entries: [{ id: 'faq-1', category: 'order', question: '배송 확인', answer: '주문 상세', sortOrder: 3, published: false, updatedAt: '2026-09-08T00:00:00Z' }] }} />);
    expect(html).toContain('새 FAQ 등록');
    expect(html).toContain('action="/admin/cs/faq"');
    expect(html).toContain('name="category"');
    expect(html).toContain('name="status"');
    expect(html).toContain('name="question"');
    expect(html).toContain('name="answer"');
    expect(html).toContain('name="published"');
    expect(html).toContain('name="sortOrder"');
    expect(html).toContain('name="updatedAt" value="2026-09-08T00:00:00Z"');
    expect(html).toContain('이 FAQ를 삭제하겠습니다.');
    expect(html).toContain('FAQ 수정 저장');
    /* 등록·수정·삭제는 각자의 폼을 제출한다(kit Button은 type을 주지 않으면 button이 된다). */
    for (const label of ['FAQ 등록', 'FAQ 수정 저장', '삭제 확정']) expect(html).toMatch(new RegExp(`<button(?=[^>]*type="submit")[^>]*>${label}</button>`));
  });

  /* 0901-044: 고객 상담 위젯의 FAQ 위 유형 버튼이 보여 줄 대표 답변을 FAQ마다 지정하고, 화면 머리에서 지금 상태를 본다. */
  it('상담 위젯 버튼 답변을 요약하고 FAQ마다 버튼을 지정한다', () => {
    const entry = { id: 'faq-1', category: 'order', question: '배송은 언제 오나요?', answer: '주문 상세', sortOrder: 0, published: true, updatedAt: '2026-11-12T00:00:00Z', widgetTopic: 'delivery' } as const;
    const html = renderToStaticMarkup(<FaqScreen data={{ total: 1, filters: normalizeFaqFilters({}), entries: [entry],
      widgetTopics: [{ topic: 'delivery', id: 'faq-1', question: '배송은 언제 오나요?', published: true }, { topic: 'return', id: 'faq-9', question: '교환 초안', published: false }] }} />);
    const summary = html.slice(html.indexOf('data-faq-widget-topics'), html.indexOf('</section>', html.indexOf('data-faq-widget-topics')));
    expect(summary).toContain('상담 위젯 버튼 답변');
    expect(summary).toMatch(/<dt[^>]*>배송 언제 오나요<\/dt><dd[^>]*><span[^>]*>배송은 언제 오나요\?<\/span><\/dd>/);
    expect(summary).toMatch(/<dt[^>]*>취소<\/dt><dd[^>]*><span[^>]*>지정 안 함 · 취소\/반품\/교환 카테고리의 공개 FAQ 목록<\/span><\/dd>/);
    expect(summary).toMatch(/교환 초안<\/span><span[^>]*data-tone="neutral"[^>]*>비공개 · 목록이 대신 보임/);
    expect(html.indexOf('상담 위젯 버튼 답변')).toBeLessThan(html.indexOf('action="/admin/cs/faq"'));
    expect(html).toMatch(/<strong[^>]*>배송은 언제 오나요\?<\/strong><span[^>]*data-faq-widget-topic="delivery"[^>]*>위젯 버튼 · 배송 언제 오나요<\/span>/);
    expect(html).toContain('name="widgetTopic"');
    expect(html).toMatch(/<option value="delivery" selected="">배송 언제 오나요<\/option>/);
    expect(html).toMatch(/<option value="">지정 안 함<\/option>/);
    expect(html).toContain('버튼마다 하나만 지정되며, 다른 FAQ에 지정돼 있었다면 이 FAQ로 바뀝니다.');
    /* 지정 상태를 읽지 못하면 '지정 안 함'으로 잘못 보이지 않고 다시 불러오라고 안내한다. */
    const failed = renderToStaticMarkup(<FaqScreen data={{ total: 0, filters: normalizeFaqFilters({}), entries: [], widgetTopics: null }} />);
    expect(failed).toContain('버튼 지정 상태를 불러오지 못했습니다.');
    expect(failed).not.toContain('지정 안 함 ·');
  });
});
