'use server';
import { unstable_rethrow } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { createClient } from '@/lib/supabase/server';
import { parseGoodsGroupIdentity } from '@/lib/admin/goods-groups';
import { transactionExactKeys, transactionInteger, transactionRecord } from '@/lib/goods-transaction-values';
import { isUuid } from '@/lib/uuid';
import { PURCHASE_CONFIRMATION_POLICY_PATH, parsePurchaseConfirmationPolicy, purchaseConfirmationError } from '@/lib/purchase-confirmation';
export async function readPurchaseConfirmationPolicyAction() {
  if (!await requireAdminActionAccess(PURCHASE_CONFIRMATION_POLICY_PATH, { capability: 'sales.manage' })) return { error: purchaseConfirmationError('42501') };
  try {
    const { data, error } = await (await createClient()).rpc('admin_get_purchase_confirmation_policy');
    const policy = error ? null : parsePurchaseConfirmationPolicy(data);
    return policy ? { policy } : { error: purchaseConfirmationError(error?.code, error?.message) };
  } catch (error) { unstable_rethrow(error); return { error: purchaseConfirmationError() }; }
}
export async function savePurchaseConfirmationPolicyAction(values: unknown, revision: unknown, operationId: unknown, rawIdentity: unknown) {
  const identity = parseGoodsGroupIdentity(rawIdentity);
  if (!identity || !transactionInteger(revision, 1) || !isUuid(operationId) || !transactionRecord(values)
    || !transactionExactKeys(values, ['autoEnabled', 'autoAfterDays', 'buyerExtensionDays', 'evidence', 'acknowledged']) || typeof values.autoEnabled !== 'boolean'
    || [values.autoAfterDays, values.buyerExtensionDays].some(v => v !== null && !transactionInteger(v, 1, 36500))
    || values.autoEnabled && values.autoAfterDays === null || values.acknowledged !== true || typeof values.evidence !== 'string' || !values.evidence.trim() || values.evidence.length > 2000) return { error: '기간과 정책 근거·적용 확인을 입력해주세요.' };
  const auth = await requireAdminActionAccess(PURCHASE_CONFIRMATION_POLICY_PATH, { capability: 'sales.manage' });
  if (!auth || auth.user.id !== identity.actorId) return { error: purchaseConfirmationError('42501') };
  try {
    const { data, error } = await (await createClient()).rpc('admin_save_purchase_confirmation_policy', { p_values: values, p_revision: revision, p_operation_id: operationId, p_actor: identity.actorId, p_session: identity.sessionId });
    const policy = error ? null : parsePurchaseConfirmationPolicy(data);
    if (!policy) return { error: purchaseConfirmationError(error?.code, error?.message) };
    revalidatePath(PURCHASE_CONFIRMATION_POLICY_PATH); revalidatePath('/admin/sales/settled'); return { policy };
  } catch (error) { unstable_rethrow(error); return { error: purchaseConfirmationError() }; }
}
