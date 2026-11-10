import { expect, it } from 'vitest';
import { adminGiftRow } from '../../test/fixtures/admin-gifts';
import { adminGiftsHref, adminGiftsQuery, normalizeAdminGiftFilters, parseAdminGiftData, parseAdminGiftRow, giftExportRows } from './gifts';
it('기본 수락 대기·100개와 전체 상태 및 50/200개 조건을 페이지 링크에 보존한다', () => {
  expect(normalizeAdminGiftFilters({})).toEqual({ state: 'awaiting_acceptance', query: '', page: 1, pageSize: 100 });
  const filters = normalizeAdminGiftFilters({ state: 'all', query: '  TEST & 선물  ', page: '3', pageSize: '200' });
  const query = new URL(adminGiftsHref(filters, 4), 'https://example.test').searchParams;
  expect(Object.fromEntries(query)).toEqual({ state: 'all', query: 'TEST & 선물', pageSize: '200', page: '4' });
  expect(Object.fromEntries(adminGiftsQuery(filters, false))).toEqual({ state: 'all', query: 'TEST & 선물' });
  expect(normalizeAdminGiftFilters({ state: 'invalid', page: '-1', pageSize: '10000' })).toEqual(normalizeAdminGiftFilters({}));
});
it('DTO는 raw 개인정보·메시지·직접입력 내용·링크 토큰·금액을 전파하지 않는다', () => {
  const parsed = parseAdminGiftRow({ ...adminGiftRow, address: { phone: 'CANARY' }, message: 'CANARY', inputValues: 'CANARY', token: 'CANARY', total: 10000 });
  expect(parsed).toEqual(adminGiftRow); expect(JSON.stringify(giftExportRows([parsed!]))).not.toContain('CANARY');
  expect(parseAdminGiftRow({ ...adminGiftRow, quantity: '2' })).toBeNull();
  expect(parseAdminGiftRow({ ...adminGiftRow, state: 'ordered' })).toBeNull();
  expect(parseAdminGiftRow({ ...adminGiftRow, expiresAt: 'unknown' })).toBeNull();
});
it('다른 페이지/표시 개수 응답과 불완전한 행은 전체 목록으로 오인하지 않는다', () => {
  const filters = normalizeAdminGiftFilters({ page: '2', pageSize: '50' });
  const data = { rows: [adminGiftRow], total: 105, page: 2, pageSize: 50, asOf: adminGiftRow.createdAt };
  expect(parseAdminGiftData(data, filters)?.total).toBe(105);
  expect(parseAdminGiftData({ ...data, page: 1 }, filters)).toBeNull();
  expect(parseAdminGiftData({ ...data, pageSize: 100 }, filters)).toBeNull();
  expect(parseAdminGiftData({ ...data, rows: [{ ...adminGiftRow, id: 'wrong' }] }, filters)).toBeNull();
});
