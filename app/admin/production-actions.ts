'use server';
import { unstable_rethrow } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { createClient } from '@/lib/supabase/server';
import { parseGoodsGroupIdentity } from '@/lib/admin/goods-groups';
import { parseGoodsProductionPolicy, parseOrderProduction, productionError } from '@/lib/order-production';
import { transactionExactKeys, transactionGoodId, transactionInteger, transactionRecord } from '@/lib/goods-transaction-values';
import { isUuid } from '@/lib/uuid';
const goodsPath = '/admin/catalog/goods';
const uncertain = (code?: string) => !/^(?:PT409|22[0-9A-Z]{3}|23[0-9A-Z]{3}|42501|P0002)$/.test(code ?? '');
export async function readGoodsProductionAction(goodId: unknown) {
 if (!transactionGoodId(goodId) || !await requireAdminActionAccess(goodsPath, { capability: 'catalog.manage' })) return { error: productionError('42501') };
 try { const { data, error } = await (await createClient()).rpc('admin_get_goods_production', { p_good: goodId }); const policy = error ? null : parseGoodsProductionPolicy(data);
  return policy && policy.goodId === goodId ? { policy } : { error: productionError(error?.code, error?.message) };
 } catch (error) { unstable_rethrow(error); return { error: productionError() }; }
}
export async function saveGoodsProductionAction(goodId: unknown, values: unknown, revision: unknown, operation: unknown, rawIdentity: unknown) {
 const identity = parseGoodsGroupIdentity(rawIdentity);
 if (!transactionGoodId(goodId) || !identity || !isUuid(operation) || !transactionInteger(revision, 0) || !transactionRecord(values)
  || !transactionExactKeys(values, ['enabled', 'leadDays', 'dayBasis', 'closedDates', 'publicNote', 'evidence', 'confirmed']) || values.confirmed !== true
  || typeof values.evidence !== 'string' || values.evidence.trim().length < 2 || !parseGoodsProductionPolicy({ ...Object.fromEntries(Object.entries(values).filter(([key]) => key !== 'confirmed')), goodId, revision, updatedAt: new Date().toISOString() })) return { error: productionError('22023'), uncertain: false };
 const auth = await requireAdminActionAccess(goodsPath, { capability: 'catalog.manage' }); if (!auth || auth.user.id !== identity.actorId) return { error: productionError('42501'), uncertain: false };
 try { const client = await createClient(), result = await client.rpc('admin_save_goods_production', { p_good: goodId, p_values: values, p_revision: revision, p_operation: operation, p_actor: identity.actorId, p_session: identity.sessionId });
  if (result.error || !parseGoodsProductionPolicy(result.data)) return { error: productionError(result.error?.code, result.error?.message), uncertain: uncertain(result.error?.code) };
  const current = await client.rpc('admin_get_goods_production', { p_good: goodId }), policy = current.error ? null : parseGoodsProductionPolicy(current.data);
  if (!policy || policy.goodId !== goodId) return { error: productionError(), uncertain: true };
  revalidatePath(goodsPath); revalidatePath(`/shop/${goodId}`); revalidatePath('/cart'); return { policy };
 } catch (error) { unstable_rethrow(error); return { error: productionError(), uncertain: true }; }
}
export async function readOrderProductionAction(orderId: unknown) {
 if (!isUuid(orderId) || !await requireAdminActionAccess(`/admin/sales/orders/${orderId}`, { capability: 'sales.read' })) return { error: productionError('42501') };
 try { const { data, error } = await (await createClient()).rpc('admin_get_order_production', { p_order: orderId }); const document = error ? null : parseOrderProduction(data);
  return document?.orderId === orderId ? { document } : { error: productionError(error?.code, error?.message) };
 } catch (error) { unstable_rethrow(error); return { error: productionError() }; }
}
export async function changeOrderProductionAction(orderId: unknown, jobId: unknown, kind: unknown, revision: unknown, operation: unknown, evidence: unknown, rawIdentity: unknown) {
 const identity = parseGoodsGroupIdentity(rawIdentity);
 if (!identity || !isUuid(orderId) || !isUuid(jobId) || !isUuid(operation) || !['start', 'complete'].includes(String(kind)) || !transactionInteger(revision, 1)
  || typeof evidence !== 'string' || evidence.trim().length < 2 || evidence.length > 1000 || /[\u0000-\u001f\u007f]/u.test(evidence)) return { error: productionError('22023'), uncertain: false };
 const auth = await requireAdminActionAccess(`/admin/sales/orders/${orderId}`, { capability: 'sales.manage' }); if (!auth || auth.user.id !== identity.actorId) return { error: productionError('42501'), uncertain: false };
 try { const client = await createClient(), result = await client.rpc('admin_change_order_production', { p_job: jobId, p_kind: kind, p_revision: revision, p_operation: operation, p_actor: identity.actorId, p_session: identity.sessionId, p_evidence: evidence.trim() });
  if (result.error) return { error: productionError(result.error.code, result.error.message), uncertain: uncertain(result.error.code) };
  if (!transactionRecord(result.data) || result.data.orderId !== orderId || result.data.jobId !== jobId) return { error: productionError(), uncertain: true };
  const current = await client.rpc('admin_get_order_production', { p_order: orderId }), document = current.error ? null : parseOrderProduction(current.data);
  if (!document || document.orderId !== orderId) return { error: productionError(), uncertain: true };
  revalidatePath(`/admin/sales/orders/${orderId}`); revalidatePath('/admin/sales/dispatch'); revalidatePath(`/orders/${orderId}`); return { document };
 } catch (error) { unstable_rethrow(error); return { error: productionError(), uncertain: true }; }
}
