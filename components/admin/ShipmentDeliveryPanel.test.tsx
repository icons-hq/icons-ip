// @vitest-environment node
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/app/admin/shipment-delivery-actions', () => ({ readShipmentDeliveryAction: vi.fn(), recordShipmentDeliveryAction: vi.fn(), selectShipmentDeliveryMethodAction: vi.fn() }));
vi.mock('@/components/admin/screens/ShipmentConsoleDeliveryDialog', () => ({ ShipmentConsoleDeliveryDialog: () => null }));
vi.mock('@/components/orders/claim-preview-busy', () => ({ useClaimPreviewBusy: vi.fn() }));
import { ShipmentDeliveryPanel, ShipmentDeliveryView } from './ShipmentDeliveryPanel';
import { deliveryHistoryFixture, deliveryPanelShipment, deliveryPolicyFixture, DELIVERY_PANEL_SHIPMENT_ID } from '@/lib/admin/shipment-delivery-panel.fixture';
import type { AdminShipmentDelivery, ShipmentDeliverySummary } from '@/lib/shipment-delivery';

const noop = () => {};
function view(shipment: AdminShipmentDelivery, notice: { text: string; tone: 'success' | 'warning' | 'danger' } | null = null) {
  return renderToStaticMarkup(<ShipmentDeliveryView shipment={shipment} shipmentId={DELIVERY_PANEL_SHIPMENT_ID} reference="2026112600010001" originName="김포" notice={notice} onSaved={noop} onReload={noop} onOpenStoreDialog={noop} />);
}
const summary = (method: ShipmentDeliverySummary['method'], extra: Partial<ShipmentDeliverySummary> = {}): ShipmentDeliverySummary => ({ method, policy: null, providerName: null, canIssueReceipt: false, ...extra });
const RETIRED = ['고객의 방식 변경 요청 근거', '기존 배송비 유지 동의 근거', '고객과 확인한 기존 배송비', '확인한 운영 조건', '켜진 운영 조건을 선택해주세요', '근거 확인 후 활성화', '버전 ', 'step="0.001"', '현재 시각 입력', '인계 참조·근거', '실제 인계', '배송 인계 확인', '수령 완료 확인', '배송 방식·인계 새로고침', '배송 방법'];

describe('배송 방식·인계 확인 — 읽기 전', () => {
  it('읽는 동안은 카드가 아니라 한 줄이고, 카드 이름은 그대로 읽는다', () => {
    const html = renderToStaticMarkup(<ShipmentDeliveryPanel shipmentId={DELIVERY_PANEL_SHIPMENT_ID} orderId="o" originName="김포" />);
    expect(html).toContain('김포 · 배송 방식·인계 확인을 불러오는 중입니다…');
    expect(html).not.toContain('<h3');
    expect(html).not.toContain('새로고침');
  });
});

describe('택배이고 이력도 기록할 일도 없는 배송 건(D-01)', () => {
  it('카드·새로고침·이력 없음 문구 없이 접힌 [배송 방식 바꾸기] 한 줄이다', () => {
    const html = view(deliveryPanelShipment({ policies: [deliveryPolicyFixture('quick')] }));
    expect(html).toContain('<details');
    expect(html).toContain('김포 · 배송 건 2026112600010001 · 배송 방식 바꾸기');
    for (const text of ['<h3', '배송 방식·인계 확인', '새로고침', '기록된 방식 변경·인계 이력이 없습니다', ...RETIRED]) expect(html, text).not.toContain(text);
  });
  it('방식을 고르기 전에 누가 바꾸자고 했는지 고르고, 그 결과(고객 화면 안내)를 보인다', () => {
    const html = view(deliveryPanelShipment({ policies: [deliveryPolicyFixture('quick')] }));
    expect(html).toContain('누가 바꾸자고 했나요?');
    expect(html).toContain('고객이 요청했습니다');
    expect(html).toContain('‘고객 요청으로 배송 방식을 변경했으며…’');
    expect(html).toContain('판매자가 정했습니다');
    expect(html).toContain('발송관리의 [방식 바꾸기]와 같은 창입니다.');
    expect(html).toContain('‘판매자가 배송 방식을 변경했으며…’');
  });
  it('고객 요청 양식은 고를 수 있는 방식만 보이고, DB가 요구하는 두 글을 사실대로 부른다', () => {
    const html = view(deliveryPanelShipment({ policies: [deliveryPolicyFixture('quick'), deliveryPolicyFixture('freight', { state: 'draft' })] }));
    expect(html).toContain('<option value="quick" selected="">퀵</option>');
    expect(html).not.toContain('<option value="parcel"');
    expect(html).not.toContain('<option value="freight"');
    expect(html).toContain('담당 합성 인계 담당 · 인계 장소 합성 인계 장소');
    expect(html).toContain('배송비·결제 금액은 바뀌지 않습니다.');
    expect(html).toContain('방문수령·직접배송·화물배송은 이 출고지에서 켜져 있지 않아 목록에서 뺐습니다. 배송정보 관리에서 켤 수 있습니다.');
    expect(html).toContain('고객이 요청한 내용 (필수)');
    expect(html).toContain('placeholder="예: 11/26 고객이 전화로 퀵 배송을 요청함"');
    expect(html).toContain('배송비 유지 동의 내용 (필수)');
    expect(html).toContain('placeholder="예: 배송비 3,000원은 그대로라고 안내하고 동의받음"');
    expect(html).toContain('이 주문의 방식 변경 이력에 남습니다.');
    expect(html).toContain('>배송 방식 바꾸기</button>');
    for (const text of RETIRED) expect(html, text).not.toContain(text);
  });
  it('바꿀 다른 방식이 없으면 양식 대신 그 사실을 한 줄로 말한다', () => {
    const html = view(deliveryPanelShipment());
    expect(html).not.toContain('<details');
    expect(html).toContain('김포 · 배송 건 2026112600010001 · 이 출고지에서 켜진 다른 배송 방식이 없습니다. 배송정보 관리에서 켤 수 있습니다.');
  });
  it('지금 못 바꾸는 이유를 보인다 — 출고지시를 보낸 뒤 · 결제 확인 전', () => {
    expect(view(deliveryPanelShipment({ canSelect: false, exportedAt: '2026-11-26T00:00:00Z' }))).toContain('김포 · 배송 건 2026112600010001 · 출고지시를 이미 보낸 배송 건은 방식을 바꿀 수 없습니다.');
    expect(view(deliveryPanelShipment({ canSelect: false, orderStatus: 'pending' }))).toContain('결제가 확인된 주문만 방식을 바꿀 수 있습니다.');
  });
  it('이미 발송했거나 끝난 배송 건은 아무것도 그리지 않고, 알림이 있으면 알림만 그린다', () => {
    expect(view(deliveryPanelShipment({ canSelect: false, status: 'shipping' }))).toBe('');
    expect(view(deliveryPanelShipment({ canSelect: false, status: 'delivered' }))).toBe('');
    const html = view(deliveryPanelShipment({ canSelect: false, status: 'shipping' }), { text: '배송 방식 바꾸기: 방식 변경 1건. 배송비·결제 금액은 바뀌지 않았습니다.', tone: 'success' });
    expect(html).toContain('방식 변경 1건. 배송비·결제 금액은 바뀌지 않았습니다.');
    expect(html).not.toContain('<details');
  });
});

describe('퀵·방문수령·직접배송·화물배송이거나 이력·기록할 일이 있는 배송 건', () => {
  it('퀵 인계는 발송관리 창과 같은 이름의 칸과 [인계 기록 · 발송처리]다', () => {
    const html = view(deliveryPanelShipment({ canTransition: true, summary: summary('quick'), policies: [deliveryPolicyFixture('quick')] }));
    expect(html).toContain('<h3');
    expect(html).toContain('김포 · 배송 방식·인계 확인');
    expect(html).toContain('퀵 발송 대기');
    expect(html).toContain('배송비 ₩3,000');
    expect(html).toContain('퀵 인계 기록');
    for (const text of ['인계한 담당자', '배송 업체·기사', '업체 연락처', '인계 시각 (KST)', '인계 확인 내용', 'placeholder="예: 퀵 접수번호 12345, 기사에게 직접 전달"', '인계 기록 · 발송처리', '새로고침']) expect(html, text).toContain(text);
    expect(html).toMatch(/name="occurredAt"[^>]*value="\d{4}-\d{2}-\d{2}T\d{2}:\d{2}"/);
    for (const text of RETIRED) expect(html, text).not.toContain(text);
  });
  it('방문수령은 수령 기록 칸이고 대리수령이 안 되면 구매자 본인이 처음부터 골라져 있다', () => {
    const html = view(deliveryPanelShipment({ canTransition: true, summary: summary('pickup') }));
    for (const text of ['방문수령 완료 기록', '수령을 확인한 담당자', '수령 시각 (KST)', '수령인 구분', '수령 확인 내용', '고객이 보여 준 확인값', '수령 기록 · 배송완료']) expect(html, text).toContain(text);
    expect(html).toContain('<option value="self" selected="">구매자 본인</option>');
    expect(html).not.toContain('수령인을 확인해주세요');
    expect(html).not.toContain('허용된 대리수령인');
    expect(html).toContain('고객이 주문 화면에서 발급한 값입니다(10분 동안 유효). 5번 틀리거나 다시 발급하면 이전 값은 쓸 수 없습니다.');
  });
  it('대리수령이 허용되면 수령인을 직접 골라야 한다', () => {
    const policy = { ...deliveryPolicyFixture('pickup'), allowDelegate: true };
    const html = view(deliveryPanelShipment({ canTransition: true, summary: summary('pickup', { policy: { ...policy, version: 1, policyId: policy.id, feeRule: 'order_fee_unchanged', confirmationRule: 'recipient_code' } }) }));
    expect(html).toContain('수령인을 확인해주세요');
    expect(html).toContain('허용된 대리수령인');
  });
  it('예약 품목 입고 확인 전이면 칸을 잠그고 이유를 보인다', () => {
    const html = view(deliveryPanelShipment({ canTransition: true, preorderReady: false, summary: summary('quick') }));
    expect(html).toContain('예약 품목의 입고 확인이 아직 끝나지 않았습니다.');
    expect(html).toMatch(/<fieldset[^>]*disabled/);
  });
  it('기록할 수 없는 때(발주확인 전)는 칸 대신 이유 한 줄이다', () => {
    const html = view(deliveryPanelShipment({ orderStatus: 'paid', summary: summary('quick') }));
    expect(html).toContain('발주확인 뒤에 인계·수령을 기록할 수 있습니다.');
    expect(html).not.toContain('퀵 인계 기록');
    expect(html).toContain('기록된 방식 변경·인계 이력이 없습니다.');
  });
  it('이력은 방식 변경의 전·후와 누가 바꿨는지, 값 이름을 새 말로 보인다', () => {
    const html = view(deliveryPanelShipment({ summary: summary('quick'), history: [
      deliveryHistoryFixture('method_selected', { fromMethod: 'parcel', toMethod: 'quick', customerRequestReference: '전화 요청', feeConsentReference: '동의함' }),
      deliveryHistoryFixture('quick_handoff', { operatorName: '김담당', providerName: '라인퀵', providerPhone: '010-0000-0000', handoffReference: '접수 12345', occurredAt: '2026-11-26T01:00:00Z' }),
    ] }));
    expect(html).toContain('방식·인계 변경 이력 2건');
    expect(html).toContain('택배 → 퀵 · 고객 요청');
    for (const text of ['고객이 요청한 내용', '배송비 유지 동의 내용', '인계한 담당자', '배송 업체·기사', '업체 연락처', '인계 확인 내용', '인계 시각', '접수 12345']) expect(html, text).toContain(text);
    for (const text of ['고객 요청 근거', '기존 배송비 유지 동의', '인계 참조', '실제 인계·확인 담당자']) expect(html, text).not.toContain(text);
  });
  it('방식 변경은 퀵 카드 안에서도 같은 선택 화면이다', () => {
    const html = view(deliveryPanelShipment({ summary: summary('quick'), policies: [deliveryPolicyFixture('quick')] }));
    expect(html).toContain('<summary');
    expect(html).toContain('누가 바꾸자고 했나요?');
    expect(html).toContain('<option value="parcel" selected="">택배</option>');
  });
});
