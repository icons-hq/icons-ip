'use server';
import { unstable_rethrow } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { parseGoodsGroupIdentity } from '@/lib/admin/goods-groups';
import { transactionExactKeys, transactionInteger, transactionRecord } from '@/lib/goods-transaction-values';
import { isUuid } from '@/lib/uuid';
import { parseReviewTypePolicy, reviewTypeError } from '@/lib/review-types';
const PATH = '/admin/cs/reviews';
export async function readReviewTypePolicyAction() {
 if (!await requireAdminActionAccess(PATH, { capability: 'cs.manage' })) return { error: reviewTypeError('42501') };
 try { const { data, error } = await (await createClient()).rpc('admin_get_review_type_policy'); const policy = error ? null : parseReviewTypePolicy(data);
  return policy ? { policy } : { error: reviewTypeError(error?.code) };
 } catch (error) { unstable_rethrow(error); return { error: reviewTypeError() }; }
}
export async function saveReviewTypePolicyAction(values: unknown, revision: unknown, operationId: unknown, rawIdentity: unknown) {
 const identity = parseGoodsGroupIdentity(rawIdentity);
 if (!identity || !isUuid(operationId) || !transactionInteger(revision, 1) || !transactionRecord(values)
  || !transactionExactKeys(values, ['enabled', 'basis', 'startDays', 'endDays', 'maxOrderDays', 'rewardEligible', 'evidence', 'confirmed'])
  || values.confirmed !== true || typeof values.evidence !== 'string' || values.evidence.trim().length < 2 || /[\u0000-\u001f\u007f]/u.test(values.evidence)
  || !parseReviewTypePolicy({ ...Object.fromEntries(Object.entries(values).filter(([key]) => key !== 'confirmed')), revision, updatedAt: new Date().toISOString() })) return { error: reviewTypeError('22023'), uncertain: false };
 const auth = await requireAdminActionAccess(PATH, { capability: 'cs.manage' });
 if (!auth || auth.user.id !== identity.actorId) return { error: reviewTypeError('42501'), uncertain: false };
 try { const client = await createClient(); const { data, error } = await client.rpc('admin_save_review_type_policy', { p_values: values, p_revision: revision, p_operation: operationId, p_actor: identity.actorId, p_session: identity.sessionId });
  if (error || !parseReviewTypePolicy(data)) return { error: reviewTypeError(error?.code), uncertain: !['PT409', '42501', '22023'].includes(error?.code ?? '') };
  const current = await client.rpc('admin_get_review_type_policy'), policy = current.error ? null : parseReviewTypePolicy(current.data);
  if (!policy) return { error: reviewTypeError(), uncertain: true };
  revalidatePath(PATH); revalidatePath('/my/reviews'); return { policy };
 } catch (error) { unstable_rethrow(error); return { error: reviewTypeError(), uncertain: true }; }
}
