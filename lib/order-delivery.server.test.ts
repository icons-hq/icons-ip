import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), serviceRpc: vi.fn() }));
vi.mock('./supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('./supabase/service', () => ({ createServiceClient: () => ({ rpc: mocks.serviceRpc }) }));
import { loadAdminOrderDeliveries, loadOrderDeliveryForService } from './order-delivery.server';
const first = '10000000-0000-4000-8000-000000000001', second = '10000000-0000-4000-8000-000000000002';
const address = { recipientName: '합성 수령인', phone: '01012345678', postalCode: '12345', address1: '합성 주소' };
const legacyAddress = { recipientName: '원래 수령인', phone: '010-1234-5678', postalCode: ' 1234 ', address1: ' 원본 기본 주소 ', address2: '원래 상세' };
const row = { orderId: first, isGift: false, address, addressRevision: 0, shippingEvidence: null };
beforeEach(() => { vi.clearAllMocks(); });
it('keeps the order list readable when a historical postal format needs review, without rewriting the source', async () => {
 mocks.rpc.mockResolvedValue({ data: [row, { ...row, orderId: second, address: legacyAddress }], error: null });
 const result = await loadAdminOrderDeliveries([first, second]);
 expect(result.size).toBe(2); expect(result.get(first)?.addressNeedsReview).toBeUndefined();
 expect(result.get(second)).toMatchObject({ address: legacyAddress, addressNeedsReview: true });
 expect(result.get(second)?.address?.postalCode).toBe(' 1234 ');
 expect(mocks.rpc).toHaveBeenCalledOnce();
});
it('does not grant the historical display exception to trusted shipping operations', async () => {
 mocks.serviceRpc.mockResolvedValue({ data: { ...row, address: legacyAddress, senderId: first, recipientId: second }, error: null });
 await expect(loadOrderDeliveryForService(first)).rejects.toThrow('order_delivery_projection_invalid');
});
it.each([
 { ...legacyAddress, unexpectedPrivateField: 'not a public address field' },
 { ...legacyAddress, recipientName: 'a'.repeat(51) },
 { ...legacyAddress, address1: { arbitrary: 'payload' } },
])('keeps malformed projection structures sealed', async invalid => {
 mocks.rpc.mockResolvedValue({ data: [{ ...row, address: invalid }], error: null });
 await expect(loadAdminOrderDeliveries([first])).rejects.toThrow('order_delivery_projection_invalid');
});
it('does not substitute historic ordinary-order addresses for validated gift delivery contracts', async () => {
 mocks.rpc.mockResolvedValue({ data: [{ ...row, isGift: true, address: legacyAddress }], error: null });
 await expect(loadAdminOrderDeliveries([first])).rejects.toThrow('order_delivery_projection_invalid');
});
