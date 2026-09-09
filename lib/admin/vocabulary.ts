/** ADR-0014: operator labels only. Domain code, public copy and card/ticket screens keep their vocabulary. */
export const ADMIN_VOCABULARY = Object.freeze({
  goods: '상품',
  goodsCode: '상품코드',
  option: '옵션',
  noticeInfo: '상품정보제공고시',
  claims: '취소·반품·교환 관리',
  claimRequest: '취소·반품·교환 요청',
  claimNumber: '요청번호',
  claimStatus: '처리 상태',
  claimRate: '요청률',
  confirmed: '발주확인',
  settled: '거래확정',
  settledHint: '배송 완료 후 정해진 기간이 지나 거래가 종료된 상태입니다. 에스크로의 구매확정과 구분합니다.',
});

/** Adapt existing static goods-operation copy; never apply to user-entered names or card/ticket surfaces. */
export function adminGoodsCopy(copy: string): string {
  const particles: Record<string, string> = { 가: '이', 는: '은', 를: '을', 와: '과', 로: '으로' };
  return copy
    .replace(/굿즈\s*코드/g, ADMIN_VOCABULARY.goodsCode)
    .replace(/고시정보/g, ADMIN_VOCABULARY.noticeInfo)
    .replace(/굿즈(?!샵| 마켓)(가|는|를|와|로)?/g, (_, particle: string | undefined) =>
      ADMIN_VOCABULARY.goods + (particle ? particles[particle] : ''));
}

/** Only server-owned notice strings change; preserved form values and user content pass through. */
export function adminGoodsNotice<T extends { message?: string; errors?: Record<string, string | undefined> }>(state: T): T {
  return {
    ...state,
    ...(state.message ? { message: adminGoodsCopy(state.message) } : {}),
    ...(state.errors ? { errors: Object.fromEntries(Object.entries(state.errors).map(([key, value]) =>
      [key, value === undefined ? value : adminGoodsCopy(value)])) } : {}),
  };
}

export function adminClaimCopy(copy: string): string {
  if (copy === '클레임') return ADMIN_VOCABULARY.claims;
  return copy.replace(/클레임번호/g, ADMIN_VOCABULARY.claimNumber)
    .replace(/클레임 상태/g, ADMIN_VOCABULARY.claimStatus)
    .replace(/클레임율/g, ADMIN_VOCABULARY.claimRate)
    .replace(/(취소|반품|교환) 클레임/g, '$1 요청')
    .replace(/클레임 (?:관리|처리)/g, ADMIN_VOCABULARY.claims)
    .replace(/클레임/g, ADMIN_VOCABULARY.claimRequest);
}

/** Raw stock values stay in domain storage; the console uses operator labels. */
export const ADMIN_STOCK_LABELS = { ok: '정상 판매', low: '소량 재고', soldout: '판매 중지' } satisfies Record<import('@/lib/data').Stock, string>;
