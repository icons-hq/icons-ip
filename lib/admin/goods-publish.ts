export interface AdminGoodSaleReadiness {
  publishedAt: string | null;
  archivedAt: string | null;
  stockQty: number;
  noticeComplete: boolean;
}

/** Publication, option stock sum, and completed notice information are independent. */
export function canSellAdminGood(good: AdminGoodSaleReadiness): boolean {
  return Boolean(good.publishedAt) && !good.archivedAt && good.stockQty > 0 && good.noticeComplete;
}
