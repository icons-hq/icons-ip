import type { Good, Ip } from './data';
import type { WishlistEntry } from './wishlist.server';

/* 위시리스트 화면(/my/wishlist · LFS 패리티 2차 L6 · MY-06·MY-07)의 읽기 모델.
 *
 * 찜 기록과 카탈로그의 조인은 이 한 곳에서 한다 — 페이지가 부르고 화면은 결과만 그린다(카탈로그 전체를
 * 클라이언트로 내려보내지 않는다). 카탈로그에서 사라진 굿즈(보관·비공개)도 줄을 지우지 않는다: 찜 기록은
 * 남아 있는데 목록에서 조용히 빠지면 사용자는 자기가 해제한 줄 안다. good=null 로 남겨 '판매 종료'와 해제
 * 수단을 그린다. IP 는 위시가 아니라 팔로우다(CONTEXT.md) — 같은 화면의 '팔로우한 IP' 탭이 따로 그린다. */

export type WishlistTab = 'goods' | 'ip';

export interface WishlistLine {
  goodId: string;
  /** 지금 공개된 굿즈. 카탈로그에서 빠졌으면 null(판매 종료 줄). */
  good: Good | null;
  /** 카드의 브랜드 줄 — 굿즈의 IP 이름. */
  brand: string | null;
}

export function wishlistTab(value: string | string[] | undefined): WishlistTab {
  const first = Array.isArray(value) ? value[0] : value;
  return first === 'ip' ? 'ip' : 'goods';
}

export function wishlistTabHref(tab: WishlistTab): string {
  return tab === 'ip' ? '/my/wishlist?tab=ip' : '/my/wishlist';
}

export function wishlistLines(entries: readonly WishlistEntry[], catalog: { goods: readonly Good[]; ips: readonly Ip[] }): WishlistLine[] {
  const goodsById = new Map(catalog.goods.map((good) => [good.id, good]));
  const ipsById = new Map(catalog.ips.map((ip) => [ip.id, ip]));
  return entries.map((entry) => {
    const good = goodsById.get(entry.goodId) ?? null;
    return { goodId: entry.goodId, good, brand: good ? ipsById.get(good.ip)?.title ?? null : null };
  });
}

/** 팔로우한 IP 를 저장 순서(최근 팔로우 먼저)대로 공개 IP 와 잇는다. 못 읽었으면 null 그대로 둔다. */
export function followedIpList(ids: readonly string[] | null, ips: readonly Ip[]): Ip[] | null {
  if (!ids) return null;
  const ipsById = new Map(ips.map((ip) => [ip.id, ip]));
  return ids.flatMap((id) => ipsById.get(id) ?? []);
}
