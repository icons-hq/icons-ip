import type { CartItem } from './cart';
import type { Good, Ip } from './data';

/*
 * 장바구니·주문서가 쓰는 상품 조회 (규모 후속).
 *
 * 담긴 상품만 알면 되는데 카탈로그 전량을 읽고 있었다. 전량 select 는 PostgREST 상한
 * (1,000)에서 조용히 잘리므로, **1,000번째 뒤의 상품을 담은 사람은 그 줄이 「판매 종료」로
 * 보이고 결제가 막힌다** — 재고도 가격도 멀쩡한데.
 *
 * 그래서 담긴 id 만 읽는다. 다만 장바구니는 클라이언트가 쥐고 있어(비회원은 브라우저 저장),
 * 서버가 미리 담아 보낼 수 있는 것은 로그인한 사람의 저장된 장바구니까지다. 나머지는
 * 화면이 열린 뒤 모자란 id 만 채운다.
 */

export interface CartCatalog {
  goods: Good[];
  ips: Ip[];
  /**
   * 이 조회가 **물어본** id. 물어봤는데 안 나온 상품은 「모르는 것」이 아니라 **없는 것**이다
   * — 그 구분이 없으면 사라진 상품이 영원히 「불러오는 중」으로 남아 결제가 열리지 않는다.
   */
  answeredIds?: readonly string[];
}

export const EMPTY_CART_CATALOG: CartCatalog = { goods: [], ips: [], answeredIds: [] };

/** 아직 못 받은 상품 id. 담긴 순서를 지킨다 — 서버 로그에서 어떤 줄이 늦었는지 보인다. */
export function missingCartGoodIds(
  items: readonly CartItem[],
  known: readonly Good[],
): string[] {
  const have = new Set(known.map((good) => good.id));
  const missing: string[] = [];
  for (const item of items) {
    if (have.has(item.goodId) || missing.includes(item.goodId)) continue;
    missing.push(item.goodId);
  }
  return missing;
}

/**
 * 받은 것을 합친다. **같은 id 는 새로 받은 쪽이 이긴다** — 재고·가격이 그 사이 바뀌었을 수
 * 있고, 담을 때의 값을 계속 보여 주면 결제 화면과 어긋난다.
 */
export function mergeCartCatalog(current: CartCatalog, incoming: CartCatalog): CartCatalog {
  return {
    goods: mergeById(current.goods, incoming.goods),
    ips: mergeById(current.ips, incoming.ips),
    answeredIds: [...new Set([...(current.answeredIds ?? []), ...(incoming.answeredIds ?? [])])],
  };
}

function mergeById<T extends { id: string }>(current: readonly T[], incoming: readonly T[]): T[] {
  if (incoming.length === 0) return [...current];
  const byId = new Map(current.map((entry) => [entry.id, entry]));
  for (const entry of incoming) byId.set(entry.id, entry);
  return [...byId.values()];
}

export interface CartLineBase extends CartItem {
  good: Good | undefined;
  ip: Ip | undefined;
}

/**
 * 담긴 줄에 상품·IP 를 붙인다.
 *
 * 못 찾은 상품은 `undefined` 로 남는다 — 화면이 「판매 종료」로 그리는 자리다. 그래서
 * **아직 받아 오는 중인 것과 정말 없는 것을 구분하는 일은 화면 몫이다**(`resolving`).
 * 그 둘을 섞으면 로딩 중에 결제 버튼이 잠기고, 사용자는 품절로 읽는다.
 */
export function buildCartLines(
  items: readonly CartItem[],
  catalog: CartCatalog,
): CartLineBase[] {
  const goodsById = new Map(catalog.goods.map((good) => [good.id, good]));
  const ipsById = new Map(catalog.ips.map((ip) => [ip.id, ip]));

  return items.map((item) => {
    const good = goodsById.get(item.goodId);
    return { ...item, good, ip: good ? ipsById.get(good.ip) : undefined };
  });
}
