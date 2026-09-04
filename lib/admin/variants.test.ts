import { describe, expect, it } from 'vitest';
import {
  adminInventoryHref,
  generateVariantCombinations,
  normalizeAdminInventoryFilters,
  normalizeOptionMasterForm,
  normalizeStockLocationForm,
  normalizeVariantStockAdjustmentForm,
  normalizeVariantTransferForm,
  parseBulkStockRows,
  parseVariantBatchPayload,
  toVariantBatchRpcArgs,
  variantOptionSummary,
  variantSignature,
  type AdminOptionMaster,
} from './variants';

const color: AdminOptionMaster = {
  id: '11111111-1111-4111-8111-111111111111',
  code: 'O0001',
  name: '색상',
  displayStyle: 'select',
  sortOrder: 1,
  archivedAt: null,
  values: [
    { id: '11111111-1111-4111-8111-aaaaaaaaaaaa', value: '빨강', sortOrder: 1, archivedAt: null },
    { id: '11111111-1111-4111-8111-bbbbbbbbbbbb', value: '파랑', sortOrder: 2, archivedAt: null },
  ],
};
const size: AdminOptionMaster = {
  id: '22222222-2222-4222-8222-222222222222',
  code: 'O0002',
  name: '사이즈',
  displayStyle: 'button',
  sortOrder: 2,
  archivedAt: null,
  values: [
    { id: '22222222-2222-4222-8222-aaaaaaaaaaaa', value: 'S', sortOrder: 1, archivedAt: null },
    { id: '22222222-2222-4222-8222-bbbbbbbbbbbb', value: 'M', sortOrder: 2, archivedAt: null },
  ],
};
const options = [{ optionId: color.id, position: 1 }, { optionId: size.id, position: 2 }];

function form(entries: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

describe('옵션 조합 · 서명 · 요약', () => {
  it('옵션 순서대로 카테시안 곱을 만든다', () => {
    const combos = generateVariantCombinations([
      { optionId: color.id, valueIds: color.values.map((value) => value.id) },
      { optionId: size.id, valueIds: [size.values[0].id] },
    ]);
    expect(combos).toHaveLength(2);
    expect(combos[0]).toEqual({ [color.id]: color.values[0].id, [size.id]: size.values[0].id });
    expect(generateVariantCombinations([{ optionId: color.id, valueIds: [] }])).toEqual([]);
    expect(generateVariantCombinations([])).toEqual([]);
  });

  it('서명은 position 순, 요약은 「옵션: 값」을 / 로 잇는다', () => {
    const values = { [size.id]: size.values[1].id, [color.id]: color.values[0].id };
    expect(variantSignature(values, options)).toBe(`${color.values[0].id}|${size.values[1].id}`);
    expect(variantOptionSummary(values, [color, size], options)).toBe('색상: 빨강 / 사이즈: M');
    expect(variantOptionSummary({}, [color, size], options)).toBe('');
  });
});

describe('재고 관리 URL 계약', () => {
  it('플래그·페이지·크기를 좁히고 기본값은 URL에서 뺀다', () => {
    const filters = normalizeAdminInventoryFilters({ query: ' 키링 ', location: 'gimpo', low: '1', page: '3', size: '999', ip: 'bad id' });
    expect(filters).toEqual({ query: '키링', location: 'gimpo', ip: '', low: true, archived: false, page: 3, size: 50 });
    expect(adminInventoryHref(filters, { page: 1 })).toBe('/admin/catalog/inventory?query=%ED%82%A4%EB%A7%81&location=gimpo&low=1');
    expect(adminInventoryHref(normalizeAdminInventoryFilters({}))).toBe('/admin/catalog/inventory');
  });
});

describe('폼 정규화', () => {
  it('재고 조정 폼 — 멱등 키·품목·출고지·수량·사유를 검사한다', () => {
    const ok = normalizeVariantStockAdjustmentForm(form({
      goodId: 'g1', movementId: '33333333-3333-4333-8333-333333333333', variantId: color.id, locationId: 'gimpo',
      expectedOnHand: '10', delta: '-3', reasonCode: 'damage', note: '',
    }));
    expect(ok).toEqual({ ok: true, value: { goodId: 'g1', movementId: '33333333-3333-4333-8333-333333333333', variantId: color.id, locationId: 'gimpo', expectedOnHand: 10, delta: -3, reasonCode: 'damage', note: null } });
    const bad = normalizeVariantStockAdjustmentForm(form({ movementId: 'nope', variantId: color.id, locationId: 'gimpo', expectedOnHand: '10', delta: '0', reasonCode: 'correction' }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(Object.keys(bad.errors).sort()).toEqual(['delta', 'form', 'note']);
  });

  it('이동 폼은 같은 자리를 거부하고, 안전재고·출고지·옵션 폼은 값 범위를 본다', () => {
    const same = normalizeVariantTransferForm(form({ movementId: '33333333-3333-4333-8333-333333333333', fromVariantId: color.id, toVariantId: color.id, fromLocationId: 'gimpo', toLocationId: 'gimpo', qty: '1' }));
    expect(same.ok).toBe(false);
    const location = normalizeStockLocationForm(form({ id: 'Busan', name: '부산', sortOrder: '3', active: 'on' }));
    expect(location).toMatchObject({ ok: true, value: { id: 'busan', name: '부산', isDefault: false, active: true, sortOrder: 3, contact: null } });
    const inactiveDefault = normalizeStockLocationForm(form({ id: 'busan', name: '부산', isDefault: 'on' }));
    expect(inactiveDefault.ok).toBe(false);
    const master = normalizeOptionMasterForm(form({
      id: color.id, name: '색상', displayStyle: 'swatch', sortOrder: '1',
      [`value:${color.values[0].id}`]: '레드', [`archive:${color.values[1].id}`]: 'on', [`value:${color.values[1].id}`]: '파랑',
      newValues: '초록\n노랑, 초록',
    }));
    expect(master).toMatchObject({ ok: true, value: { id: color.id, name: '색상', displayStyle: 'swatch', archived: false } });
    if (master.ok) {
      expect(master.value.values).toEqual([
        { id: color.values[0].id, value: '레드', archived: false },
        { id: color.values[1].id, value: '파랑', archived: true },
        { value: '초록', sortOrder: 3 },
        { value: '노랑', sortOrder: 5 },
      ]);
    }
  });

  it('품목 payload 는 모양·한도만 보고 RPC 인자로 옮긴다', () => {
    const raw = JSON.stringify({
      options: [{ optionId: color.id, position: 1 }],
      variants: [
        { values: { [color.id]: color.values[0].id }, customCode: ' RED ', additionalPrice: 500, initialStocks: [{ locationId: 'gimpo', onHandQty: 4 }] },
        { id: '44444444-4444-4444-8444-444444444444', values: { [color.id]: color.values[1].id }, archived: true },
      ],
    });
    const parsed = parseVariantBatchPayload(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const args = toVariantBatchRpcArgs('g1', '55555555-5555-4555-8555-555555555555', parsed.value);
    expect(args.target_options).toEqual([{ option_id: color.id, position: 1 }]);
    expect(args.target_variants[0]).toEqual({
      custom_code: 'RED', values: { [color.id]: color.values[0].id }, additional_price: 500, location_id: null,
      initial_stocks: [{ location_id: 'gimpo', on_hand_qty: 4 }],
    });
    expect(args.target_variants[1]).toEqual({ id: '44444444-4444-4444-8444-444444444444', custom_code: null, values: { [color.id]: color.values[1].id }, location_id: null, archived: true });
    expect(parseVariantBatchPayload('{').ok).toBe(false);
    expect(parseVariantBatchPayload(JSON.stringify({ options: [{ optionId: 'x' }], variants: [] })).ok).toBe(false);
    expect(parseVariantBatchPayload(JSON.stringify({ options: [], variants: [{ additionalPrice: 1.5 }] })).ok).toBe(false);
  });

  it('붙여넣기 행은 참조·출고지(선택)·수량·안전재고를 읽는다', () => {
    const parsed = parseBulkStockRows('RED-S, gimpo, 30, 5\ng2\t0\n# 주석\nbad, -1\n');
    expect(parsed.rows).toEqual([
      { ref: 'RED-S', locationId: 'gimpo', onHandQty: 30, safetyQty: 5 },
      { ref: 'g2', onHandQty: 0 },
    ]);
    expect(parsed.errors).toEqual([{ line: 4, message: '보유 수량은 0 이상의 정수여야 합니다.' }]);
  });
});
