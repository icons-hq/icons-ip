'use server';
import { unstable_rethrow } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { parseGoodsGroupIdentity } from '@/lib/admin/goods-groups';
import { createClient } from '@/lib/supabase/server';
import { couponCombinationError, parseAdminCouponCombinationPolicy, parseCouponCombinationPolicy } from '@/lib/coupon-combinations';
import { transactionExactKeys, transactionInteger, transactionRecord } from '@/lib/goods-transaction-values';
import { isUuid } from '@/lib/uuid';
const path = '/admin/sales/coupons';
export async function readCouponCombinationPolicyAction() {
 if (!await requireAdminActionAccess(path, { capability: 'marketing.manage' })) return { error: couponCombinationError('42501') };
 try { const { data, error } = await (await createClient()).rpc('admin_get_coupon_combination_policy'); const policy = error ? null : parseAdminCouponCombinationPolicy(data);
  return policy ? { policy } : { error: couponCombinationError(error?.code, error?.message) };
 } catch (error) { unstable_rethrow(error); return { error: couponCombinationError() }; }
}
export async function saveCouponCombinationPolicyAction(values: unknown, revision: unknown, operation: unknown, rawIdentity: unknown) {
 const identity = parseGoodsGroupIdentity(rawIdentity);
 if (!identity || !isUuid(operation) || !transactionInteger(revision, 1) || !transactionRecord(values)
  || !transactionExactKeys(values, ['stackingEnabled', 'maxGoodsCoupons', 'shippingEnabled', 'evidence', 'confirmed']) || values.confirmed !== true
  || typeof values.evidence !== 'string' || values.evidence.trim().length < 2 || values.evidence.length > 1000 || /[\u0000-\u001f\u007f]/u.test(values.evidence)
  || !parseCouponCombinationPolicy({ revision, stackingEnabled: values.stackingEnabled, maxGoodsCoupons: values.maxGoodsCoupons, shippingEnabled: values.shippingEnabled })) return { error: couponCombinationError('22023'), uncertain: false };
 const auth = await requireAdminActionAccess(path, { capability: 'marketing.manage' }); if (!auth || auth.user.id !== identity.actorId) return { error: couponCombinationError('42501'), uncertain: false };
 try { const client = await createClient(); const { data, error } = await client.rpc('admin_save_coupon_combination_policy', { p_values: values, p_revision: revision, p_operation: operation, p_actor: identity.actorId, p_session: identity.sessionId });
  if (error || !parseAdminCouponCombinationPolicy(data)) return { error: couponCombinationError(error?.code, error?.message), uncertain: !/^(?:PT409|22[0-9A-Z]{3}|23[0-9A-Z]{3}|42501|P0002)$/.test(error?.code ?? '') };
  const current = await client.rpc('admin_get_coupon_combination_policy'), policy = current.error ? null : parseAdminCouponCombinationPolicy(current.data);
  if (!policy) return { error: couponCombinationError(), uncertain: true };
  revalidatePath(path); revalidatePath('/checkout'); revalidatePath('/my/coupons'); return { policy };
 } catch (error) { unstable_rethrow(error); return { error: couponCombinationError(), uncertain: true }; }
}
