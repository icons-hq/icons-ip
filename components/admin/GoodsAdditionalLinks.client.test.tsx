import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/* 추가 구성 상품 연결 목록: 공용 상품 선택창으로 고르고, 목록은 사진·상품명·상품 자동코드로 보이며, 내부 번호(상품 URL)는 보이지 않는다. */
const hooks = vi.hoisted(() => ({ states: [] as unknown[], index: 0 }));
const mocks = vi.hoisted(() => ({ check: vi.fn() }));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.states)) hooks.states[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    return [hooks.states[index], (next: unknown) => { hooks.states[index] = typeof next === 'function' ? (next as (value: unknown) => unknown)(hooks.states[index]) : next; }];
  },
}));
vi.mock('@/app/admin/goods-additional-actions', () => ({ checkGoodsAdditionalCandidateAction: mocks.check }));
vi.mock('@/app/admin/goods-option-import-actions', () => ({ searchGoodsOptionImportAction: vi.fn() }));

import type { AdminAdditionalGood } from '@/lib/admin/goods-additional';
import { MAX_ADDITIONAL_GOODS } from '@/lib/admin/goods-additional';
import { AdminGoodsPicker, type AdminGoodsPickerRow } from './AdminGoodsPicker';
import { GOODS_ADDITIONAL_INTRO, GoodsAdditionalLinks, ADDITIONAL_NOT_SELLABLE_REASON } from './GoodsAdditionalLinks';

type Element = ReactElement<Record<string, unknown>>;
const nodes = (node: ReactNode): Element[] => Children.toArray(node).flatMap(value => isValidElement<Record<string, unknown>>(value) ? [value, ...nodes(value.props.children as ReactNode)] : []);
const text = (node: ReactNode): string => Children.toArray(node).map(value => isValidElement<Record<string, unknown>>(value) ? text(value.props.children as ReactNode) : String(value)).join('');

const label = (id: string) => id.replace(/^g-/, '').toUpperCase();
const good = (id: string, extra: Partial<AdminGoodsPickerRow> = {}): AdminGoodsPickerRow => ({ id, code: `HW-${label(id)}`, name: `상품 ${label(id)}`, categoryName: null, imageUrl: null, published: true, ...extra });
const linked = (id: string, extra: Partial<AdminAdditionalGood> = {}): AdminAdditionalGood => ({ goodId: id, name: `상품 ${label(id)}`, available: true, code: `HW-${label(id)}`, imageUrl: `/img/${id}.png`, ...extra });

let current: AdminAdditionalGood[], baseGoodId: string | null, disabled: boolean;
const onChange = (update: (list: AdminAdditionalGood[]) => AdminAdditionalGood[]) => { current = update(current); };
function view() {
  hooks.index = 0;
  const tree = GoodsAdditionalLinks({ baseGoodId, items: current, onChange, disabled });
  const all = nodes(tree);
  const button = (label: string) => all.find(node => node.type === 'button' && (text(node.props.children as ReactNode) === label || node.props['aria-label'] === label))!;
  return { all, button, text: text(tree), picker: all.find(node => node.type === AdminGoodsPicker) as ReactElement<React.ComponentProps<typeof AdminGoodsPicker>> | undefined };
}
const press = (node: Element) => (node.props.onClick as () => void)();
function open() { press(view().button('추가구성상품 찾기')); return view().picker!; }

beforeEach(() => { hooks.states = []; hooks.index = 0; mocks.check.mockReset(); current = [linked('g-a'), linked('g-b', { available: false, imageUrl: null })]; baseGoodId = 'g-base'; disabled = false; });

describe('연결 목록', () => {
  it('사진·상품명·상품 자동코드로 보이고 내부 번호는 보이지 않는다', () => {
    const { all, text: shown } = view();
    expect(shown).toContain('연결 순서 · 2/50');
    expect(shown).toContain('상품 A');
    expect(shown).toContain('HW-A');
    for (const internal of ['g-a', 'g-b', 'g-base']) expect(shown).not.toContain(internal);
    const thumbs = all.filter(node => node.type === 'img');
    expect(thumbs.map(node => node.props.src)).toEqual(['/img/g-a.png']);
  });
  it('지금 고객이 살 수 없는 연결은 그렇게 알린다', () => {
    expect(view().text).toContain('HW-B · 지금은 고객이 살 수 없음');
  });
  it('연결한 상품이 없으면 한 줄로 말한다', () => {
    current = [];
    expect(view().text).toContain('연결한 상품이 없습니다.');
  });
  it('위로·아래로는 순서를 바꾸고 맨 위·맨 아래에서는 막힌다', () => {
    const v = view();
    expect(v.button('상품 A 위로 이동').props.disabled).toBe(true);
    expect(v.button('상품 B 아래로 이동').props.disabled).toBe(true);
    press(v.button('상품 A 아래로 이동'));
    expect(current.map(item => item.goodId)).toEqual(['g-b', 'g-a']);
    press(view().button('상품 A 위로 이동'));
    expect(current.map(item => item.goodId)).toEqual(['g-a', 'g-b']);
  });
  it('빼기는 그 상품만 연결 목록에서 뺀다', () => {
    press(view().button('상품 A 연결에서 빼기'));
    expect(current.map(item => item.goodId)).toEqual(['g-b']);
  });
  it('저장하는 중에는 찾기·순서·빼기가 모두 잠긴다', () => {
    disabled = true;
    const v = view();
    for (const label of ['추가구성상품 찾기', '상품 A 아래로 이동', '상품 A 연결에서 빼기']) expect(v.button(label).props.disabled, label).toBe(true);
  });
  it('안내 한 줄은 두 화면이 같은 말을 쓴다', () => {
    expect(GOODS_ADDITIONAL_INTRO).toBe('연결한 상품은 각자의 옵션·가격 그대로 팔립니다. 품절·판매 중지 상품은 고객에게 보이지 않습니다.');
  });
});

describe('상품 선택창', () => {
  it('찾기 버튼을 누르기 전에는 선택창이 없고, 누르면 여러 개 고르는 공용 상품 선택창이 열린다', () => {
    expect(view().picker).toBeUndefined();
    const picker = open();
    expect(picker.props).toMatchObject({ title: '추가구성상품 고르기', multiple: true, selectedKeys: ['g-a', 'g-b'] });
    expect(picker.props.blockedReason).toBeNull();
  });
  it('이미 연결한 상품은 막지 않고(선택됨), 지금 편집 중인 상품과 50개가 찬 뒤의 다른 상품은 이유와 함께 막는다', () => {
    const picker = open();
    const blocked = picker.props.rowBlocked!;
    expect(blocked(good('g-a'))).toBeNull();
    expect(blocked(good('g-base'))).toBe('지금 편집 중인 상품');
    expect(blocked(good('g-z'))).toBeNull();
    current = Array.from({ length: MAX_ADDITIONAL_GOODS }, (_, index) => linked(`g-${index}`));
    const full = view().picker!.props.rowBlocked!;
    expect(full(good('g-1'))).toBeNull();
    expect(full(good('g-z'))).toBe('최대 50개까지');
  });
  it('공개 전(초안) 상품은 눌러 보기 전에 줄에서 이유를 말하고, 확인 요청도 보내지 않는다', () => {
    const blocked = open().props.rowBlocked!;
    expect(blocked(good('g-draft', { published: false }))).toBe('공개 전 상품은 연결할 수 없음');
    expect(blocked(good('g-open', { published: true }))).toBeNull();
    expect(mocks.check).not.toHaveBeenCalled();
  });
  it('고를 수 있는 상품이면 연결 목록 맨 뒤에 사진·상품명·상품 자동코드와 함께 붙인다', async () => {
    mocks.check.mockResolvedValue({ ok: true, verdict: 'available' });
    const picker = open();
    const result = await picker.props.onSelect(good('g-c', { imageUrl: '/img/c.png' }));
    expect(result).toBeUndefined();
    expect(mocks.check).toHaveBeenCalledWith('g-base', 'g-c');
    expect(current.map(item => item.goodId)).toEqual(['g-a', 'g-b', 'g-c']);
    expect(current[2]).toEqual({ goodId: 'g-c', name: '상품 C', available: true, code: 'HW-C', imageUrl: '/img/c.png' });
    expect(view().picker!.props.footer).toBeNull();
  });
  it('저장 전인 새 상품은 기준 상품 없이 확인한다', async () => {
    baseGoodId = null;
    mocks.check.mockResolvedValue({ ok: true, verdict: 'available' });
    await open().props.onSelect(good('g-c'));
    expect(mocks.check).toHaveBeenCalledWith(null, 'g-c');
  });
  it('지금 고객이 살 수 없는 상품은 연결하지 않고 선택창 안에 이유를 보인다', async () => {
    mocks.check.mockResolvedValue({ ok: true, verdict: 'unavailable' });
    const picker = open();
    expect(await picker.props.onSelect(good('g-c'))).toBe(false);
    expect(current.map(item => item.goodId)).toEqual(['g-a', 'g-b']);
    const footer = view().picker!.props.footer as ReactElement<Record<string, unknown>>;
    expect(footer.props.role).toBe('alert');
    expect(text(footer.props.children as ReactNode)).toBe(`상품 C: ${ADDITIONAL_NOT_SELLABLE_REASON}`);
  });
  it('저장할 때 DB가 다시 가리는 경우(unknown)는 막지 않는다', async () => {
    mocks.check.mockResolvedValue({ ok: true, verdict: 'unknown' });
    await open().props.onSelect(good('g-c'));
    expect(current.map(item => item.goodId)).toEqual(['g-a', 'g-b', 'g-c']);
  });
  it('확인하지 못하면 연결하지 않고 그 이유를 보인다', async () => {
    mocks.check.mockResolvedValue({ ok: false, error: '연결할 수 있는 상품인지 확인하지 못했습니다. 잠시 뒤 다시 골라주세요.' });
    expect(await open().props.onSelect(good('g-c'))).toBe(false);
    expect(current).toHaveLength(2);
    expect(text((view().picker!.props.footer as Element).props.children as ReactNode)).toContain('다시 골라주세요');
  });
  it('확인하는 동안 같은 상품이 이미 들어왔거나 50개가 차면 더하지 않는다', async () => {
    mocks.check.mockImplementation(async () => { current = [...current, linked('g-c')]; return { ok: true, verdict: 'available' }; });
    await open().props.onSelect(good('g-c'));
    expect(current.filter(item => item.goodId === 'g-c')).toHaveLength(1);
    current = Array.from({ length: MAX_ADDITIONAL_GOODS }, (_, index) => linked(`g-${index}`));
    mocks.check.mockResolvedValue({ ok: true, verdict: 'available' });
    await view().picker!.props.onSelect(good('g-z'));
    expect(current).toHaveLength(MAX_ADDITIONAL_GOODS);
  });
  it('선택창의 [빼기]는 그 상품의 연결을 푼다', () => {
    open().props.onDeselect!(good('g-a'));
    expect(current.map(item => item.goodId)).toEqual(['g-b']);
  });
  it('닫으면 선택창과 남은 이유 글이 사라진다', async () => {
    mocks.check.mockResolvedValue({ ok: true, verdict: 'unavailable' });
    const picker = open();
    await picker.props.onSelect(good('g-c'));
    view().picker!.props.onClose();
    expect(view().picker).toBeUndefined();
    open();
    expect(view().picker!.props.footer).toBeNull();
  });
  it('저장하는 중에는 선택창이 열려 있어도 고를 수 없게 이유를 보인다', () => {
    const picker = open();
    expect(picker.props.blockedReason).toBeNull();
    disabled = true;
    expect(view().picker!.props.blockedReason).toContain('저장하는 중');
  });
});
