import type { AdminGoodsVariant } from './goods-variants';

export interface AdminGoodSaleReadiness {
  publishedAt: string | null;
  archivedAt: string | null;
  stockQty: number;
  activeStockQty?: number;
  saleAvailableQty?: number;
  stock?: 'ok' | 'low' | 'soldout';
  noticeComplete: boolean;
  allowCardPayment?: boolean;
  allowBankTransfer?: boolean;
  saleRestriction?: 'none' | 'adult';
}

/** List summaries carry effective stock; editors must supply their option rows. */
export function canSellAdminGood(
  good: AdminGoodSaleReadiness,
  variants?: readonly Pick<AdminGoodsVariant, 'stockQty' | 'archivedAt'>[],
): boolean {
  const hasStock = good.saleAvailableQty !== undefined ? good.saleAvailableQty > 0 : variants
    ? variants.some((variant) => !variant.archivedAt && variant.stockQty > 0)
    : (good.activeStockQty ?? good.stockQty) > 0;
  const hasPaymentMethod = good.allowCardPayment !== false || good.allowBankTransfer !== false;
  return Boolean(good.publishedAt) && !good.archivedAt && good.stock !== 'soldout' && hasStock && good.noticeComplete
    && hasPaymentMethod && good.saleRestriction !== 'adult';
}
