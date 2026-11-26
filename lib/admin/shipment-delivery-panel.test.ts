import { describe, expect, it } from 'vitest';
import {
  activeDeliveryPolicy, deliveryChangeBlockReason, deliveryExcludedNote, deliveryHistoryRows, deliveryMethodChangeSummary, deliveryMethodChoices, deliveryNowLocal,
  deliveryPanelIsCompact, deliveryRecordBlockReason, deliveryRecordConfirmRequest,
} from './shipment-delivery-panel';
import { deliveryHistoryFixture, deliveryPanelShipment, deliveryPolicyFixture } from './shipment-delivery-panel.fixture';

describe('배송 방식을 바꿀 수 없는 이유', () => {
  const blocked = (overrides: Parameters<typeof deliveryPanelShipment>[0]) => deliveryChangeBlockReason(deliveryPanelShipment({ canSelect: false, ...overrides }));
  it('서버가 막는 조건을 순서대로 말한다', () => {
    expect(blocked({ summary: { method: 'digital', policy: null, providerName: null, canIssueReceipt: false } })).toBe('배송없음·디지털 상품은 주문 때 정한 방식을 바꿀 수 없습니다.');
    expect(blocked({ summary: { method: 'parcel', customerMethod: 'none', policy: null, providerName: null, canIssueReceipt: false } })).toContain('배송없음·디지털');
    expect(blocked({ status: 'canceled' })).toBe('취소된 배송 건은 방식을 바꿀 수 없습니다.');
    expect(blocked({ status: 'shipping' })).toBe('이미 발송했거나 배송이 끝난 배송 건은 방식을 바꿀 수 없습니다.');
    expect(blocked({ exportedAt: '2026-11-26T00:00:00Z' })).toBe('출고지시를 이미 보낸 배송 건은 방식을 바꿀 수 없습니다.');
    expect(blocked({ orderStatus: 'pending' })).toBe('결제가 확인된 주문만 방식을 바꿀 수 있습니다.');
    expect(blocked({})).toBe('취소·반품·교환 요청이 진행 중이거나 운송장이 이미 등록된 배송 건은 방식을 바꿀 수 없습니다.');
  });
  it('개발 용어와 옛 말(전달·방법)을 쓰지 않는다', () => {
    for (const status of ['ready', 'shipping', 'canceled'] as const) expect(blocked({ status })).not.toMatch(/전달|방법|활성|버전/);
  });
});

describe('고를 수 있는 배송 방식', () => {
  it('택배는 늘 고를 수 있고 택배 외 방식은 켜진 운영 조건이 있어야 한다', () => {
    const shipment = deliveryPanelShipment({ policies: [deliveryPolicyFixture('quick'), deliveryPolicyFixture('pickup', { state: 'draft' }), deliveryPolicyFixture('freight', { state: 'stopped' })] });
    expect(deliveryMethodChoices(shipment)).toEqual({ methods: ['parcel', 'quick'], excluded: ['pickup', 'direct', 'freight'] });
    expect(deliveryMethodChoices(deliveryPanelShipment())).toEqual({ methods: ['parcel'], excluded: ['quick', 'pickup', 'direct', 'freight'] });
  });
  it('같은 방식의 켜진 운영 조건이 여럿이면 가장 새 것을 쓰고, 없으면 null이다', () => {
    const shipment = deliveryPanelShipment({ policies: [deliveryPolicyFixture('quick', { revision: 2, id: 'old' }), deliveryPolicyFixture('quick', { revision: 5, id: 'new' }), deliveryPolicyFixture('quick', { revision: 9, id: 'draft', state: 'draft' })] });
    expect(activeDeliveryPolicy(shipment, 'quick')?.id).toBe('new');
    expect(activeDeliveryPolicy(shipment, 'direct')).toBeNull();
  });
  it('목록에서 뺀 방식을 한 줄로 알린다', () => {
    expect(deliveryExcludedNote([])).toBeNull();
    expect(deliveryExcludedNote(['quick', 'pickup'])).toBe('퀵·방문수령은 이 출고지에서 켜져 있지 않아 목록에서 뺐습니다. 배송정보 관리에서 켤 수 있습니다.');
    expect(deliveryExcludedNote(['quick', 'pickup', 'direct', 'freight'])).toContain('퀵·방문수령·직접배송·화물배송은 ');
  });
});

describe('접힌 한 줄과 펼친 카드', () => {
  const parcel = { method: 'parcel' as const, policy: null, providerName: null, canIssueReceipt: false };
  it('택배이고 이력도 기록할 일도 없으면 한 줄이다', () => {
    expect(deliveryPanelIsCompact(deliveryPanelShipment())).toBe(true);
    expect(deliveryPanelIsCompact(deliveryPanelShipment({ summary: { ...parcel, method: 'digital' } }))).toBe(true);
  });
  it('택배 외 방식·변경 이력·기록할 일이 있으면 카드다', () => {
    expect(deliveryPanelIsCompact(deliveryPanelShipment({ summary: { ...parcel, method: 'quick' } }))).toBe(false);
    expect(deliveryPanelIsCompact(deliveryPanelShipment({ history: [deliveryHistoryFixture('method_selected', {})] }))).toBe(false);
    expect(deliveryPanelIsCompact(deliveryPanelShipment({ canTransition: true, summary: { ...parcel, method: 'none' } }))).toBe(false);
  });
});

describe('인계·수령을 기록할 수 없는 이유', () => {
  const quick = { method: 'quick' as const, policy: null, providerName: null, canIssueReceipt: false };
  it('발주확인 전과 진행 중인 요청을 구분하고, 끝났거나 기록 대상이 아니면 말하지 않는다', () => {
    expect(deliveryRecordBlockReason(deliveryPanelShipment({ orderStatus: 'paid', summary: quick }))).toBe('발주확인 뒤에 인계·수령을 기록할 수 있습니다.');
    expect(deliveryRecordBlockReason(deliveryPanelShipment({ orderStatus: 'confirmed', summary: quick }))).toBe('취소·반품·교환 요청이 진행 중이어서 지금은 기록할 수 없습니다.');
    expect(deliveryRecordBlockReason(deliveryPanelShipment({ canTransition: true, summary: quick }))).toBeNull();
    expect(deliveryRecordBlockReason(deliveryPanelShipment({ status: 'delivered', summary: quick }))).toBeNull();
    expect(deliveryRecordBlockReason(deliveryPanelShipment())).toBeNull();
    expect(deliveryRecordBlockReason(deliveryPanelShipment({ status: 'shipping', summary: { ...quick, method: 'pickup' } }))).toBeNull();
  });
});

describe('발송처리·배송완료 확인창', () => {
  it('인계 기록은 발송처리이고 고객 화면의 업체와 앱 알림을 말한다', () => {
    const request = deliveryRecordConfirmRequest({ kind: 'quick_handoff', reference: '2026112600010001', originName: '김포', providerName: '라인퀵' });
    expect(request).toMatchObject({ title: '퀵 인계를 기록하고 발송처리할까요?', confirmLabel: '발송처리', cancelLabel: '돌아가기' });
    expect(request.message).toBe('김포 · 배송 건 2026112600010001\n배송중으로 바뀌고, 고객 주문 화면에 배송 업체(라인퀵)가 바로 보입니다. 주문이 처음 배송중이 되면 고객에게 앱 알림이 갑니다.');
  });
  it('수령 기록은 배송완료이고 청약철회·거래확정 기한의 시작을 말한다', () => {
    const request = deliveryRecordConfirmRequest({ kind: 'pickup_receive', reference: '2026112600010002' });
    expect(request).toMatchObject({ title: '방문수령 완료로 기록할까요?', confirmLabel: '배송완료로 기록', cancelLabel: '돌아가기' });
    expect(request.message).toContain('배송 건 2026112600010002');
    expect(request.message).toContain('청약철회·거래확정 기한은 입력한 수령 시각부터 셉니다.');
    expect(request.message).toContain('고객에게 앱 알림이 갑니다.');
    expect(deliveryRecordConfirmRequest({ kind: 'none_receive', reference: 'x' }).title).toBe('직접전달 완료로 기록할까요?');
    expect(deliveryRecordConfirmRequest({ kind: 'freight_handoff', reference: 'x' }).title).toBe('화물배송 인계를 기록하고 발송처리할까요?');
  });
});

describe('이력 표시', () => {
  it('방식 변경은 무엇이 어떻게 바뀌었고 누가 바꿨는지 보인다', () => {
    expect(deliveryMethodChangeSummary({ fromMethod: 'parcel', toMethod: 'quick', customerRequestReference: '전화' })).toBe('택배 → 퀵 · 고객 요청');
    expect(deliveryMethodChangeSummary({ fromMethod: 'quick', toMethod: 'parcel', source: 'dispatch_console', dispatchReason: '사유' })).toBe('퀵 → 택배 · 판매자가 바꿈');
    expect(deliveryMethodChangeSummary({ fromMethod: 'parcel', toMethod: 'unknown' })).toBeNull();
    expect(deliveryMethodChangeSummary({})).toBeNull();
  });
  it('인계와 수령은 같은 열을 발송관리 창과 같은 이름으로 부른다', () => {
    const handoff = deliveryHistoryRows('quick_handoff', { operatorName: '김', providerName: '업체', providerPhone: '010', handoffReference: '접수번호', occurredAt: '2026-11-26T01:00:00Z' });
    expect(handoff.map(row => row.label)).toEqual(['인계한 담당자', '배송 업체·기사', '업체 연락처', '인계 확인 내용', '인계 시각']);
    expect(handoff.at(-1)).toMatchObject({ time: true });
    const receive = deliveryHistoryRows('pickup_receive', { operatorName: '김', receiptReference: '본인', recipientKind: 'self', occurredAt: '2026-11-26T01:00:00Z' });
    expect(receive.map(row => row.label)).toEqual(['수령을 확인한 담당자', '수령 확인 내용', '수령 시각']);
    expect(deliveryHistoryRows('forced_delivered', { reason: '창고 확인', occurredAt: '2026-11-26T01:00:00Z' }).map(row => row.label)).toEqual(['강제 배송완료 사유', '강제 배송완료 시각']);
  });
  it('방식 변경 이력은 고객 요청 내용·배송비 유지 동의 내용과 바꾼 이유를 사실대로 부른다', () => {
    const rows = deliveryHistoryRows('method_selected', { customerRequestReference: '전화 요청', feeConsentReference: '동의', dispatchReason: '고객 전화' });
    expect(rows).toEqual([{ label: '고객이 요청한 내용', value: '전화 요청' }, { label: '배송비 유지 동의 내용', value: '동의' }, { label: '바꾼 이유', value: '고객 전화' }]);
  });
});

it('인계·수령 시각의 처음 값은 지금(KST)이고 분 단위다', () => {
  expect(deliveryNowLocal(new Date('2026-11-26T01:23:45Z'))).toBe('2026-11-26T10:23');
  expect(deliveryNowLocal(new Date('2026-11-26T16:00:00Z'))).toBe('2026-11-27T01:00');
});
