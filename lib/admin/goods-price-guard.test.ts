import { describe, expect, it } from 'vitest';
import { formatGoodsPriceGuardList, goodEditorPriceConfirmation, goodsPriceGuardLine, goodsPriceGuardNotice, goodsPriceGuardReasons, goodsPriceGuardRows } from './goods-price-guard';

describe('판매가 오입력 확인 기준(CAT-007·CAT-008)', () => {
  it('0원·1,000원 미만과 이전 금액의 절반 이하·두 배 이상을 잡고 흔한 인상·인하는 지나간다', () => {
    expect(goodsPriceGuardReasons(29000, 2900)).toEqual(['half']);
    expect(goodsPriceGuardReasons(29000, 290000)).toEqual(['double']);
    expect(goodsPriceGuardReasons(29000, 14500)).toEqual(['half']);
    expect(goodsPriceGuardReasons(29000, 58000)).toEqual(['double']);
    expect(goodsPriceGuardReasons(29000, 14501)).toEqual([]);
    expect(goodsPriceGuardReasons(29000, 57999)).toEqual([]);
    expect(goodsPriceGuardReasons(29000, 32000)).toEqual([]);
    expect(goodsPriceGuardReasons(29000, 0)).toEqual(['zero']);
    expect(goodsPriceGuardReasons(29000, 290)).toEqual(['low', 'half']);
    expect(goodsPriceGuardReasons(null, 999)).toEqual(['low']);
    expect(goodsPriceGuardReasons(null, 1000)).toEqual([]);
    /* 이미 저장된 낮은 금액을 그대로 두는 저장은 호출부가 0원·1,000원 미만 확인을 끈다. 이전 금액이 0원이면 비율을 보지 않는다. */
    expect(goodsPriceGuardReasons(500, 500, { checkLow: false })).toEqual([]);
    expect(goodsPriceGuardReasons(0, 29000)).toEqual([]);
  });

  it('상품 편집 저장은 판매가와 할인가를 이전 → 새 값으로 보이고, 바뀌지 않은 낮은 금액은 공개할 때만 다시 묻는다', () => {
    const typo = goodEditorPriceConfirmation({ saved: { regularPrice: 29000, salePrice: 29000 }, next: { regularPrice: 2900, salePrice: 2900 }, publish: false });
    expect(typo).toMatchObject({ title: '판매가 확인', confirmLabel: '이대로 저장' });
    expect(typo?.message).toContain('판매가: 29,000원 → 2,900원 (이전 금액의 절반 이하)');
    expect(typo?.message).not.toContain('할인가');
    expect(typo?.message).toContain('맞으면 저장을 계속합니다.');
    expect(goodEditorPriceConfirmation({ saved: { regularPrice: 29000, salePrice: 29000 }, next: { regularPrice: 31000, salePrice: 31000 }, publish: false })).toBeNull();
    /* 할인 금액 오타: 판매가는 그대로지만 고객이 내는 할인가가 1,000원 미만이 된다. */
    const discount = goodEditorPriceConfirmation({ saved: { regularPrice: 3000, salePrice: 3000 }, next: { regularPrice: 3000, salePrice: 100 }, publish: false });
    expect(discount?.message).toContain('할인가: 3,000원 → 100원 (1,000원 미만, 이전 금액의 절반 이하)');
    expect(discount?.message).not.toContain('판매가: 3,000원');
    /* 새 상품(저장된 값 없음)의 0원은 저장에서도, 등록 화면의 저장 후 공개에서도 묻는다. */
    const fresh = goodEditorPriceConfirmation({ saved: null, next: { regularPrice: 0, salePrice: 0 }, publish: true });
    expect(fresh).toMatchObject({ confirmLabel: '이대로 저장 후 공개' });
    expect(fresh?.message).toContain('판매가: 0원 (0원)');
    expect(fresh?.message).toContain('맞으면 저장 후 공개를 계속합니다.');
    expect(goodEditorPriceConfirmation({ saved: null, next: { regularPrice: 0, salePrice: 0 }, publish: false })).not.toBeNull();
    const kept = { saved: { regularPrice: 0, salePrice: 0 }, next: { regularPrice: 0, salePrice: 0 } };
    expect(goodEditorPriceConfirmation({ ...kept, publish: false })).toBeNull();
    expect(goodEditorPriceConfirmation({ ...kept, publish: true })?.message).toContain('판매가: 0원 (0원)');
  });

  it('바로 수정 경고 문장과 여러 상품 목록을 만든다', () => {
    expect(goodsPriceGuardNotice(29000, 31000)).toBe('');
    expect(goodsPriceGuardNotice(29000, 2900)).toBe('\n\n새 판매가가 이전 금액의 절반 이하입니다. 금액을 잘못 입력하지 않았는지 확인해주세요.');
    const rows = Array.from({ length: 12 }, (_, i) => ({ name: `상품 ${i + 1}`, price: 10000, next: i === 11 ? 11000 : 100000 }));
    const lines = goodsPriceGuardRows(rows, (row) => ({ label: row.name, before: row.price, after: row.next }));
    expect(lines).toHaveLength(11);
    const list = formatGoodsPriceGuardList(lines);
    expect(list.split('\n')).toHaveLength(11);
    expect(list).toContain('· 상품 1: 10,000원 → 100,000원 (이전 금액의 두 배 이상)');
    expect(list.endsWith('· 외 1개')).toBe(true);
    expect(goodsPriceGuardLine('판매가', 10000, 10000)).toBeNull();
  });
});
