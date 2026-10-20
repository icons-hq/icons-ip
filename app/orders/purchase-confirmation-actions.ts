'use server';
import { unstable_rethrow } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getCurrentAuthState } from '@/lib/auth/server';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { createClient } from '@/lib/supabase/server';
import { parseGoodsGroupIdentity } from '@/lib/admin/goods-groups';
import { isUuid } from '@/lib/uuid';
import { parsePurchaseConfirmation, purchaseConfirmationError, type PurchaseConfirmation } from '@/lib/purchase-confirmation';
type Result = { value: PurchaseConfirmation } | { error: string };
async function allowed(admin: boolean, actor?: string) {
  const auth = admin ? await requireAdminActionAccess('/admin/sales/settled', { capability: 'sales.manage' }) : await getCurrentAuthState();
  return Boolean(auth?.user && (!actor || auth.user.id === actor));
}
export async function readPurchaseConfirmationAction(orderId: unknown, admin = false): Promise<Result> {
  if (!isUuid(orderId) || typeof admin !== 'boolean' || !await allowed(admin)) return { error: purchaseConfirmationError('42501') };
  try {
    const { data, error } = await (await createClient()).rpc(admin ? 'admin_get_purchase_confirmation' : 'get_my_purchase_confirmation', { p_order_id: orderId });
    const value = error ? null : parsePurchaseConfirmation(data);
    return value?.orderId === orderId ? { value } : { error: purchaseConfirmationError(error?.code, error?.message) };
  } catch (error) { unstable_rethrow(error); return { error: purchaseConfirmationError() }; }
}
export async function changePurchaseConfirmationAction(orderId: unknown, kind: unknown, note: unknown, revision: unknown, operationId: unknown, rawIdentity: unknown, admin = false, acknowledged = false): Promise<Result> {
  const identity = parseGoodsGroupIdentity(rawIdentity);
  if (!identity || !isUuid(orderId) || !isUuid(operationId) || !Number.isSafeInteger(revision) || Number(revision) < 0 || typeof admin !== 'boolean'
    || typeof kind !== 'string' || !(admin ? ['request', 'hold', 'resume'] : ['confirm', 'extend']).includes(kind) || typeof note !== 'string' || note.length > 500
    || kind === 'hold' && !note.trim() || !admin && acknowledged !== true) return { error: '처리할 항목과 확인 내용을 입력해주세요.' };
  if (!await allowed(admin, identity.actorId)) return { error: purchaseConfirmationError('42501') };
  try {
    const args = { p_order_id: orderId, p_kind: kind, p_revision: revision, p_operation_id: operationId, p_actor: identity.actorId, p_session: identity.sessionId };
    const { data, error } = await (await createClient()).rpc(admin ? 'admin_change_purchase_confirmation' : 'confirm_my_purchase', admin ? { ...args, p_note: note } : { ...args, p_acknowledged: acknowledged });
    const value = error ? null : parsePurchaseConfirmation(data);
    if (!value || value.orderId !== orderId) return { error: purchaseConfirmationError(error?.code, error?.message) };
    for (const path of [`/orders/${orderId}`, `/admin/sales/orders/${orderId}`, '/admin/sales/settled', '/my/store-credits']) revalidatePath(path);
    return { value };
  } catch (error) { unstable_rethrow(error); return { error: purchaseConfirmationError() }; }
}
