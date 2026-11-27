import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

/*
 * 무통장 부분 취소의 [송금 완료 기록]은 되돌릴 수 없는 돈 기록이다(QA-C F-07) — 확인창을 통과해야만 서버 액션으로 간다.
 * DOM 없이 부품을 함수로 불러 양식의 onSubmit을 직접 실행한다. 훅은 순서대로 값을 기억한다.
 */
const hooks = vi.hoisted(() => ({ state: [] as unknown[], index: 0, refs: [] as { current: unknown }[], refIndex: 0 }));
const mocks = vi.hoisted(() => ({ record: vi.fn() }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'), useEffect: () => {}, useMemo: (compute: () => unknown) => compute(),
  useRef: (initial: unknown) => { const index = hooks.refIndex++; hooks.refs[index] ??= { current: initial }; return hooks.refs[index]; },
  useState: (initial: unknown) => { const index = hooks.index++; if (!(index in hooks.state)) hooks.state[index] = initial;
    return [hooks.state[index], (next: unknown) => { hooks.state[index] = typeof next === 'function' ? next(hooks.state[index]) : next; }]; },
}));
vi.mock('@/components/orders/claim-preview-busy', () => ({ useClaimPreviewBusy: () => {} }));
vi.mock('@/app/admin/order-partial-cancellation-actions', () => ({
  loadOrderPartialCancellationAction: vi.fn(),
  previewOrderPartialCancellationAction: vi.fn(),
  startOrderPartialCancellationAction: vi.fn(),
  retryOrderPartialCancellationAction: vi.fn(),
  resolveOrderPartialCancellationAction: vi.fn(),
  recordOrderPartialCancellationTransferAction: mocks.record,
  viewOrderPartialCancellationRefundAccountAction: vi.fn(),
}));

import { setAdminConfirmHandler } from '@/lib/admin/confirm';
import { stubAdminConfirm } from '@/lib/admin/confirm.test-support';
import { orderPartialCancellationTransferConfirm } from '@/lib/admin/order-partial-cancellation';
import type { OrderPartialCancellationContext, OrderPartialCancellationRecord } from '@/lib/orders/partial-cancellation';
import { OrderPartialCancellationPanelView } from './OrderPartialCancellationPanel';

const ORDER_ID = '99999999-8888-4777-a666-555555555555';
const ORDER_NUMBER = '2026112610000013';
const RECORD_ID = 'cccccccc-0000-4000-8000-000000000003';
const ACCOUNT = { maskedAccount: '합성은행 ****1234', maskedHolder: '홍*동', purged: false };
const EVIDENCE = '11/26 15:55 이체 완료';
const NOTE = '은행 앱 이체 내역으로 확인';
const RECORDED = '송금 완료를 기록했습니다. 구매자에게 알렸고 저장된 계좌번호는 30일 뒤 지웁니다.';

function record(overrides: Partial<OrderPartialCancellationRecord> = {}): OrderPartialCancellationRecord {
  return {
    id: RECORD_ID, sequence: 1, reasonCode: 'out_of_stock', claimId: null, returnFeeDeduction: 0, state: 'awaiting_transfer', provider: 'bank_transfer',
    refundAmount: 28_000, goodsRefundAmount: 28_000, shippingRefundAmount: 0, storeCreditRestoreAmount: 0, createdAt: '2026-11-26T06:00:00Z',
    appliedAt: '2026-11-26T06:00:05Z', completedAt: null, transferredAt: null,
    items: [{ orderItemId: 'aaaaaaaa-0000-4000-8000-00000000000a', goodName: '품절 상품 A', variantName: '블루', qty: 1, goodsRefundAmount: 28_000 }],
    closedShipmentCount: 0,
    staff: { customerDecision: '11/26 통화 — 있는 것만 받기', note: null, warehouseStopConfirmed: false, lastErrorCode: null, balanceBefore: 56_000,
      paymentAmount: 56_000, createdBy: '운영자', transferEvidence: null, transferNote: null, filedAt: null, resolution: null, resolutionReason: null,
      resolvedAt: null, closedShipments: [], refundAccount: ACCOUNT },
    ...overrides,
  };
}
function context(history: OrderPartialCancellationRecord[]): OrderPartialCancellationContext {
  return { enabled: true, canManage: true, gift: false, calculationVersion: 2, v1Allocation: null, blockers: [], provider: 'bank_transfer', paymentAmount: 56_000,
    balance: 28_000, items: [], history };
}

type Element = ReactElement<{ children?: ReactNode; record?: OrderPartialCancellationRecord; onSubmit?: (event: unknown) => unknown; type?: string }>;
function all(node: ReactNode): Element[] { return Array.isArray(node) ? node.flatMap(all) : isValidElement(node) ? [node as Element, ...all((node.props as { children?: ReactNode }).children)] : []; }
function text(node: ReactNode): string { return Array.isArray(node) ? node.map(text).join('') : isValidElement(node) ? text((node.props as { children?: ReactNode }).children) : typeof node === 'string' ? node : ''; }
function resetHooks(state: unknown[] = []) { hooks.state = state; hooks.index = 0; hooks.refs = []; hooks.refIndex = 0; }

/** 기록 한 줄(HistoryEntry)을 송금 근거·확인 메모를 적은 상태로 그리고, 그 송금 완료 기록 양식을 돌려준다. */
function transferForm(entry: OrderPartialCancellationRecord, onReload: (message?: string) => void, orderNumber: string | null = ORDER_NUMBER) {
  resetHooks();
  const view = OrderPartialCancellationPanelView({ orderId: ORDER_ID, orderNumber, context: context([entry]), onReload }) as Element;
  const row = all(view).find(element => typeof element.type === 'function' && element.props.record === entry)!;
  /* HistoryEntry의 상태 순서: 처리 중 · 해소 사유 · 안내 · 전체 계좌 · 송금 근거 · 확인 메모 */
  resetHooks([false, '', null, null, EVIDENCE, NOTE]);
  const tree = (row.type as (props: unknown) => ReactNode)(row.props);
  const form = all(tree).find(element => element.type === 'form' && text(element).includes('송금 완료 기록'))!;
  return form;
}
const submit = (form: Element) => { const preventDefault = vi.fn(); return { preventDefault, done: Promise.resolve(form.props.onSubmit?.({ preventDefault })) }; };

let confirm: ReturnType<typeof stubAdminConfirm> | null = null;
beforeEach(() => { vi.clearAllMocks(); mocks.record.mockResolvedValue({ ok: true, value: RECORDED }); });
afterEach(() => { confirm?.restore(); confirm = null; setAdminConfirmHandler(null); });

it('송금 완료 기록: 처리를 시작하기 전에 주문번호·금액·가린 계좌를 되읽는 확인창을 띄우고, 확인해야만 기록한다', async () => {
  const entry = record();
  const onReload = vi.fn();
  const seen: { pending: unknown; recorded: number }[] = [];
  confirm = stubAdminConfirm(() => { seen.push({ pending: hooks.state[0], recorded: mocks.record.mock.calls.length }); return true; });
  const { preventDefault, done } = submit(transferForm(entry, onReload));
  await done;

  expect(preventDefault).toHaveBeenCalledOnce();
  expect(confirm).toHaveBeenCalledOnce();
  expect(confirm.mock.calls[0]![0]).toBe(orderPartialCancellationTransferConfirm({ orderNumber: ORDER_NUMBER, refundAmount: 28_000, refundAccount: ACCOUNT }).message);
  expect(confirm.mock.calls[0]![0]).toContain('주문 2026112610000013');
  expect(confirm.mock.calls[0]![0]).toContain('보낸 금액: 28,000원');
  expect(confirm.mock.calls[0]![0]).toContain('받는 계좌: 합성은행 ****1234 (예금주 홍*동)');
  expect(confirm.mock.calls[0]![0]).toContain('되돌릴 수 없습니다.');
  /* 확인창이 떠 있는 동안에는 아직 처리 중이 아니고 서버 액션도 부르지 않았다. */
  expect(seen).toEqual([{ pending: false, recorded: 0 }]);
  expect(mocks.record).toHaveBeenCalledExactlyOnceWith({ orderId: ORDER_ID, partialCancellationId: RECORD_ID, evidence: EVIDENCE, note: NOTE, operationId: expect.any(String) });
  expect(onReload).toHaveBeenCalledExactlyOnceWith(RECORDED);
});

it('송금 완료 기록: 확인창에서 돌아가면 기록하지 않고 적은 내용도 그대로다', async () => {
  confirm = stubAdminConfirm(false);
  const onReload = vi.fn();
  await submit(transferForm(record(), onReload)).done;
  expect(confirm).toHaveBeenCalledOnce();
  expect(mocks.record).not.toHaveBeenCalled();
  expect(onReload).not.toHaveBeenCalled();
  expect(hooks.state.slice(0, 6)).toEqual([false, '', null, null, EVIDENCE, NOTE]);
});

it('송금 완료 기록: 확인창을 띄울 곳이 없으면 확인되지 않은 것으로 보고 기록하지 않는다', async () => {
  setAdminConfirmHandler(null);
  await submit(transferForm(record(), vi.fn())).done;
  expect(mocks.record).not.toHaveBeenCalled();
});

it('부분 반품 환불 줄은 반품 이름으로 묻는다', async () => {
  confirm = stubAdminConfirm(true);
  await submit(transferForm(record({ reasonCode: 'return' }), vi.fn())).done;
  expect(confirm.mock.calls[0]![0]).toContain("기록하면 이 부분 반품 환불이 끝나고 고객에게 '반품 환불을 송금했어요' 알림이 갑니다.");
  expect(mocks.record).toHaveBeenCalledOnce();
});
