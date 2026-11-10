import { emptyInterestCollection, type ShippingSavings } from '../../lib/product-detail-experiences';

// Product previews have no customer, cart, shipping, or database connection.
export async function loadInterestAvailabilityAction() { return false; }
export async function loadInterestCollectionAction() { return emptyInterestCollection(); }
export async function loadShippingSavingsAction(): Promise<ShippingSavings> {
  return { items: [], nextChangeAt: null, unavailable: true };
}
