import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/app/admin/warehouse-stop-actions', () => ({
  loadOrderWarehouseStopAction: vi.fn(async () => ({ ok: false, error: 'not loaded in static render' })),
  recordWarehouseStopReplyAction: vi.fn(),
  resolveCanceledShipmentDispatchAction: vi.fn(),
}));

import { OrderWarehouseStopPanelView, WarehouseStopRequirementNote } from './OrderWarehouseStopPanel';
import type { CanceledShipmentDispatch, OrderWarehouseStopContext, WarehouseStopShipment } from '@/lib/admin/warehouse-stop';

const ORDER_ID = '99999999-8888-4777-a666-555555555555';
const SHIPMENT_ID = 'bbbbbbbb-0000-4000-8000-000000000001';

function shipment(overrides: Partial<WarehouseStopShipment> = {}): WarehouseStopShipment {
  return { shipmentId: SHIPMENT_ID, shipmentNumber: '2026111930000001', originName: '남양주', status: 'ready', exportedAt: '2026-11-19T01:00:00Z',
    stopStatus: 'required', replies: [], ...overrides };
}

function dispatch(overrides: Partial<CanceledShipmentDispatch> = {}): CanceledShipmentDispatch {
  return { id: 'dddddddd-0000-4000-8000-000000000001', shipmentId: SHIPMENT_ID, shipmentNumber: '2026111930000001', originName: '남양주',
    source: 'tracking_reply', carrier: 'epost', trackingNumber: '6000000000001', discoveredAt: '2026-11-19T03:00:00Z', discoveredByName: '물류 담당',
    state: 'open', restoredQty: 2, withdrawnQty: 1, shortfallQty: 1, returnedQty: null, resolvedAt: null, resolvedByName: null, resolutionNote: null,
    lines: [{ orderItemId: 'aaaaaaaa-0000-4000-8000-000000000001', goodName: '합성 키링', variantName: '빨강', restoredQty: 2, withdrawnQty: 1, returnedQty: null }],
    ...overrides };
}

function context(overrides: Partial<OrderWarehouseStopContext> = {}): OrderWarehouseStopContext {
  return { orderId: ORDER_ID, orderStatus: 'confirmed', canRecord: true, canResolve: true, shipments: [shipment()], discoveries: [], ...overrides };
}

const render = (value: OrderWarehouseStopContext) => renderToStaticMarkup(<OrderWarehouseStopPanelView context={value} onReload={() => undefined} />);

describe('주문 상세 창고 회신·취소 뒤 출고 (ADR-0046)', () => {
  it('출고지시가 나간 발송 대기 배송 건은 회신 기록이 필요하다고 알리고 기록 양식을 연다', () => {
    const html = render(context());
    expect(html).toContain('id="warehouse-stop"');
    expect(html).toContain('data-warehouse-stop-status="required"');
    expect(html).toContain('창고 회신 기록 필요');
    expect(html).toContain('기록된 창고 회신이 없습니다.');
    expect(html).toContain('aria-label="창고 회신 기록"');
    expect(html).toContain('출고 중단 확인 — 창고가');
    expect(html).toContain('이미 출고 — 창고가');
    expect(html).toContain('<option value="messenger">메신저(카카오톡 등)</option>');
    expect(html).toContain('type="datetime-local"');
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>회신 기록</);
    /* 운영자 진술 확인란은 없다 — 회신 결과·경로·시각이 근거다. */
    expect(html).not.toContain('name="warehouseStopConfirmed"');
  });

  it('회신 기록은 결과·경로·회신 시각·사용 여부와 예전 출고지시의 회신을 구분해 보인다', () => {
    const html = render(context({ shipments: [shipment({ stopStatus: 'used', replies: [
      { id: 'r2', outcome: 'stopped', channel: 'phone', repliedAt: '2026-11-19T02:00:00Z', note: '서원 담당 통화', recordedAt: '2026-11-19T02:01:00Z',
        recordedByName: '운영자', current: true, usedKind: 'staff_cancellation', usedAt: '2026-11-19T02:05:00Z' },
      { id: 'r1', outcome: 'already_shipped', channel: 'warehouse_system', repliedAt: '2026-11-18T02:00:00Z', note: null, recordedAt: '2026-11-18T02:01:00Z',
        recordedByName: null, current: false, usedKind: null, usedAt: null },
    ] })] }));
    expect(html).toContain('회신을 이미 다른 취소에 씀');
    expect(html).toContain('운영자 전액 취소에 씀');
    expect(html).toContain('서원 담당 통화');
    expect(html).toContain('창고 시스템');
    expect(html).toContain('예전 출고지시의 회신');
  });

  it('이미 출고 회신이면 취소하지 말고 발송 처리·반품으로 안내한다', () => {
    const html = render(context({ shipments: [shipment({ stopStatus: 'already_shipped' })] }));
    expect(html).toContain('data-warehouse-stop-status="already_shipped"');
    expect(html).toContain('취소하지 말고 운송장 회신을 받아 발송 처리한 뒤 고객 반품으로 접수합니다.');
  });

  it('취소 뒤 출고 발견은 위험 배지·재고 차감·모자란 수량과 처리 양식을 보인다', () => {
    const html = render(context({ orderStatus: 'canceled', shipments: [shipment({ status: 'canceled', stopStatus: 'not_applicable' })], discoveries: [dispatch()] }));
    expect(html).toContain('data-canceled-dispatch-badge=""');
    expect(html).toContain('취소 뒤 출고 발견 1건');
    expect(html).toContain('취소한 주문의 상품이 출고됐습니다 · 1건');
    expect(html).toContain('운송장 회신 반입');
    expect(html).toContain('epost 6000000000001');
    expect(html).toContain('취소 때 되돌린 2개 중 발견 때 다시 뺀 1개');
    expect(html).toContain('그사이 다시 팔려 빼지 못한 1개');
    expect(html).toContain('aria-label="취소 뒤 출고 처리"');
    expect(html).toContain('회수 입고 확인');
    expect(html).toContain('회수 불가·손실 처리');
    expect(html).toContain('취소됨');
  });

  it('처리 권한이 없으면 발견 기록만 보이고 처리·기록 양식은 그리지 않는다', () => {
    const html = render(context({ canRecord: false, canResolve: false, discoveries: [dispatch()] }));
    expect(html).toContain('취소 뒤 출고 발견 1건');
    expect(html).not.toContain('aria-label="취소 뒤 출고 처리"');
    expect(html).not.toContain('aria-label="창고 회신 기록"');
  });

  it('처리한 발견은 결과와 근거를 보이고 처리 양식을 닫는다', () => {
    const html = render(context({ discoveries: [dispatch({ state: 'returned', returnedQty: 1, resolvedAt: '2026-11-20T01:00:00Z',
      resolvedByName: '운영자', resolutionNote: '반송 상자 입고 확인' })] }));
    expect(html).toContain('회수 입고');
    expect(html).toContain('재고 1개 되돌림');
    expect(html).toContain('반송 상자 입고 확인');
    expect(html).not.toContain('aria-label="취소 뒤 출고 처리"');
    expect(html).not.toContain('data-canceled-dispatch-badge');
  });
});

describe('취소 양식의 창고 회신 상태 줄', () => {
  it('읽기 전에는 회신 기록이 필요하다는 안내와 주문 상세의 기록 위치로 잇는다', () => {
    const html = renderToStaticMarkup(<WarehouseStopRequirementNote detailHref={`/admin/sales/orders/${ORDER_ID}`} orderId={ORDER_ID} />);
    expect(html).toContain('data-warehouse-stop-requirement="loading"');
    expect(html).toContain('창고의 출고 중단 회신 기록이 있어야 취소됩니다.');
    expect(html).toContain(`href="/admin/sales/orders/${ORDER_ID}#warehouse-stop"`);
  });
});
