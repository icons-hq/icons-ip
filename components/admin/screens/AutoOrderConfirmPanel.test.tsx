import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('@/app/admin/auto-order-confirmation-actions', () => ({ saveAutoOrderConfirmationAction: vi.fn() }));
import { AutoOrderConfirmPanel } from './AutoOrderConfirmPanel';

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
    expect(html).toContain('/admin/sales/orders/a0c00000-0000-4001-8000-000000000005');
    expect(html).toContain('취소 요청 진행 중'); expect(html).toContain('예약 입고 확인 전');
    expect(html).toContain('type="time"'); expect(html).toContain('value="16:30"');
    /* 저장은 양식 제출(onSubmit)로 간다 — kit Button은 type이 없으면 button이 된다. */
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>설정 저장</);
  });
  /* 켜고 끌 때 무엇이 달라지는지를 한 줄로 되읽는다. 긴 설명 문단과 칸 아래 세 문장은 이 줄과 "?"로 줄였다. */
  it('지금 설정을 한 줄로 되읽고, 어떤 신규주문이 빠지는지는 "?"에만 둔다', () => {
    const html = renderToStaticMarkup(<AutoOrderConfirmPanel initial={state} />);
    expect(html).toContain('매일 16:30에, 그 시각까지 결제된 신규주문을 발주확인합니다. 발주확인 전까지는 고객이 직접 취소할 수 있습니다.');
    expect(html).not.toContain('저장하면');
    expect(html).toContain('aria-label="자동 발주확인 대상 도움말"');
    for (const gone of ['시스템이 발주확인합니다', '자동 대상이 아니므로 직접 발주확인합니다', '입금 확인 뒤 1시간이 지나야 대상이므로', '다시 켜면 켠 뒤 결제된 주문부터', '이 시각까지 결제 완료된 주문이 대상입니다']) expect(html).not.toContain(gone);
    expect(html).toContain('오늘 아직 실행 전이면 바꾼 시각에(이미 지난 시각이면 1분 안에) 실행하고, 이미 실행한 날은 다시 실행하지 않습니다.');
  });
  it('끄면 실행 시각 칸은 보이지 않고, 켜짐 표시와 요약은 저장된 설정을 따른다', () => {
    const html = renderToStaticMarkup(<AutoOrderConfirmPanel initial={{ ...state, enabled: false, nextRunAt: null }} />);
    expect(html).toContain('자동 발주확인이 꺼져 있습니다. 신규주문은 직접 발주확인합니다.');
    expect(html).not.toContain('type="time"'); expect(html).not.toContain('매일 실행 시각 (KST)');
    expect(html).toMatch(/data-tone="warning"[^>]*>꺼짐</);
    expect(html).not.toMatch(/<input[^>]*type="checkbox"[^>]*checked/);
  });
  /* S36-075 리뷰: 남긴 주문도 같은 발주·발송 목록 위 상세 팝업으로 열고, 새 탭은 보조 아이콘으로 남긴다. */
  it('마지막 실행에서 남긴 주문은 지금 목록 조건 위 팝업으로 열고 새 탭 링크를 따로 둔다', () => {
    const html = renderToStaticMarkup(<AutoOrderConfirmPanel initial={state} listHref="/admin/sales/dispatch?tab=new&page=2" />);
    expect(html).toContain('href="/admin/sales/dispatch?tab=new&amp;page=2&amp;orderId=a0c00000-0000-4001-8000-000000000005"');
    expect(html).toContain('aria-label="주문 2026102610000005 상세 팝업 열기"');
    expect(html).toMatch(/href="\/admin\/sales\/orders\/a0c00000-0000-4001-8000-000000000005\?back=[^"]*"[^>]*target="_blank"|target="_blank"[^>]*href="\/admin\/sales\/orders\/a0c00000-0000-4001-8000-000000000005/);
  });
  it('꺼짐에는 다음 실행이 없고, 읽기 실패에도 직접 발주확인 안내를 남긴다', () => {
    const off = renderToStaticMarkup(<AutoOrderConfirmPanel initial={{ ...state, enabled: false, nextRunAt: null, lastRun: null, lastExclusions: [] }} />);
    expect(off).toMatch(/data-tone="warning"[^>]*>꺼짐</); expect(off).toContain('매일 16:30 · 아직 실행 기록 없음'); expect(off).not.toContain('다음 실행');
    expect(renderToStaticMarkup(<AutoOrderConfirmPanel initial={null} />)).toContain('신규주문은 위 목록에서 직접 발주확인할 수 있습니다');
  });
});
