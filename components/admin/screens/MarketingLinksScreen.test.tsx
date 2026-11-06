import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/admin/marketing-link-actions', () => ({ issueMarketingLinksAction: vi.fn() }));
import { normalizeMarketingLinkFilters } from '@/lib/admin/marketing-links';
import { MarketingLinksScreen } from './MarketingLinksScreen';

/* kit Button은 type을 주지 않으면 type="button"이라 폼을 제출하지 않는다 — 링크 조회(GET 폼)의 조회 버튼이 제출 버튼인지,
   종류·목록 수가 숨은 값으로 함께 실리는지 지킨다. */
it('링크 조회는 종류·목록 수를 함께 실어 GET 폼을 제출한다', () => {
  const filters = normalizeMarketingLinkFilters({ source: 'good', q: '키링' });
  const html = renderToStaticMarkup(<MarketingLinksScreen canIssueHome={false} data={{ filters, rows: [], total: 0 }} />);
  expect(html).toMatch(/<button[^>]*type="submit"[^>]*>조회<\/button>/);
  expect(html).toContain('type="hidden" name="source" value="good"');
  expect(html).toContain(`type="hidden" name="pageSize" value="${filters.pageSize}"`);
  expect(html).toContain('name="q" value="키링"');
  expect(html).toMatch(/aria-current="page" href="[^"]*source=good[^"]*">상품<\/a>/);
  expect(html).toContain('조건에 맞는 링크가 없습니다.');
});
