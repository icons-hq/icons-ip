import { subscriptionActor, subscriptionAvailability } from '@/lib/subscriptions/runtime.server';
import { subscriptionJson } from '@/lib/subscriptions/http.server';
export async function GET() {
  try {
    const actor = await subscriptionActor();
    if (!actor) return subscriptionJson({ canEnroll: false, menuAvailable: false });
    const state = await subscriptionAvailability(actor.actorId);
    return subscriptionJson({ canEnroll: state.canEnroll, menuAvailable: state.menuAvailable });
  } catch { return subscriptionJson({ canEnroll: false, menuAvailable: false }, 503); }
}
