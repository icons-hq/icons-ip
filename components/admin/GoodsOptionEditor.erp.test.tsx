import { isValidElement, type ReactElement, type ReactNode, type SetStateAction } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ErpItemMatch } from '@/lib/admin/erp-items';
import type { GoodsOptionRow } from '@/lib/admin/goods-option-editor';

const hooks = vi.hoisted(() => ({ state: [] as unknown[], stateIndex: 0 }));

vi.mock('@/app/admin/erp-item-actions', () => ({ searchErpItemsAction: vi.fn() }));
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

/** ErpItemNameInput은 품목을 고르면 품명 onChange를 먼저, 그다음 onSelect를 같은 이벤트에서 부른다. */
function choose(key: string, picked: ErpItemMatch) {
  const table = detailTable();
  table.props.onErpChange?.(key, picked.name);
  table.props.onErpSelect?.(key, picked);
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
    /* 입력 칸이 먼저 바꾼 품명도 고르기 전 입력으로 되돌려, 품명과 ERP 코드가 서로 다른 품목을 가리키지 않게 한다. */
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
