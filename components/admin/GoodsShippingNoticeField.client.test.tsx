import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ state: [] as unknown[], stateIndex: 0, refs: [] as { current: unknown }[], refIndex: 0, effects: [] as (() => void)[] }));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useEffect: (effect: () => void) => { hooks.effects.push(effect); },
  useState: (initial: unknown) => {
    const index = hooks.stateIndex++;
    if (!(index in hooks.state)) hooks.state[index] = initial;
    return [hooks.state[index], (next: unknown) => { hooks.state[index] = next; }];
  },
  useRef: (initial: unknown) => { const index = hooks.refIndex++; hooks.refs[index] ??= { current: initial }; return hooks.refs[index]; },
}));
vi.mock('next/link', () => ({ default: () => null }));

import { AdminPickedBox } from './AdminPickedValue';
import { AdminPickerDialog, type AdminPickerPanelProps } from './console/AdminPickerDialog';
import { GoodsShippingNoticeField, type GoodsShippingNoticeOption } from './GoodsShippingNoticeField';

type Fn = (...args: unknown[]) => unknown;
type Props = { children?: ReactNode; type?: string; onClick?: Fn; 'data-goods-shipping-notice-unlisted'?: string };
type BoxProps = Parameters<typeof AdminPickedBox>[0];
type DialogProps = AdminPickerPanelProps<GoodsShippingNoticeOption> & { title: string };

function all(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(all);
  return isValidElement<Props>(node) ? [node, ...all(node.props.children)] : [];
}
const texts = (node: ReactNode): string[] => Array.isArray(node) ? node.flatMap(texts)
  : typeof node === 'string' || typeof node === 'number' ? [String(node)]
    : isValidElement<Props>(node) ? texts(node.props.children) : [];

const option = (code: string, version: number, name: string) => ({ id: `${code}-${version}`, code, version, name, shippingNotice: `${name} 본문`, returnExchangeNotice: '교환 안내', csName: 'CS', csPhone: '0212345678', csEmail: 'cs@example.test' }) as GoodsShippingNoticeOption;
const options = [option('basic', 2, '기본 배송'), option('figure', 1, '피규어 안내'), option('figure', 2, '피규어 안내')];
let props: Partial<Parameters<typeof GoodsShippingNoticeField>[0]> = {};
/** 한 번 그리고 그 뒤의 effect까지 돌린다(커밋 뒤). */
function render() {
  hooks.stateIndex = 0; hooks.refIndex = 0; hooks.effects = [];
  const tree = all(GoodsShippingNoticeField({ options, value: '', ...props }));
  for (const effect of hooks.effects) effect();
  return tree;
}
const box = () => render().find((item) => item.type === AdminPickedBox) as unknown as ReactElement<BoxProps>;
const dialog = () => render().find((item) => item.type === AdminPickerDialog) as unknown as ReactElement<DialogProps> | undefined;
const reset = () => render().find((item) => item.type === 'button' && texts(item).join('') === '기본 안내로 되돌리기');
const unlisted = () => render().find((item) => item.props['data-goods-shipping-notice-unlisted'] !== undefined);
const open = () => { box().props.onOpen(); return dialog()!.props; };

beforeEach(() => { hooks.state = []; hooks.refs = []; hooks.effects = []; props = {}; });

describe('배송·교환·반품 안내 템플릿 고르기', () => {
  it('[템플릿 고르기]가 공용 선택창을 열고 닫으면 닫힌다', () => {
    expect(box().props).toMatchObject({ name: 'shippingNoticeTemplate', value: '', text: '기본 안내', pickLabel: '템플릿 고르기' });
    expect(dialog()).toBeUndefined();
    const picker = open();
    expect(picker).toMatchObject({ title: '배송·교환·반품 안내 템플릿 고르기', searchPlaceholder: '템플릿 이름으로 찾기', emptyText: '맞는 템플릿이 없습니다. 템플릿은 ‘배송 안내 템플릿 관리’에서 만듭니다.' });
    expect(picker.selectLabel).toBeUndefined();
    /* 칸 아래에 늘 있던 안내는 고르는 순간에만 보인다. */
    expect(picker.description).toBe('고르면 상품 상세의 배송·교환·반품 안내 글이 바뀝니다. 배송비와 회수 주소는 출고지 설정을 따릅니다.');
    expect(picker.excludedNote).toBe('확인이 끝나지 않은 템플릿은 목록에서 뺐습니다.');
    picker.onClose();
    expect(dialog()).toBeUndefined();
  });

  it('목록은 받은 템플릿을 이름으로 찾고, 이름이 같은 템플릿은 줄마다 다른 값으로 가린다', async () => {
    const picker = open();
    const page = await picker.load({ query: '', field: '', filter: '', page: 1 });
    expect(page).toMatchObject({ total: 3, page: 1, pageSize: 20 });
    const found = await picker.load({ query: '피규어', field: '', filter: '', page: 1 });
    expect('rows' in found && found.rows.map(picker.rowKey)).toEqual(['figure@1', 'figure@2']);
    expect(picker.rowView(options[1])).toEqual({ title: '피규어 안내', meta: '피규어 안내 본문' });
  });

  it('고르면 상자와 숨은 칸이 바뀌고, 반영된 뒤 숨은 칸에서 input 이벤트가 나가 요약과 미리보기가 새 안내를 읽는다', () => {
    const dispatchEvent = vi.fn();
    (box().props.inputRef as { current: unknown }).current = { dispatchEvent };
    const picker = open();
    expect(picker.selectedKeys).toBeUndefined();
    expect(picker.onSelect(options[2])).toBeUndefined();
    expect(dispatchEvent).not.toHaveBeenCalled();
    expect(box().props).toMatchObject({ value: 'figure@2', text: '피규어 안내' });
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    expect((dispatchEvent.mock.calls[0][0] as Event).type).toBe('input');
    expect(dialog()!.props.selectedKeys).toEqual(['figure@2']);
  });

  it('[기본 안내로 되돌리기]는 고른 템플릿이 있을 때만 보이고, 누르면 값을 비운다', () => {
    expect(reset()).toBeUndefined();
    props = { value: 'basic@2' };
    hooks.state = [];
    const dispatchEvent = vi.fn();
    (box().props.inputRef as { current: unknown }).current = { dispatchEvent };
    const button = reset()!;
    expect(button.props.type).toBe('button');
    button.props.onClick!();
    expect(box().props).toMatchObject({ value: '', text: '기본 안내' });
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    expect(reset()).toBeUndefined();
  });
});

describe('목록에 없는 예전 안내', () => {
  it('적용 중인 안내는 목록에 없어도 값이 그대로 남고, 선택창에는 선택됨 표시가 없다', () => {
    props = { value: 'figure@0', currentName: '피규어 안내' };
    expect(box().props).toMatchObject({ value: 'figure@0', text: '피규어 안내' });
    expect(texts(unlisted()!).join('')).toBe('지금 적용 중인 안내는 템플릿 목록에 없습니다. 바꾸지 않으면 저장해도 그대로 유지됩니다.');
    expect(open().selectedKeys).toBeUndefined();
  });

  it('다른 템플릿을 고르거나 기본 안내로 되돌리면 그 안내는 사라진다', () => {
    props = { value: 'figure@0', currentName: '피규어 안내' };
    open().onSelect(options[0]);
    expect(box().props).toMatchObject({ value: 'basic@2', text: '기본 배송' });
    expect(unlisted()).toBeUndefined();
    reset()!.props.onClick!();
    expect(box().props.text).toBe('기본 안내');
    expect(unlisted()).toBeUndefined();
  });
});
