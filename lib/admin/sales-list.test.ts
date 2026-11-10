import { describe, expect, it } from 'vitest';
import { adminOrderBackHref, adminOrdersHref, normalizeAdminOrderFilters } from './orders';
import { adminClaimBackHref, adminClaimHref, adminClaimStageLabel, normalizeAdminClaimFilters } from './claims';
import { adminSettledHref, normalizeAdminSettledFilters } from './settled';
import { adminUnpaidHref, normalizeAdminUnpaidFilters } from './unpaid';
import { normalizeShipmentFilters, shipmentConsoleHref } from './shipment-dispatch';
import { parseSettledExportFilters } from './settled-export';
import { salesListHiddenFields } from './sales-list';

describe('sales worklist URL contract', () => {
  it('keeps paid claim searches and a settled search field through pages and detail returns', () => {
    const claim = normalizeAdminClaimFilters({ dateField: 'paid', from: '2026-10-02', to: '2026-10-02', query: 'buyer', sort: 'oldest', page: '2' });
    const claimHref = adminClaimHref('return', claim);
    expect(claim).toMatchObject({ dateField: 'paid', sort: 'oldest', page: 2 });
    expect(adminClaimBackHref('return', claimHref.split('?')[1])).toBe(claimHref);
    const settled = normalizeAdminSettledFilters({ field: 'tracking', query: 'GAP1530', dateField: 'settled', pageSize: '50', page: '2' });
    const href = adminSettledHref(settled);
    expect(adminOrderBackHref(href)).toBe(href);
    expect(salesListHiddenFields(href, ['sort', 'pageSize'])).toMatchObject({ field: 'tracking', query: 'GAP1530', dateField: 'settled' });
    expect(normalizeAdminSettledFilters({ field: ['recipient', 'all'] })).not.toHaveProperty('field');
    expect(normalizeAdminClaimFilters({ dateField: ['paid', 'requested'] })).not.toHaveProperty('dateField');
  });
  it('preserves effective order filters through result controls, pagination and detail return', () => {
    const filters = normalizeAdminOrderFilters({ field: 'phone', query: '010-1234', dateField: 'paid', paymentMethod: 'card', sort: 'amount_high', pageSize: '50', page: '3' });
    const href = adminOrdersHref(filters);
    expect(filters).toMatchObject({ field: 'phone', dateField: 'paid', paymentMethod: 'card', sort: 'amount_high', pageSize: 50, page: 3 });
    expect(adminOrderBackHref(href)).toBe(href);
    expect(salesListHiddenFields(href, ['sort', 'pageSize'])).toEqual({ dateField: 'paid', paymentMethod: 'card', query: '010-1234', field: 'phone' });
    expect(new URL(adminOrdersHref(filters, { page: 4 }), 'https://test.invalid').searchParams.get('pageSize')).toBe('50');
  });
  it('keeps shipment method/date/search filters when returning from an order detail', () => {
    const filters = normalizeShipmentFilters({ tab: 'delivered', method: 'pickup', paymentMethod: 'bank_transfer', dateField: 'delivered', field: 'tracking', query: '1234', sort: 'newest', pageSize: '500', page: '2' }, 'shipping');
    const href = shipmentConsoleHref('shipping', filters);
    expect(adminOrderBackHref(href)).toBe(href);
    expect(filters).toMatchObject({ method: 'pickup', dateField: 'delivered', field: 'tracking', sort: 'newest', pageSize: 500 });
  });
  it('preserves claim date/search fields through the claim-specific return URL', () => {
    const filters = normalizeAdminClaimFilters({ stage: 'collected', field: 'buyer', dateField: 'collected', query: '검색', pageSize: '100', sort: 'oldest', page: '2' });
    const href = adminClaimHref('return', filters);
    expect(adminClaimBackHref('return', href.split('?')[1])).toBe(href);
    expect(adminClaimStageLabel('return', 'rejected')).toBe('반품거부');
    expect(adminClaimStageLabel('exchange', 'completed')).toBe('재배송 처리완료');
  });
  it('serializes unpaid state and report date basis without introducing unsupported choices', () => {
    const unpaid = normalizeAdminUnpaidFilters({ state: 'unknown', sort: 'newest', pageSize: '100', q: '대조' });
    expect(adminUnpaidHref(unpaid)).toContain('state=unknown');
    const settled = normalizeAdminSettledFilters({ dateField: 'settled', sort: 'oldest', pageSize: '50' });
    expect(adminOrderBackHref(adminSettledHref(settled))).toBe(adminSettledHref(settled));
    expect(parseSettledExportFilters({ dateField: 'paid', from: '2026-10-01', to: '2026-10-12', query: '' })).toEqual({ dateField: 'paid', from: '2026-10-01', to: '2026-10-12', query: '' });
    expect(parseSettledExportFilters({ dateField: 'providerPayout' })).toBeNull();
  });
  it('rejects repeated selectors, unsupported values and SQL offset overflow', () => {
    expect(normalizeAdminOrderFilters({ dateField: ['paid', 'ordered'], sort: 'id;drop', pageSize: '500', paymentMethod: 'naverpay' })).not.toHaveProperty('dateField');
    expect(normalizeAdminOrderFilters({ sort: 'id;drop', pageSize: '500' })).not.toHaveProperty('sort');
    expect(normalizeAdminOrderFilters({ page: '214748365', pageSize: '100' }).page).toBe(1);
    expect(normalizeShipmentFilters({ page: '4294969', pageSize: '500', dateField: 'settled', field: ['buyer', 'recipient'], method: 'naver' }, 'dispatch')).toMatchObject({ page: 1 });
    expect(normalizeShipmentFilters({ dateField: 'settled' }, 'dispatch')).not.toHaveProperty('dateField');
    expect(normalizeAdminUnpaidFilters({ page: '3garbage' }).page).toBe(1);
  });
});
