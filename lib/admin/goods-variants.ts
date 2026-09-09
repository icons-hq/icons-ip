export type AdminGoodsVariant = {
  attributes?: Record<string, string>;
  id: string;
  code: string;
  goodId: string;
  name: string;
  price: number;
  stockQty: number;
  isDefault: boolean;
  archivedAt: string | null;
};
