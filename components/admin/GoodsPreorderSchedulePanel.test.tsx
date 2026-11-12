import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { scheduleChange, scheduleIds, schedulePreview } from '@/lib/admin/preorder-schedule-change.fixture';
import type { AdminGoodsVariant } from '@/lib/admin/goods-variants';
import { GoodsPreorderSchedulePanel, PreorderScheduleResultView, PreorderSchedulePreviewStep } from './GoodsPreorderSchedulePanel';

vi.mock('@/app/admin/preorder-schedule-actions', () => ({
  applyPreorderScheduleChangeAction: vi.fn(), listPreorderScheduleChangesAction: vi.fn(), previewPreorderScheduleChangeAction: vi.fn(),
  readPreorderScheduleChangeAction: vi.fn(), retryPreorderScheduleEmailsAction: vi.fn(),
}));

const noop = () => {};
const preview = (overrides: Parameters<typeof schedulePreview>[0] = {}, props: { emailConfigured?: boolean; smsAvailable?: boolean } = {}) => renderToStaticMarkup(
  <PreorderSchedulePreviewStep preview={schedulePreview(overrides)} emailConfigured={props.emailConfigured ?? true} smsAvailable={props.smsAvailable ?? false}
    reason="공급처 입고 일정 변경" onBack={noop} onApplied={noop} onStale={noop} />);
const confirmButton = (html: string) => html.match(/<button[^>]*>일정 변경하고 주문[^<]*<\/button>/)?.[0] ?? '';

describe('예약 일정 일괄 변경 미리보기', () => {
  it("'예약 주문 N건 일정도 바꾸고 안내할까요?'와 대상·제외 사유·주의를 보인다", () => {
    const html = preview();
    expect(html).toContain('예약 주문 3건 일정도 바꾸고 안내할까요?');
    expect(html).toContain('미출고 예약 배송 건 3건의 발송 예정일을 2026년 12월 9일로 바꾸고');
    expect(html).toContain('2026-12-05 → <strong class="font-medium">2026-12-09</strong>');
    expect(html).toContain('개별 변경');
    expect(html).toContain('입금 대기');
    expect(html).toContain('바꾸지 않는 배송 건 1건 · 출고지시됨 1건');
    expect(html).toContain('접수 중인 예약 조건은 바뀌지 않습니다');
    expect(html).toContain('기본 옵션 2026년 12월 2일');
    expect(html).toContain('운영자가 주문 상세에서 따로 바꾼 배송 건 1건이 포함되어 있습니다');
    expect(html).toContain('변경 사유(내부 기록): 공급처 입고 일정 변경');
    expect(html).toContain('예: &quot;발송 예정일: 2026-12-02 → 2026-12-09&quot;');
    expect(confirmButton(html)).not.toContain('disabled=""');
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

  it('대상이 없거나 한도를 넘으면 확정할 수 없다', () => {
    const empty = preview({ targets: [], targetShipments: 0, targetOrders: 0 });
    expect(empty).toContain('바꿀 예약 배송 건이 없습니다.');
    expect(confirmButton(empty)).toContain('disabled=""');
    const over = preview({ limit: 2 });
    expect(over).toContain('한 번에 바꿀 수 있는 배송 건은 2건까지입니다.');
    expect(confirmButton(over)).toContain('disabled=""');
  });

  it('SMS는 앱 스위치와 DB 설정이 모두 켜졌을 때만 언급한다(꺼져 있으면 화면에 SMS가 없다)', () => {
    expect(preview()).not.toContain('SMS');
    expect(preview({ smsEnabled: true })).not.toContain('SMS');
    expect(preview({}, { smsAvailable: true })).not.toContain('SMS');
    expect(preview({ smsEnabled: true }, { smsAvailable: true })).toContain('SMS 수신에 동의한 고객에게는 같은 안내를 문자로도 한 번 보냅니다.');
  });
});

describe('예약 일정 일괄 변경 결과', () => {
  it('주문마다 앱 알림·이메일 결과를 보이고 이메일 없는 수신자·재시도를 알린다', () => {
    const html = renderToStaticMarkup(<PreorderScheduleResultView change={scheduleChange()} />);
    expect(html).toContain('배송 건 2건의 발송 예정일을 2026년 12월 9일로 바꿨습니다');
    expect(html).toContain('이메일이 없는 수신자 1명은 앱 알림만 받았습니다.');
    expect(html).toContain('선물 받는 분');
    expect(html).toContain('2026111230000002 · 2026-12-05 → 2026-12-09');
    expect(html).toContain('실패한 이메일만 재시도');
    expect(html).not.toContain('>SMS<');
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
    const variants: AdminGoodsVariant[] = [{ id: scheduleIds.variant, code: 'HSQ-A', goodId: 'hsq-second', name: '기본 옵션', price: 12000, stockQty: 0, isDefault: true, archivedAt: null }];
    const html = renderToStaticMarkup(<GoodsPreorderSchedulePanel goodId="hsq-second" variants={variants} />);
    expect(html).toContain('예약 주문 발송 일정 변경·고객 안내');
    expect(html).toContain('발송 예정일 변경·안내');
    expect(html).toContain('출고지시·발송된 배송 건은 바꾸지 않습니다.');
    expect(html).not.toContain('대상 미리보기');
  });
});
