'use server';
import { isUuid } from '@/lib/uuid';
import { loadProductInterestCollection, loadProductShippingSavings, loadPublicDetailExperienceConfig } from '@/lib/product-detail-experiences.server';
import type { ShippingSavings } from '@/lib/product-detail-experiences';
export async function loadInterestCollectionAction(recentIds: unknown, guestCartIds: unknown) { return loadProductInterestCollection(recentIds, guestCartIds); }
export async function loadInterestAvailabilityAction() { return (await loadPublicDetailExperienceConfig()).interests; }
export async function loadShippingSavingsAction(goodId: string, variantId: string, qty: number): Promise<ShippingSavings> {
  if (!/^[a-z0-9][a-z0-9-]{0,199}$/.test(goodId) || !isUuid(variantId) || !Number.isSafeInteger(qty) || qty < 1 || qty > 1000) return { items: [], nextChangeAt: null, unavailable: true };
  return loadProductShippingSavings(goodId, variantId, qty);
}
