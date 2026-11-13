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
    const table = tableWith(regularPrice);
    table.props.onErpChange?.(key, item.name);
    table.props.onErpSelect?.(key, item);
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
