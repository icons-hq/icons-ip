import { isUuid } from '@/lib/uuid';
import { RANDOM_OPTION_PROBLEMS, goodsOptionSaleModeErrorMessage } from '@/lib/goods-option-sale-mode';
import { transactionExactKeys, transactionInstant, transactionInteger, transactionRecord } from '@/lib/goods-transaction-values';

export const GOODS_GROUPS_PATH = '/admin/catalog/groups';
export const GOODS_GROUP_PAGE_SIZE = 30;
export const GOODS_GROUP_RECOVERY_PREFIX = 'icons:goods-group-operation:v1:';
export interface GoodsGroupIdentity { actorId: string; sessionId: string }
export interface GoodsGroupMember { goodId: string; variantId: string; values: string[]; sortOrder: number; name: string; code: string | null; price: number; stockQty: number; publishedAt: string | null; archivedAt: string | null }
export interface GoodsGroupSnapshot { id: string; name: string; optionNames: string[]; commonGoodId: string; revision: number; archivedAt: string | null; members: GoodsGroupMember[] }
export interface GoodsGroupPage { rows: GoodsGroupSnapshot[]; total: number; page: number; pageSize: number }
export interface GoodsGroupSource { goodId: string; name: string; code: string | null; groupId: string | null; variants: { id: string; name: string; attributes: Record<string, string>; price: number; stockQty: number; code: string | null }[]; blockers: string[] }
export interface GoodsGroupCandidate { id: string; code: string | null; name: string }
export interface GoodsGroupCandidates { rows: GoodsGroupCandidate[]; total: number; page: number; pageSize: number }
export interface GoodsGroupConversionRequest { sourceGoodId: string; name: string; optionNames: string[]; selections: { variantId: string; values: string[] }[] }
export interface GoodsGroupConversionPlan { sourceGoodId: string; name: string; optionNames: string[]; members: { sourceVariantId: string; sourceVariantName: string; values: string[]; retainsGoodId: boolean; goodId: string | null; price: number; stockQty: number; name: string }[];
  unselectedOptions: { id: string; name: string; stockQty: number }[]; requiresKcReview: true; allProductsUnpublished: true; aggregationPreserved: true; historicalOrdersPreserved: true; unselectedStockPreserved: true; activeCartSelectionsRequireReview: true }
export type GoodsGroupPreview = { state: 'ready'; previewId: string; expiresAt: string; plan: GoodsGroupConversionPlan } | { state: 'blocked'; blockers: string[] };
export interface GoodsGroupValues { name: string; optionNames: string[]; members: { goodId: string; values: string[] }[] }
export type GoodsGroupRecovery = GoodsGroupIdentity & { version: 1; operationId: string } & (
  { command: 'convert'; sourceGoodId: string; previewId: string } |
  { command: 'create' | 'update' | 'archive' | 'common'; groupId: string; expectedRevision: number });
export type GoodsGroupReceipt = { state: 'completed'; operationId: string; group: GoodsGroupSnapshot; aggregationId?: string } | { state: 'sealed' | 'unresolved'; operationId: string };
export type GoodsGroupFailure = { error: string; uncertain?: boolean; conflict?: boolean; authChanged?: boolean };
export type GoodsGroupResult<T> = { value: T } | GoodsGroupFailure;

const goodId = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value);
const text = (value: unknown, limit: number): value is string => typeof value === 'string' && value === value.trim() && [...value].length >= 1 && [...value].length <= limit && !/[\u0000-\u001f\u007f]/.test(value);
const uuid = (value: unknown): value is string => typeof value === 'string' && isUuid(value);
const instantOrNull = (value: unknown): value is string | null => value === null || transactionInstant(value);
const code = (value: unknown): value is string | null => value === null || text(value, 100);
const money = (value: unknown): value is number => transactionInteger(value, 0, 2_147_483_647);
const labels = (value: unknown, max: number): value is string[] => Array.isArray(value) && value.length >= 1 && value.length <= 3 && value.every(item => text(item, max));
const axes = (value: unknown): value is string[] => labels(value, 40) && new Set(value).size === value.length;
const blockers = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 30 && value.every(item => typeof item === 'string' && /^[a-z][a-z0-9_]{0,79}$/.test(item));
export const validGoodsGroupGoodId = goodId;
export function parseGoodsGroupIdentity(value: unknown): GoodsGroupIdentity | null {
  if (!transactionRecord(value) || !uuid(value.actorId) || !uuid(value.sessionId)) return null;
  return { actorId: value.actorId.toLowerCase(), sessionId: value.sessionId.toLowerCase() };
}
export function parseGoodsGroupSnapshot(value: unknown): GoodsGroupSnapshot | null {
  if (!transactionRecord(value) || !transactionExactKeys(value, ['id', 'name', 'optionNames', 'commonGoodId', 'revision', 'archivedAt', 'members'])
    || !uuid(value.id) || !text(value.name, 40) || !axes(value.optionNames) || !goodId(value.commonGoodId)
    || !transactionInteger(value.revision, 1) || !instantOrNull(value.archivedAt) || !Array.isArray(value.members) || value.members.length > 100) return null;
  const members: GoodsGroupMember[] = []; const goods = new Set<string>(), variants = new Set<string>(), combinations = new Set<string>(), positions = new Set<number>();
  for (const member of value.members) {
    if (!transactionRecord(member) || !transactionExactKeys(member, ['goodId', 'variantId', 'values', 'sortOrder', 'name', 'code', 'price', 'stockQty', 'publishedAt', 'archivedAt'])
      || !goodId(member.goodId) || !uuid(member.variantId) || !labels(member.values, 80) || member.values.length !== value.optionNames.length
      || !transactionInteger(member.sortOrder, 0, 99) || !text(member.name, 200) || !code(member.code) || !money(member.price) || !money(member.stockQty)
      || !instantOrNull(member.publishedAt) || !instantOrNull(member.archivedAt)
      || goods.has(member.goodId) || variants.has(member.variantId) || combinations.has(JSON.stringify(member.values)) || positions.has(member.sortOrder)) return null;
    goods.add(member.goodId); variants.add(member.variantId); combinations.add(JSON.stringify(member.values)); positions.add(member.sortOrder);
    members.push(member as unknown as GoodsGroupMember);
  }
  if (value.archivedAt === null && (!members.length || !goods.has(value.commonGoodId))) return null;
  return { id: value.id, name: value.name, optionNames: value.optionNames, commonGoodId: value.commonGoodId, revision: value.revision, archivedAt: value.archivedAt,
    members: members.sort((a, b) => a.sortOrder - b.sortOrder) };
}
export function parseGoodsGroupPage(value: unknown): GoodsGroupPage | null {
  if (!transactionRecord(value) || !transactionExactKeys(value, ['rows', 'total', 'page', 'pageSize']) || !Array.isArray(value.rows)
    || !transactionInteger(value.total) || !transactionInteger(value.page, 1, 100_000) || !transactionInteger(value.pageSize, 1, 100) || value.rows.length > value.pageSize || value.total < value.rows.length) return null;
  const rows = value.rows.map(parseGoodsGroupSnapshot);
  if (rows.some(row => !row) || new Set(rows.map(row => row!.id)).size !== rows.length) return null;
  return { rows: rows as GoodsGroupSnapshot[], total: value.total, page: value.page, pageSize: value.pageSize };
}
export function parseGoodsGroupSource(value: unknown): GoodsGroupSource | null {
  if (!transactionRecord(value) || !transactionExactKeys(value, ['goodId', 'name', 'code', 'groupId', 'variants', 'blockers'])
    || !goodId(value.goodId) || !text(value.name, 200) || !code(value.code) || value.groupId !== null && !uuid(value.groupId)
    || !blockers(value.blockers) || !Array.isArray(value.variants) || value.variants.length > 1000) return null;
  const variants: GoodsGroupSource['variants'] = []; const ids = new Set<string>();
  for (const row of value.variants) {
    if (!transactionRecord(row) || !transactionExactKeys(row, ['id', 'name', 'attributes', 'price', 'stockQty', 'code']) || !uuid(row.id) || ids.has(row.id)
      || !text(row.name, 200) || !transactionRecord(row.attributes) || Object.entries(row.attributes).some(([key, val]) => !text(key, 40) || !text(val, 80))
      || !money(row.price) || !money(row.stockQty) || !code(row.code)) return null;
    ids.add(row.id); variants.push(row as unknown as GoodsGroupSource['variants'][number]);
  }
  return { goodId: value.goodId, name: value.name, code: value.code, groupId: value.groupId, variants, blockers: value.blockers };
}
export function parseGoodsGroupConversionRequest(value: unknown): GoodsGroupConversionRequest | null {
  if (!transactionRecord(value) || !transactionExactKeys(value, ['sourceGoodId', 'name', 'optionNames', 'selections']) || !goodId(value.sourceGoodId)
    || !text(value.name, 40) || !axes(value.optionNames) || !Array.isArray(value.selections) || value.selections.length < 2 || value.selections.length > 100) return null;
  const ids = new Set<string>(), combinations = new Set<string>(); const selections: GoodsGroupConversionRequest['selections'] = [];
  for (const row of value.selections) {
    if (!transactionRecord(row) || !transactionExactKeys(row, ['variantId', 'values']) || !uuid(row.variantId) || !labels(row.values, 80)
      || row.values.length !== value.optionNames.length || [...`${value.name} ${row.values.join(' / ')}`].length > 200
      || ids.has(row.variantId) || combinations.has(JSON.stringify(row.values))) return null;
    ids.add(row.variantId); combinations.add(JSON.stringify(row.values)); selections.push({ variantId: row.variantId, values: row.values });
  }
  return { sourceGoodId: value.sourceGoodId, name: value.name, optionNames: value.optionNames, selections };
}
export function parseGoodsGroupPreview(value: unknown): GoodsGroupPreview | null {
  if (!transactionRecord(value)) return null;
  if (value.state === 'blocked') return transactionExactKeys(value, ['state', 'blockers']) && blockers(value.blockers) && value.blockers.length ? { state: 'blocked', blockers: value.blockers } : null;
  if (value.state !== 'ready' || !transactionExactKeys(value, ['state', 'previewId', 'expiresAt', 'plan']) || !uuid(value.previewId) || !transactionInstant(value.expiresAt)
    || !transactionRecord(value.plan)) return null;
  const plan = value.plan;
  if (!transactionExactKeys(plan, ['sourceGoodId', 'name', 'optionNames', 'members', 'unselectedOptions', 'requiresKcReview', 'allProductsUnpublished', 'aggregationPreserved', 'historicalOrdersPreserved', 'unselectedStockPreserved', 'activeCartSelectionsRequireReview'])
    || !goodId(plan.sourceGoodId) || !text(plan.name, 40) || !axes(plan.optionNames) || !Array.isArray(plan.members) || plan.members.length < 2 || plan.members.length > 100
    || !Array.isArray(plan.unselectedOptions) || plan.unselectedOptions.length > 1000
    || ['requiresKcReview', 'allProductsUnpublished', 'aggregationPreserved', 'historicalOrdersPreserved', 'unselectedStockPreserved', 'activeCartSelectionsRequireReview'].some(key => plan[key] !== true)) return null;
  const memberIds = new Set<string>(), values = new Set<string>();
  for (const [index, row] of plan.members.entries()) {
    if (!transactionRecord(row) || !transactionExactKeys(row, ['sourceVariantId', 'sourceVariantName', 'values', 'retainsGoodId', 'goodId', 'price', 'stockQty', 'name'])
      || !uuid(row.sourceVariantId) || memberIds.has(row.sourceVariantId) || !text(row.sourceVariantName, 200) || !labels(row.values, 80) || row.values.length !== plan.optionNames.length
      || values.has(JSON.stringify(row.values)) || row.retainsGoodId !== (index === 0) || row.goodId !== (index === 0 ? plan.sourceGoodId : null)
      || !money(row.price) || !money(row.stockQty) || row.name !== `${plan.name} ${row.values.join(' / ')}` || !text(row.name, 200)) return null;
    memberIds.add(row.sourceVariantId); values.add(JSON.stringify(row.values));
  }
  const remainingIds = new Set<string>();
  for (const row of plan.unselectedOptions) {
    if (!transactionRecord(row) || !transactionExactKeys(row, ['id', 'name', 'stockQty']) || !uuid(row.id) || !text(row.name, 200) || !money(row.stockQty)
      || memberIds.has(row.id) || remainingIds.has(row.id)) return null;
    remainingIds.add(row.id);
  }
  return { state: 'ready', previewId: value.previewId, expiresAt: value.expiresAt, plan: plan as unknown as GoodsGroupConversionPlan };
}
export function goodsGroupPreviewMatches(preview: GoodsGroupPreview, request: GoodsGroupConversionRequest): boolean {
  return preview.state === 'blocked' || preview.plan.sourceGoodId === request.sourceGoodId && preview.plan.name === request.name
    && JSON.stringify(preview.plan.optionNames) === JSON.stringify(request.optionNames)
    && JSON.stringify(preview.plan.members.map(row => ({ variantId: row.sourceVariantId, values: row.values }))) === JSON.stringify(request.selections);
}
export function parseGoodsGroupValues(value: unknown, minimum = 1): GoodsGroupValues | null {
  if (!transactionRecord(value) || !transactionExactKeys(value, ['name', 'optionNames', 'members']) || !text(value.name, 40) || !axes(value.optionNames)
    || !Array.isArray(value.members) || value.members.length < minimum || value.members.length > 100) return null;
  const ids = new Set<string>(), combinations = new Set<string>(); const members: GoodsGroupValues['members'] = [];
  for (const row of value.members) {
    if (!transactionRecord(row) || !transactionExactKeys(row, ['goodId', 'values']) || !goodId(row.goodId) || !labels(row.values, 80)
      || row.values.length !== value.optionNames.length || ids.has(row.goodId) || combinations.has(JSON.stringify(row.values))
      || [...`${value.name} ${row.values.join(' / ')}`].length > 200) return null;
    ids.add(row.goodId); combinations.add(JSON.stringify(row.values)); members.push({ goodId: row.goodId, values: row.values });
  }
  return { name: value.name, optionNames: value.optionNames, members };
}
export function parseGoodsGroupRecovery(value: unknown, identity?: GoodsGroupIdentity): GoodsGroupRecovery | null {
  const actor = parseGoodsGroupIdentity(value);
  if (!actor || !transactionRecord(value) || value.version !== 1 || !uuid(value.operationId)
    || identity && (actor.actorId !== identity.actorId || actor.sessionId !== identity.sessionId)) return null;
  const base = { ...actor, version: 1 as const, operationId: value.operationId };
  if (value.command === 'convert') return transactionExactKeys(value, ['version', 'actorId', 'sessionId', 'operationId', 'command', 'sourceGoodId', 'previewId'])
    && goodId(value.sourceGoodId) && uuid(value.previewId) ? { ...base, command: 'convert', sourceGoodId: value.sourceGoodId, previewId: value.previewId } : null;
  if (!['create', 'update', 'archive', 'common'].includes(String(value.command)) || !transactionExactKeys(value, ['version', 'actorId', 'sessionId', 'operationId', 'command', 'groupId', 'expectedRevision'])
    || !uuid(value.groupId) || !transactionInteger(value.expectedRevision, value.command === 'create' ? 0 : 1) || value.command === 'create' && value.expectedRevision !== 0) return null;
  return { ...base, command: value.command as 'create' | 'update' | 'archive' | 'common', groupId: value.groupId, expectedRevision: value.expectedRevision };
}
export function parseGoodsGroupReceipt(value: unknown, request: GoodsGroupRecovery): GoodsGroupReceipt | null {
  if (!transactionRecord(value) || value.operationId !== request.operationId) return null;
  if (value.state === 'sealed' || value.state === 'unresolved') return transactionExactKeys(value, ['state', 'operationId']) ? { state: value.state, operationId: request.operationId } : null;
  if (value.state !== 'completed' || !transactionExactKeys(value, ['state', 'operationId', 'group', ...(request.command === 'convert' ? ['aggregationId'] : [])])) return null;
  const group = parseGoodsGroupSnapshot(value.group);
  if (!group || request.command === 'convert' && (!uuid(value.aggregationId) || group.commonGoodId !== request.sourceGoodId || group.revision !== 1 || group.archivedAt !== null)
    || request.command !== 'convert' && (group.id !== request.groupId || group.revision !== request.expectedRevision + 1 || (request.command === 'archive') !== (group.archivedAt !== null))) return null;
  return { state: 'completed', operationId: request.operationId, group, ...(request.command === 'convert' ? { aggregationId: value.aggregationId as string } : {}) };
}
export function goodsGroupRecoveryKey(identity: GoodsGroupIdentity, scope: string) { return `${GOODS_GROUP_RECOVERY_PREFIX}${identity.actorId}:${identity.sessionId}:${scope}`; }
export const goodsGroupHref = (id: string) => `${GOODS_GROUPS_PATH}?id=${encodeURIComponent(id)}`;
export const goodsGroupConversionHref = (sourceGoodId?: string) => `${GOODS_GROUPS_PATH}/new${sourceGoodId ? `?sourceGoodId=${encodeURIComponent(sourceGoodId)}` : ''}`;
export function goodsGroupBlockerLabel(value: string): string {
  const messages: Record<string, string> = { source_unavailable: '상품이 없거나 보관되어 있습니다.', already_grouped: '이미 그룹상품에 포함된 상품입니다.', preorder_policy_attached: '예약판매 설정을 연결 해제한 뒤 전환할 수 있습니다.',
    subscription_active: '정기배송 설정 또는 진행 중인 정기배송이 있습니다.', gift_pending: '아직 주문되지 않은 선물이 진행 중입니다.', payment_pending: '결제 대기 주문이 있습니다.',
    purchase_cost_permission_required: '원가를 보존하려면 원가 관리 권한이 있는 관리자가 전환해야 합니다.', category_review_required: '상품분류를 현재 사용할 수 있는 최하위 분류로 확인해주세요.' };
  return messages[value] ?? '현재 상품 상태에서는 처리할 수 없습니다. 상품 관리 화면에서 상태를 확인해주세요.';
}
export function goodsGroupError(codeValue?: string, message?: string, dispatched = false): GoodsGroupFailure {
  if (['42501', '28000'].includes(codeValue ?? '') || message?.includes('goods_group_auth_changed')) return { error: '로그인 상태나 상품관리 권한이 바뀌었습니다. 현재 계정으로 화면을 다시 열어주세요.', authChanged: true, ...(dispatched ? { uncertain: true } : {}) };
  const messages: Record<string, string> = { goods_group_preview_expired: '비교 결과의 유효시간이 지났습니다. 최신 상품으로 다시 비교해주세요.', goods_group_source_changed: '상품·옵션 또는 거래 상태가 바뀌었습니다. 최신 상품으로 다시 비교해주세요.',
    goods_group_selection_changed: '선택한 옵션이 바뀌었습니다. 상품을 다시 불러와주세요.', goods_group_retry: '다른 상품 처리가 진행 중입니다. 잠시 후 최신 상태를 확인해주세요.', goods_group_operation_conflict: '요청 정보가 이전 처리와 다릅니다. 먼저 기존 요청의 결과를 확인해주세요.',
    goods_group_revision_changed: '다른 관리자가 그룹상품을 변경했습니다. 최신 저장본을 불러와 비교해주세요.', goods_group_changed: '그룹상품이 변경되었습니다. 최신 저장본을 불러와주세요.',
    goods_group_common_information_differs: '연결할 상품의 공통 상품정보가 다릅니다. 공통 정보를 맞춘 뒤 다시 연결해주세요.', goods_group_single_variant_required: '각 판매옵션에는 기본 옵션 하나만 있어야 합니다.',
    goods_aggregation_member_limit: '원상품에서 분리된 상품은 보관 상품을 포함해 최대 100개입니다.', invalid_goods_group_conversion: '그룹명·옵션명·옵션값과 선택 개수를 확인해주세요.' };
  const randomOption = message && RANDOM_OPTION_PROBLEMS.some((code) => message.includes(code)) ? goodsOptionSaleModeErrorMessage(message) : undefined;
  const known = randomOption ?? Object.entries(messages).find(([key]) => message?.includes(key))?.[1];
  const rejected = ['22023', '23514', '23503', '23505', 'P0002', 'PT404', 'PT409'].includes(codeValue ?? '');
  return { error: known ?? (rejected ? '입력값과 현재 상품 상태를 확인해주세요.' : '처리 결과를 확인하지 못했습니다. 입력을 유지하고 진행 내역을 확인해주세요.'),
    ...(!rejected && dispatched ? { uncertain: true } : {}), ...(codeValue === 'PT409' || codeValue === '23505' ? { conflict: true } : {}) };
}
