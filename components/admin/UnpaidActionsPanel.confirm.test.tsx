import type { ReactElement, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubAdminConfirm } from '@/lib/admin/confirm.test-support';

/* 입금 확인·기한 연장·즉시 취소는 누르는 순간 주문의 결제 상태·재고가 바뀐다(U-01). 세 양식 모두 확인창을 통과해야만 서버 액션으로 간다.
 * DOM 없이 컴포넌트를 함수로 불러 양식의 onSubmit을 직접 실행한다 — useActionState는 액션마다 정해 둔 보내기 함수를 돌려준다. */
const dispatchers = vi.hoisted(() => new Map<unknown, (formData: unknown) => void>());
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return { ...actual, useActionState: (action: unknown) => [{}, dispatchers.get(action) ?? (() => undefined), false] };
});
vi.mock('@/app/admin/unpaid-actions', () => ({
  cancelUnpaidBankTransferOrderAction: vi.fn(),
  confirmBankDepositAction: vi.fn(),
  confirmBankTransferDepositAction: vi.fn(),
  extendBankTransferDeadlineAction: vi.fn(),
  ignoreBankDepositAction: vi.fn(),
}));
import {
  cancelUnpaidBankTransferOrderAction,
  confirmBankTransferDepositAction,
  extendBankTransferDeadlineAction,
} from '@/app/admin/unpaid-actions';
import type { AdminUnpaidOrderRow } from '@/lib/admin/unpaid';
import { unpaidCancelRequest, unpaidConfirmDepositRequest, unpaidExtendDeadlineRequest } from '@/lib/admin/unpaid-copy';
import { formatOrderDateTime } from '@/lib/orders';
import { UnpaidActionsPanel } from './UnpaidActionsPanel';
import { ignoreUnconfirmedUnpaidSubmit } from './unpaid-submit';

const ORDER: AdminUnpaidOrderRow = {
  id: '9a3f21c0-1111-4000-8000-000000000abc',
  orderNumber: '20261126140710000001',
  buyerName: '홍길동',
  buyerId: '00000000-0000-4000-8000-000000000d01',
  recipientName: '김수령',
  total: 23000,
  createdAt: '2026-11-26T05:07:00.000Z',
  expiresAt: '2026-11-27T05:07:00.000Z',
  extendedAt: null,
  depositCode: '612345',
  itemSummary: '무통장 굿즈 × 1',
  attemptState: 'prepared',
};

type Node = ReactElement<{ children?: ReactNode; action?: unknown; onSubmit?: (event: unknown) => void }>;
function findForms(node: ReactNode, found: Node[] = []): Node[] {
  if (Array.isArray(node)) { node.forEach((child) => findForms(child, found)); return found; }
  if (node && typeof node === 'object' && 'props' in node) {
    const element = node as Node;
    if (element.type === 'form') found.push(element);
    findForms(element.props.children, found);
  }
  return found;
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const dispatch = { confirm: vi.fn(), extend: vi.fn(), cancel: vi.fn() };
let confirm: ReturnType<typeof stubAdminConfirm> | null = null;
beforeEach(() => {
  dispatchers.clear();
  dispatchers.set(confirmBankTransferDepositAction, dispatch.confirm);
  dispatchers.set(extendBankTransferDeadlineAction, dispatch.extend);
  dispatchers.set(cancelUnpaidBankTransferOrderAction, dispatch.cancel);
  Object.values(dispatch).forEach((fn) => fn.mockReset());
  /* 이 시험은 DOM이 없다 — 양식 값을 읽는 자리를 기억만 하는 FormData로 바꾼다. */
  vi.stubGlobal('FormData', class { constructor(readonly form: unknown) {} });
});
afterEach(() => {
  confirm?.restore();
  confirm = null;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function panelForms(order: AdminUnpaidOrderRow = ORDER) {
  const forms = findForms(UnpaidActionsPanel({ order, now: Date.parse('2026-11-26T05:07:00.000Z') }));
  expect(forms).toHaveLength(3);
  return { confirm: forms[0]!, extend: forms[1]!, cancel: forms[2]! };
}
async function submit(form: Node) {
  const target = { isConnected: true }, preventDefault = vi.fn();
  form.props.onSubmit?.({ currentTarget: target, preventDefault });
  await flush();
  return { target, preventDefault };
}

describe('미결제 처리 패널의 세 양식', () => {
  it('양식 action 자리는 비어 있다(하이드레이션 전에 눌린 제출이 확인 없이 서버 액션으로 가지 않는다)', () => {
    for (const form of Object.values(panelForms())) {
      expect(form.props.action).toBe(ignoreUnconfirmedUnpaidSubmit);
      expect(form.props.action).not.toBe(confirmBankTransferDepositAction);
    }
  });

  it('입금 확인: 확인창에서 주문번호·구매자·금액·입금자명을 보이고, 확인해야만 입금 확인 액션으로 보낸다', async () => {
    confirm = stubAdminConfirm(true);
    const { target, preventDefault } = await submit(panelForms().confirm);

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(confirm).toHaveBeenCalledOnce();
    expect(confirm.mock.calls[0]![0]).toBe(unpaidConfirmDepositRequest(ORDER).message);
    expect(confirm.mock.calls[0]![0]).toContain('주문 20261126140710000001 · 홍길동 · 23,000원');
    expect(confirm.mock.calls[0]![0]).toContain('안내된 입금자명 김수령612345');
    expect(dispatch.confirm).toHaveBeenCalledOnce();
    expect(dispatch.confirm).toHaveBeenCalledWith(expect.objectContaining({ form: target }));
    expect(dispatch.extend).not.toHaveBeenCalled();
    expect(dispatch.cancel).not.toHaveBeenCalled();
  });

  it('입금 확인: 확인창에서 돌아가면 보내지 않는다', async () => {
    confirm = stubAdminConfirm(false);
    const { preventDefault } = await submit(panelForms().confirm);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(confirm).toHaveBeenCalledOnce();
    expect(Object.values(dispatch).every((fn) => fn.mock.calls.length === 0)).toBe(true);
  });

  it('즉시 취소: 재고·환불·되살릴 수 없음을 말하고, 확인해야만 취소 액션으로 보낸다', async () => {
    confirm = stubAdminConfirm(true);
    const { target } = await submit(panelForms().cancel);

    expect(confirm.mock.calls[0]![0]).toBe(unpaidCancelRequest(ORDER).message);
    expect(confirm.mock.calls[0]![0]).toContain('주문 20261126140710000001 · 홍길동 · 23,000원');
    expect(confirm.mock.calls[0]![0]).toContain('입금 전 주문이라 환불은 없습니다.');
    expect(dispatch.cancel).toHaveBeenCalledOnce();
    expect(dispatch.cancel).toHaveBeenCalledWith(expect.objectContaining({ form: target }));
    expect(dispatch.confirm).not.toHaveBeenCalled();
    expect(dispatch.extend).not.toHaveBeenCalled();
  });

  it('즉시 취소: 확인창에서 돌아가면 보내지 않는다', async () => {
    confirm = stubAdminConfirm(false);
    await submit(panelForms().cancel);
    expect(confirm).toHaveBeenCalledOnce();
    expect(Object.values(dispatch).every((fn) => fn.mock.calls.length === 0)).toBe(true);
  });

  it('기한 연장: 누른 시각 기준으로 지금 기한 → 새 기한을 보이고, 확인해야만 연장 액션으로 보낸다', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: Date.parse('2026-11-26T20:00:00.000Z') });
    confirm = stubAdminConfirm(true);
    const { target } = await submit(panelForms().extend);

    const message = confirm.mock.calls[0]![0];
    expect(message).toBe(unpaidExtendDeadlineRequest(ORDER, Date.parse('2026-11-26T20:00:00.000Z')).message);
    expect(message).toContain(`입금 기한(KST) ${formatOrderDateTime(ORDER.expiresAt!)} → ${formatOrderDateTime('2026-11-27T20:00:00.000Z')}`);
    expect(dispatch.extend).toHaveBeenCalledOnce();
    expect(dispatch.extend).toHaveBeenCalledWith(expect.objectContaining({ form: target }));
    expect(dispatch.confirm).not.toHaveBeenCalled();
    expect(dispatch.cancel).not.toHaveBeenCalled();
  });

  it('기한 연장: 확인창에서 돌아가면 보내지 않는다', async () => {
    confirm = stubAdminConfirm(false);
    await submit(panelForms().extend);
    expect(Object.values(dispatch).every((fn) => fn.mock.calls.length === 0)).toBe(true);
  });

  it('같은 버튼을 거듭 눌러도 확인창은 하나이고 한 번만 보낸다', async () => {
    confirm = stubAdminConfirm(true);
    const form = panelForms().cancel;
    const target = { isConnected: true };
    form.props.onSubmit?.({ currentTarget: target, preventDefault: vi.fn() });
    form.props.onSubmit?.({ currentTarget: target, preventDefault: vi.fn() });
    await flush();
    expect(confirm).toHaveBeenCalledOnce();
    expect(dispatch.cancel).toHaveBeenCalledOnce();
  });
});
