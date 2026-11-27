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

  /* D-23: 설명은 두 문장이다. 같은 배송 건에 회신이 여러 개일 때의 규칙 같은 긴 안내는 없앴다. */
  it('회신 양식과 머리의 설명은 짧고, 출고지시를 다시 보냈다면 회신도 새로 받아야 한다고만 말한다', () => {
    const html = render(context());
    expect(html).toContain('회신을 받은 뒤에 적습니다. 출고지시를 다시 보냈다면 회신도 새로 받아야 합니다.');
    expect(html).toContain('출고지시가 나간 배송 건은 창고에 출고 중단을 요청하고, 받은 회신을 여기에 기록해야 운영자 전액·부분 취소를 실행할 수 있습니다.');
    expect(html).not.toContain('가장 늦게 받은 회신을 따릅니다');
    expect(html).not.toContain('회신을 받기 전에는 기록하지 않습니다');
  });

  it('빠진 칸이 있으면 [회신 기록]을 잠그고 무엇이 빠졌는지 버튼 옆에 보인다', () => {
    const html = render(context());
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""[^>]*>회신 기록</);
    expect(html).toMatch(/data-warehouse-stop-missing=""[^>]*>창고 회신 결과를 골라주세요\.</);
    /* 잠긴 버튼은 이유 줄을 가리킨다(스크린 리더가 왜 잠겼는지 읽는다). */
    expect(html).toMatch(/aria-describedby="([^"]+)-missing"[^>]*disabled=""|disabled=""[^>]*aria-describedby="([^"]+)-missing"/);
  });

  it('반송 입고는 창고가 이미 출고했다고 회신한 발송 대기 배송 건에만 고를 수 있어 그 밖에는 잠그고 이유를 보인다', () => {
    const locked = render(context());
    expect(locked).toMatch(/<input[^>]*disabled=""[^>]*type="radio"[^>]*value="returned"/);
    expect(locked).toContain('창고가 이미 출고했다고 회신한 발송 대기 배송 건에만 고를 수 있습니다.');
    expect(locked).not.toMatch(/<input[^>]*disabled=""[^>]*type="radio"[^>]*value="stopped"/);
    const open = render(context({ shipments: [shipment({ stopStatus: 'already_shipped' })] }));
    expect(open).not.toMatch(/<input[^>]*disabled=""[^>]*type="radio"[^>]*value="returned"/);
    expect(open).not.toContain('data-warehouse-stop-returned-lock');
    /* 취소된 배송 건은 회수 입고로 닫으므로 이미 출고 회신이 있어도 반송 입고를 열지 않는다. */
    const canceled = render(context({ shipments: [shipment({ status: 'canceled', stopStatus: 'not_applicable' })] }));
    expect(canceled).toMatch(/<input[^>]*disabled=""[^>]*type="radio"[^>]*value="returned"/);
  });

  it('회신 기록은 결과·경로·회신 시각·사용 여부와 예전 출고지시의 회신을 구분해 보인다', () => {
    const html = render(context({ shipments: [shipment({ stopStatus: 'used', replies: [
      { id: 'r2', outcome: 'stopped', channel: 'phone', repliedAt: '2026-11-19T02:00:00Z', note: '서원 담당 통화', recordedAt: '2026-11-19T02:01:00Z',
        recordedByName: '운영자', current: true, usedKind: 'staff_cancellation', usedAt: '2026-11-19T02:05:00Z', supersededAt: null },
      { id: 'r1', outcome: 'already_shipped', channel: 'warehouse_system', repliedAt: '2026-11-18T02:00:00Z', note: null, recordedAt: '2026-11-18T02:01:00Z',
        recordedByName: null, current: false, usedKind: null, usedAt: null, supersededAt: null },
      { id: 'r0', outcome: 'stopped', channel: 'phone', repliedAt: '2026-11-18T01:00:00Z', note: null, recordedAt: '2026-11-18T01:01:00Z',
        recordedByName: null, current: false, usedKind: null, usedAt: null, supersededAt: '2026-11-18T03:00:00Z' },
    ] })] }));
    expect(html).toContain('다른 취소에 쓴 회신');
    expect(html).not.toContain('회신을 이미 다른 취소에 씀');
    expect(html).toContain('운영자 전액 취소에 씀');
    expect(html).toContain('서원 담당 통화');
    expect(html).toContain('창고 시스템');
    expect(html).toContain('예전 출고지시의 회신');
    /* 발송으로 반박된 회신은 무효로 보인다(ADR-0046 통합 리뷰). */
    expect(html).toContain('발송돼 무효');
    expect(html).toContain('반송 입고 — 이미 나간 상품을');
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
    expect(html).toContain('운송장 회신 올리기');
    expect(html).toContain('epost 6000000000001');
    expect(render(context({ orderStatus: 'canceled', shipments: [shipment({ status: 'canceled', stopStatus: 'not_applicable' })],
      discoveries: [dispatch({ carrierLabel: '우체국택배' })] }))).toContain('우체국택배 6000000000001');
    expect(html).toContain('취소 때 되돌린 2개 중 발견 때 다시 뺀 1개');
    expect(html).toContain('그사이 다시 팔려 빼지 못한 1개');
    expect(html).toContain('aria-label="취소 뒤 출고 처리"');
    expect(html).toContain('회수 입고 확인');
    expect(html).toContain('회수 불가·손실 처리');
    expect(html).toContain('취소됨');
    /* 처리 결과와 근거를 채우기 전에는 [처리 기록]을 잠그고 이유를 보인다. 근거는 필수이고 어디에 남는지 말한다. */
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""[^>]*>처리 기록</);
    expect(html).toMatch(/data-canceled-dispatch-missing=""[^>]*>처리 결과를 골라주세요\.</);
    expect(html).toContain('근거 (필수)');
    expect(html).toContain('5자 이상 적습니다. 처리 결과 줄에 그대로 남습니다.');
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

describe('배송 건 이름', () => {
  it('배송건번호가 없는 옛 배송 건은 내부 번호(UUID 끝 8자) 대신 \'번호 없음\'이라 적는다', () => {
    const html = render(context({ shipments: [shipment({ shipmentNumber: null })] }));
    expect(html).toContain('남양주 · 번호 없음');
    expect(html).not.toContain(SHIPMENT_ID.replaceAll('-', '').slice(-8).toUpperCase());
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
