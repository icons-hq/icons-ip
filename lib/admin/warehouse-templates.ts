/** Exact header order from the warehouse templates; shared by export and reply import. */
export const SEOWON_EXPORT_HEADERS = [
  '받는분전화번호', '받는분기타연락처', '받는분우편번호', '받는분주소(전체,분할)', '운임Type', '수량', '품목명',
] as const;

export const GIMPO_EXPORT_HEADERS = [
  '상품명(확정)+옵션(수집)+수량(조합용)', '상품명(확정)+옵션(확정)+수량(조합용)',
  '수취인주소(1)', '수취인명+쇼핑몰명(1)', '수취인전화번호1', '수취인전화번호2', '배송메세지',
  '주문번호(사방넷)', '주문번호(쇼핑몰)', '옵션별칭', '상품명(확정)', '옵션(수집)', '옵션(확정)',
  '공급단가', '주문금액/수량', '수량', 'EA(상품)', '수취인우편번호(1)', '수취인명', '배송비(수집)', '운송장번호',
] as const;
