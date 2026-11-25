import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* 진열 순서: 번호 칸 + [지금 순서 보기]. 지금 순서를 보며 [이 앞에 두기]로 번호를 넣고, 번호를 넣으면 같은 번호를 쓰는 상품을 한 줄로 알린다. */
type Effect = { deps: unknown[]; effect: () => void | (() => void); cleanup?: () => void };
const hooks = vi.hoisted(() => ({ states: [] as unknown[], index: 0, refs: [] as { current: unknown }[], refIndex: 0, effects: [] as Effect[], effectIndex: 0, changed: [] as number[] }));
const mocks = vi.hoisted(() => ({ list: vi.fn(), slot: vi.fn() }));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.states)) hooks.states[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    return [hooks.states[index], (next: unknown) => { hooks.states[index] = typeof next === 'function' ? (next as (value: unknown) => unknown)(hooks.states[index]) : next; }];
  },
  useRef: (initial: unknown) => { const index = hooks.refIndex++; hooks.refs[index] ??= { current: initial }; return hooks.refs[index]; },
  useId: () => 'display-order',
  useEffect: (effect: () => void | (() => void), deps: unknown[] = []) => {
    const index = hooks.effectIndex++, previous = hooks.effects[index];
    if (!previous || deps.some((dep, at) => dep !== previous.deps[at])) { hooks.effects[index] = { deps, effect, cleanup: previous?.cleanup }; hooks.changed.push(index); }
  },
}));
vi.mock('@/app/admin/goods-display-order-actions', () => ({ listGoodsDisplayOrderAction: mocks.list, readGoodsDisplayOrderSlotAction: mocks.slot }));

import { GOOD_EDITOR_HELP } from '@/lib/admin/help/good-editor';
import type { GoodsDisplayOrderRow } from '@/lib/admin/goods-display-order';
import { AdminPickerDialog } from './console/AdminPickerDialog';
import { GoodReadback } from './GoodEditorParts';
import { GoodDisplayOrderField } from './GoodDisplayOrderField';

type Element = ReactElement<Record<string, unknown>>;
const nodes = (node: ReactNode): Element[] => Children.toArray(node).flatMap(value => isValidElement<Record<string, unknown>>(value) ? [value, ...nodes(value.props.children as ReactNode)] : []);
const text = (node: ReactNode): string => Children.toArray(node).map(value => isValidElement<Record<string, unknown>>(value) ? text(value.props.children as ReactNode) : String(value)).join('');
type Props = Parameters<typeof GoodDisplayOrderField>[0];
type PickerProps = { load: (request: { query: string; field: string; filter: string; page: number }) => Promise<unknown>; rowView: (row: GoodsDisplayOrderRow) => { title: ReactNode; meta: ReactNode; imageUrl?: string | null };
  rowAction: (row: GoodsDisplayOrderRow, state: { busy: boolean }) => ReactNode; rowKey: (row: GoodsDisplayOrderRow) => string; onClose: () => void; title: string; description: string; excludedNote: string; emptyText: string; showImages: boolean };

let props: Props;
const row = (id: string, order: number, previousOrder: number | null, extra: Partial<GoodsDisplayOrderRow> = {}): GoodsDisplayOrderRow => ({ id, name: `상품 ${id.toUpperCase()}`, imageUrl: `/img/${id}.png`, order, previousOrder, published: true, ...extra });
function view() {
  hooks.index = 0; hooks.refIndex = 0; hooks.effectIndex = 0;
  const tree = GoodDisplayOrderField(props) as Element;
  const all = nodes(tree);
  return {
    tree, all, input: all.find(node => node.type === 'input' && node.props.name === 'displayOrder')!,
    button: (label: string) => all.find(node => node.type === 'button' && text(node.props.children as ReactNode) === label),
    picker: all.find(node => node.type === AdminPickerDialog) as ReactElement<PickerProps> | undefined,
    readback: all.filter(node => node.type === GoodReadback).map(node => text(node.props.children as ReactNode)),
  };
}
/** 바뀐 효과를 실행한다(이전 정리 먼저). 타이머를 쓰는 효과는 가짜 시간으로 흘린다. */
function effects() { for (const index of hooks.changed.splice(0)) { const item = hooks.effects[index]; item.cleanup?.(); item.cleanup = item.effect() || undefined; } }
const type = (value: string) => { (view().input.props.onChange as (event: { currentTarget: { value: string } }) => void)({ currentTarget: { value } }); };
const press = (node: Element | undefined) => (node!.props.onClick as () => void)();
const openPicker = () => { press(view().button('지금 순서 보기')); return view().picker!; };

beforeEach(() => {
  hooks.states = []; hooks.refs = []; hooks.effects = []; hooks.changed = []; hooks.index = 0; hooks.refIndex = 0; hooks.effectIndex = 0;
  mocks.list.mockReset(); mocks.slot.mockReset(); vi.useFakeTimers();
  props = { defaultValue: 4, goodId: 'hw-self' };
});
afterEach(() => { for (const item of hooks.effects) item.cleanup?.(); vi.useRealTimers(); });

describe('번호 칸', () => {
  it('폼 이름·0 이상의 정수·저장된 값은 그대로이고, 칸 이름 옆 "?"와 칸 아래 한 줄 설명을 단다', () => {
    const { tree, input } = view();
    expect(input.props).toMatchObject({ name: 'displayOrder', type: 'number', min: 0, defaultValue: '4', id: 'display-order' });
    expect(tree.props).toMatchObject({ label: '진열 순서 (선택)', hint: '숫자가 작을수록 앞 · 비우면 숫자를 넣은 상품 뒤', help: GOOD_EDITOR_HELP.displayOrder, inputId: 'display-order' });
  });
  it('값이 없으면 빈 칸이고 0도 값이다', () => {
    props = { defaultValue: null, goodId: null };
    expect(view().input.props.defaultValue).toBe('');
    hooks.states = []; props = { defaultValue: 0, goodId: null };
    expect(view().input.props.defaultValue).toBe('0');
    hooks.states = []; props = { goodId: null };
    expect(view().input.props.defaultValue).toBe('');
  });
  it('저장 오류는 칸 아래에 알리고 설명과 함께 읽히게 한다', () => {
    props = { ...props, error: '진열 순서는 0 이상의 정수여야 합니다.' };
    const { tree, input } = view();
    expect(tree.props.error).toBe('진열 순서는 0 이상의 정수여야 합니다.');
    expect(input.props['aria-invalid']).toBe(true);
    expect(input.props['aria-describedby']).toBe('display-order-hint display-order-error');
  });
});

describe('지금 순서 보기', () => {
  it('누르기 전에는 선택창이 없고 누르면 지금 순서 선택창이 열린다', () => {
    expect(view().picker).toBeUndefined();
    const picker = openPicker();
    expect(picker.props).toMatchObject({ title: '지금 진열 순서', showImages: true, emptyText: '진열 순서를 넣은 상품이 아직 없습니다.', excludedNote: '보관한 상품과 진열 순서를 넣지 않은 상품은 목록에서 뺐습니다.' });
    expect(picker.props.description).toContain('숫자가 작은 상품부터 고객 화면의 추천순 앞쪽에 나옵니다.');
    expect(picker.props.description).toBe('숫자가 작은 상품부터 고객 화면의 추천순 앞쪽에 나옵니다. [이 앞에 두기]를 누르면 그 상품보다 한 칸 앞 번호가 진열 순서 칸에 들어갑니다.');
  });
  it('목록은 서버의 순서 조회로 읽고, 실패하면 그 이유를 창 안에 돌려준다', async () => {
    const page = { rows: [row('hw-a', 1, null)], total: 1, page: 1, pageSize: 20 };
    mocks.list.mockResolvedValueOnce({ ok: true, data: page }).mockResolvedValueOnce({ ok: false, error: '진열 순서를 불러오지 못했습니다. 잠시 뒤 다시 열어주세요.' });
    const picker = openPicker();
    expect(await picker.props.load({ query: '키링', field: '', filter: '', page: 2 })).toBe(page);
    expect(mocks.list).toHaveBeenCalledWith({ query: '키링', page: 2 });
    expect(await picker.props.load({ query: '', field: '', filter: '', page: 1 })).toEqual({ error: '진열 순서를 불러오지 못했습니다. 잠시 뒤 다시 열어주세요.' });
  });
  it('줄에는 사진·상품명·번호를 보이고, 상품 URL은 줄을 알아보는 데만 쓰며 보이지 않는다', () => {
    const picker = openPicker();
    expect(picker.props.rowKey(row('hw-a', 3, null))).toBe('hw-a');
    const shown = picker.props.rowView(row('hw-a', 3, null));
    expect(shown).toEqual({ title: '상품 HW-A', meta: '3번', imageUrl: '/img/hw-a.png' });
    expect(picker.props.rowView(row('hw-b', 5, 3, { published: false })).meta).toBe('5번 · 초안');
    for (const entry of [row('hw-a', 3, null), row('hw-b', 5, 3)]) expect(`${text(picker.props.rowView(entry).title)}${text(picker.props.rowView(entry).meta)}`).not.toMatch(/hw-[ab]\b/);
  });
  it('지금 편집 중인 상품은 이 상품이라고 알리고 버튼을 두지 않는다', () => {
    const action = openPicker().props.rowAction(row('hw-self', 4, 2), { busy: false }) as Element;
    expect(action.type).toBe('span'); expect(text(action.props.children as ReactNode)).toBe('이 상품');
  });
  it('한 칸 앞 번호가 비어 있지 않은 줄은 버튼 대신 이유를 보인다', () => {
    const picker = openPicker();
    const reason = (entry: GoodsDisplayOrderRow) => { const action = picker.props.rowAction(entry, { busy: false }) as Element; return action.type === 'span' ? text(action.props.children as ReactNode) : 'button'; };
    expect(reason(row('hw-a', 5, 4))).toBe('바로 앞 번호를 쓰는 상품이 있음');
    expect(reason(row('hw-b', 5, 5))).toBe('같은 번호가 앞에 있음');
    expect(reason(row('hw-c', 0, null))).toBe('더 앞 번호 없음');
    expect(reason(row('hw-d', 5, 3))).toBe('button');
  });
  it('[이 앞에 두기]는 한 칸 앞 번호를 칸에 넣고 입력 이벤트를 내며 창을 닫고 어느 상품 앞인지 되읽어 준다', () => {
    const picker = openPicker();
    const dispatchEvent = vi.fn(); const input = { value: '4', dispatchEvent };
    hooks.refs[0].current = input;
    const button = picker.props.rowAction(row('hw-a', 6, 2, { name: '키링' }), { busy: false }) as Element;
    expect(button.props['aria-label']).toBe('키링 앞에 두기'); expect(text(button.props.children as ReactNode)).toBe('이 앞에 두기');
    press(button);
    expect(input.value).toBe('5');
    expect(dispatchEvent.mock.calls.map(([event]) => (event as Event).type)).toEqual(['input', 'change']);
    expect(dispatchEvent.mock.calls.every(([event]) => (event as Event).bubbles)).toBe(true);
    const after = view();
    expect(after.picker).toBeUndefined();
    expect(after.readback).toEqual(['‘키링’ 바로 앞에 둡니다. 그 상품은 지금 6번입니다.']);
  });
  it('번호를 직접 고치면 어느 상품 앞이라는 되읽기는 사라진다', () => {
    const picker = openPicker();
    hooks.refs[0].current = { value: '', dispatchEvent: vi.fn() };
    press(picker.props.rowAction(row('hw-a', 6, 2, { name: '키링' }), { busy: false }) as Element);
    type('9');
    expect(view().readback).toEqual([]);
  });
  it('닫으면 선택창이 사라진다', () => {
    openPicker().props.onClose();
    expect(view().picker).toBeUndefined();
  });
});

describe('번호를 쓰는 상품 되읽기', () => {
  it('저장된 값 그대로이거나 칸이 비었거나 정수가 아니면 묻지 않는다', async () => {
    view(); effects(); await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.slot).not.toHaveBeenCalled();
    for (const value of ['', '-1', '1.5', 'abc']) { type(value); view(); effects(); await vi.advanceTimersByTimeAsync(1000); }
    expect(mocks.slot).not.toHaveBeenCalled();
    expect(view().readback).toEqual([]);
  });
  it('번호를 바꾸고 잠깐 멈추면 그 번호를 쓰는 다른 상품을 물어 알린다', async () => {
    mocks.slot.mockResolvedValue({ ok: true, slot: { order: 7, names: ['키링', '스티커'], total: 2 } });
    type('7'); view(); effects();
    await vi.advanceTimersByTimeAsync(399);
    expect(mocks.slot).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.slot).toHaveBeenCalledWith({ order: 7, goodId: 'hw-self' });
    await vi.advanceTimersByTimeAsync(0);
    expect(view().readback).toEqual(['7번은 이미 쓰는 상품이 있습니다(키링, 스티커). 번호가 같은 상품끼리는 앞뒤를 정할 수 없습니다.']);
  });
  it('아무도 쓰지 않는 번호는 비어 있다고 알린다', async () => {
    mocks.slot.mockResolvedValue({ ok: true, slot: { order: 8, names: [], total: 0 } });
    type('8'); view(); effects(); await vi.advanceTimersByTimeAsync(400);
    expect(view().readback).toEqual(['8번은 아직 쓰는 상품이 없습니다.']);
  });
  it('새 상품은 제외할 상품 없이 묻는다', async () => {
    props = { defaultValue: null, goodId: null };
    mocks.slot.mockResolvedValue({ ok: true, slot: { order: 3, names: [], total: 0 } });
    type('3'); view(); effects(); await vi.advanceTimersByTimeAsync(400);
    expect(mocks.slot).toHaveBeenCalledWith({ order: 3, goodId: null });
  });
  it('계속 고치는 동안에는 마지막 번호만 묻는다', async () => {
    mocks.slot.mockResolvedValue({ ok: true, slot: { order: 12, names: [], total: 0 } });
    type('1'); view(); effects(); await vi.advanceTimersByTimeAsync(200);
    type('12'); view(); effects(); await vi.advanceTimersByTimeAsync(400);
    expect(mocks.slot).toHaveBeenCalledTimes(1); expect(mocks.slot).toHaveBeenCalledWith({ order: 12, goodId: 'hw-self' });
  });
  it('이전 번호의 늦은 응답은 지금 번호의 설명으로 보이지 않는다', async () => {
    let resolveFirst!: (value: unknown) => void;
    mocks.slot.mockReturnValueOnce(new Promise(resolve => { resolveFirst = resolve; }));
    type('7'); view(); effects(); await vi.advanceTimersByTimeAsync(400);
    type('9'); view(); effects();
    resolveFirst({ ok: true, slot: { order: 7, names: ['키링'], total: 1 } }); await vi.advanceTimersByTimeAsync(0);
    expect(view().readback).toEqual([]);
  });
  it('물어보지 못하면 조용히 설명만 뺀다', async () => {
    mocks.slot.mockResolvedValueOnce({ ok: false, error: '진열 순서를 불러오지 못했습니다.' });
    type('7'); view(); effects(); await vi.advanceTimersByTimeAsync(400);
    expect(view().readback).toEqual([]);
    mocks.slot.mockRejectedValueOnce(new Error('network'));
    type('8'); view(); effects(); await vi.advanceTimersByTimeAsync(400);
    expect(view().readback).toEqual([]);
  });
  it('저장된 값으로 되돌리면 설명을 걷는다', async () => {
    mocks.slot.mockResolvedValue({ ok: true, slot: { order: 7, names: ['키링'], total: 1 } });
    type('7'); view(); effects(); await vi.advanceTimersByTimeAsync(400);
    expect(view().readback).toHaveLength(1);
    type('4');
    expect(view().readback).toEqual([]);
  });
});
