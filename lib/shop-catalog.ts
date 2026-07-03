import type { Good } from './data';

export type GoodsSort = '인기순' | '신상품' | '낮은 가격' | '높은 가격';

export const GOODS_SORTS: GoodsSort[] = ['인기순', '신상품', '낮은 가격', '높은 가격'];

export const ALL_IPS = 'all';

export interface ShopGoodsFilter {
  ipId: string;
  sort: GoodsSort;
}

export function selectShopGoods(goods: Good[], filter: ShopGoodsFilter): Good[] {
  const filtered = goods.filter((good) => filter.ipId === ALL_IPS || good.ip === filter.ipId);

  // 인기·신상 지표가 카탈로그에 없으므로 인기순=카탈로그 순서, 신상품=신상 badge 우선으로 대응한다.
  if (filter.sort === '신상품') {
    return [...filtered].sort((a, b) => Number(b.badge === '신상') - Number(a.badge === '신상'));
  }
  if (filter.sort === '낮은 가격') return [...filtered].sort((a, b) => a.price - b.price);
  if (filter.sort === '높은 가격') return [...filtered].sort((a, b) => b.price - a.price);
  return filtered;
}
