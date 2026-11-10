import { describe, expect, it } from 'vitest';
import {
  adminInquiryBackHref,
  adminInquiryBuyerLabel,
  adminInquiryDetailHref,
  adminInquiryHref,
  adminInquiryNavigation,
  adminInquiryBackFilters,
  normalizeAdminInquiryFilters,
  type AdminInquiryFilters,
} from './inquiries';

const BASE: AdminInquiryFilters = {
  category: 'all',
  field: 'all',
  from: null,
  page: 1,
  query: '',
  status: 'open',
  to: null,
};

describe('어드민 문의 필터 정규화', () => {
  /* 큐 화면의 존재 이유가 "지금 답할 것"이라 기본값이 미답변이다. */
  it('상태를 주지 않으면 미답변으로 연다', () => {
    expect(normalizeAdminInquiryFilters({}).status).toBe('open');
  });

  it('모르는 상태·유형·검색 유형은 기본값으로 되돌린다', () => {
    const filters = normalizeAdminInquiryFilters({
      category: 'refund',
      field: 'phone',
      status: 'archived',
    });

    expect(filters.status).toBe('open');
    expect(filters.category).toBe('all');
    expect(filters.field).toBe('all');
  });

  /* 뒤집힌 기간은 RPC가 거절한다. 화면이 오류로 죽는 대신 조건을 버린다. */
  it('뒤집힌 기간은 통째로 버린다', () => {
    const filters = normalizeAdminInquiryFilters({ from: '2026-08-20', to: '2026-08-10' });

    expect(filters.from).toBeNull();
    expect(filters.to).toBeNull();
  });

  it('달력에 없는 날짜와 음수 페이지를 받아들이지 않는다', () => {
    const filters = normalizeAdminInquiryFilters({ from: '2026-02-30', page: '-3' });

    expect(filters.from).toBeNull();
    expect(filters.page).toBe(1);
  });

  it('100자를 넘는 검색어는 버린다', () => {
    const filters = normalizeAdminInquiryFilters({ query: 'a'.repeat(101) });

    expect(filters.query).toBe('');
  });
});

describe('어드민 문의 링크', () => {
  it('상태와 페이지는 항상 싣고 기본값 필터는 URL을 더럽히지 않는다', () => {
    expect(adminInquiryHref(BASE)).toBe('/admin/cs/inquiries?status=open&page=1');
  });

  it('검색 유형은 검색어가 있을 때만 따라간다', () => {
    expect(adminInquiryHref({ ...BASE, field: 'buyer' }))
      .toBe('/admin/cs/inquiries?status=open&page=1');
    expect(adminInquiryHref({ ...BASE, field: 'buyer', query: '홍길동' }))
      .toContain('field=buyer');
  });

  /* 상세에서 목록으로 돌아올 때 조건을 잃으면 운영자가 다시 필터를 짠다. */
  it('상세 링크가 목록 조건을 함께 들고 간다', () => {
    const href = adminInquiryDetailHref('inq-1', { ...BASE, page: 3, status: 'answered' });

    expect(href).toContain('/admin/cs/inquiries/inq-1?back=');
    expect(adminInquiryBackHref(decodeURIComponent(href.split('back=')[1])))
      .toBe('/admin/cs/inquiries?status=answered&page=3');
  });

  /* back 값은 URL에서 온다. 임의 경로로 튀지 않게 쿼리 문자열로만 되살린다. */
  it('back 값이 없거나 이상하면 기본 목록으로 보낸다', () => {
    expect(adminInquiryBackHref(undefined)).toBe('/admin/cs/inquiries');
    expect(adminInquiryBackHref('https://evil.example/steal')).not.toContain('evil.example');
    expect(adminInquiryBackHref('  ')).toBe('/admin/cs/inquiries');
  });
});

describe('구매자 표기', () => {
  it('닉네임이 비면 주문 콘솔과 같은 축약을 쓴다', () => {
    expect(adminInquiryBuyerLabel(null, '33333333-3333-4333-8333-333333333333')).toBe('fan_333333');
    expect(adminInquiryBuyerLabel('  maple  ', 'x')).toBe('maple');
  });
});

describe('inquiry navigation', () => {
  it('preserves every filter across page boundaries for previews and dedicated details', async () => {
    const filters = { ...BASE, status: 'all' as const, category: 'order' as const, satisfaction: 'dissatisfied' as const, from: '2026-10-01', to: '2026-10-31', query: '배송', field: 'title' as const, page: 2, pageSize: 20 };
    const data = { filters, pageSize: 20, total: 42, counts: { open: 42, answered: 0, closed: 0 }, rows: Array.from({ length: 20 }, (_, i) => ({ id: `id-${21+i}` })) } as import('./inquiries').AdminInquiryConsoleData;
    const calls: number[] = [];
    const adjacent = async (offset: number) => { calls.push(offset); return `id-${offset+1}`; };
    const first = await adminInquiryNavigation('id-21', data, 'preview', adjacent);
    expect(first.position).toBe(21); expect(calls).toEqual([19]);
    expect(first.previousHref).toBe(`${adminInquiryHref(filters, { page: 1 })}&inquiryId=id-20`);
    const last = await adminInquiryNavigation('id-40', data, 'detail', adjacent);
    expect(last.nextHref).toBe(adminInquiryDetailHref('id-41', { ...filters, page: 3 }));
    expect(adminInquiryBackFilters(new URL(last.nextHref!, 'http://localhost').searchParams.get('back'))).toEqual({ ...filters, page: 3 });
  });
  it('does not fabricate a position or neighbor after the record leaves the filtered page', async () => {
    const data = { filters: BASE, pageSize: 20, total: 0, rows: [], counts: { open: 0, answered: 0, closed: 0 } };
    const result = await adminInquiryNavigation('removed', data, 'preview', async () => { throw new Error('must not query'); });
    expect(result).toEqual({ position: null, total: 0, previousHref: null, nextHref: null });
  });
  it('never links back to itself when concurrent queue changes shift a boundary lookup', async () => {
    const data = { filters: { ...BASE, page: 2 }, pageSize: 20, total: 22, rows: [{ id: 'current' }], counts: { open: 22, answered: 0, closed: 0 } } as import('./inquiries').AdminInquiryConsoleData;
    const result = await adminInquiryNavigation('current', data, 'preview', async () => 'current');
    expect(result.previousHref).toBeNull(); expect(result.nextHref).toBeNull();
  });
});
