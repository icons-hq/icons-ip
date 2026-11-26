import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
vi.mock('@/components/admin/EncryptedWorkbookDownloadButton', () => ({ EncryptedWorkbookDownloadButton: ({ href, label }: { href: string; label: string }) => <a href={href}>{label}</a> }));
import { AdminGiftsScreen } from './AdminGiftsScreen';
import { adminGiftRow, giftConsoleId } from '../../../test/fixtures/admin-gifts';
import { normalizeAdminGiftFilters } from '@/lib/admin/gifts';
it('수락 전 결제 안내·빈 수령인·50/100/200 선택과 검색 전체 파일을 표시한다', () => {
  const html = renderToStaticMarkup(<AdminGiftsScreen data={{ rows: [adminGiftRow], total: 201, page: 1, pageSize: 100,
    asOf: adminGiftRow.createdAt, filters: normalizeAdminGiftFilters({}) }} />);
  expect(html).toContain('받는 사람이 수락한 뒤 보낸 사람이 결제합니다.'); expect(html).toContain('TEST 보낸 사람');
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
/* G-01: 선물에는 운영자가 쓰는 번호가 없다. 내부 번호 끝 8자(선물번호·연결 주문)는 번호가 아니라 화면에서 뺀다. 조회 함수가 주문번호를 주지 않아 연결 주문은 가는 곳을 말한다. */
it('선물번호와 주문 번호 조각을 보이지 않고, 연결 주문은 주문 상세 링크로 말한다', () => {
  const orderId = giftConsoleId(20), row = { ...adminGiftRow, id: giftConsoleId(7), state: 'ordered' as const, recipientName: 'TEST 받는 사람', orderId };
  const html = renderToStaticMarkup(<AdminGiftsScreen data={{ rows: [row], total: 1, page: 1, pageSize: 100, asOf: row.createdAt, filters: normalizeAdminGiftFilters({ state: 'all' }) }} />);
  const visible = html.replace(/<[^>]*>/g, ' ');
  expect(html).not.toContain('선물번호'); expect(visible).not.toMatch(/\b[0-9A-Fa-f]{8}\b/);
  expect(html).not.toMatch(/title="[0-9a-f]{8}-[0-9a-f]{4}-/);
  expect(html).toMatch(new RegExp(`<a[^>]*href="/admin/sales/orders/${orderId}"[^>]*>주문 상세</a>`));
  expect(html).toContain('>연결 주문<');
});
/* G-02·G-03: 이름은 모든 상태를 보이는 '선물 내역'이고, 검색 안내는 화면에 보이는 값만 말하며, 메뉴설명은 한 문단이다. */
it('화면 이름은 선물 내역이고 메뉴설명은 한 문단이다', () => {
  const html = renderToStaticMarkup(<AdminGiftsScreen data={{ rows: [adminGiftRow], total: 1, page: 1, pageSize: 100, asOf: adminGiftRow.createdAt, filters: normalizeAdminGiftFilters({}) }} />);
  expect(html).toContain('aria-label="선물 내역"'); expect(html).not.toContain('선물 수락');
  expect(html).toMatch(/id="sales-gifts-query-hint">보낸 사람 · 받는 사람 · 상품</);
  const guide = html.slice(html.indexOf('data-sales-guide'), html.indexOf('</details>', html.indexOf('data-sales-guide')));
  expect(guide.match(/<p>/g)).toHaveLength(1); expect(guide).toContain('연결 주문의 [주문 상세]');
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
