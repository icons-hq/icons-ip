import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/* 상품 없이 연 동영상·숏클립 화면: 안내 글 대신 공용 상품 선택창으로 상품을 고른다(화면 규칙 1). */
const hooks = vi.hoisted(() => ({ states: [] as unknown[], index: 0 }));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.states)) hooks.states[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    return [hooks.states[index], (next: unknown) => { hooks.states[index] = typeof next === 'function' ? (next as (value: unknown) => unknown)(hooks.states[index]) : next; }];
  },
}));
vi.mock('@/app/admin/goods-option-import-actions', () => ({ searchGoodsOptionImportAction: vi.fn() }));

import { AdminGoodsPicker, type AdminGoodsPickerRow } from '@/components/admin/AdminGoodsPicker';
import { AdminPageHeader } from '@/components/admin/console/AdminKit';
import { GoodsMediaGoodChooser } from './GoodsMediaGoodChooser';

type Element = ReactElement<Record<string, unknown>>;
const nodes = (node: ReactNode): Element[] => Children.toArray(node).flatMap(value => isValidElement<Record<string, unknown>>(value) ? [value, ...nodes(value.props.children as ReactNode)] : []);
const text = (node: ReactNode): string => Children.toArray(node).map(value => isValidElement<Record<string, unknown>>(value) ? text(value.props.children as ReactNode) : String(value)).join('');

function view() {
  hooks.index = 0;
  const all = nodes(GoodsMediaGoodChooser());
  const header = all.find(node => node.type === AdminPageHeader)!;
  return { all, header, picker: all.find(node => node.type === AdminGoodsPicker) as ReactElement<Record<string, unknown>> | undefined,
    open: nodes(header.props.actions as ReactNode).find(node => text(node.props.children as ReactNode) === '상품 고르기')! };
}
const good: AdminGoodsPickerRow = { id: 'good-a b', code: 'G10', name: '미니 피규어팩', categoryName: null, imageUrl: null, published: true };

beforeEach(() => { hooks.states = []; hooks.index = 0; });

describe('상품 동영상·숏클립 — 상품 없이 열었을 때', () => {
  it('버튼 하나로 상품 선택창을 열고, 열기 전에는 선택창이 없다', () => {
    const closed = view();
    expect(closed.header.props.title).toBe('상품 동영상·숏클립');
    expect(closed.picker).toBeUndefined();
    (closed.open.props.onClick as () => void)();
    const opened = view();
    expect(opened.picker).toBeDefined();
    expect(opened.picker!.props.title).toBe('상품 고르기');
    /* 보관한 상품은 동영상을 저장할 수 없고 선택창 조회에서도 빠진다(규칙 2) — 그 사실을 한 줄로 알린다. */
    expect(opened.picker!.props.excludedNote).toBe('보관한 상품은 목록에서 뺐습니다.');
    (opened.picker!.props.onClose as () => void)();
    expect(view().picker).toBeUndefined();
  });

  it('줄 버튼은 [선택]이고, 고르면 그 상품의 동영상·숏클립 화면으로 간다', () => {
    (view().open.props.onClick as () => void)();
    const row = (view().picker!.props.rowAction as (good: AdminGoodsPickerRow, state: { busy: boolean }) => ReactElement<Record<string, unknown>>)(good, { busy: false });
    expect(text(row.props.children as ReactNode)).toBe('선택');
    expect(row.props.href).toBe('/admin/catalog/goods/media?goodId=good-a%20b');
    expect(row.props['aria-label']).toBe('미니 피규어팩 선택');
  });
});
