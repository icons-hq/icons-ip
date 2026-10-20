'use server';
import { unstable_rethrow } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { parseGoodsGroupIdentity } from '@/lib/admin/goods-groups';
import { transactionExactKeys, transactionInteger, transactionRecord } from '@/lib/goods-transaction-values';
import { isUuid } from '@/lib/uuid';
import { CLAIM_FEE_POLICY_PATH, claimFeeError, parseClaimFeePolicy } from '@/lib/orders/claim-fees';
export async function readClaimFeePolicyAction() {
 if (!await requireAdminActionAccess('/admin/sales/claims/returns', { capability: 'sales.manage' })) return { error: claimFeeError('42501') };
 try { const { data, error } = await (await createClient()).rpc('admin_get_claim_fee_policy'); const policy = error ? null : parseClaimFeePolicy(data);
  return policy ? { policy } : { error: claimFeeError(error?.code, error?.message) };
 } catch (error) { unstable_rethrow(error); return { error: claimFeeError() }; }
}
export async function saveClaimFeePolicyAction(values: unknown, revision: unknown, operationId: unknown, rawIdentity: unknown) {
 const identity = parseGoodsGroupIdentity(rawIdentity);
 if (!identity || !isUuid(operationId) || !transactionInteger(revision, 1) || !transactionRecord(values) || !transactionExactKeys(values, ['enabled', 'returnAmount', 'exchangeAmount', 'evidence', 'confirmed'])
  || typeof values.enabled !== 'boolean' || [values.returnAmount, values.exchangeAmount].some(a => a !== null && !transactionInteger(a, 1, 1000000))
  || values.confirmed !== true || typeof values.evidence !== 'string' || values.evidence.trim().length < 2 || values.evidence.length > 1000 || /[\u0000-\u001f\u007f]/u.test(values.evidence)) return { error: claimFeeError('22023') };
 const auth = await requireAdminActionAccess('/admin/sales/claims/returns', { capability: 'sales.manage' });
 if (!auth || auth.user.id !== identity.actorId) return { error: claimFeeError('42501') };
 try { const { data, error } = await (await createClient()).rpc('admin_save_claim_fee_policy', { p_values: values, p_revision: revision, p_operation: operationId, p_actor: identity.actorId, p_session: identity.sessionId });
  const policy = error ? null : parseClaimFeePolicy(data);
  if (!policy) return { error: claimFeeError(error?.code, error?.message) };
  revalidatePath(CLAIM_FEE_POLICY_PATH); return { policy };
 } catch (error) { unstable_rethrow(error); return { error: claimFeeError() }; }
}
