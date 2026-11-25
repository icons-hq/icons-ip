import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ErpItemMatch } from '@/lib/admin/erp-items';

/*
 * 옵션의 ERP 품목 고르기(화면 규칙 1·2, F4). 버튼 부품은 함수로 불러 React 요소 트리를 걷는다(DOM 없음, useState만 흉내 낸다).
 * 공용 선택창 자체의 검색·쪽 이동·[선택] 동작은 console/AdminPickerDialog.test.tsx가 본다.
 */
const hooks = vi.hoisted(() => ({ enabled: false, state: [] as unknown[], index: 0, search: vi.fn() }));
vi.mock('@/app/admin/erp-item-picker-actions', () => ({ searchErpItemPickerAction: hooks.search }));
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return { ...actual, useState: (initial: unknown) => {
    if (!hooks.enabled) return actual.useState(initial);
    const index = hooks.index++;
    if (!(index in hooks.state)) hooks.state[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    return [hooks.state[index], (next: unknown) => { hooks.state[index] = typeof next === 'function' ? (next as (current: unknown) => unknown)(hooks.state[index]) : next; }];
  } };
});

const { ErpItemPickButton, erpItemPickSummary, erpItemRowView, loadErpItems } = await import('./ErpItemPicker');
const { AdminPickerDialog } = await import('./console/AdminPickerDialog');

type Element = ReactElement<Record<string, unknown>>;
function nodes(node: ReactNode): Element[] { return Children.toArray(node).flatMap((value) => isValidElement<Record<string, unknown>>(value) ? [value, ...nodes(value.props.children as ReactNode)] : []); }

const item: ErpItemMatch = { code: '000123', name: '아크릴 키링', category: '문구 > 키링', salePrice: 12000, barcode: '0880000000123', mappedCategoryId: 'leaf' };
const bare: ErpItemMatch = { code: 'K-2', name: '키링 거치대', category: null, salePrice: null, barcode: null, mappedCategoryId: null };

beforeEach(() => { hooks.enabled = false; hooks.state = []; hooks.index = 0; hooks.search.mockReset(); });

describe('ERP 품목 선택창 조회', () => {
  it('검색어와 쪽만 서버에 넘기고, 받은 쪽을 그대로 선택창에 준다', async () => {
    const data = { rows: [item], total: 41, page: 2, pageSize: 20 };
    hooks.search.mockResolvedValue({ ok: true, data });
    expect(await loadErpItems({ query: '키링', field: '', filter: '', page: 2 })).toBe(data);
    expect(hooks.search).toHaveBeenCalledExactlyOnceWith({ query: '키링', page: 2 });
  });

  it('조회에 실패하면 선택창 안에 보일 오류를 돌려준다', async () => {
    hooks.search.mockResolvedValue({ ok: false, error: 'ERP 품목을 불러오지 못했습니다. 잠시 뒤 다시 검색해주세요.' });
    expect(await loadErpItems({ query: '', field: '', filter: '', page: 1 })).toEqual({ error: 'ERP 품목을 불러오지 못했습니다. 잠시 뒤 다시 검색해주세요.' });
  });
});

describe('ERP 품목 선택창의 줄', () => {
  it('품명 아래에 고르면 들어갈 ERP 코드·바코드와 ERP 분류·판매가를 보인다', () => {
    expect(erpItemRowView(item)).toEqual({ title: '아크릴 키링', meta: '000123 · 바코드 0880000000123 · 문구 > 키링 · 판매가 12,000원' });
  });

  it('바코드가 없는 품목은 없다고 적고, 분류·판매가가 없으면 그 자리를 비운다', () => {
    expect(erpItemRowView(bare)).toEqual({ title: '키링 거치대', meta: 'K-2 · 바코드 없음' });
    expect(erpItemRowView({ ...bare, salePrice: 0 }).meta).toBe('K-2 · 바코드 없음 · 판매가 0원');
  });
});

describe('고른 ERP 품목 한 줄', () => {
  const row = { erpCode: '000123', erpName: '아크릴 키링', barcode: '0880000000123' };

  it('고른 품목의 ERP 코드와 함께 들어간 바코드를 되읽는다', () => {
    expect(erpItemPickSummary(row, item)).toEqual({ text: '고른 ERP 품목 · 000123 · 바코드 0880000000123', warning: false });
  });

  it('바코드가 없는 품목이면 그렇다고 알리고(적어 둔 바코드는 그대로다), 고른 뒤 바코드 칸을 비웠으면 바코드를 말하지 않는다', () => {
    expect(erpItemPickSummary({ erpCode: 'K-2', erpName: '키링 거치대', barcode: null }, bare)).toEqual({ text: '고른 ERP 품목 · K-2 · 바코드 없는 품목', warning: false });
    expect(erpItemPickSummary({ erpCode: 'K-2', erpName: '키링 거치대', barcode: '4900000000011' }, bare)).toEqual({ text: '고른 ERP 품목 · K-2 · 바코드 없는 품목', warning: false });
    expect(erpItemPickSummary({ ...row, barcode: ' ' }, item)).toEqual({ text: '고른 ERP 품목 · 000123', warning: false });
  });

  it('적어 둔 바코드가 품목과 달라 그대로 둔 경우는 품목의 바코드와 함께 경고로 알린다', () => {
    expect(erpItemPickSummary({ ...row, barcode: '4900000000011' }, item)).toEqual({
      text: '고른 ERP 품목 · 000123 · 바코드는 적어 둔 값을 그대로 뒀습니다. ERP 품목의 바코드는 0880000000123입니다.', warning: true,
    });
  });

  it('ERP 코드나 ERP 품명을 손으로 고친 줄은 더는 고른 품목이 아니다', () => {
    expect(erpItemPickSummary({ ...row, erpCode: '000123-A' }, item)).toBeNull();
    expect(erpItemPickSummary({ ...row, erpName: '아크릴 키링 (수정)' }, item)).toBeNull();
    expect(erpItemPickSummary({ erpCode: null, erpName: null, barcode: null }, item)).toBeNull();
  });
});

describe('ERP 품목 고르기 버튼', () => {
  const props = { ariaLabel: '옵션 2 ERP 품목 고르기', target: '옵션 2(파랑)', onSelect: vi.fn(), blockedReason: (picked: ErpItemMatch) => picked.code === 'K-2' ? '다른 옵션에 넣은 품목' : null };
  function render(overrides: Partial<typeof props> = {}) { hooks.index = 0; return nodes(ErpItemPickButton({ ...props, ...overrides })); }
  const button = (tree: Element[]) => tree.find((node) => node.type === 'button')!;
  const dialog = (tree: Element[]) => tree.find((node) => node.type === AdminPickerDialog);
  beforeEach(() => { props.onSelect.mockClear(); });

  it('닫혀 있을 때는 폼을 제출하지 않는 버튼 하나만 그린다', () => {
    const html = renderToStaticMarkup(<ErpItemPickButton {...props} />);
    expect(html).toMatch(/^<button type="button"[^>]*data-erp-item-picker=""[^>]*aria-label="옵션 2 ERP 품목 고르기"[^>]*>ERP 품목 고르기<\/button>$/);
  });

  it('누르면 공용 선택창이 열리고, 어느 옵션에 무엇이 들어가는지 창 맨 위에서 말한다', () => {
    hooks.enabled = true;
    expect(dialog(render())).toBeUndefined();
    (button(render()).props.onClick as () => void)();
    const opened = dialog(render())!;
    expect(opened.props).toMatchObject({
      title: 'ERP 품목 고르기',
      description: '옵션 2(파랑)에 넣을 ERP 품목을 고릅니다. ERP 코드와 ERP 품명이 고른 품목 값으로 바뀌고, 바코드는 칸이 비어 있을 때만 들어갑니다.',
      searchPlaceholder: 'ERP 품명·ERP 코드',
      emptyText: '맞는 ERP 품목이 없습니다. ‘ERP 품목’ 메뉴에 올린 품목만 나옵니다. 없는 품목은 창을 닫고 ERP 코드·바코드·ERP 품명 칸에 직접 적습니다.',
      load: loadErpItems,
      rowView: erpItemRowView,
    });
    expect((opened.props.rowKey as (picked: ErpItemMatch) => string)(item)).toBe('000123');
    /* 다른 옵션이 쓰는 품목은 줄에 이유를 보이고 고를 수 없다. 여러 개 고르기·이미 고른 줄 표시는 쓰지 않는다(자기 줄의 품목은 다시 고를 수 있다). */
    expect(opened.props.rowBlocked).toBe(props.blockedReason);
    expect(opened.props.multiple).toBeUndefined();
    expect(opened.props.selectedKeys).toBeUndefined();
  });

  it('옵션 없는 상품은 대상 이름 없이 무엇이 들어가는지만 말한다', () => {
    hooks.enabled = true;
    (button(render({ target: undefined })).props.onClick as () => void)();
    expect(dialog(render({ target: undefined }))!.props.description).toBe('ERP 코드와 ERP 품명이 고른 품목 값으로 바뀌고, 바코드는 칸이 비어 있을 때만 들어갑니다.');
  });

  it('고르면 품목을 넘기고 창을 닫게 두며, [닫기]는 아무것도 넘기지 않고 닫는다', () => {
    hooks.enabled = true;
    (button(render()).props.onClick as () => void)();
    /* false가 아닌 값을 돌려줘야 선택창이 스스로 닫힌다(onClose를 부른다). */
    expect((dialog(render())!.props.onSelect as (picked: ErpItemMatch) => unknown)(item)).toBeUndefined();
    expect(props.onSelect).toHaveBeenCalledExactlyOnceWith(item);
    (dialog(render())!.props.onClose as () => void)();
    expect(dialog(render())).toBeUndefined();
    expect(props.onSelect).toHaveBeenCalledOnce();
  });
});
