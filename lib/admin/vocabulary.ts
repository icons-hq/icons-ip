/** ADR-0014: operator labels only. Domain code, public copy and card/ticket screens keep their vocabulary. */
export const ADMIN_VOCABULARY = Object.freeze({
  goods: '상품',
  /**
   * 시스템이 저장할 때 만드는 상품 코드(goods.code, ADR-0048). 스마트스토어의 '판매자상품코드'는 바코드·ERP 코드를 넣을 칸으로
   * 읽혀(2026-11-19 사고) 이름에 '자동'을 넣었다. 사람이 넣는 ERP 코드·바코드와 같은 '○○ 코드' 꼴이고 앞말이 출처다.
   */
  goodsCode: '상품 자동코드',
  /** 시스템이 매기는 바뀌지 않는 숫자(goods.product_no, ADR-0038). */
  goodsNumber: '상품번호',
  /**
   * 상품을 처음 저장할 때 정해지는 영문 값(goods.id — 바뀌지 않는 내부 식별자). 상품번호와 다르다.
   * 2026-11-25부터 고객 화면 주소는 상품 자동코드로 열리고(ADR-0050) 이 값의 주소는 새 주소로 옮겨진다 — 이름은 아직 그대로다.
   */
  goodsUrl: '상품 URL',
  /** 고객이 여는 상품 상세 주소(`xsquare.kr/shop/<상품 자동코드 소문자>`, ADR-0050). 상품 자동코드를 따른다. */
  goodsAddress: '고객 화면 주소',
  goodsList: '상품 조회/수정',
  goodsGroups: '그룹상품 조회/수정',
  goodsGroupsCreate: '그룹상품 등록',
  goodsRegister: '상품 등록',
  goodsImport: '상품 일괄등록',
  additionalGoods: '추가구성상품',
  option: '옵션',
  /* 상품 편집의 가격·재고 입력은 스마트스토어 용어를 쓴다. 저장 계약은 price=할인가, compareAtPrice=판매가(할인 시)다. */
  salePrice: '판매가',
  instantDiscount: '즉시할인',
  discountedPrice: '할인가',
  optionPrice: '옵션가',
  stockQuantity: '재고수량',
  /** 옵션마다 시스템이 만드는 코드(goods_variants.code, ADR-0048). 출고지시 엑셀의 '옵션코드' 열이 이 값이다. */
  optionCode: '옵션 자동코드',
  noticeInfo: '상품정보제공고시',
  saleStatus: '판매상태',
  displayStatus: '전시상태',
  productInquiry: '문의 관리',
  customerInquiry: '고객문의 관리',
  orderSearch: '주문통합검색',
  unpaidOrders: '미결제 확인',
  dispatch: '발주(주문)확인/발송관리',
  shipping: '배송현황 관리',
  claims: '취소·반품·교환 관리',
  claimRequest: '취소·반품·교환 요청',
  claimNumber: '요청번호',
  claimStatus: '처리 상태',
  claimRate: '요청률',
  confirmed: '발주확인',
  settled: '거래확정',
  settledHint: '구매자 직접 확정 또는 설정된 자동 정책으로 거래가 확정된 상태입니다. 판매대금 지급 완료나 반품·교환 권리의 소멸을 뜻하지 않습니다.',
});

/** Adapt existing static goods-operation copy; never apply to user-entered names or card/ticket surfaces. */
export function adminGoodsCopy(copy: string): string {
  const particles: Record<string, string> = { 가: '이', 는: '은', 를: '을', 와: '과', 로: '으로' };
  return copy
    .replace(/굿즈\s*코드/g, ADMIN_VOCABULARY.goodsCode)
    .replace(/고시정보/g, ADMIN_VOCABULARY.noticeInfo)
    .replace(/굿즈(?!샵| 마켓)(가|는|를|와|로)?/g, (_, particle: string | undefined) =>
      ADMIN_VOCABULARY.goods + (particle ? particles[particle] : ''))
    .replace(/추가(?:\s*구성)?\s*상품/g, ADMIN_VOCABULARY.additionalGoods);
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

/** 판매상태(goods.stock) 값의 화면 이름. 목록·건수 칸·일괄 변경·상품 수정·가이드가 같은 말을 쓴다(저장 값은 그대로다). */
export const ADMIN_STOCK_LABELS = { ok: '판매중', low: '소량 재고', soldout: '판매중지' } satisfies Record<import('@/lib/data').Stock, string>;
