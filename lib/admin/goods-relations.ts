import { isUuid } from '@/lib/uuid';
import type { GoodsRelationKind } from '@/lib/good-relations';
import { toKstDateTimeInput } from './goods-price-periods';
import { parseGoodsRelationVisual, type GoodsRelationVisual } from '@/lib/good-relation-visual';

export { relationDefaultTitle, type GoodsRelationKind } from '@/lib/good-relations';

export const GOODS_RELATIONS_PATH = '/admin/catalog/related-goods';
export const GOODS_RELATION_KINDS = [{ value: 'together', label: '함께 사면 좋은 상품' }, { value: 'similar', label: '유사한 상품' }, { value: 'codi', label: '코디 상품' }, { value: 'other_composition', label: '다른 구성 상품' }] as const;
export const GOODS_RELATION_STATES = [{ value: 'active', label: '전시중' }, { value: 'scheduled', label: '전시대기' }, { value: 'stopped', label: '전시중지' }, { value: 'ended', label: '기간종료' }] as const;
export type GoodsRelationState = typeof GOODS_RELATION_STATES[number]['value'];
export interface GoodsRelationGood { id: string; name: string; code: string; imagePath: string | null; public: boolean; compositionLabel?: string | null }
export interface GoodsCompositionLabel { goodId: string; label: string }
export interface GoodsRelation {
  id: string; kind: GoodsRelationKind; title: string; representativeGoodId: string; enabled: boolean;
  startsAt: string | null; endsAt: string | null; revision: number; createdAt: string | null; updatedAt: string | null;
  state: GoodsRelationState; goods: GoodsRelationGood[]; visual?: GoodsRelationVisual | null;
}
export interface GoodsRelationValues {
  kind: GoodsRelationKind; title: string; representativeGoodId: string; enabled: boolean;
  startsAt: string | null; endsAt: string | null; goodIds: string[]; visual?: GoodsRelationVisual | null; compositionLabels?: GoodsCompositionLabel[];
}
export interface GoodsRelationFilters { query: string; kind: 'all' | GoodsRelationKind; state: 'all' | GoodsRelationState; page: number; pageSize: 20 | 50 | 100 }
export interface GoodsRelationList { rows: GoodsRelation[]; total: number; filters: GoodsRelationFilters }
export interface GoodsRelationCandidates { rows: GoodsRelationGood[]; total: number; page: number; pageSize: 20 }
export interface GoodsRelationDraft extends Omit<GoodsRelationValues, 'goodIds'> { id: string; revision: number; goods: GoodsRelationGood[] }
export const relationLimit = (kind: GoodsRelationKind, visual = false) => kind === 'other_composition' ? 10 : visual || kind === 'codi' ? 5 : kind === 'together' ? 6 : 10;
export const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const validCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const validInstant = (value: unknown) => value === null || typeof value === 'string' && Number.isFinite(Date.parse(value));
const validCompositionLabel = (value: unknown): value is string => typeof value === 'string' && value === value.trim()
  && [...value].length >= 1 && [...value].length <= 40 && !/[\u0000-\u001f\u007f-\u009f]/.test(value);

function parseCompositionLabels(value: unknown, goodIds: string[]): GoodsCompositionLabel[] | null {
  if (!Array.isArray(value) || value.length > 10) return null;
  const seen = new Set<string>(), labels: GoodsCompositionLabel[] = [];
  for (const item of value) {
    if (!isObject(item) || Object.keys(item).length !== 2 || typeof item.goodId !== 'string' || !goodIds.includes(item.goodId)
      || seen.has(item.goodId) || typeof item.label !== 'string' || /[\u0000-\u001f\u007f-\u009f]/.test(item.label)) return null;
    seen.add(item.goodId);
    const label = item.label.trim();
    if (label && !validCompositionLabel(label)) return null;
    if (label) labels.push({ goodId: item.goodId, label });
  }
  return labels;
}

export function goodsRelationDraft(relation: GoodsRelation): GoodsRelationDraft {
  return { id: relation.id, revision: relation.revision, kind: relation.kind, title: relation.title,
    representativeGoodId: relation.representativeGoodId, enabled: relation.enabled,
    startsAt: toKstDateTimeInput(relation.startsAt), endsAt: toKstDateTimeInput(relation.endsAt), goods: relation.goods, visual: relation.visual ?? null };
}

function parseInstant(value: unknown): string | null | false {
  if (value === '' || value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) return false;
  const [year, month, day, hour, minute, second = 0] = value.slice(0, 19).split(/[-T:]/).map(Number);
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()
    || hour > 23 || minute > 59 || second > 59) return false;
  const timestamp = Date.parse(value.length === 16 ? `${value}:00+09:00` : value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : false;
}

export function parseGoodsRelationInput(input: unknown): { ok: true; id: string; revision: number; values: GoodsRelationValues } | { ok: false; error: string } {
  if (!isObject(input) || !isUuid(input.id) || !validCount(input.revision) || !isObject(input.values)) return { ok: false, error: '편성 정보가 올바르지 않습니다. 최신 화면을 다시 열어주세요.' };
  const value = input.values;
  if (!GOODS_RELATION_KINDS.some(kind => kind.value === value.kind) || typeof value.title !== 'string' || !value.title.trim()
    || [...value.title.trim()].length > 15 || typeof value.enabled !== 'boolean') return { ok: false, error: '유형과 노출 제목(1~15자), 전시 여부를 확인해주세요.' };
  const kind = value.kind as GoodsRelationKind;
  if (kind === 'other_composition' && /[\u0000-\u001f\u007f-\u009f]/.test(value.title)) return { ok: false, error: '다른 구성 상품의 노출 제목에는 제어문자를 사용할 수 없습니다.' };
  const maximum = relationLimit(kind, Boolean(value.visual));
  if (!Array.isArray(value.goodIds) || value.goodIds.length < 2 || value.goodIds.length > maximum
    || value.goodIds.some(id => typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(id))
    || new Set(value.goodIds).size !== value.goodIds.length || !value.goodIds.includes(value.representativeGoodId)) return { ok: false, error: `대표 상품을 포함해 서로 다른 상품을 2~${maximum}개 선택해주세요.` };
  if (kind === 'other_composition' && value.goodIds.some(id => id.length > 120)) return { ok: false, error: '다른 구성 상품의 상품번호를 확인해주세요.' };
  const visual = parseGoodsRelationVisual(value.visual, value.goodIds as string[]);
  if (visual === false || kind === 'codi' && !visual || (kind === 'similar' || kind === 'other_composition') && visual) return { ok: false, error: '이미지 업로드·대체 설명·상품 태그 위치를 확인해주세요. 코디는 이미지가 필요하고 유사상품·다른 구성은 목록형만 지원합니다.' };
  const compositionLabels = kind === 'other_composition' ? parseCompositionLabels(value.compositionLabels ?? [], value.goodIds as string[]) : undefined;
  if (compositionLabels === null || kind !== 'other_composition' && value.compositionLabels !== undefined) return { ok: false, error: '다른 구성 상품의 표시값은 선택한 상품별로 40자 이내로 입력해주세요.' };
  const startsAt = parseInstant(value.startsAt); const endsAt = parseInstant(value.endsAt);
  if (startsAt === false || endsAt === false || startsAt && endsAt && Date.parse(startsAt) >= Date.parse(endsAt)) return { ok: false, error: '노출 기간을 확인해주세요. 종료는 시작보다 늦어야 합니다.' };
  return { ok: true, id: input.id, revision: input.revision, values: { kind, title: value.title.trim(), representativeGoodId: value.representativeGoodId as string,
    enabled: value.enabled, startsAt, endsAt, goodIds: value.goodIds as string[], ...(value.visual !== undefined ? { visual } : {}), ...(compositionLabels ? { compositionLabels } : {}) } };
}

export function parseRelationGoods(value: unknown): GoodsRelationGood[] | null {
  if (!Array.isArray(value) || value.some(good => !isObject(good) || typeof good.id !== 'string' || !good.id || typeof good.name !== 'string'
    || typeof good.code !== 'string' || good.imagePath !== null && typeof good.imagePath !== 'string' || typeof good.public !== 'boolean'
    || good.compositionLabel !== undefined && good.compositionLabel !== null && !validCompositionLabel(good.compositionLabel))) return null;
  return value as GoodsRelationGood[];
}
export function parseGoodsRelation(value: unknown): GoodsRelation | null {
  if (!isObject(value) || !isUuid(value.id) || !validCount(value.revision) || value.revision < 1
    || !validInstant(value.createdAt) || !validInstant(value.updatedAt) || !GOODS_RELATION_STATES.some(state => state.value === value.state)) return null;
  const goods = parseRelationGoods(value.goods);
  if (!goods) return null;
  if (value.kind === 'other_composition' ? goods.some(good => good.compositionLabel === undefined) : goods.some(good => good.compositionLabel !== undefined)) return null;
  const parsed = parseGoodsRelationInput({ id: value.id, revision: value.revision, values: { ...value, goodIds: goods.map(good => good.id),
    ...(value.kind === 'other_composition' ? { compositionLabels: goods.flatMap(good => good.compositionLabel ? [{ goodId: good.id, label: good.compositionLabel }] : []) } : {}) } });
  return parsed.ok ? { ...value, goods } as unknown as GoodsRelation : null;
}
export function normalizeGoodsRelationFilters(search: Record<string, string | string[] | undefined>): GoodsRelationFilters {
  const page = Number(search.page);
  return { query: typeof search.q === 'string' ? search.q.trim().slice(0, 100) : '',
    kind: GOODS_RELATION_KINDS.some(kind => kind.value === search.kind) ? search.kind as GoodsRelationKind : 'all',
    state: GOODS_RELATION_STATES.some(state => state.value === search.state) ? search.state as GoodsRelationState : 'all',
    page: Number.isSafeInteger(page) && page > 0 && page <= 100000 ? page : 1, pageSize: search.pageSize === '50' ? 50 : search.pageSize === '100' ? 100 : 20 };
}
export function goodsRelationHref(filters: GoodsRelationFilters, page = filters.page) {
  return `${GOODS_RELATIONS_PATH}?${new URLSearchParams({ q: filters.query, kind: filters.kind, state: filters.state, page: String(page), pageSize: String(filters.pageSize) })}`;
}
export function goodsRelationError(message?: string) {
  if (message === 'goods_relation_changed') return '다른 운영자가 저장한 내용이 있습니다. 입력은 유지됩니다. 최신 편성을 다시 열어 변경 내용을 확인해주세요.';
  if (message === 'goods_relation_operation_conflict') return '같은 저장 요청에 다른 내용이 있습니다. 최신 편성을 다시 확인해주세요.';
  if (message === 'unverified_artwork') return '등록 가능한 새 이미지가 아닙니다. 이 편성에 저장된 이미지를 유지하거나 새 이미지를 다시 업로드해주세요.';
  if (message === 'invalid_goods_relation_visual') return '이미지·대체 설명·상품 태그 위치와 연결 상품을 확인해주세요.';
  if (message === 'invalid_goods_relation_composition_labels') return '다른 구성 상품의 표시값과 연결 상품을 확인해주세요.';
  if (message === 'invalid_goods_relation_goods') return '구성 상품과 대표 상품을 확인해주세요. 삭제된 상품은 선택할 수 없습니다.';
  if (message === 'invalid_goods_relation_period') return '노출 기간을 확인해주세요. 종료는 시작보다 늦어야 합니다.';
  return '연관상품을 저장하지 못했습니다. 입력은 유지됩니다. 잠시 후 다시 시도해주세요.';
}
