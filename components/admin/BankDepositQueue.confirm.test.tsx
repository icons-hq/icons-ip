import type { ReactElement, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubAdminConfirm } from '@/lib/admin/confirm.test-support';

/* 입금 내역을 주문에 연결해 확정하면 주문이 결제완료가 되고 고객 메일이 나간다. 내리기는 이 목록에서 다시 올릴 길이 없다(U-07).
 * 둘 다 확인창을 통과해야만 서버 액션으로 간다. DOM 없이 입금 카드를 함수로 불러 양식의 onSubmit을 직접 실행한다. */
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
import { confirmBankDepositAction, ignoreBankDepositAction } from '@/app/admin/unpaid-actions';
import type { AdminBankDepositRow } from '@/lib/admin/unpaid';
import { bankDepositConfirmRequest, bankDepositIgnoreRequest } from '@/lib/admin/unpaid-copy';
import { DepositCard } from './BankDepositQueue';
import { ignoreUnconfirmedUnpaidSubmit } from './unpaid-submit';

const DEPOSIT: AdminBankDepositRow = {
  id: 'd1',
  source: 'fake',
  externalId: 'dep-001',
  depositedAt: '2026-11-26T05:00:00.000Z',
  depositorName: '김수령612345',
  amount: 23000,
  rawReference: '기업 12345',
  suggestedOrderId: '9a3f21c0-1111-4000-8000-000000000abc',
  suggestedOrderCode: '612345',
  suggestedConfidence: 'code_amount',
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
async function submit(form: Node) {
  const target = { isConnected: true }, preventDefault = vi.fn();
  form.props.onSubmit?.({ currentTarget: target, preventDefault });
  await flush();
  return { target, preventDefault };
}

const dispatch = { confirm: vi.fn(), ignore: vi.fn() };
let confirm: ReturnType<typeof stubAdminConfirm> | null = null;
beforeEach(() => {
  dispatchers.clear();
  dispatchers.set(confirmBankDepositAction, dispatch.confirm);
  dispatchers.set(ignoreBankDepositAction, dispatch.ignore);
  Object.values(dispatch).forEach((fn) => fn.mockReset());
  vi.stubGlobal('FormData', class { constructor(readonly form: unknown) {} });
});
afterEach(() => {
  confirm?.restore();
  confirm = null;
  vi.unstubAllGlobals();
});

describe('입금 내역 카드의 양식', () => {
  it('제안이 있으면 확정·내리기 양식이 있고, 양식 action 자리는 모두 비어 있다', () => {
    const forms = findForms(DepositCard({ deposit: DEPOSIT }));
    expect(forms).toHaveLength(2);
    for (const form of forms) expect(form.props.action).toBe(ignoreUnconfirmedUnpaidSubmit);
  });

  it('제안이 없으면 내리기 양식만 있다', () => {
    const forms = findForms(DepositCard({ deposit: { ...DEPOSIT, suggestedOrderId: null, suggestedOrderCode: null, suggestedConfidence: null } }));
    expect(forms).toHaveLength(1);
  });

  it('이 주문으로 확정: 입금액·입금자명·연결할 주문을 보이고, 확인해야만 확정 액션으로 보낸다', async () => {
    confirm = stubAdminConfirm(true);
    const [confirmForm] = findForms(DepositCard({ deposit: DEPOSIT }));
    const { target, preventDefault } = await submit(confirmForm!);

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(confirm).toHaveBeenCalledOnce();
    expect(confirm.mock.calls[0]![0]).toBe(bankDepositConfirmRequest(DEPOSIT).message);
    expect(confirm.mock.calls[0]![0]).toContain('입금 23,000원 · 입금자명 김수령612345');
    expect(confirm.mock.calls[0]![0]).toContain('연결할 주문 · 입금확인코드 612345');
    expect(dispatch.confirm).toHaveBeenCalledOnce();
    expect(dispatch.confirm).toHaveBeenCalledWith(expect.objectContaining({ form: target }));
    expect(dispatch.ignore).not.toHaveBeenCalled();
  });

  it('이 주문으로 확정: 확인창에서 돌아가면 보내지 않는다', async () => {
    confirm = stubAdminConfirm(false);
    const [confirmForm] = findForms(DepositCard({ deposit: DEPOSIT }));
    await submit(confirmForm!);
    expect(confirm).toHaveBeenCalledOnce();
    expect(dispatch.confirm).not.toHaveBeenCalled();
    expect(dispatch.ignore).not.toHaveBeenCalled();
  });

  it('목록에서 내리기: 기록은 남는다고 말하고, 확인해야만 보류 액션으로 보낸다', async () => {
    confirm = stubAdminConfirm(true);
    const forms = findForms(DepositCard({ deposit: DEPOSIT }));
    const { target } = await submit(forms[1]!);

    expect(confirm.mock.calls[0]![0]).toBe(bankDepositIgnoreRequest(DEPOSIT).message);
    expect(confirm.mock.calls[0]![0]).toContain('입금 기록과 보류 사유는 남아');
    expect(dispatch.ignore).toHaveBeenCalledOnce();
    expect(dispatch.ignore).toHaveBeenCalledWith(expect.objectContaining({ form: target }));
    expect(dispatch.confirm).not.toHaveBeenCalled();
  });

  it('목록에서 내리기: 확인창에서 돌아가면 보내지 않는다', async () => {
    confirm = stubAdminConfirm(false);
    const forms = findForms(DepositCard({ deposit: DEPOSIT }));
    await submit(forms[1]!);
    expect(dispatch.ignore).not.toHaveBeenCalled();
  });
});
