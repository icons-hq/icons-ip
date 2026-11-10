import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
vi.mock('@/components/admin/EncryptedWorkbookDownloadButton', () => ({ EncryptedWorkbookDownloadButton: ({ href, label }: { href: string; label: string }) => <a href={href}>{label}</a> }));
import { AdminGiftsScreen } from './AdminGiftsScreen';
import { adminGiftRow, giftConsoleId } from '../../../test/fixtures/admin-gifts';
import { normalizeAdminGiftFilters } from '@/lib/admin/gifts';
it('수락 전 결제 안내·빈 수령인·50/100/200 선택과 검색 전체 파일을 표시한다', () => {
  const html = renderToStaticMarkup(<AdminGiftsScreen data={{ rows: [adminGiftRow], total: 201, page: 1, pageSize: 100,
    asOf: adminGiftRow.createdAt, filters: normalizeAdminGiftFilters({}) }} />);
  expect(html).toContain('수락 전에는 주문·결제가 생성되지 않습니다.'); expect(html).toContain('TEST 보낸 사람');
  expect(html).toContain('>수락 전<'); expect(html).toContain('>주문 전<');
  for (const size of [50, 100, 200]) expect(html).toContain(`${size}개씩`);
  /* 목록 수 변경은 GET 폼 제출이다 — kit Button은 type이 없으면 button이 된다. */
  expect(html).toMatch(/<button[^>]*type="submit"[^>]*>적용</);
  expect(html).toMatch(/<button[^>]*type="submit"[^>]*>검색</);
  expect(html).toContain('/api/admin/gifts/export'); expect(html).toContain('page=2');
});
it('주문 생성 상태는 결제완료로 표시하지 않고 실제 주문 상세로 연결한다', () => {
  const orderId = giftConsoleId(20), row = { ...adminGiftRow, state: 'ordered' as const, recipientName: 'TEST 받는 사람', orderId };
  const html = renderToStaticMarkup(<AdminGiftsScreen data={{ rows: [row], total: 1, page: 1, pageSize: 100,
    asOf: row.createdAt, filters: normalizeAdminGiftFilters({ state: 'all' }) }} />);
  expect(html).toContain(`/admin/sales/orders/${orderId}`); expect(html).toContain('>주문 생성<'); expect(html).toContain('state=all');
});
/* 사람 눈 판정: 전 행이 같은 회색이라 내일 끝나는 건을 찾을 수 없었다. */
it('오늘·내일 끝나는 선물에만 표시를 붙이고 건수를 목록 머리에 적는다', () => {
  const at = (expiresAt: string, index: number) => ({ ...adminGiftRow, id: giftConsoleId(index), expiresAt });
  const asOf = '2026-11-09T06:00:00Z';
  const html = renderToStaticMarkup(<AdminGiftsScreen data={{ rows: [at('2026-11-09T12:00:00Z', 1), at('2026-11-10T06:00:00Z', 2), at('2026-11-14T06:00:00Z', 3)], total: 3, page: 1, pageSize: 100, asOf, filters: normalizeAdminGiftFilters({}) }} />);
  expect(html).toMatch(/data-tone="warning"[^>]*>오늘 종료</);
  expect(html).toMatch(/data-tone="warning"[^>]*>내일 종료</);
  expect(html).toContain('>5일 남음<');
  expect(html).toContain('오늘·내일 종료 2건');
});
