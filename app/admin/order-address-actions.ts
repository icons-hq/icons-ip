'use server';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';
import { normalizeOrderAddressRequest, orderAddressError, orderAddressReceiptMatches, parseOrderAddressReceipt, type OrderAddressContext, type OrderAddressReceipt } from '@/lib/admin/order-address';
import { getOrderAddressContext, getOrderAddressReceipt } from '@/lib/admin/order-address.server';
const PATH = '/admin/sales/orders';
const access = () => requireAdminActionAccess(PATH, { capability: 'sales.manage' });
export async function loadOrderAddressContextAction(orderId: string): Promise<{ context: OrderAddressContext } | { error: string }> {
  if (!await access()) return { error: '현재 매니저 권한을 확인해주세요.' };
  if (!isUuid(orderId)) return { error: '주문번호를 확인해주세요.' };
  try { return { context: await getOrderAddressContext(orderId.toLowerCase()) }; }
  catch (error) { unstable_rethrow(error); return { error: '배송 정보와 변경 이력을 읽지 못했습니다. 다시 확인해주세요.' }; }
}
export type OrderAddressActionResult = { receipt: OrderAddressReceipt | null } | { error: string; uncertain?: boolean; conflict?: boolean };
export async function readOrderAddressChangeAction(id: string): Promise<OrderAddressActionResult> {
  if (!await access()) return { error: '현재 매니저 권한을 확인해주세요.' };
  if (!isUuid(id)) return { error: '변경 요청번호를 확인해주세요.' };
  try { return { receipt: await getOrderAddressReceipt(id.toLowerCase()) }; }
  catch (error) { unstable_rethrow(error); return { error: '저장 결과를 읽지 못했습니다. 같은 요청을 다시 확인해주세요.', uncertain: true }; }
}
export async function changeOrderAddressAction(input: unknown): Promise<OrderAddressActionResult> {
  if (!await access()) return { error: '현재 매니저 권한을 확인해주세요.' };
  const parsed = normalizeOrderAddressRequest(input); if ('error' in parsed) return parsed;
  const request = parsed.request;
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('admin_change_order_address', { p_operation_id: request.id, p_order_id: request.orderId,
      p_expected_revision: request.revision, p_address: request.address, p_reason: request.reason, p_customer_agreed: request.agreed });
    if (error) return { error: orderAddressError(error.code, error.message), conflict: error.code === 'PT409', uncertain: !['42501', 'PT409', '22023', '23514', 'P0002'].includes(error.code ?? '') };
    const receipt = parseOrderAddressReceipt(data);
    if (!receipt || !orderAddressReceiptMatches(receipt, request)) return { error: '저장 결과를 확인하지 못했습니다. 같은 요청의 결과를 조회해주세요.', uncertain: true };
    for (const path of [PATH, `${PATH}/${request.orderId}`, '/admin/sales/dispatch', '/admin/sales/shipping', `/orders/${request.orderId}`, `/checkout/${request.orderId}`]) revalidatePath(path);
    return { receipt };
  } catch (error) { unstable_rethrow(error); return { error: '저장 결과가 불확실합니다. 같은 요청의 결과를 확인해주세요.', uncertain: true }; }
}
