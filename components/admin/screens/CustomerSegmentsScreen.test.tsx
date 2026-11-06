import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/admin/customer-segment-actions', () => ({ archiveCustomerSegmentsAction: vi.fn(), favoriteCustomerSegmentAction: vi.fn() }));
import { normalizeSegmentFilters } from '@/lib/admin/customer-segments';
import { CustomerSegmentsScreen } from './CustomerSegmentsScreen';

/* kit Button은 type을 주지 않으면 type="button"이라 폼을 제출하지 않는다 — 세그먼트 목록 조회(GET 폼)의 조회 버튼만 제출하고,
   선택 삭제는 확인 단계를 거치도록 제출하지 않는 버튼인지 지킨다. 조회 키는 그대로다. */
it('세그먼트 목록 조회는 같은 조회 키로 GET 폼을 제출한다', () => {
  const html = renderToStaticMarkup(<CustomerSegmentsScreen
    data={{ rows: [], favorites: [], total: 0, filters: normalizeSegmentFilters({ q: '장바구니', favorite: '1' }) }}
    overview={{ checkedAt: '2026-11-06T00:00:00.000Z', groups: { potential: null, visitor: 3, interested: 2, buyer: 1, loyal: 0 }, firstPurchaseMembers: 4, memberCount: 9 }}
  />);
  expect(html).toMatch(/<button[^>]*type="submit"[^>]*>조회<\/button>/);
  expect(html).toMatch(/<button[^>]*type="button"[^>]*>선택 삭제<\/button>/);
  for (const name of ['group', 'target', 'kind', 'q', 'favorite', 'pageSize']) expect(html).toContain(`name="${name}"`);
  expect(html).toContain('value="장바구니"');
  expect(html).toMatch(/<input type="checkbox" name="favorite" checked="" value="1"\/>/);
  expect(html).toContain('조건에 맞는 세그먼트가 없습니다.');
});
