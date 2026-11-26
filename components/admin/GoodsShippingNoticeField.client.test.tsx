import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ state: [] as unknown[], stateIndex: 0, refs: [] as { current: unknown }[], refIndex: 0, effects: [] as (() => void)[] }));
const mocks = vi.hoisted(() => ({ list: vi.fn() }));
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
vi.mock('@/app/admin/shipping-notice-template-actions', () => ({ listShippingNoticeTemplateOptionsAction: mocks.list }));

import { AdminPickedBox } from './AdminPickedValue';
import { AdminPickerDialog, type AdminPickerPanelProps } from './console/AdminPickerDialog';
import { GoodsShippingNoticeField, type GoodsShippingNoticeOption } from './GoodsShippingNoticeField';

type Fn = (...args: unknown[]) => unknown;
type Props = { children?: ReactNode; type?: string; onClick?: Fn; 'data-goods-shipping-notice-unlisted'?: string; 'data-goods-shipping-notice-replaced'?: string; 'data-goods-shipping-notice-outdated'?: string };
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
const restore = () => render().find((item) => item.type === 'button' && texts(item).join('') === '원래 안내로');
const replaced = () => render().find((item) => item.props['data-goods-shipping-notice-replaced'] !== undefined);
const outdated = () => render().find((item) => item.props['data-goods-shipping-notice-outdated'] !== undefined);
const firstPage = { query: '', field: '', filter: '', page: 1 };

beforeEach(() => {
  hooks.state = []; hooks.refs = []; hooks.effects = []; props = {};
  /* 선택창을 열면 목록을 다시 읽는다. 기본은 화면을 열 때와 같은 목록이다. */
  mocks.list.mockReset().mockResolvedValue({ ok: true, options, pendingCount: 0 });
});

describe('배송·교환·반품 안내 템플릿 고르기', () => {
  it('[템플릿 고르기]가 공용 선택창을 열고 닫으면 닫힌다', () => {
    expect(box().props).toMatchObject({ name: 'shippingNoticeTemplate', value: '', text: '기본 안내', pickLabel: '템플릿 고르기' });
    expect(dialog()).toBeUndefined();
    const picker = open();
    expect(picker).toMatchObject({ title: '배송·교환·반품 안내 템플릿 고르기', searchPlaceholder: '템플릿 이름으로 찾기', emptyText: '맞는 템플릿이 없습니다. 템플릿은 ‘배송 안내 템플릿 관리’에서 만듭니다.' });
    expect(picker.selectLabel).toBeUndefined();
    /* 칸 아래에 늘 있던 안내는 고르는 순간에만 보인다. */
    expect(picker.description).toBe('고르면 상품 상세의 배송·교환·반품 안내 글이 바뀝니다. 배송비와 반품 주소는 바뀌지 않습니다.');
    /* 뺀 템플릿이 없으면 뺐다는 줄도 없다. */
    expect(picker.excludedNote).toBeUndefined();
    expect(picker.footer).toBeUndefined();
    picker.onClose();
    expect(dialog()).toBeUndefined();
  });

  it('목록은 받은 템플릿을 이름으로 찾고, 이름이 같은 템플릿은 줄마다 다른 값으로 가린다', async () => {
    const picker = open();
    const page = await picker.load(firstPage);
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
    props = { value: 'legacy@3', currentName: '피규어 안내' };
    expect(box().props).toMatchObject({ value: 'legacy@3', text: '피규어 안내' });
    expect(texts(unlisted()!).join('')).toBe('지금 적용 중인 안내는 템플릿 목록에 없습니다. 바꾸지 않으면 저장해도 그대로 유지됩니다.');
    expect(open().selectedKeys).toBeUndefined();
  });

  it('다른 템플릿을 고르거나 기본 안내로 되돌리면 그 안내는 사라진다', () => {
    props = { value: 'legacy@3', currentName: '피규어 안내' };
    open().onSelect(options[0]);
    expect(box().props).toMatchObject({ value: 'basic@2', text: '기본 배송' });
    expect(unlisted()).toBeUndefined();
    reset()!.props.onClick!();
    expect(box().props.text).toBe('기본 안내');
    expect(unlisted()).toBeUndefined();
  });

  /*
   * G2(2026-11-25 리뷰, 화면 규칙 7): 목록에 없는 안내는 선택창으로 다시 고를 수 없다. 무심코 [기본 안내로 되돌리기]를 누르면
   * 다른 수정까지 버리고 새로고침해야 돌아올 수 있었다. 바꾼 동안에는 [원래 안내로]로 되돌린다.
   */
  it('목록에 없는 안내를 다른 것으로 바꾼 동안에는 [원래 안내로]가 보이고, 누르면 처음 값으로 돌아온다', () => {
    props = { value: 'legacy@3', currentName: '피규어 안내' };
    /* 바꾸기 전에는 되돌릴 것이 없다. */
    expect(restore()).toBeUndefined(); expect(replaced()).toBeUndefined();
    reset()!.props.onClick!();
    expect(box().props).toMatchObject({ value: '', text: '기본 안내' });
    expect(texts(replaced()!).join('')).toBe('원래 쓰던 안내(피규어 안내)는 템플릿 목록에 없어 [템플릿 고르기]로는 다시 고를 수 없습니다. 되돌리려면 [원래 안내로]를 누릅니다.');
    const dispatchEvent = vi.fn();
    (box().props.inputRef as { current: unknown }).current = { dispatchEvent };
    expect(restore()!.props.type).toBe('button');
    restore()!.props.onClick!();
    expect(box().props).toMatchObject({ value: 'legacy@3', text: '피규어 안내' });
    /* 되돌린 값도 숨은 칸에서 input 이벤트로 알린다(요약·미리보기·이탈 경고가 다시 읽는다). */
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    expect(restore()).toBeUndefined(); expect(replaced()).toBeUndefined();
    expect(texts(unlisted()!).join('')).toContain('바꾸지 않으면 저장해도 그대로 유지됩니다.');
    /* 다른 템플릿을 고른 뒤에도 되돌릴 수 있다. */
    open().onSelect(options[0]);
    expect(box().props.value).toBe('basic@2');
    restore()!.props.onClick!();
    expect(box().props.value).toBe('legacy@3');
  });

  it('저장에 실패해 폼을 다시 그린 뒤에도 저장돼 있는 안내로 되돌릴 수 있다', () => {
    /* 편집기는 다시 그릴 때 제출했던 값(기본 안내)을 처음 값으로 준다. 되돌릴 곳은 저장돼 있는 값이다. */
    props = { value: '', savedValue: 'legacy@3', currentName: '피규어 안내' };
    expect(box().props).toMatchObject({ value: '', text: '기본 안내' });
    restore()!.props.onClick!();
    expect(box().props).toMatchObject({ value: 'legacy@3', text: '피규어 안내' });
  });

  it('저장돼 있는 안내가 목록에 있으면 선택창에서 다시 고르면 되므로 [원래 안내로]를 두지 않는다', () => {
    props = { value: 'figure@1', currentName: '피규어 안내' };
    open().onSelect(options[0]);
    expect(restore()).toBeUndefined(); expect(replaced()).toBeUndefined();
    reset()!.props.onClick!();
    expect(restore()).toBeUndefined();
  });
});

/*
 * N-4·N-6: 템플릿을 고치면 그 템플릿을 쓰는 상품도 함께 바뀌므로 드문 경우다(보관했다 복원한 상품, 예전 엑셀을 다시 올린 상품).
 * 같은 템플릿의 고치기 전 내용이 남아 있으면, 상품을 저장하면 지금 내용으로 바뀐다고 알린다.
 */
describe('같은 템플릿의 고치기 전 내용', () => {
  const latestOnly = [option('basic', 2, '기본 배송'), option('figure', 2, '피규어 안내')];

  it('값은 그대로 두고, 상품을 저장하면 지금 내용으로 바뀐다고 알린다', () => {
    props = { options: latestOnly, value: 'figure@1', currentName: '피규어 안내' };
    expect(box().props).toMatchObject({ value: 'figure@1', text: '피규어 안내' });
    expect(texts(outdated()!).join('')).toBe('이 상품에는 템플릿을 고치기 전 내용이 적용돼 있습니다. 상품을 저장하면 지금 내용으로 바뀝니다.');
    expect(unlisted()).toBeUndefined();
    open().onSelect(latestOnly[1]);
    expect(box().props).toMatchObject({ value: 'figure@2', text: '피규어 안내' });
    expect(outdated()).toBeUndefined();
  });
});

/* 0-3: 다른 탭에서 방금 만든 템플릿도 새로고침 없이 보인다. 선택창을 열 때마다 목록을 다시 읽는다. */
describe('선택창을 열 때 목록 다시 읽기', () => {
  const created = option('n-new', 1, '방금 만든 안내');

  it('다시 읽은 목록으로 선택창과 상자를 그리고, 편집기에 같은 목록을 알린다', async () => {
    const onOptionsChange = vi.fn();
    props = { onOptionsChange };
    mocks.list.mockResolvedValue({ ok: true, options: [...options, created], pendingCount: 0 });
    const picker = open();
    expect(mocks.list).not.toHaveBeenCalled();
    const page = await picker.load(firstPage);
    expect('rows' in page && page.rows.map(picker.rowKey)).toContain('n-new@1');
    expect(onOptionsChange).toHaveBeenCalledTimes(1);
    expect(onOptionsChange).toHaveBeenCalledWith([...options, created]);
    /* 새 템플릿을 고르면 상자에 그 이름이 보이고(목록에 없는 안내로 보이지 않는다), 값은 전처럼 코드@버전이다. */
    dialog()!.props.onSelect(created);
    expect(box().props).toMatchObject({ value: 'n-new@1', text: '방금 만든 안내' });
    expect(unlisted()).toBeUndefined();
    expect(dialog()!.props.selectedKeys).toEqual(['n-new@1']);
  });

  it('한 번 연 창에서는 한 번만 읽고(검색·페이지 이동은 그 목록을 쓴다), 다시 열면 다시 읽는다', async () => {
    const picker = open();
    await picker.load(firstPage);
    await dialog()!.props.load({ ...firstPage, query: '피규어' });
    await dialog()!.props.load({ ...firstPage, page: 2 });
    expect(mocks.list).toHaveBeenCalledTimes(1);
    dialog()!.props.onClose();
    await open().load(firstPage);
    expect(mocks.list).toHaveBeenCalledTimes(2);
  });

  it('아직 켜지 않은(준비 중) 템플릿이 있으면 목록에서 뺐다고 알린다', async () => {
    mocks.list.mockResolvedValue({ ok: true, options, pendingCount: 2 });
    await open().load(firstPage);
    expect(dialog()!.props.excludedNote).toBe('준비 중인 템플릿은 목록에서 뺐습니다. ‘배송 안내 템플릿 관리’에서 [수정]을 눌러 저장하면 고를 수 있습니다.');
  });

  it.each([
    ['거절', () => mocks.list.mockResolvedValue({ ok: false, error: '템플릿 목록을 새로 읽지 못했습니다.' })],
    ['연결 끊김', () => mocks.list.mockRejectedValue(new Error('network'))],
  ])('다시 읽지 못하면(%s) 화면을 열 때의 목록으로 열고 그렇다고 알린다', async (_name, fail) => {
    const onOptionsChange = vi.fn();
    props = { onOptionsChange };
    fail();
    const page = await open().load(firstPage);
    expect(page).toMatchObject({ total: 3 });
    expect(onOptionsChange).not.toHaveBeenCalled();
    expect(texts(dialog()!.props.footer).join('')).toBe('목록을 새로 읽지 못해 이 화면을 열 때의 목록을 보여 줍니다. 방금 만든 템플릿이 안 보이면 창을 닫고 다시 열어 주세요.');
  });

  it('화면이 새 목록을 내려 주면(저장 뒤 다시 그림) 그 목록을 쓴다', async () => {
    mocks.list.mockResolvedValue({ ok: true, options: [...options, created], pendingCount: 0 });
    await open().load(firstPage);
    dialog()!.props.onSelect(created);
    expect(box().props.text).toBe('방금 만든 안내');
    const renamed = [option('n-new', 2, '이름을 바꾼 안내')];
    props = { options: renamed };
    /* 고른 값(n-new@1)은 새 목록에 없는 버전이다 — 같은 템플릿의 고치기 전 내용으로 본다. */
    expect(box().props.text).toBe('지금 적용 중인 안내');
    expect(outdated()).toBeDefined();
  });
});
