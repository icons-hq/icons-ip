'use server';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { createClient } from '@/lib/supabase/server';
import { revalidateGoodsSurfaces } from '@/lib/admin/revalidate-goods.server';
import { loadGoodsGroup, loadGoodsGroups, loadGoodsGroupSource, searchGoodsGroupCandidates } from '@/lib/admin/goods-groups.server';
import { GOODS_GROUPS_PATH, goodsGroupError, goodsGroupPreviewMatches, parseGoodsGroupConversionRequest, parseGoodsGroupIdentity,
  parseGoodsGroupPreview, parseGoodsGroupReceipt, parseGoodsGroupRecovery, parseGoodsGroupValues, validGoodsGroupGoodId,
  type GoodsGroupCandidates, type GoodsGroupIdentity, type GoodsGroupPage, type GoodsGroupPreview, type GoodsGroupReceipt, type GoodsGroupRecovery,
  type GoodsGroupResult, type GoodsGroupSnapshot, type GoodsGroupSource } from '@/lib/admin/goods-groups';
import { isUuid } from '@/lib/uuid';
import { transactionExactKeys, transactionInteger, transactionRecord } from '@/lib/goods-transaction-values';
import { parseGoodsGroupFilters, type GoodsGroupConsole } from '@/lib/admin/goods-group-console';
import { loadGoodsGroupConsole } from '@/lib/admin/goods-group-console.server';

function readIdentity(value: unknown) { return transactionRecord(value) && transactionExactKeys(value, ['actorId', 'sessionId']) ? parseGoodsGroupIdentity(value) : null; }
async function authorized(identity: GoodsGroupIdentity) {
  const auth = await requireAdminActionAccess(GOODS_GROUPS_PATH, { capability: 'catalog.manage' });
  return Boolean(auth && auth.user.id === identity.actorId);
}
function identityArgs(identity: GoodsGroupIdentity) { return { p_expected_actor_id: identity.actorId, p_expected_session_id: identity.sessionId }; }
function refresh() {
  try { revalidateGoodsSurfaces(); revalidatePath(GOODS_GROUPS_PATH); revalidatePath(`${GOODS_GROUPS_PATH}/new`); }
  catch (error) { unstable_rethrow(error); /* A confirmed receipt remains confirmed when only cache refresh fails. */ }
}
export async function searchGoodsGroupsAction(query: unknown, page: unknown, rawIdentity: unknown): Promise<GoodsGroupResult<GoodsGroupPage>> {
  const identity = readIdentity(rawIdentity);
  if (!identity || typeof query !== 'string' || [...query.trim()].length > 100 || !transactionInteger(page, 1, 100_000)) return goodsGroupError('22023');
  if (!await authorized(identity)) return goodsGroupError('42501');
  try { return { value: await loadGoodsGroups(query.trim(), page) }; }
  catch (error) { unstable_rethrow(error); return { error: '그룹상품 목록을 불러오지 못했습니다. 현재 화면을 유지합니다.' }; }
}
export async function searchGoodsGroupConsoleAction(input: unknown, rawIdentity: unknown): Promise<GoodsGroupResult<GoodsGroupConsole>> {
  const identity = readIdentity(rawIdentity), filters = parseGoodsGroupFilters(input);
  if (!identity || !filters) return goodsGroupError('22023');
  if (!await authorized(identity)) return goodsGroupError('42501');
  try { return { value: await loadGoodsGroupConsole(filters) }; }
  catch (error) { unstable_rethrow(error); return { error: '그룹상품 목록을 불러오지 못했습니다. 현재 목록을 유지합니다.' }; }
}
export async function searchGoodsGroupProductsAction(query: unknown, page: unknown, rawIdentity: unknown): Promise<GoodsGroupResult<GoodsGroupCandidates>> {
  const identity = readIdentity(rawIdentity);
  if (!identity || typeof query !== 'string' || [...query.trim()].length > 100 || !transactionInteger(page, 1, 100_000)) return goodsGroupError('22023');
  if (!await authorized(identity)) return goodsGroupError('42501');
  try { return { value: await searchGoodsGroupCandidates(query.trim(), page) }; }
  catch (error) { unstable_rethrow(error); return { error: '상품 검색 결과를 불러오지 못했습니다.' }; }
}
export async function readGoodsGroupSourceAction(goodId: unknown, rawIdentity: unknown): Promise<GoodsGroupResult<GoodsGroupSource>> {
  const identity = readIdentity(rawIdentity);
  if (!identity || !validGoodsGroupGoodId(goodId)) return goodsGroupError('22023');
  if (!await authorized(identity)) return goodsGroupError('42501');
  try { const source = await loadGoodsGroupSource(goodId); return source ? { value: source } : { error: '상품이 없거나 보관되어 있습니다.' }; }
  catch (error) { unstable_rethrow(error); return { error: '상품과 옵션을 불러오지 못했습니다.' }; }
}
export async function readGoodsGroupAction(groupId: unknown, rawIdentity: unknown): Promise<GoodsGroupResult<GoodsGroupSnapshot>> {
  const identity = readIdentity(rawIdentity);
  if (!identity || !isUuid(groupId)) return goodsGroupError('22023');
  if (!await authorized(identity)) return goodsGroupError('42501');
  try { const group = await loadGoodsGroup(groupId); return group ? { value: group } : { error: '그룹상품을 찾지 못했습니다.' }; }
  catch (error) { unstable_rethrow(error); return { error: '그룹상품을 불러오지 못했습니다. 현재 입력은 유지됩니다.' }; }
}
export async function previewGoodsGroupConversionAction(rawRequest: unknown, rawIdentity: unknown): Promise<GoodsGroupResult<GoodsGroupPreview>> {
  const request = parseGoodsGroupConversionRequest(rawRequest), identity = readIdentity(rawIdentity);
  if (!request || !identity) return goodsGroupError('22023', 'invalid_goods_group_conversion');
  if (!await authorized(identity)) return goodsGroupError('42501');
  try {
    const client = await createClient(); const { data, error } = await client.rpc('admin_preview_goods_group_conversion', { p_request: request, ...identityArgs(identity) });
    if (error) return goodsGroupError(error.code, error.message);
    const preview = parseGoodsGroupPreview(data);
    return preview && goodsGroupPreviewMatches(preview, request) ? { value: preview } : { error: '변환 전 비교 결과를 현재 입력과 대조하지 못했습니다. 다시 비교해주세요.' };
  } catch (error) { unstable_rethrow(error); return { error: '변환 전 비교를 완료하지 못했습니다. 입력은 유지됩니다.' }; }
}
async function receiptResult(recovery: GoodsGroupRecovery, rpc: string, args: Record<string, unknown>, read: boolean): Promise<GoodsGroupResult<GoodsGroupReceipt>> {
  if (!await authorized(recovery)) return goodsGroupError('42501', undefined, true);
  try {
    const client = await createClient(); const { data, error } = await client.rpc(rpc, { ...args, ...identityArgs(recovery) });
    if (error) return { ...goodsGroupError(error.code, error.message, true), ...(read ? { uncertain: true } : {}) };
    const receipt = parseGoodsGroupReceipt(data, recovery);
    if (!receipt || !read && receipt.state === 'unresolved') return { error: '요청 결과를 대조하지 못했습니다. 진행 내역을 확인해주세요.', uncertain: true };
    if (receipt.state === 'completed') refresh();
    return { value: receipt };
  } catch (error) { unstable_rethrow(error); return { error: '처리 결과가 불명확합니다. 같은 진행 내역으로 결과를 확인해주세요.', uncertain: true }; }
}
export async function confirmGoodsGroupConversionAction(input: unknown): Promise<GoodsGroupResult<GoodsGroupReceipt>> {
  const recovery = parseGoodsGroupRecovery(input);
  if (!recovery || recovery.command !== 'convert') return goodsGroupError('22023');
  return receiptResult(recovery, 'admin_confirm_goods_group_conversion', { p_preview_id: recovery.previewId, p_operation_id: recovery.operationId }, false);
}
export async function saveGoodsGroupAction(input: unknown, values: unknown): Promise<GoodsGroupResult<GoodsGroupReceipt>> {
  const recovery = parseGoodsGroupRecovery(input);
  const parsed = recovery && (recovery.command === 'create' || recovery.command === 'update') ? parseGoodsGroupValues(values, recovery.command === 'create' ? 2 : 1) : null;
  if (!recovery || !parsed || recovery.command !== 'create' && recovery.command !== 'update') return goodsGroupError('22023', 'invalid_goods_group_structure');
  return receiptResult(recovery, 'admin_save_goods_group', { p_group_id: recovery.groupId, p_expected_revision: recovery.expectedRevision,
    p_values: parsed, p_operation_id: recovery.operationId }, false);
}
export async function archiveGoodsGroupAction(input: unknown): Promise<GoodsGroupResult<GoodsGroupReceipt>> {
  const recovery = parseGoodsGroupRecovery(input);
  if (!recovery || recovery.command !== 'archive') return goodsGroupError('22023');
  return receiptResult(recovery, 'admin_archive_goods_group', { p_group_id: recovery.groupId, p_expected_revision: recovery.expectedRevision, p_operation_id: recovery.operationId }, false);
}
/** Recovery accepts durable identity metadata only; it never repeats a mutation. */
export async function readGoodsGroupOperationAction(input: unknown, seal: unknown = false): Promise<GoodsGroupResult<GoodsGroupReceipt>> {
  const recovery = parseGoodsGroupRecovery(input);
  if (!recovery || typeof seal !== 'boolean') return { ...goodsGroupError('22023'), uncertain: true };
  return recovery.command === 'convert'
    ? receiptResult(recovery, 'admin_read_goods_group_conversion', { p_preview_id: recovery.previewId, p_operation_id: recovery.operationId, p_seal: seal }, true)
    : receiptResult(recovery, 'admin_read_goods_group_change', { p_group_id: recovery.groupId, p_expected_revision: recovery.expectedRevision, p_command: recovery.command,
      p_operation_id: recovery.operationId, p_seal: seal }, true);
}
