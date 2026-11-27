import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('@/app/admin/dispatch-delivery-actions', () => ({ readDispatchShipmentDeliveryAction: vi.fn(), recordDispatchShipmentDeliveryAction: vi.fn() }));
import { DispatchDeliveryRecordButton, DispatchDeliveryRecordForm, dispatchDeliveryHistory, dispatchDeliveryOperation } from './DispatchDeliveryRecordPanel';
import { HandoffForm } from './ShipmentDeliveryPanel';
import { deliveryPanelShipment, deliveryPolicyFixture } from '@/lib/admin/shipment-delivery-panel.fixture';
vi.mock('@/app/admin/shipment-delivery-actions', () => ({ readShipmentDeliveryAction: vi.fn(), recordShipmentDeliveryAction: vi.fn(), selectShipmentDeliveryMethodAction: vi.fn() }));

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

/*
 * 발송관리 줄의 '인계·수령 확인' 창은 주문 상세를 열 수 없는 출고 전용 계정의 유일한 길이다. 하는 일이 주문 상세의 인계·수령 기록과 같으므로
 * 칸 이름·시각의 처음 값·버튼 이름이 같다 — 서버 오류 문구가 가리키는 칸 이름이 이 창에도 있다.
 */
describe('발송관리 줄의 인계·수령 기록 양식은 주문 상세와 같은 말을 쓴다', () => {
  const summary = (method: 'quick' | 'pickup', allowDelegate = false) => {
    const policy = { ...deliveryPolicyFixture(method), allowDelegate };
    return { method, providerName: null, canIssueReceipt: false, policy: { ...policy, version: 1 as const, policyId: policy.id, feeRule: 'order_fee_unchanged' as const, confirmationRule: 'recipient_code' as const } };
  };
  const labels = (html: string) => [...html.matchAll(/<(?:span class="text-sm font-medium"|label[^>]*)>([^<]+)</g)].map(match => match[1]);
  const RETIRED = ['실제 인계·확인 담당자', '실제 배송 업체·담당', '배송 담당 연락처', '실제 인계 참조·근거', '주문자가 제시한 일회 수령 확인값', '현재 시각 입력', '주문자 본인', '배송 인계 확인', '수령 완료 확인'];

  it('퀵 인계: 인계한 담당자·인계 시각(지금)·배송 업체·기사·업체 연락처·인계 확인 내용과 [인계 기록 · 발송처리]', () => {
    const shipment = deliveryPanelShipment({ canTransition: true, summary: summary('quick') });
    const html = renderToStaticMarkup(<DispatchDeliveryRecordForm shipment={shipment} kind="quick_handoff" reference="2026112600010001" onSaved={() => {}} />);
    for (const text of ['퀵 인계 기록', '인계한 담당자', '인계 시각 (KST)', '배송 업체·기사', '업체 연락처', '인계 확인 내용', 'placeholder="고객 주문 화면에 보입니다"', 'placeholder="예: 퀵 접수번호 12345, 기사에게 직접 전달"']) expect(html, text).toContain(text);
    expect(html).toMatch(/name="occurredAt"[^>]*value="\d{4}-\d{2}-\d{2}T\d{2}:\d{2}"/);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>인계 기록 · 발송처리</);
    for (const text of RETIRED) expect(html, text).not.toContain(text);
    /* 주문 상세의 같은 양식과 칸 이름이 하나도 다르지 않다. */
    const detail = renderToStaticMarkup(<HandoffForm shipment={shipment} reference="2026112600010001" onSaved={() => {}} />);
    expect(labels(html).sort()).toEqual(labels(detail).sort());
  });

  it('방문수령: 수령을 확인한 담당자·수령 시각·수령인 구분(구매자 본인)·수령 확인 내용·고객이 보여 준 확인값과 [수령 기록 · 배송완료]', () => {
    const shipment = deliveryPanelShipment({ canTransition: true, summary: summary('pickup') });
    const html = renderToStaticMarkup(<DispatchDeliveryRecordForm shipment={shipment} kind="pickup_receive" reference="2026112600010001" onSaved={() => {}} />);
    for (const text of ['방문수령 완료 기록', '수령을 확인한 담당자', '수령 시각 (KST)', '수령인 구분', '수령 확인 내용', '고객이 보여 준 확인값',
      '고객이 주문 화면에서 발급한 값입니다(10분 동안 유효). 5번 틀리거나 다시 발급하면 이전 값은 쓸 수 없습니다.']) expect(html, text).toContain(text);
    expect(html).toContain('<option value="self" selected="">구매자 본인</option>');
    expect(html).not.toContain('허용된 대리수령인');
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>수령 기록 · 배송완료</);
    for (const text of RETIRED) expect(html, text).not.toContain(text);
    const delegate = renderToStaticMarkup(<DispatchDeliveryRecordForm shipment={deliveryPanelShipment({ canTransition: true, summary: summary('pickup', true) })} kind="pickup_receive" reference="x" onSaved={() => {}} />);
    expect(delegate).toContain('<option value="" disabled="" selected="">수령인을 확인해주세요</option>');
    expect(delegate).toContain('<option value="delegate">허용된 대리수령인</option>');
  });

  it('예약 품목의 입고 확인이 끝나지 않았으면 양식을 잠그고 주문 상세와 같은 안내를 보인다', () => {
    const html = renderToStaticMarkup(<DispatchDeliveryRecordForm shipment={deliveryPanelShipment({ canTransition: true, preorderReady: false, summary: summary('quick') })} kind="quick_handoff" reference="x" onSaved={() => {}} />);
    expect(html).toContain('예약 품목의 입고 확인이 아직 끝나지 않았습니다. 상품 편집의 예약판매에서 이 주문을 골라 [선택한 예약 주문 입고 확인]을 먼저 눌러주세요.');
    expect(html).toMatch(/<fieldset[^>]*disabled=""/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>인계 기록 · 발송처리</);
  });
});
