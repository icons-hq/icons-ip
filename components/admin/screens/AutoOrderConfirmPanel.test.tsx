import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('@/app/admin/auto-order-confirmation-actions', () => ({ saveAutoOrderConfirmationAction: vi.fn() }));
vi.mock('@/app/admin/staging-test-delivery-actions', () => ({ markStagingTestDeliveredAction: vi.fn() }));
import { AutoOrderConfirmPanel } from './AutoOrderConfirmPanel';
import { StagingTestDeliveryPanel } from './StagingTestDeliveryPanel';

const state = { revision: 3, enabled: true, runTime: '16:30', enabledAt: '2026-10-27T00:57:35Z', updatedAt: '2026-10-27T00:57:35Z',
  nextRunAt: '2026-10-27T07:30:00Z',
  lastRun: { runDate: '2026-10-26', cutoffAt: '2026-10-26T07:30:00Z', startedAt: '2026-10-26T07:31:00Z', finishedAt: '2026-10-26T07:31:01Z', confirmedCount: 12, excludedCount: 2 },
  lastExclusions: [
    { orderId: 'a0c00000-0000-4001-8000-000000000005', orderNumber: '2026102610000005', outcome: 'cancellation_in_progress' as const },
    { orderId: 'a0c00000-0000-4001-8000-000000000006', orderNumber: '2026102610000006', outcome: 'preorder_unallocated' as const },
  ] };

describe('발주 화면의 자동 발주확인 패널', () => {
  it('시각·켜짐·마지막/다음 실행과 남긴 주문의 사유를 보여 준다', () => {
    const html = renderToStaticMarkup(<AutoOrderConfirmPanel initial={state} />);
    /* 켜짐·꺼짐은 제목 옆 배지가 말하고, 요약 줄은 시각과 실행 결과를 말한다(MD 판정: 꺼짐이 회색 글자로 묻혔다). */
    expect(html).toMatch(/data-tone="success"[^>]*>켜짐</);
    expect(html).toContain('매일 16:30 · 마지막 실행');
    /* 첫 화면은 처리할 주문 목록의 자리다 — 설정은 접은 채로 그리고, 입력은 접어도 DOM에 남는다. */
    expect(html).toMatch(/<details (?:(?!open)[^>])*data-sales-disclosure=""(?:(?!open)[^>])*>/);
    /* 값을 바꾸기 전 비활성인 저장 버튼에 이유를 붙인다. */
    expect(html).toContain('사용 여부나 실행 시각을 바꾸면 저장할 수 있습니다.');
    expect(html).toContain('발주확인 12건 · 제외 2건');
    expect(html).toContain('다음 실행');
    expect(html).toContain('발주확인 전까지 고객은 주문을 직접 취소할 수 있습니다');
    expect(html).toContain('전에 결제된 주문은 자동 대상이 아니므로 직접 발주확인합니다');
    expect(html).toContain('/admin/sales/orders/a0c00000-0000-4001-8000-000000000005');
    expect(html).toContain('취소 요청 진행 중'); expect(html).toContain('예약 재고 할당 전');
    expect(html).toContain('type="time"'); expect(html).toContain('value="16:30"');
    /* 저장은 양식 제출(onSubmit)로 간다 — kit Button은 type이 없으면 button이 된다. */
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>설정 저장</);
  });
  it('꺼짐에는 다음 실행이 없고, 읽기 실패에도 직접 발주확인 안내를 남긴다', () => {
    const off = renderToStaticMarkup(<AutoOrderConfirmPanel initial={{ ...state, enabled: false, nextRunAt: null, lastRun: null, lastExclusions: [] }} />);
    expect(off).toMatch(/data-tone="warning"[^>]*>꺼짐</); expect(off).toContain('매일 16:30 · 아직 실행 기록 없음'); expect(off).not.toContain('다음 실행');
    expect(renderToStaticMarkup(<AutoOrderConfirmPanel initial={null} />)).toContain('신규주문은 위 목록에서 직접 발주확인할 수 있습니다');
  });
  it('테스트 배송완료는 스테이징 전용임과 메일 미발송을 알린다', () => {
    const html = renderToStaticMarkup(<StagingTestDeliveryPanel />);
    expect(html).toContain('테스트 배송완료 (스테이징 전용)'); expect(html).toContain('배송 메일은 없으며');
    expect(html).toContain('스테이징 테스트 주문임을 확인했습니다');
  });
});
