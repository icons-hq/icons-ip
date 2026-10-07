/**
 * ERP 품목 마스터 계약.
 *
 * MD가 ERP '품목 생성' 데이터를 어드민에 반입해 두면, 상품 옵션에 ERP 품명을
 * 입력할 때 품번·바코드·고객 카테고리·판매가를 제안한다. ERP와 실시간 연동은
 * 하지 않는다. 반입된 값은 제안일 뿐이며 MD가 상품 화면에서 바꿀 수 있다.
 */
export type ErpItemMatch = {
  /** ERP 품번 */
  code: string;
  /** ERP 품명 */
  name: string;
  /** ERP 카테고리 원문. 없으면 null */
  category: string | null;
  /** ERP 판매가(원). 없으면 null */
  salePrice: number | null;
  barcode: string | null;
  /** 이 ERP 카테고리에 연결해 둔 ICONS 고객 카테고리 id. 연결이 없으면 null */
  mappedCategoryId: string | null;
};
