import { isValidElement, type ReactElement, type ReactNode, type SetStateAction } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ErpItemMatch } from '@/lib/admin/erp-items';
import type { GoodsOptionRow } from '@/lib/admin/goods-option-editor';

const hooks = vi.hoisted(() => ({ state: [] as unknown[], stateIndex: 0 }));

vi.mock('@/app/admin/erp-item-picker-actions', () => ({ searchErpItemPickerAction: vi.fn() }));
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useState: (initial: unknown) => {
      const index = hooks.stateIndex++;
      if (!(index in hooks.state)) hooks.state[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
      return [hooks.state[index], (next: unknown) => {
        hooks.state[index] = typeof next === 'function' ? (next as (current: unknown) => unknown)(hooks.state[index]) : next;
      }];
    },
  };
});

const { GoodsOptionEditor } = await import('./GoodsOptionEditor');
const { ErpItemPickButton } = await import('./ErpItemPicker');

type ErpRowState = { item?: ErpItemMatch; message?: string; warning?: boolean };
type DetailProps = {
  children?: ReactNode;
  erpRows?: Record<string, ErpRowState>;
  onErpChange?: (key: string, value: string) => void;
  onErpSelect?: (key: string, item: ErpItemMatch) => void;
};

function find(node: ReactNode, predicate: (element: ReactElement<DetailProps>) => boolean): ReactElement<DetailProps>[] {
  if (!isValidElement<DetailProps>(node)) return Array.isArray(node) ? node.flatMap((child) => find(child, predicate)) : [];
  const matches = predicate(node) ? [node] : [];
  const children = node.props.children;
  for (const child of Array.isArray(children) ? children : [children]) matches.push(...find(child, predicate));
  return matches;
}

const savedRed = '11111111-1111-4111-8111-111111111111';
const savedBlue = '22222222-2222-4222-8222-222222222222';
const item: ErpItemMatch = { code: '000123', name: '아크릴 키링', category: '문구 > 키링', salePrice: 12000, barcode: '0880000000123', mappedCategoryId: 'leaf' };

let rows: GoodsOptionRow[];
const setRows = vi.fn((next: SetStateAction<GoodsOptionRow[]>) => { rows = typeof next === 'function' ? next(rows) : next; });
const onErpItemSelect = vi.fn();

/** 선택창에서 품목을 고르면 그 줄의 onErpSelect만 불린다(ERP 품명 칸은 직접 적는 칸이라 고르기 전에 바뀌지 않는다). */
function choose(key: string, picked: ErpItemMatch) {
  detailTable().props.onErpSelect?.(key, picked);
}

function detailTable() {
  hooks.stateIndex = 0;
  const tree = GoodsOptionEditor({ rows, baseline: [savedRed, savedBlue], basePrice: 10000, onRowsChange: setRows, onErpItemSelect });
  return find(tree, (element) => typeof element.props.onErpSelect === 'function')[0];
}

beforeEach(() => {
  hooks.state = [];
  setRows.mockClear();
  onErpItemSelect.mockClear();
  rows = [
    { id: savedRed, name: '빨강', code: 'R', attributes: { 색상: '빨강' }, extraPrice: 0, stockQty: 1, expectedStockQty: 1, erpCode: null, erpName: '아크', barcode: null },
    { id: savedBlue, name: '파랑', code: 'B', attributes: { 색상: '파랑' }, extraPrice: 0, stockQty: 1, expectedStockQty: 1, erpCode: '000123', erpName: '아크릴 키링', barcode: '0880000000123' },
  ];
});

/* 2026-10-07 3차 리뷰: 같은 ERP 품목을 두 옵션에 고르면 화면은 막지 않고 저장만 원인 없이 실패했다. */
describe('옵션 상세 정보의 ERP 품목 선택', () => {
  it('다른 옵션이 쓰는 ERP 품목은 채우지 않고 경고하며, 카테고리·판매가 제안도 하지 않는다', () => {
    choose(savedRed, item);
    expect(onErpItemSelect).not.toHaveBeenCalled();
    /* 적어 둔 품명도 그대로 둬, 품명과 ERP 코드가 서로 다른 품목을 가리키지 않게 한다. */
    expect(rows[0]).toMatchObject({ erpCode: null, erpName: '아크', barcode: null });
    expect(rows[1]).toMatchObject({ erpCode: '000123', barcode: '0880000000123' });
    const state = detailTable().props.erpRows?.[savedRed];
    expect(state).toEqual({
      warning: true,
      message: '옵션 2(파랑)에 이미 같은 ERP 코드(000123)가 있어 채우지 않았습니다. 한 ERP 품목은 옵션 하나에만 연결할 수 있습니다. 두 옵션의 ERP 품목을 맞바꾸려면 한쪽을 비우고 저장한 뒤 다시 지정해주세요.',
    });
  });

  it('겹치지 않는 ERP 품목은 고른 옵션에 채우고 카테고리·판매가를 제안한다', () => {
    rows[1] = { ...rows[1], erpCode: '000124', barcode: '0880000000124' };
    choose(savedRed, item);
    expect(rows[0]).toMatchObject({ erpCode: '000123', erpName: '아크릴 키링', barcode: '0880000000123' });
    expect(rows[1]).toMatchObject({ erpCode: '000124' });
    expect(onErpItemSelect).toHaveBeenCalledWith(item);
    expect(detailTable().props.erpRows?.[savedRed]).toEqual({ item });
  });
});

/* 1007-045(11/11 결정 "빈 칸 자동"): 판매가 칸이 비어 있을 때만 고른 품목의 ERP 판매가를 바로 넣는다. 0원 입력은 값으로 본다. */
describe('ERP 판매가 빈 칸 자동 입력', () => {
  const applyRegular = vi.fn();
  function tableWith(regularPrice: string) {
    hooks.stateIndex = 0;
    const tree = GoodsOptionEditor({ rows, baseline: [], basePrice: 0, onRowsChange: setRows, onErpItemSelect, onRegularPriceApply: applyRegular,
      priceDraft: { regularPrice, discountEnabled: false, discountValue: '', discountUnit: 'won' } });
    return find(tree, (element) => typeof element.props.onErpSelect === 'function')[0];
  }
  function chooseWith(regularPrice: string, key: string) {
    tableWith(regularPrice).props.onErpSelect?.(key, item);
  }
  const single = 'new:[]';
  beforeEach(() => { applyRegular.mockClear(); rows = [{ name: '기본 옵션', code: '', attributes: {}, extraPrice: 0, stockQty: 1, erpCode: null, erpName: null, barcode: null }]; });

  it('판매가가 비어 있으면 고른 품목의 ERP 판매가를 바로 넣고 버튼 적용과 같은 안내를 보인다', () => {
    chooseWith('', single);
    expect(applyRegular).toHaveBeenCalledWith(12000);
    expect(rows[0]).toMatchObject({ erpCode: '000123', erpName: '아크릴 키링' });
    expect(onErpItemSelect).toHaveBeenCalledWith(item);
    expect(tableWith('').props.erpRows?.[single]).toEqual({ item, message: '판매가가 비어 있어 ERP 판매가 12,000원을 넣었습니다.', warning: false });
  });

  it('0원을 포함해 판매가에 값이 있으면 넣지 않고 지금처럼 적용 버튼만 둔다', () => {
    for (const regularPrice of ['0', '9900']) {
      hooks.state = []; applyRegular.mockClear();
      rows = [{ name: '기본 옵션', code: '', attributes: {}, extraPrice: 0, stockQty: 1, erpCode: null, erpName: null, barcode: null }];
      chooseWith(regularPrice, single);
      expect(applyRegular).not.toHaveBeenCalled();
      expect(tableWith(regularPrice).props.erpRows?.[single]).toEqual({ item });
    }
  });
});

/*
 * 2026-10-07 3차 리뷰: 표 안 재고 부족 경고 규칙이 ERP 안내까지 덮어 성공 안내도 경고색 11px로 보였다. 템플릿 룩(ADR-0028)에서는
 * 안내마다 자기 색·크기 유틸리티를 갖는다 — 그 칸의 실제 요소를 그려 확인한다.
 */
describe('옵션 상세 정보의 ERP 안내 색', () => {
  type Tagged = ReactElement<DetailProps & { className?: string; 'data-tone'?: string; 'data-good-option-erp-message'?: string; 'data-good-option-low-stock'?: string }>;
  function detailParts() {
    const table = detailTable();
    return find((table.type as (props: DetailProps) => ReactNode)(table.props), () => true) as Tagged[];
  }
  const erpMessages = () => detailParts().filter((element) => element.type === 'small' && element.props['data-good-option-erp-message'] === '');

  it('적용 성공은 성공색, 적용 실패·확인 필요는 경고색이고 둘 다 같은 작은 글자다', () => {
    choose(savedRed, item);
    const [failed] = erpMessages();
    expect(failed.props['data-tone']).toBe('warning');
    expect(failed.props.className).toContain('text-[var(--wc-warning)]');
    expect(failed.props.className).toContain('text-xs');
    expect(failed.props.className).not.toContain('text-[var(--wc-success)]');

    rows[1] = { ...rows[1], erpCode: '000124', barcode: '0880000000124' };
    choose(savedRed, item);
    (detailTable().props as { onErpPrice?: (key: string, salePrice: number) => void }).onErpPrice?.(savedRed, item.salePrice!);
    expect(rows[0]).toMatchObject({ extraPrice: 2000 });
    const [applied] = erpMessages();
    expect(applied.props.children).toBe('옵션가를 2,000원으로 맞춰 판매 12,000원이 되었습니다.');
    expect(applied.props['data-tone']).toBe('success');
    expect(applied.props.className).toContain('text-[var(--wc-success)]');
    expect(applied.props.className).toContain('text-xs');
    expect(applied.props.className).not.toContain('text-[var(--wc-warning)]');
  });

  it('같은 칸의 재고 부족 경고는 ERP 안내와 따로 경고색의 더 작은 글자로 보인다', () => {
    rows[0] = { ...rows[0], lowStockThreshold: 3 };
    choose(savedRed, item);
    const lowStock = detailParts().filter((element) => element.type === 'small' && element.props['data-good-option-low-stock'] === '');
    expect(lowStock).toHaveLength(1);
    expect(lowStock[0].props['data-tone']).toBe('warning');
    expect(lowStock[0].props.className).toContain('text-[var(--wc-warning)]');
    expect(lowStock[0].props.className).toContain('text-[11px]');
    expect(erpMessages()[0].props.className).not.toContain('text-[11px]');
  });
});

/*
 * 2026-11-25 화면 규칙 1(F4): ERP 품명 칸의 제안 목록(2자 이상·최대 8개)을 공용 선택창으로 바꿨다. 줄마다 [ERP 품목 고르기]가 있고,
 * ERP 코드·바코드·ERP 품명 칸은 ERP 품목에 없는 것을 직접 적는 평범한 입력 칸이다. 고른 줄에만 고른 품목 한 줄이 보인다.
 */
describe('옵션 줄의 ERP 품목 고르기', () => {
  type PickButton = ReactElement<Parameters<typeof ErpItemPickButton>[0]>;
  type Tagged = ReactElement<DetailProps & { className?: string; 'data-tone'?: string; 'data-good-option-erp-picked'?: string; 'aria-label'?: string; role?: string }>;
  function detailParts(canSearchErp = true) {
    hooks.stateIndex = 0;
    const tree = GoodsOptionEditor({ rows, baseline: [savedRed, savedBlue], basePrice: 10000, onRowsChange: setRows, onErpItemSelect, canSearchErp });
    const table = find(tree, (element) => typeof element.props.onErpSelect === 'function')[0];
    return find((table.type as (props: DetailProps) => ReactNode)(table.props), () => true) as Tagged[];
  }
  const pickButtons = (canSearchErp = true) => detailParts(canSearchErp).filter((element) => element.type === ErpItemPickButton) as unknown as PickButton[];
  const summaries = () => detailParts().filter((element) => element.type === 'small' && element.props['data-good-option-erp-picked'] === '');

  it('줄마다 버튼을 두고, 고르면 그 옵션에 ERP 코드·ERP 품명·바코드를 한 번에 넣는다', () => {
    rows[1] = { ...rows[1], erpCode: '000124', barcode: '0880000000124' };
    const buttons = pickButtons();
    expect(buttons.map((button) => [button.props.ariaLabel, button.props.target])).toEqual([
      ['옵션 1 ERP 품목 고르기', '옵션 1(빨강)'], ['옵션 2 ERP 품목 고르기', '옵션 2(파랑)'],
    ]);
    buttons[0].props.onSelect(item);
    expect(rows[0]).toMatchObject({ erpCode: '000123', erpName: '아크릴 키링', barcode: '0880000000123' });
    expect(rows[1]).toMatchObject({ erpCode: '000124' });
    expect(onErpItemSelect).toHaveBeenCalledExactlyOnceWith(item);
  });

  it('같은 상품의 다른 옵션이 쓰는 품목은 선택창에서 고를 수 없고, 자기 줄의 품목은 다시 고를 수 있다', () => {
    const [red, blue] = pickButtons();
    expect(red.props.blockedReason?.(item)).toBe('다른 옵션에 넣은 품목');
    expect(blue.props.blockedReason?.(item)).toBeNull();
    expect(red.props.blockedReason?.({ ...item, code: '000999', barcode: null })).toBeNull();
    /* 코드는 달라도 비어 있는 바코드 칸에 들어갈 바코드를 다른 옵션이 쓰고 있으면 고를 수 없다. */
    expect(red.props.blockedReason?.({ ...item, code: '000999' })).toBe('다른 옵션에 넣은 품목');
  });

  it('ERP 품목을 찾을 권한이 없으면 버튼이 없고, 세 칸은 그대로 직접 적는다', () => {
    expect(pickButtons(false)).toHaveLength(0);
    const inputs = detailParts(false).filter((element) => element.type === 'input').map((element) => element.props['aria-label']);
    for (const label of ['옵션 1 ERP 코드', '옵션 1 바코드', '옵션 1 ERP 품명']) expect(inputs).toContain(label);
  });

  it('ERP 품명 칸은 제안 목록이 없는 평범한 입력 칸이다', () => {
    const name = detailParts().find((element) => element.type === 'input' && element.props['aria-label'] === '옵션 1 ERP 품명')!;
    expect(name.props.role).toBeUndefined();
    (name.props as { onChange: (event: unknown) => void }).onChange({ target: { value: '직접 적은 품명' } });
    expect(rows[0]).toMatchObject({ erpCode: null, erpName: '직접 적은 품명', barcode: null });
    expect(onErpItemSelect).not.toHaveBeenCalled();
  });

  it('고른 줄에만 고른 품목 한 줄이 보이고, 직접 적은 줄과 고른 뒤 손으로 고친 줄에는 없다', () => {
    rows[1] = { ...rows[1], erpCode: '000124', barcode: '0880000000124' };
    /* 파랑은 ERP 코드·품명·바코드가 다 있지만 직접 적은 줄이다. */
    expect(summaries()).toHaveLength(0);
    pickButtons()[0].props.onSelect(item);
    const [picked] = summaries();
    expect(summaries()).toHaveLength(1);
    expect(picked.props.children).toBe('고른 ERP 품목 · 000123 · 바코드 0880000000123');
    expect(picked.props.className).toContain('text-muted-foreground');
    expect(picked.props['data-tone']).toBeUndefined();

    /* ERP 코드를 손으로 고치면 더는 그 품목이 아니다. 되돌리면 다시 보인다. */
    rows[0] = { ...rows[0], erpCode: '000123-A' };
    expect(summaries()).toHaveLength(0);
    rows[0] = { ...rows[0], erpCode: '000123' };
    expect(summaries()).toHaveLength(1);
    /* ERP 품명을 손으로 고치면 고른 품목 표시와 판매가 제안을 함께 거둔다. */
    detailTable().props.onErpChange?.(savedRed, '아크릴 키링 (수정)');
    expect(summaries()).toHaveLength(0);
    expect(detailTable().props.erpRows?.[savedRed]).toBeUndefined();
  });

  it('적어 둔 바코드가 고른 품목과 다르면 그대로 두고 경고색으로 알린다', () => {
    rows[0] = { ...rows[0], barcode: '4900000000011' };
    rows[1] = { ...rows[1], erpCode: '000124', barcode: '0880000000124' };
    pickButtons()[0].props.onSelect(item);
    expect(rows[0]).toMatchObject({ erpCode: '000123', barcode: '4900000000011' });
    const [picked] = summaries();
    expect(picked.props.children).toBe('고른 ERP 품목 · 000123 · 바코드는 적어 둔 값을 그대로 뒀습니다. ERP 품목의 바코드는 0880000000123입니다.');
    expect(picked.props['data-tone']).toBe('warning');
    expect(picked.props.className).toContain('text-[var(--wc-warning)]');
  });
});
