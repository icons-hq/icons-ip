import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ErpItemMatch } from '@/lib/admin/erp-items';

/*
 * 옵션의 ERP 품목 고르기(화면 규칙 1·2, F4). 버튼 부품은 함수로 불러 React 요소 트리를 걷는다(DOM 없음, useState만 흉내 낸다).
 * 공용 선택창 자체의 검색·쪽 이동·[선택] 동작은 console/AdminPickerDialog.test.tsx가 본다.
 */
const hooks = vi.hoisted(() => ({ enabled: false, state: [] as unknown[], index: 0, search: vi.fn(), scope: null as { current: string } | null }));
vi.mock('@/app/admin/erp-item-picker-actions', () => ({ searchErpItemPickerAction: hooks.search }));
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  /* 표가 기억하는 마지막 검색어(ErpItemPickScope)는 시험이 넣어 준 것을 읽는다. */
  return { ...actual, useContext: (context: Parameters<typeof actual.useContext>[0]) => hooks.enabled ? hooks.scope : actual.useContext(context), useState: (initial: unknown) => {
    if (!hooks.enabled) return actual.useState(initial);
    const index = hooks.index++;
    if (!(index in hooks.state)) hooks.state[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    return [hooks.state[index], (next: unknown) => { hooks.state[index] = typeof next === 'function' ? (next as (current: unknown) => unknown)(hooks.state[index]) : next; }];
  } };
});

const { ErpItemPickButton, ErpItemPickScope, erpItemPickDescription, erpItemPickSummary, erpItemRowView, erpItemTakenReason, loadErpItems, nextEmptyErpPickTarget } = await import('./ErpItemPicker');
type PickTarget = import('./ErpItemPicker').ErpItemPickTarget;
const { AdminPickerDialog } = await import('./console/AdminPickerDialog');

type Element = ReactElement<Record<string, unknown>>;
function nodes(node: ReactNode): Element[] { return Children.toArray(node).flatMap((value) => isValidElement<Record<string, unknown>>(value) ? [value, ...nodes(value.props.children as ReactNode)] : []); }

const item: ErpItemMatch = { code: '000123', name: '아크릴 키링', category: '문구 > 키링', salePrice: 12000, barcode: '0880000000123', mappedCategoryId: 'leaf' };
const bare: ErpItemMatch = { code: 'K-2', name: '키링 거치대', category: null, salePrice: null, barcode: null, mappedCategoryId: null };

beforeEach(() => { hooks.enabled = false; hooks.state = []; hooks.index = 0; hooks.scope = null; hooks.search.mockReset(); });

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
    expect(erpItemRowView(item)).toEqual({ title: '아크릴 키링', meta: '000123 · 바코드 0880000000123 · 문구 > 키링 · ERP 판매가 12,000원' });
  });

  it('바코드가 없는 품목은 없다고 적고, 분류·판매가가 없으면 그 자리를 비운다', () => {
    expect(erpItemRowView(bare)).toEqual({ title: '키링 거치대', meta: 'K-2 · 바코드 없음' });
    expect(erpItemRowView({ ...bare, salePrice: 0 }).meta).toBe('K-2 · 바코드 없음 · ERP 판매가 0원');
  });

  /* 지금 고르는 옵션에 들어 있는 품목은 줄 앞에 적는다. 막지는 않는다 — 비어 있는 바코드를 채우려고 같은 품목을 다시 고를 수 있다. */
  it('지금 옵션에 들어 있는 품목의 줄에는 그 사실을 먼저 적는다', () => {
    expect(erpItemRowView(bare, 'K-2').meta).toBe('이 옵션에 넣은 품목 · K-2 · 바코드 없음');
    expect(erpItemRowView(bare, '000123').meta).toBe('K-2 · 바코드 없음');
    expect(erpItemRowView(bare, null).meta).toBe('K-2 · 바코드 없음');
  });
});

/*
 * F1(2026-11-26 QA-B, 화면 규칙 2): 다른 상품이나 사용 중지한 옵션이 쓰는 품목은 고르기 전에 막고 까닭(어느 상품·옵션인지)을 줄에 보인다.
 * 예전에는 [선택]으로 보여, 고른 뒤 상품 저장이 통째로 거절됐다(ERP 코드·바코드는 옵션 전체에서 하나뿐이어야 저장된다).
 */
describe('다른 상품·사용 중지한 옵션이 쓰는 ERP 품목', () => {
  const usedBy = { variantId: 'variant-other', goodName: 'QA 키링', optionName: '기본 옵션', via: 'erpCode' as const };
  const context = { rowIds: new Set(['variant-row']), savedIds: new Set(['variant-row', 'variant-stopped']), barcodeEmpty: true };

  it('아무도 쓰지 않는 품목은 막지 않는다', () => {
    expect(erpItemTakenReason({}, context)).toBeNull();
    expect(erpItemTakenReason({ usedBy: null }, context)).toBeNull();
  });

  it('다른 상품의 옵션이 쓰는 품목은 그 상품 이름과 함께 막는다', () => {
    expect(erpItemTakenReason({ usedBy }, context)).toBe('다른 상품에 넣은 품목 · QA 키링');
  });

  it('이 상품의 사용 중지한 옵션이 쓰는 품목은 그 옵션 이름과 함께 막는다', () => {
    expect(erpItemTakenReason({ usedBy: { ...usedBy, variantId: 'variant-stopped', optionName: '단종 색상' } }, context)).toBe('사용 중지한 옵션에 넣은 품목 · 단종 색상');
  });

  it('지금 표에 있는 옵션이 쓰는 품목은 여기서 가리지 않는다 — 표의 지금 값(저장 전 수정 포함)으로 가린다', () => {
    expect(erpItemTakenReason({ usedBy: { ...usedBy, variantId: 'variant-row' } }, context)).toBeNull();
  });

  it('바코드만 겹치는 품목은 옵션의 바코드 칸이 비어 있을 때만 막는다(바코드는 빈 칸에만 들어간다)', () => {
    const barcode = { usedBy: { ...usedBy, via: 'barcode' as const } };
    expect(erpItemTakenReason(barcode, context)).toBe('다른 상품에 넣은 바코드 · QA 키링');
    expect(erpItemTakenReason(barcode, { ...context, barcodeEmpty: false })).toBeNull();
    expect(erpItemTakenReason({ usedBy }, { ...context, barcodeEmpty: false })).toBe('다른 상품에 넣은 품목 · QA 키링');
  });
});

/* 가져온 직후의 결과 안내다. 저장하면 사라지므로 '고른 줄과 적은 줄을 구분한다'는 뜻으로 쓰지 않는다. */
describe('ERP 품목에서 가져온 값 한 줄', () => {
  const row = { erpCode: '000123', erpName: '아크릴 키링', barcode: '0880000000123' };

  it('고른 품목의 ERP 코드와 함께 들어간 바코드를 되읽는다', () => {
    expect(erpItemPickSummary(row, item)).toEqual({ text: 'ERP 품목에서 가져왔습니다 · 000123 · 바코드 0880000000123', warning: false });
  });

  it('바코드가 없는 품목이면 그렇다고 알리고(적어 둔 바코드는 그대로다), 고른 뒤 바코드 칸을 비웠으면 바코드를 말하지 않는다', () => {
    expect(erpItemPickSummary({ erpCode: 'K-2', erpName: '키링 거치대', barcode: null }, bare)).toEqual({ text: 'ERP 품목에서 가져왔습니다 · K-2 · 바코드 없는 품목', warning: false });
    expect(erpItemPickSummary({ erpCode: 'K-2', erpName: '키링 거치대', barcode: '4900000000011' }, bare)).toEqual({ text: 'ERP 품목에서 가져왔습니다 · K-2 · 바코드 없는 품목', warning: false });
    expect(erpItemPickSummary({ ...row, barcode: ' ' }, item)).toEqual({ text: 'ERP 품목에서 가져왔습니다 · 000123', warning: false });
  });

  it('적어 둔 바코드가 품목과 달라 그대로 둔 경우는 품목의 바코드와 함께 경고로 알린다', () => {
    expect(erpItemPickSummary({ ...row, barcode: '4900000000011' }, item)).toEqual({
      text: 'ERP 품목에서 가져왔습니다 · 000123 · 바코드 칸에 있던 값(4900000000011)은 그대로 뒀습니다. 이 품목의 바코드는 0880000000123입니다. 이 품목 것으로 바꾸려면 바코드 칸을 고쳐 주세요.', warning: true,
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
      initialQuery: '',
    });
    expect((opened.props.rowKey as (picked: ErpItemMatch) => string)(item)).toBe('000123');
    expect((opened.props.rowView as (picked: ErpItemMatch) => unknown)(item)).toEqual(erpItemRowView(item));
    /* 다른 옵션이 쓰는 품목은 줄에 이유를 보이고 고를 수 없다. 이미 고른 줄 표시는 쓰지 않는다(자기 줄의 품목은 다시 고를 수 있다). 표를 넘기지 않으면 한 번 고르고 닫는다. */
    expect(opened.props.rowBlocked).toBe(props.blockedReason);
    expect(opened.props.multiple).toBe(false);
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

/*
 * G4(2026-11-25 리뷰): 줄마다 창을 열고 매번 빈 검색에서 시작하면 옵션이 수십 개인 상품에서 전보다 느리다.
 * 창은 그 줄에 적힌 글이나 표에서 마지막으로 찾은 검색어로 열리고, 고른 뒤에는 아래의 빈 옵션으로 이어서 고른다.
 */
describe('옵션이 많은 상품에서 ERP 품목 이어서 고르기', () => {
  type DialogProps = { description: string; initialQuery: string; multiple: boolean; load: (request: { query: string; field: string; filter: string; page: number }) => Promise<unknown>;
    onSelect: (picked: ErpItemMatch) => unknown; onClose: () => void; rowBlocked?: (picked: ErpItemMatch) => string | null; rowView: (picked: ErpItemMatch) => { meta?: unknown } };
  const selects = [vi.fn(), vi.fn(), vi.fn(), vi.fn()];
  let queue: PickTarget[];
  const entry = (index: number, name: string, empty = true, used: string[] = []): PickTarget => ({
    key: `row-${index}`, target: `옵션 ${index + 1}(${name})`, empty, currentCode: empty ? null : `CODE-${index}`,
    blockedReason: (picked) => used.includes(picked.code) ? '다른 옵션에 넣은 품목' : null, onSelect: selects[index],
  });
  function render(index = 0, overrides: { rowText?: string } = {}) {
    hooks.index = 0;
    const own = queue[index];
    return nodes(ErpItemPickButton({ ariaLabel: `옵션 ${index + 1} ERP 품목 고르기`, target: own.target, blockedReason: own.blockedReason, onSelect: own.onSelect, currentCode: own.currentCode, queue, queueKey: own.key, ...overrides }));
  }
  const open = (index = 0, overrides: { rowText?: string } = {}) => { (render(index, overrides).find((node) => node.type === 'button')!.props.onClick as () => void)(); };
  const dialog = (index = 0) => render(index).find((node) => node.type === AdminPickerDialog)?.props as DialogProps | undefined;
  beforeEach(() => {
    hooks.enabled = true; hooks.scope = { current: '' }; selects.forEach((select) => select.mockClear());
    queue = [entry(0, '빨강'), entry(1, '파랑', false), entry(2, '초록'), entry(3, '노랑')];
  });

  it('빈 줄을 건너 아래의 첫 빈 옵션을 찾고, 마지막 줄이나 표에 없는 줄에서는 없다고 한다', () => {
    expect(nextEmptyErpPickTarget(queue, 'row-0')?.key).toBe('row-2');
    expect(nextEmptyErpPickTarget(queue, 'row-2')?.key).toBe('row-3');
    expect(nextEmptyErpPickTarget(queue, 'row-3')).toBeNull();
    expect(nextEmptyErpPickTarget(queue, 'gone')).toBeNull();
    expect(nextEmptyErpPickTarget(undefined, 'row-0')).toBeNull();
    expect(nextEmptyErpPickTarget(queue, null)).toBeNull();
  });

  it('창 맨 위 글은 처음에는 무엇이 들어가는지와 넘어간다는 것을, 이어서 고를 때는 방금 넣은 것과 지금 옵션을 말한다', () => {
    expect(erpItemPickDescription({ target: '옵션 1(빨강)', continues: true })).toBe('옵션 1(빨강)에 넣을 ERP 품목을 고릅니다. ERP 코드와 ERP 품명이 고른 품목 값으로 바뀌고, 바코드는 칸이 비어 있을 때만 들어갑니다. 고르면 다음 빈 옵션으로 넘어갑니다.');
    expect(erpItemPickDescription({ target: '옵션 3(초록)', done: '옵션 1(빨강)에 ‘아크릴 키링’ 품목을 넣었습니다.', continues: true })).toBe('옵션 1(빨강)에 ‘아크릴 키링’ 품목을 넣었습니다. 이어서 옵션 3(초록)에 넣을 ERP 품목을 고릅니다.');
  });

  it('창은 그 줄에 적힌 글로 열리고, 적힌 것이 없으면 표에서 마지막으로 찾은 검색어로 열린다', async () => {
    hooks.search.mockResolvedValue({ ok: true, data: { rows: [], total: 0, page: 1, pageSize: 20 } });
    open(0);
    expect(dialog()!.initialQuery).toBe('');
    /* 검색할 때마다 표가 그 검색어를 기억한다(쪽 이동도 같은 검색어다). */
    await dialog()!.load({ query: ' 아크릴 키링 ', field: '', filter: '', page: 1 });
    expect(hooks.scope!.current).toBe('아크릴 키링');
    expect(hooks.search).toHaveBeenCalledExactlyOnceWith({ query: ' 아크릴 키링 ', page: 1 });
    dialog()!.onClose();
    /* 다른 줄에서 창을 새로 열어도 같은 검색어에서 시작한다. */
    hooks.state = []; open(2);
    expect(dialog(2)!.initialQuery).toBe('아크릴 키링');
    /* 그 줄에 적어 둔 ERP 품명·ERP 코드가 있으면 그것이 먼저다. */
    hooks.state = []; open(2, { rowText: '  스티커 A  ' });
    expect(dialog(2)!.initialQuery).toBe('스티커 A');
  });

  it('고르면 창을 닫지 않고 아래의 빈 옵션으로 넘어가며, 마지막 빈 옵션을 채우면 닫힌다', () => {
    open(0);
    expect(dialog()).toMatchObject({ multiple: true, description: expect.stringContaining('옵션 1(빨강)에 넣을 ERP 품목을 고릅니다.') });
    expect(dialog()!.description).toContain('고르면 다음 빈 옵션으로 넘어갑니다.');
    /* 여러 개 고르기에서는 선택창이 스스로 닫지 않는다. 다음 옵션으로 넘어간 뒤의 줄은 표에서 다시 읽는다. */
    dialog()!.onSelect(item);
    expect(selects[0]).toHaveBeenCalledExactlyOnceWith(item);
    /* 옵션 2(파랑)는 이미 ERP 품목이 있어 건너뛴다. */
    expect(dialog()).toMatchObject({ multiple: true, description: '옵션 1(빨강)에 ‘아크릴 키링’ 품목을 넣었습니다. 이어서 옵션 3(초록)에 넣을 ERP 품목을 고릅니다.' });
    /* 방금 넣은 품목은 표가 다시 그려지면 다음 옵션에서 '다른 옵션에 넣은 품목'으로 막힌다. */
    queue = [entry(0, '빨강', false), entry(1, '파랑', false), entry(2, '초록', true, ['000123']), entry(3, '노랑', true, ['000123'])];
    expect(dialog()!.rowBlocked?.(item)).toBe('다른 옵션에 넣은 품목');
    dialog()!.onSelect(bare);
    expect(selects[2]).toHaveBeenCalledExactlyOnceWith(bare);
    expect(selects[0]).toHaveBeenCalledOnce();
    /* 마지막 빈 옵션: 더 넘어갈 곳이 없어도 [완료]로 닫는 모양은 그대로다. */
    expect(dialog()).toMatchObject({ multiple: true, description: '옵션 3(초록)에 ‘키링 거치대’ 품목을 넣었습니다. 이어서 옵션 4(노랑)에 넣을 ERP 품목을 고릅니다.' });
    dialog()!.onSelect({ ...bare, code: 'K-3', name: '키링 줄' });
    expect(selects[3]).toHaveBeenCalledOnce();
    expect(dialog()).toBeUndefined();
  });

  it('아래에 빈 옵션이 없으면 한 번 고르고 닫는 창이고, 지금 줄에 들어 있는 품목을 줄에 적는다', () => {
    queue = [entry(0, '빨강', false), entry(1, '파랑', false)];
    open(1);
    expect(dialog(1)).toMatchObject({ multiple: false });
    expect(dialog(1)!.description).not.toContain('넘어갑니다');
    expect(dialog(1)!.rowView({ ...bare, code: 'CODE-1' }).meta).toBe('이 옵션에 넣은 품목 · CODE-1 · 바코드 없음');
    /* 한 번 고르기에서는 false가 아닌 값을 돌려줘 선택창이 스스로 닫는다. */
    expect(dialog(1)!.onSelect(item)).toBeUndefined();
    expect(selects[1]).toHaveBeenCalledExactlyOnceWith(item);
  });

  it('[완료]로 닫으면 넘어가던 옵션은 그대로 비어 있고, 다시 열면 그 버튼의 줄에서 시작한다', () => {
    open(0);
    dialog()!.onSelect(item);
    dialog()!.onClose();
    expect(dialog()).toBeUndefined();
    expect(selects[2]).not.toHaveBeenCalled();
    open(0);
    expect(dialog()!.description).toContain('옵션 1(빨강)에 넣을 ERP 품목을 고릅니다.');
  });

  it('표가 기억하는 검색어는 표마다 따로다', () => {
    hooks.enabled = false;
    const html = renderToStaticMarkup(<ErpItemPickScope><ErpItemPickButton ariaLabel="옵션 1 ERP 품목 고르기" onSelect={vi.fn()} /></ErpItemPickScope>);
    expect(html).toContain('ERP 품목 고르기');
  });
});
