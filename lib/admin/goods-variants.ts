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
};
