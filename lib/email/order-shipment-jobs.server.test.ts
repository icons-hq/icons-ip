import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enqueueOrderShippedEmails, processOrderShipmentEmails } from './order-shipment-jobs.server';

const mocks = vi.hoisted(() => ({ staffRpc: vi.fn(), serviceRpc: vi.fn(), send: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.staffRpc }) }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ rpc: mocks.serviceRpc }) }));
vi.mock('./transactional.server', () => ({ sendOrderShippedEmail: mocks.send }));

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('enqueueOrderShippedEmails', () => {
  it('surfaces enqueue failure without copying database details', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.staffRpc.mockResolvedValue({ data: null, error: { message: 'buyer@example.test private payload' } });
    await expect(enqueueOrderShippedEmails([{ orderId: 'order', shipmentId: 'shipment' }])).rejects.toThrow('shipment_email_enqueue_failed');
    expect(log).toHaveBeenCalledWith('[email] shipment_email_enqueue_failed');
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('rejects an oversized import before querying the database', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(enqueueOrderShippedEmails(Array.from({ length: 1001 }, () => ({ orderId: 'order', shipmentId: 'shipment' })))).rejects.toThrow('shipment_email_enqueue_failed');
    expect(mocks.staffRpc).not.toHaveBeenCalled();
  });
  it('persists a 1000-shipment request without sending mail in the request', async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({
      orderId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      shipmentId: `10000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    }));
    mocks.staffRpc.mockResolvedValue({ data: { queued: 1000 }, error: null });
    await expect(enqueueOrderShippedEmails(rows)).resolves.toEqual({ queued: 1000 });
    expect(mocks.staffRpc).toHaveBeenCalledWith('admin_enqueue_shipment_emails', { target_rows: rows });
    expect(mocks.send).not.toHaveBeenCalled();
  });
});

describe('processOrderShipmentEmails', () => {
  it('does not report a delivered job as completed when its lease finish fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.serviceRpc.mockImplementation(async (name: string) => name === 'claim_shipment_email_jobs'
      ? { data: [{ order_id: 'order', shipment_id: 'shipment', claim_token: 'claim' }], error: null }
      : { data: null, error: { message: 'private db payload' } });
    mocks.send.mockResolvedValue({ status: 'sent' });
    await expect(processOrderShipmentEmails()).resolves.toEqual({ claimed: 1, completed: 0, retried: 0, review: 0, failed: 1 });
    expect(log).toHaveBeenCalledWith('[email] shipment_email_jobs_need_attention', { review: 0, failed: 1 });
  });
  it('leaves uncertain thrown sends in review', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.serviceRpc.mockImplementation(async (name: string) => ({ data: name === 'claim_shipment_email_jobs'
      ? [{ order_id: 'order', shipment_id: 'shipment', claim_token: 'claim' }] : 'review', error: null }));
    mocks.send.mockRejectedValue(new Error('provider recipient payload'));
    await expect(processOrderShipmentEmails()).resolves.toEqual({ claimed: 1, completed: 0, retried: 0, review: 1, failed: 0 });
  });
  it.each([
    ['unknown', 'review', 'delivery_outcome_unknown'],
    ['sent', 'already_delivered', null],
    ['busy', 'retry', 'delivery_in_progress'],
  ])('does not send over existing %s delivery evidence', async (state, outcome, errorCode) => {
    mocks.serviceRpc.mockImplementation(async (name: string) => ({ data: name === 'claim_shipment_email_jobs'
      ? [{ order_id: 'order', shipment_id: 'shipment', claim_token: 'claim', delivery_state: state }] : 'pending', error: null }));
    await processOrderShipmentEmails();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.serviceRpc).toHaveBeenCalledWith('finish_shipment_email_job', {
      target_shipment: 'shipment', target_claim: 'claim', outcome, error_code: errorCode,
    });
  });
  it.each([
    [{ status: 'skipped', reason: 'already_delivered' }, 'already_delivered', null],
    [{ status: 'failed', error: 'provider_http_429' }, 'retry', 'provider_retryable'],
    [{ status: 'failed', error: 'provider_http_503' }, 'retry', 'provider_retryable'],
    [{ status: 'failed', error: 'provider_not_configured' }, 'retry', 'provider_not_configured'],
    [{ status: 'failed', error: 'provider_http_400' }, 'review', 'delivery_rejected'],
    [{ status: 'failed', error: 'provider_network_error' }, 'review', 'delivery_outcome_unknown'],
    [{ status: 'failed', error: 'secret@example.test provider body' }, 'review', 'delivery_outcome_unknown'],
    [{ status: 'skipped', reason: 'recipient_missing' }, 'review', 'recipient_missing'],
    [{ status: 'skipped', reason: 'shipment_items_missing' }, 'review', 'shipment_unavailable'],
    [{ status: 'skipped', reason: 'order_status_mismatch:canceled' }, 'review', 'shipment_unavailable'],
  ])('retains a safe decision for %j', async (delivery, outcome, errorCode) => {
    mocks.serviceRpc.mockImplementation(async (name: string) => ({ data: name === 'claim_shipment_email_jobs'
      ? [{ order_id: 'order', shipment_id: 'shipment', claim_token: 'claim' }] : 'pending', error: null }));
    mocks.send.mockResolvedValue(delivery);
    await processOrderShipmentEmails();
    expect(mocks.serviceRpc).toHaveBeenCalledWith('finish_shipment_email_job', {
      target_shipment: 'shipment', target_claim: 'claim', outcome, error_code: errorCode,
    });
  });
  it('sends only the claimed batch and completes each lease', async () => {
    const jobs = Array.from({ length: 25 }, (_, i) => ({ order_id: `order-${i}`, shipment_id: `shipment-${i}`, claim_token: `claim-${i}` }));
    mocks.serviceRpc.mockImplementation(async (name: string) => ({ data: name === 'claim_shipment_email_jobs' ? jobs : 'completed', error: null }));
    let active = 0; let maximum = 0;
    mocks.send.mockImplementation(async () => { active += 1; maximum = Math.max(maximum, active); await new Promise((resolve) => setTimeout(resolve, 1)); active -= 1; return { status: 'sent' }; });
    await expect(processOrderShipmentEmails()).resolves.toEqual({ claimed: 25, completed: 25, retried: 0, review: 0, failed: 0 });
    expect(maximum).toBeLessThanOrEqual(5);
    expect(mocks.send).toHaveBeenCalledWith({ orderId: 'order-0', shipmentId: 'shipment-0' });
    expect(mocks.serviceRpc.mock.calls.filter(([name]) => name === 'claim_shipment_email_jobs')).toEqual([['claim_shipment_email_jobs', { batch_limit: 25 }]]);
    expect(mocks.serviceRpc).toHaveBeenCalledWith('finish_shipment_email_job', { target_shipment: 'shipment-0', target_claim: 'claim-0', outcome: 'sent', error_code: null });
  });
});
