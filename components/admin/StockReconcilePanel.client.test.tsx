import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* 재고 대조 패널: [처음부터 다시]는 열 연결을 손으로 바꾼 적이 있을 때만, 사라지는 개수를 보이며 묻는다(S-04). 전송이 끊겼을 때 안내는 버튼 이름으로 말한다. */
const hooks = vi.hoisted(() => ({ states: [] as unknown[], index: 0, refs: [] as { current: unknown }[], refIndex: 0 }));
const router = vi.hoisted(() => ({ refresh: vi.fn(), replace: vi.fn() }));
const actions = vi.hoisted(() => ({ preview: vi.fn(), apply: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/app/admin/stock-reconcile-actions', () => ({ readStockReconcileFileAction: vi.fn(), previewStockReconcileAction: actions.preview, applyStockReconcileAction: actions.apply }));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.states)) hooks.states[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    return [hooks.states[index], (next: unknown) => { hooks.states[index] = typeof next === 'function' ? (next as (value: unknown) => unknown)(hooks.states[index]) : next; }];
  },
  useRef: (initial: unknown) => { const index = hooks.refIndex++; hooks.refs[index] ??= { current: initial }; return hooks.refs[index]; },
  useMemo: (factory: () => unknown) => factory(),
  useTransition: () => [false, (callback: () => void) => { callback(); }],
}));

import { Button } from '@/components/admin/kit/ui/button';
import { stubAdminConfirm } from '@/lib/admin/confirm.test-support';
import { STOCK_RECONCILE_PATH, type StockReconcileDocument } from '@/lib/admin/stock-reconcile';
import { StockReconcilePanel } from './StockReconcilePanel';

type Element = ReactElement<Record<string, unknown>>;
const nodes = (node: ReactNode): Element[] => Children.toArray(node).flatMap(value => isValidElement<Record<string, unknown>>(value) ? [value, ...nodes(value.props.children as ReactNode)] : []);
const text = (node: ReactNode): string => Children.toArray(node).map(value => isValidElement<Record<string, unknown>>(value) ? text(value.props.children as ReactNode) : String(value)).join('');
const flush = async () => { for (let turn = 0; turn < 5; turn += 1) await Promise.resolve(); };

/* 기준 시각 기본값(지금)이 '미래 시각' 검사에 걸리지 않도록 실제 지금으로 그린다. */
const now = new Date().toISOString();
const item = { goodId: 'g1', goodsCode: 'G1', goodsName: '키링', sourceRow: 2, matchKind: 'option_code' as const, appliedDelta: null, stockAfter: null, preorder: false,
  returnedSinceQty: 0, awaitingReturnQty: 0, adjustedSinceCount: 0, adjustedSinceQty: 0, stockBefore: null, appliedPendingQty: null, appliedShippedSinceQty: null,
  appliedReturnedSinceQty: null, appliedAwaitingReturnQty: null };
const previewed = (changed: boolean): StockReconcileDocument => ({
  id: '60000000-0000-4000-8000-000000000001', originId: null, originName: null, sourceLabel: '서원 재고.xlsx', asOf: now, createdAt: now, createdByName: '운영자',
  rowCount: 1, matchedCount: 1, issueCount: 0, changedCount: changed ? 1 : 0, appliedAt: null, appliedByName: null, applyReason: null, applyResult: null, issues: [],
  items: [{ ...item, variantId: '60000000-0000-4000-8000-000000000011', optionName: '핑크', optionCode: 'G1-01', fileQty: 20, stockQty: changed ? 10 : 11,
    pendingQty: 8, shippedSinceQty: 1, difference: 1, targetQty: 11 }],
});

let initialSnapshot: StockReconcileDocument | null = null;
function view() {
  hooks.index = 0; hooks.refIndex = 0;
  const tree = StockReconcilePanel({ origins: [], initialSnapshot, now });
  const all = nodes(tree);
  return {
    text: text(tree),
    button: (label: string) => all.find(node => (node.type === Button || node.type === 'button') && text(node.props.children as ReactNode) === label),
    byId: (id: string) => all.find(node => node.props.id === id),
    byLabel: (label: string) => all.find(node => node.props['aria-label'] === label),
    alerts: () => all.filter(node => node.props.role === 'alert').map(node => text(node.props.children as ReactNode)),
  };
}
const change = (node: Element | undefined, value: string) => (node!.props.onChange as (event: { target: { value: string } }) => void)({ target: { value } });
const press = (node: Element | undefined) => (node!.props.onClick as () => void)();
/* 머리글로 읽는 표를 붙여넣어 확인한다. 열은 품번(ERP 코드)·품명(가져오지 않음)·재고수량(재고 수량)으로 자동 연결된다. */
function readPastedTable() {
  change(view().byId('stock-reconcile-paste'), '품번\t품명\t재고수량\n000123\t키링\t12');
  press(view().button('붙여넣은 표 확인'));
}
const restart = async () => { press(view().button('처음부터 다시')); await flush(); };

let confirm: ReturnType<typeof stubAdminConfirm>;
beforeEach(() => { hooks.states = []; hooks.index = 0; hooks.refs = []; hooks.refIndex = 0; router.replace.mockClear(); actions.preview.mockReset(); actions.apply.mockReset(); initialSnapshot = null; });
afterEach(() => confirm?.restore());

describe('재고 대조 — 처음부터 다시', () => {
  it('열 연결을 바꾸지 않았으면 묻지 않고 바로 비운다', async () => {
    confirm = stubAdminConfirm(false);
    readPastedTable();
    expect(view().button('처음부터 다시')).toBeDefined();
    await restart();
    expect(confirm).not.toHaveBeenCalled();
    expect(view().button('처음부터 다시')).toBeUndefined();
    expect(router.replace).toHaveBeenCalledWith(STOCK_RECONCILE_PATH, { scroll: false });
  });

  it('손으로 바꾼 열이 있으면 사라지는 개수를 보이며 묻고, 취소하면 그대로 둔다', async () => {
    confirm = stubAdminConfirm(false);
    readPastedTable();
    change(view().byLabel('품명 열의 항목'), 'barcode');
    await restart();
    expect(confirm).toHaveBeenCalledOnce();
    expect(confirm).toHaveBeenCalledWith('직접 바꾼 열 연결 1개가 사라집니다. 처음부터 다시 할까요?');
    expect(view().button('처음부터 다시')).toBeDefined();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('확인하면 비운다', async () => {
    confirm = stubAdminConfirm(true);
    readPastedTable();
    change(view().byLabel('품명 열의 항목'), 'barcode');
    change(view().byLabel('재고수량 열의 항목'), 'ignore');
    await restart();
    expect(confirm).toHaveBeenCalledWith('직접 바꾼 열 연결 2개가 사라집니다. 처음부터 다시 할까요?');
    expect(view().button('처음부터 다시')).toBeUndefined();
    expect(router.replace).toHaveBeenCalledWith(STOCK_RECONCILE_PATH, { scroll: false });
  });

  it('바꿨다가 자동 연결로 되돌리면 잃을 것이 없어 묻지 않는다', async () => {
    confirm = stubAdminConfirm(false);
    readPastedTable();
    change(view().byLabel('품명 열의 항목'), 'barcode');
    change(view().byLabel('품명 열의 항목'), 'ignore');
    await restart();
    expect(confirm).not.toHaveBeenCalled();
    expect(view().button('처음부터 다시')).toBeUndefined();
  });
});

describe('재고 대조 — 전송이 끊겼을 때', () => {
  it('미리보기를 만들다 끊기면 다시 미리보기 하라고만 안내한다(요청이라는 말을 쓰지 않는다)', async () => {
    confirm = stubAdminConfirm(true);
    actions.preview.mockRejectedValueOnce(new Error('offline'));
    readPastedTable();
    press(view().button('1줄 미리보기'));
    await flush();
    expect(actions.preview).toHaveBeenCalledOnce();
    expect(view().alerts()).toEqual(['미리보기를 만드는 중 연결이 끊겼습니다. 다시 미리보기 해주세요.']);
  });

  it.each([[true, '옵션 1개 재고 반영'], [false, '대조 기록만 남기기']])('반영 결과를 모르면 같은 사유로 [버튼 이름] 버튼을 다시 누르라고 안내한다(바뀌는 옵션 있음: %s)', async (changed, label) => {
    confirm = stubAdminConfirm(true);
    initialSnapshot = previewed(changed);
    actions.apply.mockRejectedValueOnce(new Error('offline'));
    press(view().button(label));
    await flush();
    expect(actions.apply).toHaveBeenCalledOnce();
    const [alert] = view().alerts();
    expect(alert).toBe(`반영됐는지 확인하지 못했습니다. 같은 사유로 [${label}] 버튼을 다시 누르면 두 번 반영되지 않고, 이미 반영됐다면 그 결과를 보여 줍니다.`);
    /* 안내가 가리키는 버튼이 화면에 그대로 있다. */
    expect(view().button(label)).toBeDefined();
  });
});
