import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { sendOrderShippedEmail, type TransactionalEmailResult } from './transactional.server';

export interface ShipmentEmailReference { orderId: string; shipmentId: string }

/** Confirm durable IDs only; dispatch itself already inserts the outbox transactionally. */
export async function enqueueOrderShippedEmails(rows: readonly ShipmentEmailReference[]): Promise<{ queued: number }> {
  try {
    if (rows.length > 1000) throw new Error('invalid_batch');
    if (!rows.length) return { queued: 0 };
    const client = await createClient();
    const { data, error } = await client.rpc('admin_enqueue_shipment_emails', {
      target_rows: rows.map(({ orderId, shipmentId }) => ({ orderId, shipmentId })),
    });
    if (error || !Number.isInteger(data?.queued) || data.queued < 0 || data.queued > rows.length) {
      throw new Error('invalid_enqueue_result');
    }
    return { queued: data.queued };
  } catch {
    console.error('[email] shipment_email_enqueue_failed');
    throw new Error('shipment_email_enqueue_failed');
  }
}

interface ClaimedJob { order_id: string; shipment_id: string; claim_token: string; delivery_state: 'ready' | 'busy' | 'sent' | 'unknown' }
interface DeliveryOutcome { outcome: 'sent' | 'already_delivered' | 'retry' | 'review'; error_code: string | null }

function deliveryOutcome(result: TransactionalEmailResult): DeliveryOutcome {
  if (result.status === 'sent') return { outcome: 'sent', error_code: null };
  if (result.status === 'skipped') {
    if (result.reason === 'already_delivered') return { outcome: 'already_delivered', error_code: null };
    if (result.reason === 'recipient_missing') return { outcome: 'review', error_code: 'recipient_missing' };
    return { outcome: 'review', error_code: 'shipment_unavailable' };
  }
  if (result.error === 'provider_not_configured') return { outcome: 'retry', error_code: 'provider_not_configured' };
  if (/^provider_http_(429|5[0-9]{2})$/.test(result.error)) return { outcome: 'retry', error_code: 'provider_retryable' };
  if (/^provider_http_[1-5][0-9]{2}$/.test(result.error)) return { outcome: 'review', error_code: 'delivery_rejected' };
  // A network timeout can follow provider acceptance. Preserve the uncertainty for review.
  return { outcome: 'review', error_code: 'delivery_outcome_unknown' };
}

/** One cron run owns at most 25 leases and performs at most five provider calls concurrently. */
export async function processOrderShipmentEmails() {
  const service = createServiceClient();
  const { data, error } = await service.rpc('claim_shipment_email_jobs', { batch_limit: 25 });
  if (error || !Array.isArray(data) || data.length > 25) throw new Error('shipment_email_claim_failed');
  const jobs = data as ClaimedJob[];
  const result = { claimed: jobs.length, completed: 0, retried: 0, review: 0, failed: 0 };
  for (let offset = 0; offset < jobs.length; offset += 5) {
    await Promise.all(jobs.slice(offset, offset + 5).map(async (job) => {
      try {
        let delivery: DeliveryOutcome;
        try {
          if (job.delivery_state === 'sent') delivery = { outcome: 'already_delivered', error_code: null };
          else if (job.delivery_state === 'busy') delivery = { outcome: 'retry', error_code: 'delivery_in_progress' };
          else if (job.delivery_state === 'unknown') delivery = { outcome: 'review', error_code: 'delivery_outcome_unknown' };
          else delivery = deliveryOutcome(await sendOrderShippedEmail({ orderId: job.order_id, shipmentId: job.shipment_id }));
        }
        catch { delivery = { outcome: 'review', error_code: 'delivery_outcome_unknown' }; }
        const finished = await service.rpc('finish_shipment_email_job', {
          target_shipment: job.shipment_id, target_claim: job.claim_token, ...delivery,
        });
        if (finished.error) throw new Error('finish_failed');
        if (finished.data === 'completed') result.completed += 1;
        else if (finished.data === 'pending') result.retried += 1;
        else if (finished.data === 'review') result.review += 1;
        else result.failed += 1;
      } catch { result.failed += 1; }
    }));
  }
  if (result.review || result.failed) console.error('[email] shipment_email_jobs_need_attention', { review: result.review, failed: result.failed });
  return result;
}
