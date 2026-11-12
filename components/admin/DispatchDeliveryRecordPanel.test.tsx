import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('@/app/admin/dispatch-delivery-actions', () => ({ readDispatchShipmentDeliveryAction: vi.fn(), recordDispatchShipmentDeliveryAction: vi.fn() }));
import { DispatchDeliveryRecordButton, dispatchDeliveryHistory, dispatchDeliveryOperation } from './DispatchDeliveryRecordPanel';

describe('dispatch non-parcel handoff entry (1014-084)', () => {
  it('records handoff then receipt for courier-like methods, and a single receipt for pickup and direct handover', () => {
    expect(dispatchDeliveryOperation('quick', 'ready')).toBe('quick_handoff');
    expect(dispatchDeliveryOperation('direct', 'shipping')).toBe('direct_receive');
    expect(dispatchDeliveryOperation('freight', 'ready')).toBe('freight_handoff');
    expect(dispatchDeliveryOperation('pickup', 'ready')).toBe('pickup_receive');
    expect(dispatchDeliveryOperation('none', 'ready')).toBe('none_receive');
    expect(dispatchDeliveryOperation('pickup', 'delivered')).toBeNull();
    expect(dispatchDeliveryOperation('quick', 'delivered')).toBeNull();
    expect(dispatchDeliveryOperation('parcel', 'ready')).toBeNull();
    expect(dispatchDeliveryOperation('digital', 'ready')).toBeNull();
  });
  it('shows only handoff and receipt history, not method changes with customer request notes', () => {
    const row = (kind: string) => ({ id: kind, kind: kind as never, evidence: {}, actorName: null, recordedAt: '2026-11-11T00:00:00Z' });
    expect(dispatchDeliveryHistory([row('method_selected'), row('quick_handoff'), row('digital_access'), row('quick_receive')]).map(item => item.kind))
      .toEqual(['quick_handoff', 'quick_receive']);
  });
  it('renders a button that opens the record popup without navigating to the order detail page', () => {
    const html = renderToStaticMarkup(<DispatchDeliveryRecordButton shipmentId="00000000-0000-4000-8000-000000000001" label="퀵 인계·수령 확인" />);
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('퀵 인계·수령 확인');
    expect(html).not.toContain('href=');
  });
});
