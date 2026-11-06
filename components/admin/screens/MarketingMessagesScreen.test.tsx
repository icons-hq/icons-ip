import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@/app/admin/marketing-message-actions', () => ({ changeMarketingMessageAction: vi.fn(), exportMarketingMessagesAction: vi.fn() }));
import { normalizeMarketingFilters } from '@/lib/admin/marketing-messages';
import { MarketingMessagesScreen } from './MarketingMessagesScreen';

/* kit Button은 type을 주지 않으면 type="button"이라 폼을 제출하지 않는다 — 이력 조회(GET 폼)의 조회 버튼이 제출 버튼인지,
   조회 키(state·q·start·end)가 그대로인지 지킨다. */
it('메시지 이력 조회는 같은 조회 키로 GET 폼을 제출한다', () => {
  const html = renderToStaticMarkup(<MarketingMessagesScreen data={{ rows: [], total: 0, page: 1, pageSize: 20, filters: normalizeMarketingFilters({ q: '가을', state: 'draft' }) }} />);
  expect(html).toMatch(/<button[^>]*type="submit"[^>]*>조회<\/button>/);
  for (const name of ['state', 'q', 'start', 'end']) expect(html).toContain(`name="${name}"`);
  expect(html).toContain('value="가을"');
  expect(html).toMatch(/<button[^>]*type="button"[^>]*disabled=""[^>]*>조회 결과 엑셀 다운로드<\/button>/);
  expect(html).toContain('조건에 맞는 메시지가 없습니다.');
});
