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
  expect(html).toContain('/api/admin/gifts/export'); expect(html).toContain('page=2');
});
it('주문 생성 상태는 결제완료로 표시하지 않고 실제 주문 상세로 연결한다', () => {
  const orderId = giftConsoleId(20), row = { ...adminGiftRow, state: 'ordered' as const, recipientName: 'TEST 받는 사람', orderId };
  const html = renderToStaticMarkup(<AdminGiftsScreen data={{ rows: [row], total: 1, page: 1, pageSize: 100,
    asOf: row.createdAt, filters: normalizeAdminGiftFilters({ state: 'all' }) }} />);
  expect(html).toContain(`/admin/sales/orders/${orderId}`); expect(html).toContain('>주문 생성<'); expect(html).toContain('state=all');
});
