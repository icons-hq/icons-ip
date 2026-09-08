export type AdminGoodsVariant = {
  id: string;
  goodId: string;
  name: string;
  price: number;
  stockQty: number;
  isDefault: boolean;
  archivedAt: string | null;
};
