import { isUuid } from '@/lib/uuid';
import type { GoodsRelationKind } from '@/lib/good-relations';
import { toKstDateTimeInput } from './goods-price-periods';
import { parseGoodsRelationVisual, type GoodsRelationVisual } from '@/lib/good-relation-visual';
import { parseGoodVisibility, type GoodVisibilityReason } from './good-visibility';

export { relationDefaultTitle, type GoodsRelationKind } from '@/lib/good-relations';

export const GOODS_RELATIONS_PATH = '/admin/catalog/related-goods';
export const GOODS_RELATION_KINDS = [{ value: 'together', label: '함께 사면 좋은 상품' }, { value: 'similar', label: '유사한 상품' }, { value: 'codi', label: '코디 상품' }, { value: 'other_composition', label: '다른 구성 상품' }] as const;
export const GOODS_RELATION_STATES = [{ value: 'active', label: '전시중' }, { value: 'scheduled', label: '전시대기' }, { value: 'stopped', label: '전시중지' }, { value: 'ended', label: '기간종료' }] as const;
export type GoodsRelationState = typeof GOODS_RELATION_STATES[number]['value'];
/**
 * 담은 상품이 고객에게 보이는지와 안 보이는 이유. DB(private.goods_display_visibility)가 정하고, 보는 운영자의 성인 인증과는 상관없다.
 * `public`은 상품과 IP가 공개됐다는 뜻이다(visibility가 public 또는 restricted). 판매 제한(19금) 상품은 restricted이고 화면이 따로 표시한다.
 */
export type GoodsRelationGoodVisibility = 'public' | GoodVisibilityReason;
export interface GoodsRelationGood { id: string; name: string; code: string; imagePath: string | null; public: boolean; visibility: GoodsRelationGoodVisibility; compositionLabel?: string | null }
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
/**
 * 담은 상품이 한도를 넘어 그 유형·표시 방식으로 바꿀 수 없는 까닭(화면 규칙 5 — 저장할 때가 아니라 고를 때 막는다). 바꿀 수 있으면 null.
 * `label`은 받침으로 끝나는 이름만 넘긴다('코디 상품'·'이미지형').
 */
export function relationLimitBlock(label: string, limit: number, count: number): string | null {
  return count > limit ? `${label}은 ${limit}개까지 담습니다. 지금 ${count}개라 ${count - limit}개를 뺀 뒤 바꿀 수 있습니다.` : null;
}
/** 바꾸거나 빼면 함께 사라지는 입력을 한 문장으로 적는다(화면 규칙 7). 사라지는 것이 없으면 ''. */
export function relationLossText(loss: { image?: boolean; tags?: number; text?: boolean; labels?: number }): string {
  const parts: [string, '이' | '가'][] = [];
  if (loss.image) parts.push(['이미지 1장', '이']);
  if (loss.tags) parts.push([`태그 ${loss.tags}개`, '가']);
  if (loss.text) parts.push(['이미지 설명과 소개 글', '이']);
  if (loss.labels) parts.push([`구성 표시값 ${loss.labels}개`, '가']);
  return parts.length ? `${parts.map(([text]) => text).join(', ')}${parts[parts.length - 1][1]} 사라집니다.` : '';
}

/** 판매 제한(19금) 상품에 '공개'와 따로 붙이는 표시. 성인 상품을 모든 고객에게 숨겨 둔 동안에는 그 사실을 적는다(기능 공개 관리의 버튼 이름과 같다). */
export const RELATION_ADULT_ONLY = '성인 인증 고객에게만';
export const RELATION_ADULT_HIDDEN = '성인 상품 · 모든 고객에게 숨김';
const RELATION_GOOD_STATUS: Record<GoodsRelationGoodVisibility, { status: 'published' | 'draft' | 'archived'; label: string }> = {
  public: { status: 'published', label: '공개' }, restricted: { status: 'published', label: '공개' },
  draft: { status: 'draft', label: '초안' }, ip_draft: { status: 'draft', label: 'IP 초안' },
  archived: { status: 'archived', label: '보관' }, ip_archived: { status: 'archived', label: 'IP 보관' },
};
/** 담은 상품 한 줄의 전시상태(초안·공개·보관)와 판매 제한 표시. 고르는 창과 저장 뒤 화면이 같은 값을 쓴다. */
export function relationGoodStatus(good: Pick<GoodsRelationGood, 'visibility'>, adultGoodsHidden = false) {
  return { ...RELATION_GOOD_STATUS[good.visibility], note: good.visibility !== 'restricted' ? null : adultGoodsHidden ? RELATION_ADULT_HIDDEN : RELATION_ADULT_ONLY };
}
/** 선택창 줄에 쓰는 한 줄: "공개 · 성인 인증 고객에게만". */
export function relationGoodStatusText(good: Pick<GoodsRelationGood, 'visibility'>, adultGoodsHidden = false) {
  const { label, note } = relationGoodStatus(good, adultGoodsHidden);
  return note ? `${label} · ${note}` : label;
}
/** 성인 인증 고객까지 넣어 가장 넓게 봤을 때 고객에게 보이는 상품. 성인 상품을 모두에게 숨겨 둔 동안에는 판매 제한 상품이 빠진다. */
export function relationShownGoods<T extends Pick<GoodsRelationGood, 'visibility'>>(goods: readonly T[], adultGoodsHidden = false): T[] {
  return goods.filter(good => good.visibility === 'public' || good.visibility === 'restricted' && !adultGoodsHidden);
}

/** 고객 상세에 보이는지와 안 보이는 까닭. 조건은 고객 조회(get_good_relation_compositions·get_good_other_compositions)와 같다. */
export interface RelationCustomerView {
  /** 전시 기간 안이면(전시대기는 시작한 뒤에) 고객에게 보인다. */
  shown: boolean;
  /** 안 보이는 까닭. few·empty는 공개 상품이 모자람, representative는 대표 상품이 고객에게 안 보임. */
  reason: 'stopped' | 'ended' | 'empty' | 'few' | 'representative' | null;
  /** 아직 전시 기간 전이다. */
  scheduled: boolean;
  /** 목록형 '함께 사면 좋은 상품'은 대표 상품 상세 한 곳에만 보인다. */
  representativeOnly: boolean;
  /** 보이는 상품 상세 수. */
  pages: number;
  /** all: 성인 인증 고객에게만 보인다. some: 담은 상품 가운데 `adultCount`개만 성인 인증 고객에게 보인다. */
  adultOnly: 'none' | 'some' | 'all';
  adultCount: number;
  /** reason이 representative일 때 대표 상품의 상태 이름. */
  representativeStatus: string | null;
  /** 성인 상품을 모든 고객에게 숨겨 둔 탓에 빠진 상품이 있다(reason이 few·empty일 때만 본다). */
  hiddenAdult: boolean;
}
export function relationCustomerView(input: {
  kind: GoodsRelationKind; visual: boolean; state: GoodsRelationState; representativeGoodId: string;
  goods: readonly Pick<GoodsRelationGood, 'id' | 'visibility'>[]; adultGoodsHidden?: boolean;
}): RelationCustomerView {
  const general = input.goods.filter(good => good.visibility === 'public');
  const widest = relationShownGoods(input.goods, input.adultGoodsHidden);
  const needsRepresentative = input.kind !== 'other_composition';
  const eligible = (members: typeof widest) => members.length >= 2 && (!needsRepresentative || members.some(good => good.id === input.representativeGoodId));
  const representativeOnly = input.kind === 'together' && !input.visual;
  const hiddenAdult = Boolean(input.adultGoodsHidden) && input.goods.some(good => good.visibility === 'restricted');
  const hidden = (reason: RelationCustomerView['reason'], representativeStatus: string | null = null): RelationCustomerView =>
    ({ shown: false, reason, scheduled: false, representativeOnly, pages: 0, adultOnly: 'none', adultCount: 0, representativeStatus, hiddenAdult });
  if (input.state === 'stopped') return hidden('stopped');
  if (input.state === 'ended') return hidden('ended');
  if (widest.length < 2) return hidden(widest.length ? 'few' : 'empty');
  if (!eligible(widest)) {
    const representative = input.goods.find(good => good.id === input.representativeGoodId);
    return hidden('representative', !representative ? null : representative.visibility === 'restricted' ? '모든 고객에게 숨긴 성인 상품' : RELATION_GOOD_STATUS[representative.visibility].label);
  }
  const adultCount = widest.length - general.length;
  return { shown: true, reason: null, scheduled: input.state === 'scheduled', representativeOnly, pages: representativeOnly ? 1 : widest.length,
    adultOnly: !eligible(general) ? 'all' : adultCount ? 'some' : 'none', adultCount, representativeStatus: null, hiddenAdult };
}
const RELATION_HIDDEN_REASON = { stopped: '전시중지라', ended: '전시 기간이 끝나', empty: '공개 상품이 없어', few: '공개 상품이 1개뿐이라' } as const;
/** 성인 상품을 모든 고객에게 숨겨 둔 동안에는 '공개'로 보이는 판매 제한 상품이 수에서 빠진 까닭을 함께 적는다. */
const RELATION_HIDDEN_ADULT = '숨긴 성인 상품을 빼면 ';
/** 다른 구성 상품은 상품 상세 구성의 설정이 꺼져 있으면 보이지 않는다(이 화면에서는 그 설정을 읽지 못해 조건으로 적는다). */
const OTHER_COMPOSITION_CONDITION = ' 상품 상세 구성의 \'다른 구성 추천 표시\'가 켜져 있어야 합니다.';
/**
 * 저장 막대의 결과 한 줄('글보다 화면' 3). 고친 내용이 있으면 "저장하면 …", 저장된 그대로면 지금 상태를 말한다.
 * `startText`는 전시 기간 전일 때의 시작 시각("12월 1일 10:00").
 */
export function relationReadback(view: RelationCustomerView, options: { kind: GoodsRelationKind; unsaved: boolean; startText?: string | null }): string {
  if (!view.shown) {
    const short = view.reason === 'few' || view.reason === 'empty';
    const cause = view.reason === 'representative' ? `대표 상품이 ${view.representativeStatus ?? '공개 전'}이라` : RELATION_HIDDEN_REASON[view.reason ?? 'empty'];
    return `${short && view.hiddenAdult ? RELATION_HIDDEN_ADULT : ''}${cause} ${options.unsaved ? '저장해도 ' : ''}고객에게 보이지 않습니다.`;
  }
  const where = view.representativeOnly ? '대표 상품 상세' : `상품 ${view.pages}개 상세`;
  const from = view.scheduled && options.startText ? `${options.startText}부터 ` : '';
  const lead = options.unsaved ? '저장하면 ' : view.scheduled ? '' : '지금 ';
  const audience = view.adultOnly === 'all' ? `${RELATION_ADULT_ONLY} ` : '';
  const some = view.adultOnly === 'some' ? ` 성인 상품 ${view.adultCount}개는 ${RELATION_ADULT_ONLY} 보입니다.` : '';
  return `${lead}${from}${audience}${where}에 보입니다.${some}${options.kind === 'other_composition' ? OTHER_COMPOSITION_CONDITION : ''}`;
}
/** 목록의 '고객 화면' 칸: 보임/안 보임과 짧은 까닭. */
export function relationListView(view: RelationCustomerView): { shown: boolean; detail: string } {
  if (!view.shown) {
    return { shown: false, detail: view.reason === 'representative' ? `대표 상품이 ${view.representativeStatus ?? '공개 전'}`
      : view.reason === 'stopped' ? '전시중지' : view.reason === 'ended' ? '전시 기간 끝남'
      : `${view.hiddenAdult ? RELATION_HIDDEN_ADULT : ''}${view.reason === 'few' ? '공개 상품 1개뿐' : '공개 상품 없음'}` };
  }
  const where = view.representativeOnly ? '대표 상품 상세' : `상품 ${view.pages}개 상세`;
  const audience = view.adultOnly === 'all' ? ` · ${RELATION_ADULT_ONLY}` : view.adultOnly === 'some' ? ` · ${view.adultCount}개는 ${RELATION_ADULT_ONLY}` : '';
  return view.scheduled ? { shown: false, detail: `전시 기간 전 · ${where}${audience}` } : { shown: true, detail: `${where}${audience}` };
}

/** datetime-local 값(KST)의 시각. 비었거나 읽을 수 없으면 null. */
function kstInputTime(value: string | null | undefined): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return null;
  const time = Date.parse(`${value.slice(0, 16)}:00+09:00`);
  return Number.isFinite(time) ? time : null;
}
/** datetime-local 값을 "12월 1일 10:00"으로 읽는다. 올해가 아니면 연도를 붙인다. */
function kstInputText(value: string, currentYear: number): string {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  return `${year === currentYear ? '' : `${year}년 `}${month}월 ${day}일 ${value.slice(11, 16)}`;
}
/** 저장 전 입력의 전시상태. 판정 순서는 DB(goods_relation_document)와 같다. `now`는 화면을 연 시각이다. */
export function relationDraftState(draft: Pick<GoodsRelationDraft, 'enabled' | 'startsAt' | 'endsAt'>, now: number): GoodsRelationState {
  if (!draft.enabled) return 'stopped';
  const start = kstInputTime(draft.startsAt), end = kstInputTime(draft.endsAt);
  return start !== null && start > now ? 'scheduled' : end !== null && end <= now ? 'ended' : 'active';
}
/**
 * 전시 기간 입력을 한 줄로 되읽는다('글보다 화면' 3). 시작 시각부터 보이고 종료 시각에 내려간다. 비운 쪽은 제한이 없다.
 * `invalid`면 저장할 수 없는 기간이다. `startText`는 저장 막대의 결과 한 줄이 쓴다.
 */
export function relationPeriodReadback(draft: Pick<GoodsRelationDraft, 'enabled' | 'startsAt' | 'endsAt'>, now: number): { text: string; invalid: boolean; startText: string | null } {
  const start = kstInputTime(draft.startsAt), end = kstInputTime(draft.endsAt);
  const year = new Date(now + 9 * 60 * 60 * 1000).getUTCFullYear();
  const startText = start === null ? null : kstInputText(draft.startsAt!, year), endText = end === null ? null : kstInputText(draft.endsAt!, year);
  if (start !== null && end !== null && end <= start) return { text: '종료가 시작보다 늦어야 저장할 수 있습니다.', invalid: true, startText };
  const period = startText && endText ? `${startText}부터 ${endText}까지 전시합니다.` : startText ? `${startText}부터 계속 전시합니다.`
    : endText ? `${endText}까지 전시합니다.` : '기간 없이 계속 전시합니다.';
  return { text: draft.enabled ? period : `전시로 바꾸면 ${period}`, invalid: false, startText };
}
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

const RELATION_UNREADABLE = '저장할 내용을 읽지 못했습니다. 화면을 새로고침한 뒤 다시 저장해 주세요.';
const RELATION_PERIOD_ERROR = '전시 기간의 종료를 시작보다 늦게 맞춰 주세요.';
const RELATION_VISUAL_ERROR = '이미지를 저장하지 못했습니다. 이미지를 다시 올리고 태그를 다시 붙인 뒤 저장해 주세요.';
/**
 * 이미지 쪽에서 저장할 수 없는 까닭을 하나씩 말한다(이미지 없음 → 이미지 설명 없음). 문제가 없으면 null — 글자 수·태그 위치는 parseGoodsRelationVisual이 본다.
 * 편집 화면의 결과 한 줄도 같은 판정을 써서, 저장하면 거절될 입력에 "저장하면 … 보입니다"라고 말하지 않는다.
 */
export function relationVisualError(kind: GoodsRelationKind, visual: unknown): string | null {
  if (visual === undefined || visual === null) return kind === 'codi' ? '코디 상품은 이미지가 있어야 합니다. 코디 이미지를 올려 주세요.' : null;
  if (kind === 'similar' || kind === 'other_composition') return '유사한 상품과 다른 구성 상품에는 이미지를 넣을 수 없습니다. 화면을 새로고침한 뒤 다시 저장해 주세요.';
  if (!isObject(visual)) return RELATION_UNREADABLE;
  if (typeof visual.imagePath !== 'string' || !visual.imagePath) return kind === 'codi' ? '코디 이미지를 올려 주세요.' : '이미지형은 이미지가 있어야 합니다. 이미지를 올리거나 표시 방식을 목록형으로 바꿔 주세요.';
  if (typeof visual.alt !== 'string' || !visual.alt.trim()) return '이미지 설명을 적어 주세요.';
  return null;
}

export function parseGoodsRelationInput(input: unknown): { ok: true; id: string; revision: number; values: GoodsRelationValues } | { ok: false; error: string } {
  if (!isObject(input) || !isUuid(input.id) || !validCount(input.revision) || !isObject(input.values)) return { ok: false, error: RELATION_UNREADABLE };
  const value = input.values;
  if (!GOODS_RELATION_KINDS.some(kind => kind.value === value.kind) || typeof value.enabled !== 'boolean' || typeof value.title !== 'string') return { ok: false, error: RELATION_UNREADABLE };
  if (!value.title.trim() || [...value.title.trim()].length > 15) return { ok: false, error: '노출 제목을 1~15자로 적어 주세요.' };
  const kind = value.kind as GoodsRelationKind;
  if (kind === 'other_composition' && /[\u0000-\u001f\u007f-\u009f]/.test(value.title)) return { ok: false, error: '노출 제목에 줄바꿈이나 탭은 넣을 수 없습니다. 지우고 다시 저장해 주세요.' };
  const maximum = relationLimit(kind, Boolean(value.visual));
  if (!Array.isArray(value.goodIds) || value.goodIds.some(id => typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(id))
    || new Set(value.goodIds).size !== value.goodIds.length) return { ok: false, error: RELATION_UNREADABLE };
  if (value.goodIds.length < 2) return { ok: false, error: '상품을 2개 이상 담아 주세요.' };
  if (value.goodIds.length > maximum) return { ok: false, error: `상품은 ${maximum}개까지 담을 수 있습니다. ${value.goodIds.length - maximum}개를 뺀 뒤 다시 저장해 주세요.` };
  if (!value.goodIds.includes(value.representativeGoodId)) return { ok: false, error: '담은 상품 가운데 대표 상품을 하나 골라 주세요.' };
  if (kind === 'other_composition' && value.goodIds.some(id => id.length > 120)) return { ok: false, error: RELATION_UNREADABLE };
  const visualError = relationVisualError(kind, value.visual);
  if (visualError) return { ok: false, error: visualError };
  const visual = parseGoodsRelationVisual(value.visual, value.goodIds as string[]);
  if (visual === false) return { ok: false, error: RELATION_VISUAL_ERROR };
  const compositionLabels = kind === 'other_composition' ? parseCompositionLabels(value.compositionLabels ?? [], value.goodIds as string[]) : undefined;
  if (compositionLabels === null || kind !== 'other_composition' && value.compositionLabels !== undefined) return { ok: false, error: '구성 표시값은 상품마다 40자까지 적을 수 있습니다. 줄바꿈은 넣을 수 없습니다.' };
  const startsAt = parseInstant(value.startsAt); const endsAt = parseInstant(value.endsAt);
  if (startsAt === false || endsAt === false || startsAt && endsAt && Date.parse(startsAt) >= Date.parse(endsAt)) return { ok: false, error: RELATION_PERIOD_ERROR };
  return { ok: true, id: input.id, revision: input.revision, values: { kind, title: value.title.trim(), representativeGoodId: value.representativeGoodId as string,
    enabled: value.enabled, startsAt, endsAt, goodIds: value.goodIds as string[], ...(value.visual !== undefined ? { visual } : {}), ...(compositionLabels ? { compositionLabels } : {}) } };
}

export function parseRelationGoods(value: unknown): GoodsRelationGood[] | null {
  if (!Array.isArray(value) || value.some(good => !isObject(good) || typeof good.id !== 'string' || !good.id || typeof good.name !== 'string'
    || typeof good.code !== 'string' || good.imagePath !== null && typeof good.imagePath !== 'string' || typeof good.public !== 'boolean'
    || parseGoodVisibility(good.visibility) === null || good.public !== (good.visibility === 'public' || good.visibility === 'restricted')
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
/** 저장 결과를 모를 때의 안내. 화면은 입력을 잠그고 [저장됐는지 확인]으로 같은 저장을 다시 보낸다(두 번 저장되지 않는다). */
export const RELATION_SAVE_UNKNOWN = '저장됐는지 확인하지 못했습니다. [저장됐는지 확인]을 누르면 같은 내용이 두 번 저장되지 않습니다.';
/** 저장 결과를 모르는 채 화면을 떠나려 할 때 묻는 말. 이 화면은 저장하려던 내용을 따로 보관하지 않아, 떠나면 여기서는 다시 확인할 수 없다. */
export const RELATION_LEAVE_UNKNOWN = '저장됐는지 아직 모릅니다. 이 화면을 떠나면 여기서는 다시 확인할 수 없고, 저장되지 않았으면 적은 내용이 사라집니다. 떠난 뒤에는 연관상품 목록에서 저장됐는지 확인해 주세요. 이동할까요?';
/** 다른 사람이 먼저 저장했거나 같은 저장이 다른 내용으로 이미 끝났다. 화면은 이때 [최신 내용 다시 열기]를 보인다. */
export function goodsRelationConflict(message?: string) {
  return message === 'goods_relation_changed' || message === 'goods_relation_operation_conflict';
}
export function goodsRelationError(message?: string) {
  if (message === 'goods_relation_changed') return '다른 사람이 먼저 바꿨습니다. 지금 적은 내용은 저장되지 않았습니다. [최신 내용 다시 열기]로 바뀐 내용을 확인한 뒤 다시 고쳐 주세요.';
  if (message === 'goods_relation_operation_conflict') return '저장하지 못했습니다. [최신 내용 다시 열기]로 지금 저장된 내용을 확인한 뒤 다시 고쳐 주세요.';
  if (message === 'unverified_artwork') return '이미지를 다시 올려 주세요. 올린 지 오래됐거나 다른 곳에 이미 쓴 이미지는 저장되지 않습니다.';
  if (message === 'invalid_goods_relation_visual') return RELATION_VISUAL_ERROR;
  if (message === 'invalid_goods_relation_composition_labels') return '구성 표시값을 저장하지 못했습니다. 40자를 넘거나 줄바꿈이 든 값을 고친 뒤 다시 저장해 주세요.';
  if (message === 'invalid_goods_relation_goods') return '담은 상품 가운데 저장할 수 없는 상품이 있습니다. 삭제된 상품을 뺀 뒤 다시 저장해 주세요.';
  if (message === 'invalid_goods_relation_period') return RELATION_PERIOD_ERROR;
  return '연관상품을 저장하지 못했습니다. 적어 둔 내용은 그대로 있습니다. 잠시 뒤 다시 저장해 주세요.';
}
