import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { normalizeFaqFilters } from '@/lib/faq';
import { FaqScreen } from './FaqScreen';
vi.mock('@/app/admin/faq-actions', () => ({ saveFaqAction: vi.fn(), deleteFaqAction: vi.fn() }));
describe('FAQ 운영 화면', () => {
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
  });
});
