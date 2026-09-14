export const ADMIN_QA_VIEWPORTS = [
  { width: 1440, height: 1000 }, { width: 1280, height: 900 },
  { width: 1024, height: 900 }, { width: 768, height: 1024 },
  { width: 390, height: 844 }, { width: 320, height: 740 },
];

// Exact visible shell/page headings, not arbitrary text somewhere in the DOM.
// Detail records and selected/edit states belong in an external run manifest.
export const ADMIN_QA_ROUTES = [
  ['', '개요'], ['sales/orders', '주문 통합검색'], ['sales/unpaid', '미입금 확인'],
  ['sales/dispatch', '발주·발송 관리'], ['sales/shipping', '배송현황 관리'],
  ['sales/settled', '거래확정 내역'], ['sales/claims/cancels', '취소 관리'],
  ['sales/claims/returns', '반품 관리'], ['sales/claims/exchanges', '교환 관리'],
  ['sales/coupons', '쿠폰 관리'], ['cs/inquiries', '1:1 문의'], ['cs/faq', 'FAQ 관리'],
  ['cs/qna', '상품 Q&A'], ['cs/reviews', '리뷰 관리'],
  ['catalog/ips', 'IP'], ['catalog/ips?create=1', 'IP 등록'],
  ['catalog/goods', '상품'], ['catalog/goods?create=1', '상품 등록'],
  ['catalog/goods/import', '상품 엑셀 등록·수정'], ['catalog/goods/export', '상품 엑셀 내보내기'],
  ['catalog/categories', '고객 카테고리'], ['catalog/notice-presets', '상품정보제공고시 프리셋'],
  ['catalog/cards', '카드'], ['catalog/pools', '카드풀'], ['catalog/policies', '뽑기권 발급 정책'],
  ['catalog/grants', '카드팩 수동 발급'], ['catalog/games', '게임'],
  ['catalog/events', '이벤트'], ['catalog/ticket-types', '티켓 회차'],
  ['display/curations', '홈 큐레이션'], ['display/campaigns', '캠페인'],
  ['community/moderation', '모더레이션'], ['community/members', '회원'], ['community/roles', '역할'],
  ['messaging/notifications', '공지 발송'], ['messaging/emails', '메일 발송 이력'],
  ['stats/sales', '판매분석'], ['stats/claims', '취소·반품·교환 관리'], ['stats/customers', '고객현황'],
  ['settings/operations', '운영 준비'], ['settings/store-credits', '적립금 정책'],
  ['settings/store', '사업자·CS·결제 표시'], ['settings/origins', '출고지·배송비'],
  ['settings/shipping-regions', '지역 추가 배송비'], ['settings/shipping-notices', '배송정보 템플릿'],
  ['settings/carriers', '택배사 관리'], ['check-in', '현장 티켓 검표'], ['guide', '사용 가이드'],
].map(([path, heading]) => ({ id: path.replaceAll('/', '-').replace('?create=1', '-create') || 'overview', path: `/admin${path ? `/${path}` : ''}`, heading }));
