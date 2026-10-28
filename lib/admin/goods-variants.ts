export type AdminGoodsVariant = {
  attributes?: Record<string, string>;
  id: string;
  code: string;
  goodId: string;
  name: string;
  price: number;
  stockQty: number;
  /** null/undefined means no warning threshold; zero is a configured threshold. */
  lowStockThreshold?: number | null;
  /** Internal ERP fields are nullable and intentionally separate from code. */
  erpCode?: string | null;
  erpName?: string | null;
  barcode?: string | null;
  externalUpdatedAt?: string | null;
  isDefault: boolean;
  archivedAt: string | null;
  updatedAt?: string;
  /** 옵션별 구매 제한(D7②): 주문 1건·회원 1명의 최대 수량. null = 제한 없음, undefined = 읽지 않음(저장 키에서 빠져 DB 값 유지). */
  orderMaxQty?: number | null;
  memberMaxQty?: number | null;
};
