import { describe, expect, it } from 'vitest';
import { normalizeShipmentFilters, shipmentConsoleHref } from './shipment-dispatch';
import { parseShipmentDelayNotice, shipmentDelayNoticeLabel } from './shipment-delay-notice';
import { adminListExportHref } from './list-export';

describe('배송건의 발송지연 안내 조회 계약', () => {
  it('검색·탭·페이지·엑셀 링크에서 같은 필터를 유지하고 배송현황에서는 제거한다', () => {
    const filters = normalizeShipmentFilters({ tab: 'delayed', query: '  검증  ', delayNotice: 'partial_failed', page: '2', pageSize: '50' }, 'dispatch');
    expect(filters).toMatchObject({ delayNotice: 'partial_failed', query: '검증', page: 2, pageSize: 50 });
    const href = shipmentConsoleHref('dispatch', filters, { page: 3 });
    expect(new URL(href, 'https://test.invalid').searchParams.get('delayNotice')).toBe('partial_failed');
    expect(adminListExportHref('dispatch', href)).toContain('delayNotice=partial_failed');
    expect(adminListExportHref('dispatch', href)).not.toContain('page=');
    expect(shipmentConsoleHref('shipping', filters, { tab: 'transit' })).not.toContain('delayNotice');
    expect(normalizeShipmentFilters({ delayNotice: 'partial_failed' }, 'shipping')).not.toHaveProperty('delayNotice');
  });
  it.each(['all', 'sent,unknown', 'invalid', ['sent', 'unknown']])('잘못된 필터를 조회에 넣지 않는다: %s', value => {
    expect(normalizeShipmentFilters({ delayNotice: value }, 'dispatch')).not.toHaveProperty('delayNotice');
  });
  it('미발송은 명시적인 빈 기록만 허용하고 누락 응답은 확인 필요로 남긴다', () => {
    const unsent = { status: 'not_sent', noticeId: null, requestedAt: null, inAppStatus: null, emailStatus: null, emailProviderState: null };
    expect(parseShipmentDelayNotice(unsent)).toEqual(unsent);
    expect(parseShipmentDelayNotice(undefined)).toBeNull();
    expect(parseShipmentDelayNotice({ ...unsent, emailStatus: 'sent' })).toBeNull();
    expect(shipmentDelayNoticeLabel()).toBe('확인 필요');
  });
  it('실제 요청 식별자와 시각·채널 결과가 모두 있어야 발송 기록을 표시한다', () => {
    const sent = { status: 'sent', noticeId: '11111111-1111-4111-8111-111111111111', requestedAt: '2026-10-13T10:00:00Z', inAppStatus: 'sent', emailStatus: 'sent', emailProviderState: 'accepted' };
    expect(parseShipmentDelayNotice(sent)).toEqual(sent);
    expect(parseShipmentDelayNotice({ ...sent, noticeId: null })).toBeNull();
    expect(parseShipmentDelayNotice({ ...sent, requestedAt: 'invalid' })).toBeNull();
    expect(parseShipmentDelayNotice({ ...sent, emailStatus: 'made_up' })).toBeNull();
  });
});
