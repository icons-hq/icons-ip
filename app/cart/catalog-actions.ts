'use server';

import { EMPTY_CART_CATALOG, type CartCatalog } from '@/lib/cart-catalog';
import { getStorefrontGoodsByIds, getStorefrontIpsByIds } from '@/lib/storefront.server';

/** 한 번에 물어볼 수 있는 상품 수. RPC 쪽 상한(500)보다 낮게 잡아 화면이 먼저 거른다. */
const MAX_IDS = 200;

/*
 * 장바구니·주문서가 「이 id 들의 상품」을 묻는 문. 공개 카탈로그라 로그인 없이도 답한다
 * (비회원 장바구니가 있다) — 대신 **id 로만** 답하고 목록을 열어 주지 않는다.
 *
 * 실패는 빈 목록으로 수렴한다. 화면은 아직 못 받은 줄을 「로딩」으로 그리지 「품절」로
 * 그리지 않으므로, 조용히 결제를 막는 일은 생기지 않는다.
 */
export async function resolveCartCatalogAction(ids: readonly string[]): Promise<CartCatalog> {
  const wanted = [...new Set(ids.filter((id) => typeof id === 'string' && id))].slice(0, MAX_IDS);
  if (wanted.length === 0) return EMPTY_CART_CATALOG;

  try {
    const goods = await getStorefrontGoodsByIds(wanted);
    const ips = await getStorefrontIpsByIds(goods.map((good) => good.ip));
    return { goods, ips, answeredIds: wanted };
  } catch {
    return EMPTY_CART_CATALOG;
  }
}
