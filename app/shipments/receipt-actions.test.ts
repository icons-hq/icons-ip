import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/auth/server', () => ({ getCurrentAuthState: mocks.auth }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));
import { issueShipmentReceiptConfirmationAction } from './receipt-actions';
const id = '00000000-0000-4000-8000-000000000492';
beforeEach(() => { vi.resetAllMocks(); mocks.auth.mockResolvedValue({ isConfigured: true, user: { id: 'owner' } }); });
describe('customer receipt confirmation', () => {
  it('requires a logged in customer before requesting a confirmation value', async () => {
    mocks.auth.mockResolvedValue({ isConfigured: true, user: null });
    expect(await issueShipmentReceiptConfirmationAction(id)).toMatchObject({ ok: false }); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('uses the caller session and returns only the issued value and its technical bounds', async () => {
    mocks.rpc.mockResolvedValue({ data: { code: '1234ABCD5678', expiresAt: '2026-09-10T12:10:00Z', maxAttempts: 5, unrelated: 'not returned' }, error: null });
    expect(await issueShipmentReceiptConfirmationAction(id)).toEqual({ ok: true, code: '1234ABCD5678', expiresAt: '2026-09-10T12:10:00Z', maxAttempts: 5 });
    expect(mocks.rpc).toHaveBeenCalledWith('issue_shipment_receipt_confirmation', { p_shipment_id: id });
  });
  it('does not turn unknown ownership or an invalid response into an issued value', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'shipment_not_found' } });
    expect(await issueShipmentReceiptConfirmationAction(id)).toMatchObject({ ok: false });
    mocks.rpc.mockResolvedValue({ data: { code: 'short', expiresAt: '2026-09-10T12:10:00Z', maxAttempts: 5 }, error: null });
    expect(await issueShipmentReceiptConfirmationAction(id)).toMatchObject({ ok: false });
  });
});
