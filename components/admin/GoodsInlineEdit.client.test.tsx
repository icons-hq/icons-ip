import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * 목록 칸 안 바로 수정(판매가·재고수량). QA2b: 입력이 현재 값 뒤에 이어 붙고(10009 + 12000 → 1,000,912,000원) 확인 없이 저장되던 결함.
 * 입력은 포커스에 전체 선택되고, 저장은 '이전 → 새 값' 확인을 거친 뒤에만 서버로 간다.
 */
const hooks = vi.hoisted(() => ({ states: [] as unknown[], index: 0, refs: [] as { current: unknown }[], refIndex: 0, tasks: [] as Promise<unknown>[] }));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.states)) hooks.states[index] = typeof initial === 'function' ? initial() : initial;
    return [hooks.states[index], (next: unknown) => { hooks.states[index] = typeof next === 'function' ? next(hooks.states[index]) : next; }];
  },
  useRef: (initial: unknown) => { const index = hooks.refIndex++; hooks.refs[index] ??= { current: initial }; return hooks.refs[index]; },
  useEffect: () => undefined,
  useId: () => 'id',
  useTransition: () => [false, (task: () => unknown) => { hooks.tasks.push(Promise.resolve(task())); }],
}));
const mocks = vi.hoisted(() => ({ preview: vi.fn(), commit: vi.fn(), read: vi.fn(), adjust: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('@/app/admin/goods-bulk-actions', () => ({ previewGoodsBulkAction: mocks.preview, commitGoodsBulkAction: mocks.commit, readGoodsBulkAction: mocks.read }));
vi.mock('@/app/admin/actions', () => ({ adjustAdminStockAction: mocks.adjust }));
vi.mock('./GoodsInlineDialogHost', () => ({ useGoodsInlineDialogs: () => null }));

import { setAdminConfirmHandler } from '@/lib/admin/confirm';
import { GoodsInlinePrice, GoodsInlineStock, InlineEditor } from './GoodsInlineEdit';

type El = ReactElement<Record<string, unknown>>;
const identity = { actorId: 'b9000000-0000-4000-8000-000000000001', sessionId: 'b9000000-0000-4000-8000-000000000002' };
const row = { id: 'good-a', name: '상품 A', code: 'A', price: 10000, nextPrice: 12000, priceMin: 10000, priceMax: 10000, nextMin: 12000, nextMax: 12000, published: true, archived: false, stopped: false, skip: null };
const confirmations: { title?: string; message: string }[] = [];
let answer = true;

function find(node: ReactNode, match: (el: El) => boolean): El | null {
  if (Array.isArray(node)) return node.map(child => find(child, match)).find(Boolean) ?? null;
  if (!isValidElement(node)) return null;
  const el = node as El;
  return match(el) ? el : find(el.props.children as ReactNode, match);
}
function renderEditor(element: El) {
  hooks.index = 0; hooks.refIndex = 0;
  const call = element.type as (props: unknown) => El;
  const editor = call(element.props);
  const form = find(editor, el => el.type === InlineEditor) ?? editor;
  return { editor: form, input: find(form.props.children as ReactNode, el => el.type === 'input')! };
}
async function settle() { await new Promise(resolve => setTimeout(resolve, 0)); while (hooks.tasks.length) { await hooks.tasks.shift(); await new Promise(resolve => setTimeout(resolve, 0)); } }
function formOf(name: string, value: string) { const form = new FormData(); form.set(name, value); return form; }

beforeEach(() => {
  vi.clearAllMocks(); hooks.states.length = 0; hooks.refs.length = 0; hooks.tasks.length = 0; confirmations.length = 0; answer = true;
  setAdminConfirmHandler(async request => { confirmations.push(request); return answer; });
  mocks.preview.mockImplementation(async (operationId: string, request: unknown) => ({ value: { state: 'ready', operationId, request, groups: [], goods: [row], expiresAt: '2026-10-27T00:15:00Z' } }));
  mocks.commit.mockImplementation(async (operationId: string) => ({ value: { state: 'completed', operationId, goodsCount: 1, groupsCount: 0, error: null } }));
  mocks.adjust.mockResolvedValue({ stockAdjustment: { adjustmentId: 'adj' } });
});

describe('목록 칸 안 바로 수정의 입력 안전', () => {
  const price = <GoodsInlinePrice goodId="good-a" goodName="상품 A" basePrice={10000} identity={identity} hasOptions={false} display="10,000원" />;
  const stock = <GoodsInlineStock goodId="good-a" goodName="상품 A" ipId="ip-a" variantId="b9000000-0000-4000-8000-000000000010" stockQty={7} />;

  it('판매가·재고수량 입력은 포커스를 받으면 값 전체를 선택해 타이핑이 값 뒤에 이어 붙지 않는다', () => {
    for (const element of [price, stock]) {
      const { input } = renderEditor(element as El);
      const select = vi.fn();
      (input.props.onFocus as (event: unknown) => void)({ currentTarget: { select } });
      expect(select).toHaveBeenCalledTimes(1);
    }
  });
  it('판매가 저장은 이전 → 새 판매가 확인을 받은 뒤에만 서버로 가고, 취소하면 보내지 않는다', async () => {
    const { editor } = renderEditor(price as El);
    answer = false;
    (editor.props.onSubmit as (form: FormData) => void)(formOf('price', '12000'));
    await settle();
    expect(confirmations).toHaveLength(1);
    expect(confirmations[0].message).toBe('상품 A의 판매가를 10,000원에서 12,000원으로 바꿉니다.');
    expect(mocks.preview).not.toHaveBeenCalled();
    answer = true;
    (editor.props.onSubmit as (form: FormData) => void)(formOf('price', '12000'));
    await settle();
    expect(mocks.preview).toHaveBeenCalledTimes(1);
    expect(mocks.commit).toHaveBeenCalledTimes(1);
  });
  it('값이 같거나 잘못된 판매가는 확인창 없이 처리한다', async () => {
    const { editor } = renderEditor(price as El);
    (editor.props.onSubmit as (form: FormData) => void)(formOf('price', '10000'));
    (editor.props.onSubmit as (form: FormData) => void)(formOf('price', '1000912000a'));
    await settle();
    expect(confirmations).toHaveLength(0);
    expect(mocks.preview).not.toHaveBeenCalled();
  });
  it('재고수량 저장도 이전 → 새 수량 확인을 받은 뒤에만 조정한다', async () => {
    const { editor } = renderEditor(stock as El);
    answer = false;
    (editor.props.onSubmit as (form: FormData) => void)(formOf('stockQty', '70'));
    await settle();
    expect(confirmations[0].message).toContain('7개에서 70개로 바꿉니다');
    expect(mocks.adjust).not.toHaveBeenCalled();
    answer = true;
    (editor.props.onSubmit as (form: FormData) => void)(formOf('stockQty', '70'));
    await settle();
    expect(mocks.adjust).toHaveBeenCalledTimes(1);
  });
});
