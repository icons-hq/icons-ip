import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { toGood, type GoodRow } from './catalog';
import { parseCategoryDisplayPage } from './category-display.server';
import { selectShopGoods, type ShopListQuery } from './shop-catalog';
import type { Ip } from './data';

/** Explicit local DB integration invocation: CATEGORY_DISPLAY_ORACLE_FILE must
 * point to the JSON emitted by the rollback-only SQL fixture of the same name. */
const filename = process.env.CATEGORY_DISPLAY_ORACLE_FILE;
describe.skipIf(!filename)('실제 DB 공개 카탈로그와 전시의 독립 가격·공급·정렬 비교', () => {
  it('기간할인, 옵션가격범위, 예약물량, 품절, zero-padding, 정렬 7종·예약판매 포함 필터가 112개 경우에 일치한다', () => {
    const data = JSON.parse(readFileSync(filename!, 'utf8')) as { rows: GoodRow[]; cases: { mode: string; query: { ips: string[]; types: string[]; min: number | null; max: number | null; sort: ShopListQuery['sort'] }; page: unknown }[] };
    const goods = data.rows.map(row => toGood(row, () => ''));
    const ips = [{ id: 'cd-oracle-ip', title: '가격 공급 비교' } as Ip];
    const baseQuery: ShopListQuery = { ips: [], types: [], priceMin: null, priceMax: null, sort: 'recommended', view: 'all' };
    const baseline = selectShopGoods({ goods, ips }, baseQuery).goods;
    const manualIds = ['10', '2', '1', '01', '001', '20'].map(suffix => `cd-oracle-g-${suffix}`);
    expect(data.cases).toHaveLength(112);
    for (const entry of data.cases) {
      const query: ShopListQuery = { ...baseQuery, ips: entry.query.ips, types: entry.query.types, priceMin: entry.query.min, priceMax: entry.query.max, sort: entry.query.sort };
      const expected = selectShopGoods({ goods: baseline, ips }, { ...query, view: entry.mode === 'manual' ? 'best' : 'all' }, manualIds);
      const actual = parseCategoryDisplayPage(entry.page, query);
      expect(actual, `${entry.mode} ${JSON.stringify(query)}`).not.toBeNull();
      expect(actual!.result).toEqual(expected);
    }
    const discount = baseline.find(good => good.id === 'cd-oracle-g-1')!;
    expect(discount.price).toBe(500); expect(discount.priceMax).toBe(2500);
    expect(baseline.find(good => good.id === 'cd-oracle-g-2')?.stockQty).toBe(3);
    expect(baseline.find(good => good.id === 'cd-oracle-g-10')?.stockQty).toBe(0);
  });
});
