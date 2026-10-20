import { loadSubscriptionOffers } from '@/lib/subscriptions/customer.server';
import { subscriptionJson } from '@/lib/subscriptions/http.server';
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams, ids = params.getAll('goodId');
  if (!ids.length || ids.length > 100 || [...params.keys()].some(key => key !== 'goodId') || ids.some(id => !id || id.length > 200)) return subscriptionJson({ offers: [] }, 400);
  try { return subscriptionJson({ offers: await loadSubscriptionOffers(ids) }); }
  catch { return subscriptionJson({ offers: [] }, 503); }
}
