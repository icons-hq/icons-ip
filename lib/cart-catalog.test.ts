import { describe, expect, it } from 'vitest';
import {
  buildCartLines,
  mergeCartCatalog,
  missingCartGoodIds,
  type CartCatalog,
} from './cart-catalog';
import type { Good, Ip } from './data';

function good(id: string, overrides: Partial<Good> = {}): Good {
  return {
    id,
    ip: 'ip1',
    name: `굿즈 ${id}`,
    type: '키링',
    price: 10000,
    compareAtPrice: null,
    badge: null,
    stock: 'ok',
    stockQty: 5,
    img: '',
    allowBankTransfer: true,
    ...overrides,
  } as Good;
}

function ip(id: string): Ip {
  return {
    id,
    title: `IP ${id}`,
    sub: '',
    v: { key: 'k', label: 'L', color: '#000' },
    glyph: '',
    bg: '',
    fans: 0,
    goods: 0,
    cards: 0,
    featured: false,
    tagline: '',
    synopsis: '',
  } as Ip;
}

describe('missingCartGoodIds', () => {
  it('아직 못 받은 id 만, 담긴 순서대로 돌려준다', () => {
    const items = [{ goodId: 'b', qty: 1 }, { goodId: 'a', qty: 2 }, { goodId: 'c', qty: 1 }];
    expect(missingCartGoodIds(items, [good('a')])).toEqual(['b', 'c']);
  });

  it('같은 상품을 두 줄로 담아도 한 번만 묻는다', () => {
    const items = [{ goodId: 'a', qty: 1 }, { goodId: 'a', qty: 3 }];
    expect(missingCartGoodIds(items, [])).toEqual(['a']);
  });

  it('전부 있으면 묻지 않는다', () => {
    expect(missingCartGoodIds([{ goodId: 'a', qty: 1 }], [good('a')])).toEqual([]);
  });
});

describe('mergeCartCatalog', () => {
  it('새로 받은 값이 이전 값을 덮는다 — 담을 때의 재고를 계속 보여 주면 결제와 어긋난다', () => {
    const current: CartCatalog = { goods: [good('a', { stockQty: 5 })], ips: [ip('ip1')] };
    const merged = mergeCartCatalog(current, { goods: [good('a', { stockQty: 0 })], ips: [] });

    expect(merged.goods).toHaveLength(1);
    expect(merged.goods[0].stockQty).toBe(0);
    expect(merged.ips).toHaveLength(1);
  });

  it('받은 것이 없으면 이전 값을 그대로 둔다', () => {
    const current: CartCatalog = { goods: [good('a')], ips: [ip('ip1')], answeredIds: ['a'] };
    expect(mergeCartCatalog(current, { goods: [], ips: [], answeredIds: [] })).toEqual(current);
  });

  it('물어본 id 는 답이 비어 와도 「물어봤다」로 남는다 — 없는 상품을 계속 되묻지 않는다', () => {
    const current: CartCatalog = { goods: [], ips: [], answeredIds: [] };
    const merged = mergeCartCatalog(current, { goods: [], ips: [], answeredIds: ['gone'] });

    expect(merged.answeredIds).toEqual(['gone']);
    expect(merged.goods).toEqual([]);
  });
});

describe('buildCartLines', () => {
  it('상품과 IP 를 담긴 줄에 붙인다', () => {
    const lines = buildCartLines(
      [{ goodId: 'a', qty: 2 }],
      { goods: [good('a')], ips: [ip('ip1')] },
    );

    expect(lines[0].qty).toBe(2);
    expect(lines[0].good?.id).toBe('a');
    expect(lines[0].ip?.id).toBe('ip1');
  });

  it('못 찾은 상품은 undefined 로 남는다 — 로딩과 판매 종료를 가르는 것은 화면 몫이다', () => {
    const lines = buildCartLines([{ goodId: 'gone', qty: 1 }], { goods: [], ips: [] });

    expect(lines[0].good).toBeUndefined();
    expect(lines[0].ip).toBeUndefined();
  });

  it('IP 를 못 찾아도 상품 줄 자체는 살린다', () => {
    const lines = buildCartLines([{ goodId: 'a', qty: 1 }], { goods: [good('a')], ips: [] });

    expect(lines[0].good?.id).toBe('a');
    expect(lines[0].ip).toBeUndefined();
  });
});
