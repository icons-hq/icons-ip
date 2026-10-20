'use server';
import { unstable_rethrow } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { parseGoodsGroupIdentity } from '@/lib/admin/goods-groups';
import { isUuid } from '@/lib/uuid';
import { parseShipmentPackDocument, shipmentPackError, shipmentPackIds } from '@/lib/admin/shipment-packs';
export async function readShipmentPacksAction(rawIds: unknown, rawIdentity: unknown) {
 const ids = shipmentPackIds(rawIds), identity = parseGoodsGroupIdentity(rawIdentity);
 if (!ids || !identity) return { error: shipmentPackError('', '22023') };
 const auth = await requireAdminActionAccess('/admin/sales/dispatch', { capability: 'sales.manage' });
 if (!auth || auth.user.id !== identity.actorId) return { error: shipmentPackError('', '42501') };
 try { const { data, error } = await (await createClient()).rpc('admin_get_shipment_packs', { p_ids: ids });
  const document = error ? null : parseShipmentPackDocument(data);
  return document ? { document } : { error: shipmentPackError(error?.message, error?.code) };
 } catch (error) { unstable_rethrow(error); return { error: shipmentPackError() }; }
}
export async function changeShipmentPackAction(rawIds: unknown, kind: unknown, version: unknown, reason: unknown, operationId: unknown, rawIdentity: unknown) {
 const ids = shipmentPackIds(rawIds), identity = parseGoodsGroupIdentity(rawIdentity);
 if (!ids || !identity || !['create', 'release'].includes(kind as string) || typeof version !== 'string' || !/^[a-f0-9]{64}$/.test(version) || !isUuid(operationId)
  || typeof reason !== 'string' || reason.trim().length < 2 || reason.length > 500 || /[\u0000-\u001f\u007f]/u.test(reason)) return { error: shipmentPackError('', '22023'), uncertain: false };
 const auth = await requireAdminActionAccess('/admin/sales/dispatch', { capability: 'sales.manage' });
 if (!auth || auth.user.id !== identity.actorId) return { error: shipmentPackError('', '42501'), uncertain: false };
 try { const client = await createClient(); const { data, error } = await client.rpc('admin_change_shipment_pack', { p_ids: ids, p_kind: kind, p_version: version, p_reason: reason.trim(), p_operation: operationId, p_actor: identity.actorId, p_session: identity.sessionId });
  if (error || !data) return { error: shipmentPackError(error?.message, error?.code), uncertain: !error || !['22023', '23514', '42501', 'PT409', 'P0002'].includes(error.code) };
  // The operation receipt is frozen; always display the current package state.
  const current = await client.rpc('admin_get_shipment_packs', { p_ids: ids }); const document = current.error ? null : parseShipmentPackDocument(current.data);
  if (!document) return { error: shipmentPackError(), uncertain: true };
  revalidatePath('/admin/sales/dispatch'); revalidatePath('/admin/sales/shipping'); return { document };
 } catch (error) { unstable_rethrow(error); return { error: shipmentPackError(), uncertain: true }; }
}
