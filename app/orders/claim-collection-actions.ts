'use server';
import { unstable_rethrow } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { parseGoodsGroupIdentity } from '@/lib/admin/goods-groups';
import { transactionInteger } from '@/lib/goods-transaction-values';
import { isUuid } from '@/lib/uuid';
import { claimCollectionError, normalizeClaimCollectionValues, parseClaimCollectionDocument, parseClaimReturnBundles, withClaimReturnBundles } from '@/lib/orders/claim-collection';
export async function readClaimCollectionAction(claimId: unknown, rawIdentity: unknown, operator: boolean) {
  const identity = parseGoodsGroupIdentity(rawIdentity);
  if (!identity || !isUuid(claimId) || typeof operator !== 'boolean') return { error: claimCollectionError('22023') };
  if (operator && !await requireAdminActionAccess('/admin/sales/orders', { capability: 'sales.manage' })) return { error: claimCollectionError('42501') };
  try {
    const { data, error } = await (await createClient()).rpc(operator ? 'admin_read_claim_collection_plan' : 'read_my_claim_collection_plan', { p_claim: claimId, p_actor: identity.actorId, p_session: identity.sessionId });
    if (!error && data === null && !operator) return { document: null };
    const document = error ? null : parseClaimCollectionDocument(data);
    if (document?.claimId !== claimId) return { error: claimCollectionError(error?.code, error?.message) };
    // 회수 주소(묶음)는 문서에 키를 더하지 않고 별도 RPC로 읽어 합친다(이전 앱 파서와의 배포 창 호환).
    const bundleRead = await (await createClient()).rpc(operator ? 'admin_read_claim_return_bundles' : 'read_my_claim_return_bundles', { p_claim: claimId, p_actor: identity.actorId, p_session: identity.sessionId });
    const bundles = bundleRead.error ? null : parseClaimReturnBundles(bundleRead.data);
    return bundles ? { document: withClaimReturnBundles(document, bundles) } : { error: claimCollectionError(bundleRead.error?.code, bundleRead.error?.message) };
  } catch (error) { unstable_rethrow(error); return { error: claimCollectionError() }; }
}
export async function saveClaimCollectionAction(claimId: unknown, shipmentId: unknown, revision: unknown, claimRevision: unknown, rawValues: unknown, operationId: unknown, rawIdentity: unknown) {
  const identity = parseGoodsGroupIdentity(rawIdentity), values = normalizeClaimCollectionValues(rawValues);
  if (!identity || !values || !isUuid(claimId) || !isUuid(shipmentId) || !isUuid(operationId) || !transactionInteger(revision, 0) || !transactionInteger(claimRevision, 0)) return { error: claimCollectionError('22023') };
  const auth = await requireAdminActionAccess('/admin/sales/orders', { capability: 'sales.manage' });
  if (!auth || auth.user.id !== identity.actorId) return { error: claimCollectionError('42501') };
  try {
    const { data, error } = await (await createClient()).rpc('admin_save_claim_collection_plan', { p_claim: claimId, p_shipment: shipmentId, p_revision: revision, p_claim_revision: claimRevision, p_values: values, p_operation: operationId, p_actor: identity.actorId, p_session: identity.sessionId });
    const document = error ? null : parseClaimCollectionDocument(data);
    if (!document || document.claimId !== claimId) return { error: claimCollectionError(error?.code, error?.message), uncertain: !error || !['22023', 'PT409', '42501', 'P0002'].includes(error.code) };
    revalidatePath('/admin/sales/claims', 'layout'); revalidatePath(`/orders/${document.orderId}`);
    // 저장은 끝났다. 회수 주소(별도 RPC)를 읽지 못해도 저장 결과를 숨기지 않고, 주소는 다시 확인에서 보인다.
    const bundleRead = await (await createClient()).rpc('admin_read_claim_return_bundles', { p_claim: claimId, p_actor: identity.actorId, p_session: identity.sessionId });
    const bundles = bundleRead.error ? null : parseClaimReturnBundles(bundleRead.data);
    return { document: bundles ? withClaimReturnBundles(document, bundles) : document };
  } catch (error) { unstable_rethrow(error); return { error: claimCollectionError(), uncertain: true }; }
}
