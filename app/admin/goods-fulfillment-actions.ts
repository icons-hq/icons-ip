'use server';
import { unstable_rethrow } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { parseGoodsGroupIdentity } from '@/lib/admin/goods-groups';
import { createClient } from '@/lib/supabase/server';
import { inquiryDraftSessionId } from '@/lib/admin/inquiry-drafts';
import { fulfillmentError, parseDigitalFile, parseGoodsFulfillment, type GoodsFulfillmentSettings } from '@/lib/goods-fulfillment';
import { transactionExactKeys, transactionGoodId, transactionInteger, transactionRecord } from '@/lib/goods-transaction-values';
import { isUuid } from '@/lib/uuid';
import { prepareDigitalAsset, verifyDigitalAsset, type DigitalAssetResult } from '@/lib/admin/digital-assets.server';
const path = '/admin/catalog/goods';
const unknown = () => ({ error: fulfillmentError(), uncertain: true });
export async function readGoodsFulfillmentAction(goodId: unknown): Promise<{ settings: GoodsFulfillmentSettings } | { error: string }> {
 if (!transactionGoodId(goodId) || !await requireAdminActionAccess(path, { capability: 'catalog.manage' })) return { error: fulfillmentError('42501') };
 try { const { data, error } = await (await createClient()).rpc('admin_get_goods_fulfillment', { p_good: goodId }); const settings = error ? null : parseGoodsFulfillment(data, true);
  return settings?.goodId === goodId ? { settings } : { error: fulfillmentError(error?.code, error?.message) };
 } catch (error) { unstable_rethrow(error); return { error: fulfillmentError() }; }
}
export async function saveGoodsFulfillmentAction(goodId: unknown, values: unknown, revision: unknown, operation: unknown, rawIdentity: unknown) {
 const identity = parseGoodsGroupIdentity(rawIdentity);
 if (!identity || !transactionGoodId(goodId) || !isUuid(operation) || !transactionInteger(revision, 0) || !transactionRecord(values)
  || !transactionExactKeys(values, ['mode', 'methods', 'files', 'publicNote', 'evidence', 'confirmed']) || values.confirmed !== true
  || typeof values.evidence !== 'string' || values.evidence.trim().length < 2
  || !parseGoodsFulfillment({ ...Object.fromEntries(Object.entries(values).filter(([k]) => k !== 'confirmed')), goodId, revision, updatedAt: new Date().toISOString() }, true)) return { error: fulfillmentError('22023'), uncertain: false };
 const auth = await requireAdminActionAccess(path, { capability: 'catalog.manage' }); if (auth?.user.id !== identity.actorId) return { error: fulfillmentError('42501'), uncertain: false };
 try {
  const client = await createClient(), { files, ...rest } = values;
  const saved = await client.rpc('admin_save_goods_fulfillment', { p_good: goodId, p_values: { ...rest, assetIds: (files as { id: string }[]).map(f => f.id) }, p_revision: revision, p_operation: operation, p_actor: identity.actorId, p_session: identity.sessionId });
  if (saved.error) return { error: fulfillmentError(saved.error.code, saved.error.message), uncertain: !/^(?:PT409|22[0-9A-Z]{3}|23[0-9A-Z]{3}|42501|P0002)$/.test(saved.error.code ?? '') };
  if (parseGoodsFulfillment(saved.data, true)?.goodId !== goodId) return unknown();
  const latest = await client.rpc('admin_get_goods_fulfillment', { p_good: goodId }), settings = latest.error ? null : parseGoodsFulfillment(latest.data, true);
  if (!settings || settings.goodId !== goodId) return unknown();
  for (const p of [path, `/shop/${goodId}`, '/cart', '/checkout']) revalidatePath(p); return { settings };
 } catch (error) { unstable_rethrow(error); return unknown(); }
}
async function uploadIdentity(rawIdentity: unknown) {
 const identity = parseGoodsGroupIdentity(rawIdentity); if (!identity) return null;
 const auth = await requireAdminActionAccess(path, { capability: 'catalog.manage' }); if (auth?.user.id !== identity.actorId) return null;
 const { data } = await (await createClient()).auth.getSession();
 return data.session?.user.id === identity.actorId && inquiryDraftSessionId(data.session.access_token) === identity.sessionId ? identity : null;
}
export async function prepareDigitalAssetAction(input: unknown, rawIdentity: unknown) {
 if (!transactionRecord(input) || !parseDigitalFile(input)) return { ok: false as const, error: '지원 파일 형식·이름과 50MB 이하 크기를 확인해주세요.' };
 try { const identity = await uploadIdentity(rawIdentity); if (!identity) return { ok: false as const, error: fulfillmentError('42501') };
  const file = parseDigitalFile(input)!, prepared = await prepareDigitalAsset(identity.actorId, identity.sessionId, file.id, file.name, file.mimeType, file.size);
  return prepared ? { ok: true as const, ...prepared } : { ok: false as const, error: '파일 업로드를 준비하지 못했습니다. 현재 계정과 진행 중인 업로드를 확인해주세요.' };
 } catch (error) { unstable_rethrow(error); return { ok: false as const, error: '파일 업로드를 준비하지 못했습니다.' }; }
}
export async function verifyDigitalAssetAction(id: unknown, rawIdentity: unknown): Promise<DigitalAssetResult> {
 if (!isUuid(id)) return { ok: false, error: '파일을 다시 선택해주세요.' };
 try { const identity = await uploadIdentity(rawIdentity); return identity ? await verifyDigitalAsset(identity.actorId, identity.sessionId, id) : { ok: false, error: fulfillmentError('42501') };
 } catch (error) { unstable_rethrow(error); return { ok: false, error: '파일 확인 결과를 알 수 없습니다. 같은 업로드 결과를 다시 확인해주세요.', uncertain: true }; }
}
