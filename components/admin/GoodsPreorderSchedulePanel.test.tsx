import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { differingTarget, noticeOnlyTarget, scheduleChange, scheduleIds, schedulePreview } from '@/lib/admin/preorder-schedule-change.fixture';
import type { AdminGoodsVariant } from '@/lib/admin/goods-variants';
import { GoodsPreorderSchedulePanel, PreorderScheduleResultView, PreorderSchedulePreviewStep, openPolicySummary } from './GoodsPreorderSchedulePanel';

vi.mock('@/app/admin/preorder-schedule-actions', () => ({
  applyPreorderScheduleChangeAction: vi.fn(), listPreorderScheduleChangesAction: vi.fn(), previewPreorderScheduleChangeAction: vi.fn(),
  readPreorderScheduleChangeAction: vi.fn(), retryPreorderScheduleEmailsAction: vi.fn(),
}));

const noop = () => {};
const preview = (overrides: Parameters<typeof schedulePreview>[0] = {}, props: { emailConfigured?: boolean; smsAvailable?: boolean; reason?: string } = {}) => renderToStaticMarkup(
  <PreorderSchedulePreviewStep preview={schedulePreview(overrides)} emailConfigured={props.emailConfigured ?? true} smsAvailable={props.smsAvailable ?? false}
    initialReason={props.reason ?? '공급처 입고 일정 변경'} onBack={noop} onApplied={noop} onStale={noop} />);
const confirmButton = (html: string) => html.match(/<button[^>]*>일정 변경하고 주문[^<]*<\/button>/)?.[0] ?? '';
const rowCheckbox = (html: string, shipmentId: string) => html.match(new RegExp(`<tr[^>]*data-shipment-id="${shipmentId}"[^>]*>.*?<input[^>]*>`))?.[0] ?? '';
const variants: AdminGoodsVariant[] = [{ id: scheduleIds.variant, code: 'HSQ-A', goodId: 'hsq-second', name: '기본 옵션', price: 12000, stockQty: 0, isDefault: true, archivedAt: null }];

describe('예약 일정 일괄 변경 미리보기', () => {
  it("'예약 주문 N건 일정도 바꾸고 안내할까요?'와 대상·제외 사유를 보인다", () => {
    const html = preview();
    expect(html).toContain('예약 주문 3건 일정도 바꾸고 안내할까요?');
    expect(html).toContain('미출고 예약 배송 건 3건의 발송 예정일을 2026년 12월 9일로 바꾸고');
    expect(html).toContain('2026-12-05 → <strong class="font-medium">2026-12-09</strong>');
    expect(html).toContain('개별 변경');
    expect(html).toContain('입금 대기');
    expect(html).toContain('바꾸지 않는 배송 건 1건 · 출고지시됨 1건');
    expect(html).toContain('운영자가 주문 상세에서 따로 바꾼 배송 건 1건이 포함되어 있습니다');
    expect(html).toContain('>공급처 입고 일정 변경</textarea>');
    expect(html).toContain('예: &quot;발송 예정일: 2026-12-02 → 2026-12-09&quot;');
    expect(html).toContain('전체 선택');
    expect(confirmButton(html)).not.toContain('disabled=""');
  });

  it('개별 변경이 새 날짜와 같으면 일정 그대로 안내만 하고, 고객이 아는 날짜 → 새 날짜로 알린다', () => {
    const html = preview({ targets: [noticeOnlyTarget], targetShipments: 1, targetOrders: 1 });
    expect(html).toContain('안내만(일정 그대로)');
    expect(html).toContain('(고객 안내: 2026-12-02 → 2026-12-09)');
    expect(html).toContain('따로 바꿔 둔 1건은 일정 그대로 안내만');
    expect(html).toContain('이미 새 날짜라 일정은 그대로 두고 고객에게 안내만 합니다');
    expect(rowCheckbox(html, scheduleIds.shipment5)).toContain('checked=""');
  });

  it('다른 예약 상품 때문에 새 날짜가 입력과 다른 배송 건은 드러내고 기본으로 뺀다', () => {
    const html = preview({ targets: [...schedulePreview().targets, differingTarget], targetShipments: 4, targetOrders: 4 });
    expect(html).toContain('새 예정일 다름');
    expect(html).toContain('앞당기는 변경이면 바꾸지 않고, 늦출 때는 그 상품의 주문 당시 예정일 이상으로 바꿉니다.');
    expect(rowCheckbox(html, scheduleIds.shipment6)).not.toContain('checked=""');
    expect(rowCheckbox(html, scheduleIds.shipment1)).toContain('checked=""');
    expect(html).toContain('예약 주문 3건 일정도 바꾸고 안내할까요?');
    expect(html).toContain('처음 선택으로 되돌리기');
  });

  it('상한을 넘으면 주문번호 순 앞의 N건을 먼저 고르고 상품 종류에 맞게 나누는 길을 안내한다', () => {
    const select = preview({ limit: 2 });
    expect(select).toContain('바꿀 배송 건이 3건이라 한 번에 바꿀 수 있는 2건을 넘습니다');
    expect(select).toContain('옵션별로 나누어 바꿀 수도 있습니다');
    expect(select).toContain('앞의 2건만 고르기');
    expect(rowCheckbox(select, scheduleIds.shipment3)).not.toContain('checked=""');
    expect(confirmButton(select)).not.toContain('disabled=""');
    const random = preview({ limit: 2, randomSale: true });
    expect(random).not.toContain('옵션별로 나누어');
    expect(preview({ limit: 2, variantCount: 1 })).not.toContain('옵션별로 나누어');
  });

  it('접수 중인 예약 조건: 활성화 권한이 있으면 새 날짜로 교체가 기본이다', () => {
    const html = preview();
    expect(html).toContain('접수 중인 예약 조건 · 기본 옵션 2026년 12월 2일');
    expect(html).toMatch(/<input[^>]*checked=""[^>]*\/><span>접수 중 예약 조건도 2026년 12월 9일로 교체/);
    expect(html).not.toContain('data-preorder-schedule-policy-ack');
    expect(confirmButton(html)).not.toContain('disabled=""');
  });

  it('권한이 없거나 교체할 수 없으면 그대로 둔다는 확인을 받아야 확정할 수 있다', () => {
    const denied = preview({ canReplacePolicies: false });
    expect(denied).not.toContain('새 버전으로 활성화');
    expect(denied).toContain('접수 중 조건은 계정 주매니저·통합 매니저가 새 날짜로 바꿔야 새 주문에도 같은 날짜가 안내됩니다.');
    expect(confirmButton(denied)).toContain('disabled=""');
    const blocked = preview({ policyBlockReason: 'before_sale_end' });
    expect(blocked).toContain('새 발송 예정일이 접수 종료일보다 빨라 예약 조건을 바꿀 수 없습니다.');
    expect(confirmButton(blocked)).toContain('disabled=""');
    expect(preview({ openPolicies: [] })).not.toContain('접수 중인 예약 조건');
  });

  it('사유가 비면 확정할 수 없다', () => {
    expect(confirmButton(preview({}, { reason: '' }))).toContain('disabled=""');
  });

  it('기본 고객 문구는 굿즈명으로 채우고 고객 이메일·이름은 보이지 않는다', () => {
    const html = preview();
    expect(html).toContain('예약 주문 발송 일정 변경 안내');
    expect(html).toContain('주문하신 &#x27;홍실 2차 랜덤 포토카드&#x27;의 발송 예정일이 변경되었습니다.');
    expect(html).not.toMatch(/@example|buyer|구매자 이름/);
  });

  it('이메일 채널이 준비되지 않으면 이유를 보이고 확정을 막는다', () => {
    const off = preview({ emailEnabled: false });
    expect(off).toContain('지연 안내 이메일 발송 설정이 꺼져 있습니다.');
    expect(confirmButton(off)).toContain('disabled=""');
    const env = preview({}, { emailConfigured: false });
    expect(env).toContain('이메일 공급자 또는 발송 서명 설정이 준비되지 않았습니다.');
    expect(confirmButton(env)).toContain('disabled=""');
  });

  it('대상이 없으면 확정할 수 없다', () => {
    const empty = preview({ targets: [], targetShipments: 0, targetOrders: 0 });
    expect(empty).toContain('바꿀 예약 배송 건이 없습니다.');
    expect(confirmButton(empty)).toContain('disabled=""');
  });

  it('SMS는 앱 스위치와 DB 설정이 모두 켜졌을 때만 언급한다(꺼져 있으면 화면에 SMS가 없다)', () => {
    expect(preview()).not.toContain('SMS');
    expect(preview({ smsEnabled: true })).not.toContain('SMS');
    expect(preview({}, { smsAvailable: true })).not.toContain('SMS');
    expect(preview({ smsEnabled: true }, { smsAvailable: true })).toContain('SMS 수신에 동의한 고객에게는 같은 안내를 문자로도 한 번 보냅니다.');
  });
});

describe('접수 중인 예약 조건 안내', () => {
  it('날짜별로 묶고 옵션 이름은 셋까지 보인다', () => {
    const policy = (variantName: string, expectedShipDate = '2026-12-02') => ({ variantName, expectedShipDate });
    expect(openPolicySummary([policy('A'), policy('B'), policy('C'), policy('D'), policy('E'), policy('늦은 옵션', '2026-12-16')]))
      .toBe('A·B·C 외 2개 2026년 12월 2일 · 늦은 옵션 2026년 12월 16일');
  });
});

describe('예약 일정 일괄 변경 결과', () => {
  it('주문마다 앱 알림·이메일 결과를 보이고 안내만 한 배송 건·이메일 없는 수신자·재시도를 알린다', () => {
    const html = renderToStaticMarkup(<PreorderScheduleResultView change={scheduleChange()} />);
    expect(html).toContain('배송 건 2건을 2026년 12월 9일 일정으로 안내했습니다');
    expect(html).toContain('이메일이 없는 수신자 1명은 앱 알림만 받았습니다.');
    expect(html).toContain('선물 받는 분');
    expect(html).toContain('2026111230000001 · 2026-12-02 → 2026-12-09');
    expect(html).toContain('2026111230000002 · 2026-12-09 (일정 그대로, 안내만)');
    expect(html).toContain('실패한 이메일만 재시도');
    expect(html).not.toContain('>SMS<');
    expect(html).not.toContain('접수 중');
  });
  it('접수 중 조건을 바꿨는지, 그대로 두기로 확인했는지 남긴다', () => {
    const policies = [{ variantName: '기본 옵션', expectedShipDate: '2026-12-02' }];
    expect(renderToStaticMarkup(<PreorderScheduleResultView change={scheduleChange({ policyAction: 'replaced', policies })} />))
      .toContain('접수 중이던 예약 조건(기본 옵션 2026년 12월 2일)을 2026년 12월 9일 새 버전으로 바꿨습니다.');
    expect(renderToStaticMarkup(<PreorderScheduleResultView change={scheduleChange({ policyAction: 'acknowledged', policies })} />))
      .toContain('접수 중인 예약 조건(기본 옵션 2026년 12월 2일)은 바꾸지 않았습니다.');
  });
  it('SMS 결과가 있을 때만 SMS 열을 그린다', () => {
    const change = scheduleChange();
    const html = renderToStaticMarkup(<PreorderScheduleResultView change={{ ...change, smsQueued: true,
      targets: change.targets.map((target, index) => ({ ...target, smsStatus: index ? 'skipped' : 'sent', smsReason: index ? 'consent_required' : null })) }} />);
    expect(html).toContain('>SMS<');
    expect(html).toContain('SMS 수신 동의가 없습니다.');
  });
});

describe('예약판매 영역의 진입점', () => {
  it('설명과 진입 버튼만 그리고 대화상자는 닫혀 있다', () => {
    const html = renderToStaticMarkup(<GoodsPreorderSchedulePanel goodId="hsq-second" variants={variants} />);
    expect(html).toContain('예약 주문 발송 일정 변경·고객 안내');
    expect(html).toContain('발송 예정일 변경·안내');
    expect(html).toContain('출고지시·발송된 배송 건은 바꾸지 않습니다.');
    expect(html).not.toContain('대상 미리보기');
    expect(html).not.toContain('예약 주문도 이 날짜로 미리보기');
  });
  it('예약 조건을 새 날짜로 활성화한 직후 기존 예약 주문도 그 날짜로 미리보는 입구를 보인다', () => {
    const html = renderToStaticMarkup(<GoodsPreorderSchedulePanel goodId="hsq-second" variants={variants} suggestion={{ expectedShipDate: '2026-12-09', variantId: null, key: 1 }} />);
    expect(html).toContain('예약 조건을 2026년 12월 9일 발송으로 활성화했습니다');
    expect(html).toContain('예약 주문도 이 날짜로 미리보기');
  });
});
