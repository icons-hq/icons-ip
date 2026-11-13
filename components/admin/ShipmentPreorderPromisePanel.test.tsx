// @vitest-environment node
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/app/admin/preorder-shipment-actions', () => ({ changeShipmentPreorderDateAction: vi.fn(), readShipmentPreorderPromiseAction: vi.fn() }));
vi.mock('@/components/orders/claim-preview-busy', () => ({ useClaimPreviewBusy: vi.fn() }));
import { PromiseChangeHeadline } from './ShipmentPreorderPromisePanel';

const base = { id: 'c', fromDate: '2099-10-01', toDate: '2099-10-15', reason: 'r', actorName: null, changedAt: '2099-09-01T00:00:00Z', bulkChangeId: null, noticeOnly: false };
describe('PromiseChangeHeadline', () => {
  it('shows an individual change as a plain date move', () => {
    const html = renderToStaticMarkup(<PromiseChangeHeadline change={base} />);
    expect(html).toContain('2099-10-01 → 2099-10-15');
    expect(html).not.toContain('일괄 변경');
  });
  it('marks a bulk change with its source', () => {
    const html = renderToStaticMarkup(<PromiseChangeHeadline change={{ ...base, bulkChangeId: 'b' }} />);
    expect(html).toContain('2099-10-01 → 2099-10-15');
    expect(html).toContain('· 예약 주문 일괄 변경');
  });
  it('shows a notice-only row as notice without an A → A move', () => {
    const html = renderToStaticMarkup(<PromiseChangeHeadline change={{ ...base, fromDate: '2099-10-15', bulkChangeId: 'b', noticeOnly: true }} />);
    expect(html).toContain('고객 안내만(일정 그대로) · 예약 주문 일괄 변경');
    expect(html).not.toContain('→');
  });
});
