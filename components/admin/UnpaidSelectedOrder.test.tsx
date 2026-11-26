import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * 입금 확인·즉시 취소가 끝나면 그 주문은 목록에서 빠진다(QA-O 고칠 것 8). 처리 패널이 결과 문구와 함께 사라져
 * "고른 주문이 목록에 없습니다"만 남지 않게, 고른 주문의 자리(UnpaidSelectedOrder)가 방금 처리한 결과를 들고 있다가 보인다.
 * DOM 없이 부품을 함수로 불러 상태를 직접 쥔다 — useState는 시험이 든 값을, useActionState는 넘겨받은 액션을 기억한다.
 */
const hooks = vi.hoisted(() => ({ processed: null as string | null, actions: [] as unknown[] }));
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useState: () => [hooks.processed, (value: string | null) => { hooks.processed = value; }],
    useActionState: (action: unknown) => { hooks.actions.push(action); return [{}, () => undefined, false]; },
  };
});
vi.mock('@/app/admin/unpaid-actions', () => ({
  cancelUnpaidBankTransferOrderAction: vi.fn(),
  confirmBankTransferDepositAction: vi.fn(),
  extendBankTransferDeadlineAction: vi.fn(),
}));
import {
  cancelUnpaidBankTransferOrderAction,
  confirmBankTransferDepositAction,
  extendBankTransferDeadlineAction,
} from '@/app/admin/unpaid-actions';
import type { AdminUnpaidOrderRow } from '@/lib/admin/unpaid';
import { unpaidProcessedNotice } from '@/lib/admin/unpaid-copy';
import { UnpaidActionsPanel } from './UnpaidActionsPanel';
import { UnpaidSelectedOrder, UnpaidSelectionNotice } from './UnpaidSelectedOrder';
import { reportUnpaidProcessed } from './unpaid-submit';

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
const DETAIL = `/admin/sales/orders/${ORDER.id}`;
const LIST = '/admin/sales/unpaid';
const CONFIRMED = '입금을 확인해 주문을 결제완료로 확정했습니다.';
const CANCELED = '미입금 주문을 취소하고 재고를 복원했습니다.';

type PanelElement = ReactElement<{ order: AdminUnpaidOrderRow; onProcessed?: (notice: string) => void; detailHref?: string }>;

beforeEach(() => {
  hooks.processed = null;
  hooks.actions = [];
  vi.mocked(confirmBankTransferDepositAction).mockReset();
  vi.mocked(extendBankTransferDeadlineAction).mockReset();
  vi.mocked(cancelUnpaidBankTransferOrderAction).mockReset();
});

describe('reportUnpaidProcessed', () => {
  it('성공한 결과 문구만 바깥에 알리고, 서버 액션의 결과는 그대로 돌려준다', async () => {
    const formData = { name: 'formData' } as unknown as FormData;
    const onProcessed = vi.fn();
    const action = vi.fn<(state: { message?: string }, formData: FormData) => Promise<{ message?: string }>>(async () => ({ message: CONFIRMED }));
    await expect(reportUnpaidProcessed(action, onProcessed)({}, formData)).resolves.toEqual({ message: CONFIRMED });
    expect(action).toHaveBeenCalledOnce();
    expect(action).toHaveBeenCalledWith({}, formData);
    expect(onProcessed).toHaveBeenCalledOnce();
    expect(onProcessed).toHaveBeenCalledWith(CONFIRMED);
  });

  it('거절은 알리지 않는다 — 거절된 주문은 목록에 남아 패널이 오류를 보인다', async () => {
    const onProcessed = vi.fn();
    const rejected = { error: '이미 처리된 주문입니다.' } as { error?: string; message?: string };
    await expect(reportUnpaidProcessed(async () => rejected, onProcessed)({}, {} as FormData)).resolves.toBe(rejected);
    expect(onProcessed).not.toHaveBeenCalled();
  });
});

describe('unpaidProcessedNotice', () => {
  it('어느 주문에 무엇을 했는지와 목록에서 빠진 이유를 한 줄로 말한다', () => {
    expect(unpaidProcessedNotice(ORDER, CONFIRMED))
      .toBe('주문 20261126140710000001 · 입금을 확인해 주문을 결제완료로 확정했습니다. 처리가 끝나 이 목록에서 빠졌습니다.');
    expect(unpaidProcessedNotice({ orderNumber: undefined, depositCode: '612345' }, CANCELED))
      .toBe('입금확인코드 612345 주문 · 미입금 주문을 취소하고 재고를 복원했습니다. 처리가 끝나 이 목록에서 빠졌습니다.');
  });
});

describe('처리 패널이 결과를 바깥에 알리는 길', () => {
  it('알릴 곳이 없으면 세 서버 액션을 그대로 쓴다', () => {
    UnpaidActionsPanel({ order: ORDER });
    expect(hooks.actions).toEqual([
      confirmBankTransferDepositAction,
      extendBankTransferDeadlineAction,
      cancelUnpaidBankTransferOrderAction,
    ]);
  });

  it('입금 확인이 성공하면 주문과 함께 결과 한 줄을 알린다', async () => {
    const onProcessed = vi.fn();
    vi.mocked(confirmBankTransferDepositAction).mockResolvedValue({ message: CONFIRMED });
    UnpaidActionsPanel({ order: ORDER, onProcessed });
    const confirm = hooks.actions[0] as (state: object, formData: FormData) => Promise<unknown>;
    expect(confirm).not.toBe(confirmBankTransferDepositAction);
    await expect(confirm({}, {} as FormData)).resolves.toEqual({ message: CONFIRMED });
    expect(confirmBankTransferDepositAction).toHaveBeenCalledOnce();
    expect(onProcessed).toHaveBeenCalledWith(unpaidProcessedNotice(ORDER, CONFIRMED));
  });

  it('즉시 취소가 성공하면 알리고, 거절되면 알리지 않는다', async () => {
    const onProcessed = vi.fn();
    vi.mocked(cancelUnpaidBankTransferOrderAction)
      .mockResolvedValueOnce({ error: '주문을 취소하지 못했습니다.' })
      .mockResolvedValueOnce({ message: CANCELED });
    UnpaidActionsPanel({ order: ORDER, onProcessed });
    const cancel = hooks.actions[2] as (state: object, formData: FormData) => Promise<unknown>;
    await cancel({}, {} as FormData);
    expect(onProcessed).not.toHaveBeenCalled();
    await cancel({}, {} as FormData);
    expect(onProcessed).toHaveBeenCalledOnce();
    expect(onProcessed).toHaveBeenCalledWith(unpaidProcessedNotice(ORDER, CANCELED));
  });

  it('기한 연장은 알리지 않는다 — 주문이 목록에 남아 패널이 결과를 보인다', () => {
    UnpaidActionsPanel({ order: ORDER, onProcessed: vi.fn() });
    expect(hooks.actions[1]).toBe(extendBankTransferDeadlineAction);
  });
});

describe('고른 주문의 자리', () => {
  it('주문이 목록에 있으면 처리 패널을 보이고, 처리 결과를 받을 곳을 넘긴다', () => {
    const element = UnpaidSelectedOrder({ order: ORDER, detailHref: DETAIL, listHref: LIST, now: 0 }) as PanelElement;
    expect(element.type).toBe(UnpaidActionsPanel);
    expect(element.props.order).toBe(ORDER);
    expect(element.props.detailHref).toBe(DETAIL);
    element.props.onProcessed?.(unpaidProcessedNotice(ORDER, CONFIRMED));
    expect(hooks.processed).toBe(unpaidProcessedNotice(ORDER, CONFIRMED));
  });

  it('방금 처리한 주문이 목록에서 빠지면 그 자리에 처리 결과와 주문 상세 링크를 보인다', () => {
    hooks.processed = unpaidProcessedNotice(ORDER, CONFIRMED);
    const html = renderToStaticMarkup(UnpaidSelectedOrder({ order: null, detailHref: DETAIL, listHref: LIST }));
    expect(html).toContain('id="unpaid-actions"');
    expect(html).toContain('data-admin-notice="success"');
    expect(html).toContain('주문 20261126140710000001 · 입금을 확인해 주문을 결제완료로 확정했습니다. 처리가 끝나 이 목록에서 빠졌습니다.');
    expect(html).toMatch(new RegExp(`<a[^>]*href="${DETAIL}"[^>]*>주문 상세</a>`));
    expect(html).toMatch(new RegExp(`<a[^>]*href="${LIST}"[^>]*>목록으로</a>`));
    expect(html).not.toContain('고른 주문이 목록에 없습니다');
    expect(html).not.toContain('이미 처리됐을 수 있어요');
  });

  it('이 화면에서 처리한 적이 없는 주문이 목록에 없으면 이미 처리됐을 수 있다고 말한다', () => {
    const html = renderToStaticMarkup(UnpaidSelectedOrder({ order: null, detailHref: DETAIL, listHref: LIST }));
    expect(html).toContain('data-admin-notice="warning"');
    expect(html).toContain('고른 주문이 목록에 없습니다. 이미 처리됐을 수 있어요.');
    expect(html).toMatch(new RegExp(`<a[^>]*href="${DETAIL}"[^>]*>주문 상세에서 처리 결과 확인</a>`));
  });

  it('주문 번호 꼴이 아닌 값이면 상세로 잇지 않는다', () => {
    const gone = renderToStaticMarkup(<UnpaidSelectionNotice detailHref={null} listHref={LIST} processed={null} />);
    expect(gone).not.toContain('주문 상세');
    const done = renderToStaticMarkup(<UnpaidSelectionNotice detailHref={null} listHref={LIST} processed="처리했습니다." />);
    expect(done).not.toContain('주문 상세');
    expect(done).toContain('목록으로');
  });
});
