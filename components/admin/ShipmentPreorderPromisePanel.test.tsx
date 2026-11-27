// @vitest-environment node
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/app/admin/preorder-shipment-actions', () => ({ changeShipmentPreorderDateAction: vi.fn(), readShipmentPreorderPromiseAction: vi.fn() }));
vi.mock('@/components/orders/claim-preview-busy', () => ({ useClaimPreviewBusy: vi.fn() }));
import { PromiseChangeHeadline } from './ShipmentPreorderPromisePanel';

const base = { id: 'c', fromDate: '2099-10-01', toDate: '2099-10-15', reason: 'r', actorName: null, changedAt: '2099-09-01T00:00:00Z', bulkChangeId: null, noticeOnly: false };
describe('PromiseChangeHeadline', () => {
  it('shows an individual change as a plain date move', () => {
    const html = renderToStaticMarkup(<PromiseChangeHeadline change={base} />);
    expect(html).toContain('2099-10-01 → 2099-10-15');
    expect(html).not.toContain('일괄 변경');
  });
  it('marks a bulk change with its source', () => {
    const html = renderToStaticMarkup(<PromiseChangeHeadline change={{ ...base, bulkChangeId: 'b' }} />);
    expect(html).toContain('2099-10-01 → 2099-10-15');
    expect(html).toContain('· 예약 주문 일괄 변경');
  });
  it('shows a notice-only row as notice without an A → A move', () => {
    const html = renderToStaticMarkup(<PromiseChangeHeadline change={{ ...base, fromDate: '2099-10-15', bulkChangeId: 'b', noticeOnly: true }} />);
    expect(html).toContain('고객 안내만(일정 그대로) · 예약 주문 일괄 변경');
    expect(html).not.toContain('→');
  });
});

/* D-19: 예정일을 바꾸면 고객 주문 화면에 바로 보이므로 확인창이 이전 → 새 날짜와 그 결과를 말한다. 같은 날짜·빈 이유는 누르기 전에 막는다. */
import { PromiseEditor, preorderDateConfirmRequest } from './ShipmentPreorderPromisePanel';
import type { ShipmentPreorderPromise } from '@/app/admin/preorder-shipment-actions';

const promise: ShipmentPreorderPromise = { shipmentId: 'c3a00000-0000-4002-8000-000000000021', orderId: 'c3a00000-0000-4002-8000-000000000022', status: 'ready',
  originalExpectedShipDate: '2099-10-01', expectedShipDate: '2099-10-15', updatedAt: '2099-09-01T00:00:00Z', changes: [] };
describe('예약 발송 예정일 바꾸기', () => {
  it('확인창은 이전 → 새 예정일과 고객 화면에 바로 보이고 알림은 가지 않는다는 사실만 말한다', () => {
    expect(preorderDateConfirmRequest({ from: '2099-10-15', to: '2099-11-05' })).toEqual({
      title: '발송 예정일을 바꿀까요?',
      message: '2099년 10월 15일 발송 예정 → 2099년 11월 5일 발송 예정\n고객 주문 화면에 바뀐 예정일이 바로 보입니다. 고객에게 알림은 가지 않습니다.',
      confirmLabel: '예정일 바꾸기', cancelLabel: '돌아가기',
    });
  });
  it('버튼은 일어나는 일을 말하고, 처음에는 같은 날짜라 잠겨 있으며 이유를 보인다', () => {
    const html = renderToStaticMarkup(<PromiseEditor promise={promise} onSaved={() => {}} />);
    expect(html).toContain('>발송 예정일 바꾸기</button>');
    expect(html).toMatch(/<button[^>]*disabled[^>]*>발송 예정일 바꾸기<\/button>/);
    expect(html).toContain('다른 날짜를 고르면 누를 수 있습니다.');
    for (const retired of ['발송 예정일 변경 기록', '변경 사유', '고객에게 따로 알림은 가지 않습니다']) expect(html, retired).not.toContain(retired);
  });
  it('이유 칸은 필수라고 이름에 적고 어디에 보이는지 한 줄로 말한다. 지난 날짜는 고를 수 없다', () => {
    const html = renderToStaticMarkup(<PromiseEditor promise={promise} onSaved={() => {}} />);
    expect(html).toContain('바꾸는 이유 (필수)');
    expect(html).toContain('placeholder="예: 공장 입고가 늦어져 일정을 미룸"');
    expect(html).toContain('변경 이력과 발송관리의 지연 메모에 보입니다.');
    expect(html).toMatch(/type="date"[^>]*min="\d{4}-\d{2}-\d{2}"|min="\d{4}-\d{2}-\d{2}"[^>]*type="date"/);
  });
});
