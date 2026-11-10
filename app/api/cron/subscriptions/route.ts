import { isUuid } from '@/lib/uuid';
import { createServiceClient } from '@/lib/supabase/service';
import { timingSafeEqual } from 'node:crypto';
import { runtimeGoodsSubscriptionWorker } from '@/lib/subscriptions/worker.server';
import { runBillingCredentialCleanup } from '@/lib/subscriptions/credential-revocation.server';
import { subscriptionJson } from '@/lib/subscriptions/http.server';
export const maxDuration = 90;
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET, expected = Buffer.from(secret ?? ''), authorization = request.headers.get('authorization');
  const actual = Buffer.from(authorization?.startsWith('Bearer ') ? authorization.slice(7) : '');
  if (!secret || expected.length !== actual.length || !timingSafeEqual(expected, actual)) return subscriptionJson({ ok: false }, 401);
  try {
    const service = createServiceClient();
    for (const name of ['service_purge_billing_registration_secrets', 'service_purge_goods_subscription_exports']) {
      const { error } = await service.rpc(name, { p_limit: 100 }); if (error) throw new Error('subscription_cleanup_unavailable');
    }
    // New charges require the DB worker and charge gates; dispatched recovery remains available.
    const result = await runtimeGoodsSubscriptionWorker().run();
    const cleanup = result.state === 'idle' ? await runBillingCredentialCleanup() : null;
    if (result.state === 'idle' && (!cleanup || cleanup.state === 'idle')) {
      const candidates = await service.rpc('service_list_fenced_goods_transaction_cleanup_candidates', { p_limit: 1 });
      if (candidates.error || !Array.isArray(candidates.data) || candidates.data.length > 1 || candidates.data.some(id => !isUuid(id))) throw new Error('subscription_cleanup_unavailable');
      if (candidates.data[0]) {
        const cleaned = await service.rpc('service_cleanup_fenced_goods_transactions', { p_actor: candidates.data[0] });
        if (cleaned.error || !cleaned.data || !['not_fenced', 'cleaned', 'deferred'].includes(cleaned.data.state)) throw new Error('subscription_cleanup_unavailable');
      }
    }
    return subscriptionJson({ ok: true, state: result.state, processed: result.state === 'idle' ? 0 : 1, cleanup: cleanup?.state ?? null });
  } catch { return subscriptionJson({ ok: false, error: 'subscription_work_unavailable' }, 502); }
}
