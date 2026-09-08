import { describe, expect, it } from 'vitest';
import type { Good } from '@/lib/data';
import {
  SEARCH_GOODS_PAGE_SIZE,
  goodsSearchOffset,
  goodsSearchPage,
  requestedGoodsSearchPage,
} from './search-goods';

/* 순위(이름 → IP 이름 → 유형·배지)는 서버가 매긴다 — `supabase/tests/storefront_cards_and_search.sql`
   이 그 순서를 잠근다. 여기 남은 것은 페이지 번호 규칙뿐이다(규모 후속). */

function good(id: string): Good {
  return { id, name: id, ip: 'ip', type: '키링', price: 1000, badge: null, stock: 'ok', stockQty: 1, img: '' };
}

describe('requestedGoodsSearchPage', () => {
  it('URL 쓰레기는 1페이지로 접고 소수는 내림한다', () => {
    expect(requestedGoodsSearchPage(Number.NaN)).toBe(1);
    expect(requestedGoodsSearchPage(-3)).toBe(1);
    expect(requestedGoodsSearchPage(2.9)).toBe(2);
  });

  it('offset 은 페이지 크기의 배수다', () => {
    expect(goodsSearchOffset(1)).toBe(0);
    expect(goodsSearchOffset(3)).toBe(SEARCH_GOODS_PAGE_SIZE * 2);
  });
});

describe('goodsSearchPage', () => {
  it('총 건수로 페이지 수를 세고 결과가 없어도 1/1 이다', () => {
    expect(goodsSearchPage({ items: [], total: 0, page: 1 })).toEqual({ items: [], total: 0, page: 1, pageCount: 1 });
    expect(goodsSearchPage({ items: [good('g1')], total: SEARCH_GOODS_PAGE_SIZE + 1, page: 1 }).pageCount).toBe(2);
  });

  /* 총 건수 밖의 페이지는 마지막 페이지로 당긴다 — 화면이 다시 방어하지 않게 여기서 끝낸다. */
  it('범위 밖 페이지는 마지막 페이지로 당긴다', () => {
    expect(goodsSearchPage({ items: [], total: 5, page: 9 }).page).toBe(1);
  });
});
