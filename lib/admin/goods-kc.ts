import { isUuid } from '@/lib/uuid';
import {
  GOODS_KC_BUSINESS_LABELS, GOODS_KC_FAMILY_LABELS, GOODS_KC_SCHEME_LABELS,
  goodsKcNeedsIdentifier, goodsKcSchemeAllowed,
  type GoodsKcBusinessRole, type GoodsKcDisclosure, type GoodsKcFamily, type GoodsKcScheme,
} from '@/lib/goods-kc';

export const MAX_GOODS_KC_MODELS = 50;
export const GOODS_KC_EVIDENCE_LABELS = {
  applicability: '적용판단 근거 참조', certificate: '인증·신고문서 참조',
  testReport: '시험성적서 참조', declaration: '공급자 확인서 참조',
} as const;
export interface GoodsKcModelInput {
  family: GoodsKcFamily | '';
  scheme: GoodsKcScheme | '';
  productCategory: string;
  modelName: string;
  businessRole: GoodsKcBusinessRole | '';
  businessName: string;
  identifier: string;
  publicNote: string;
  variantIds: string[];
  basis: string;
  evidence: Record<keyof typeof GOODS_KC_EVIDENCE_LABELS, string>;
}
export interface GoodsKcVariant { id: string; code: string; name: string; active: boolean }
export interface GoodsKcHistoryEntry {
  revision: number; status: 'unreviewed' | 'reviewed'; changedAt: string; actorName: string | null; reason: string;
}
export interface AdminGoodsKc {
  revision: number | null;
  status: 'unreviewed' | 'reviewed';
  models: GoodsKcModelInput[];
  contextFingerprint: string;
  publishedAt: string | null;
  archivedAt: string | null;
  reviewedAt: string | null;
  reviewerName: string | null;
  variants: GoodsKcVariant[];
  history: GoodsKcHistoryEntry[];
}
export interface GoodsKcSaveInput {
  models: GoodsKcModelInput[];
  status: 'unreviewed' | 'reviewed';
  expectedRevision: number | null;
  expectedContextFingerprint: string;
  attested: boolean;
}
const FINGERPRINT = /^[a-f0-9]{64}$/;
const SINGLE_LINE_CONTROLS = /[\u0000-\u001f\u007f]/;
const MULTI_LINE_CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function boundedText(value: unknown, limit: number, multiline = false): string | null {
  if (typeof value !== 'string' || value.length > limit
    || (multiline ? MULTI_LINE_CONTROLS : SINGLE_LINE_CONTROLS).test(value)) return null;
  return value.trim();
}
function integer(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
}
function instantOrNull(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && Number.isFinite(Date.parse(value)));
}
export function emptyGoodsKcModel(): GoodsKcModelInput {
  return { family: '', scheme: '', productCategory: '', modelName: '', businessRole: '', businessName: '',
    identifier: '', publicNote: '', variantIds: [], basis: '',
    evidence: { applicability: '', certificate: '', testReport: '', declaration: '' } };
}
export function kcModelFromTemplate(family: GoodsKcFamily, scheme: GoodsKcScheme, publicNote=''): GoodsKcModelInput | null {
  return goodsKcSchemeAllowed(family, scheme) ? { ...emptyGoodsKcModel(), family, scheme, publicNote:scheme==='not_applicable'?publicNote:'' } : null;
}
/** Family for "상품 전체 KC 해당 없음". Every family allows not-applicable;
 * '그 외' is the one that does not imply a KC-regulated product group. */
export const GOODS_KC_PRODUCT_NOT_APPLICABLE_FAMILY: GoodsKcFamily = 'other';
/** One not-applicable model linked to every active option of the product. The
 * optional customer note is the only other value; the rest stays blank. */
export function goodsKcProductNotApplicableModel(variants: readonly GoodsKcVariant[], publicNote = ''): GoodsKcModelInput {
  return { ...emptyGoodsKcModel(), family: GOODS_KC_PRODUCT_NOT_APPLICABLE_FAMILY, scheme: 'not_applicable', publicNote: publicNote.trim(),
    variantIds: variants.filter((variant) => variant.active).map((variant) => variant.id.toLowerCase()).sort() };
}
/** True when the product already has exactly one not-applicable model. */
export function goodsKcSoleNotApplicable(models: readonly GoodsKcModelInput[]): boolean {
  return models.length === 1 && models[0].scheme === 'not_applicable';
}
/** A basic goods save can bump the KC review underneath an open editor (context
 * change invalidates it). Unsaved model input must survive that refresh, so the
 * editor adopts the new server revision but keeps what the MD is typing; with no
 * unsaved input it simply shows the server models. Compared against the models
 * the editor last loaded, never against the new ones. */
export function goodsKcEditorRefresh(previous: AdminGoodsKc, next: AdminGoodsKc, models: GoodsKcModelInput[]): {
  models: GoodsKcModelInput[]; keptUnsavedInput: boolean; reopened: boolean;
} {
  const unsaved = JSON.stringify(models) !== JSON.stringify(previous.models);
  return {
    models: unsaved ? models : next.models,
    keptUnsavedInput: unsaved && next.revision !== previous.revision,
    reopened: previous.status === 'reviewed' && next.status !== 'reviewed',
  };
}
/** Customer note the one-click action saves. A sole not-applicable model keeps
 * its own note, which the MD may just have edited in the model fields; the
 * separately typed draft applies only when the action creates that model. */
export function goodsKcProductNotApplicableNote(models: readonly GoodsKcModelInput[], draftNote = ''): string {
  return goodsKcSoleNotApplicable(models) ? models[0].publicNote : draftNote;
}
/** Plan for the one-click action. `discarded` counts current model rows that the
 * replacement would erase; the editor confirms before discarding any input.
 * Rows are compared in saved form, so trimming or option order alone is no loss. */
export function planGoodsKcProductNotApplicable(models: readonly GoodsKcModelInput[], variants: readonly GoodsKcVariant[], draftNote = '') {
  const next = [goodsKcProductNotApplicableModel(variants, goodsKcProductNotApplicableNote(models, draftNote))];
  const current = normalizeGoodsKcModels(models) ?? models;
  return { models: next, discarded: models.length && JSON.stringify(current) !== JSON.stringify(next) ? models.length : 0 };
}

/** Copy after "저장 후 공개" was refused only for KC and the same input was saved
 * as a draft instead. The admin guide's error table quotes these strings verbatim. */
export const GOODS_KC_PUBLISH_BLOCKED_COPY = {
  goods: "초안으로 저장했습니다. 상품명·유형·IP·고시정보가 바뀌어 KC를 다시 검토해야 공개할 수 있습니다. KC 정보에서 다시 검토(KC 대상이 아니면 '상품 전체 KC 해당 없음')한 뒤 공개해주세요.",
  options: "초안으로 저장했습니다. 옵션이 바뀌어 KC를 다시 검토해야 공개할 수 있습니다. KC 정보에서 다시 검토(KC 대상이 아니면 '상품 전체 KC 해당 없음')한 뒤 공개해주세요.",
  goodsAndOptions: "초안으로 저장했습니다. 상품명·유형·IP·고시정보와 옵션이 바뀌어 KC를 다시 검토해야 공개할 수 있습니다. KC 정보에서 다시 검토(KC 대상이 아니면 '상품 전체 KC 해당 없음')한 뒤 공개해주세요.",
  unreviewed: "초안으로 저장했습니다. KC 정보에서 검토를 완료한 뒤 공개해주세요. KC 대상이 아니면 '상품 전체 KC 해당 없음'으로 바로 끝낼 수 있습니다.",
} as const;
type GoodsKcPublishSnapshot = Pick<AdminGoodsKc, 'status' | 'revision'> & { history: readonly Pick<GoodsKcHistoryEntry, 'revision' | 'reason'>[] };
/** Picks the copy from the KC state read before and after the draft save. Only a
 * completed review that this save invalidated names a cause; the reasons are the
 * invalidation events newer than the revision read before the save
 * (private.invalidate_goods_kc_review). Anything else, including an unreadable
 * state, keeps the generic "complete the review" copy. */
export function goodsKcPublishBlockedMessage(before: GoodsKcPublishSnapshot | null, after: GoodsKcPublishSnapshot | null): string {
  const reviewedRevision = before?.status === 'reviewed' ? before.revision : null;
  if (reviewedRevision === null || !after || after.status === 'reviewed') return GOODS_KC_PUBLISH_BLOCKED_COPY.unreviewed;
  const reasons = new Set(after.history.filter((entry) => entry.revision > reviewedRevision).map((entry) => entry.reason));
  const goods = reasons.has('goods_context_changed');
  const options = reasons.has('variant_context_changed');
  if (goods && options) return GOODS_KC_PUBLISH_BLOCKED_COPY.goodsAndOptions;
  if (goods) return GOODS_KC_PUBLISH_BLOCKED_COPY.goods;
  return options ? GOODS_KC_PUBLISH_BLOCKED_COPY.options : GOODS_KC_PUBLISH_BLOCKED_COPY.unreviewed;
}

/** Partial drafts are supported. Unsupported combinations and malformed payloads
 * are rejected before they reach the database; required evidence is checked at
 * the separate review-completion boundary. */
export function normalizeGoodsKcModels(value: unknown): GoodsKcModelInput[] | null {
  if (!Array.isArray(value) || value.length > MAX_GOODS_KC_MODELS) return null;
  const models: GoodsKcModelInput[] = [];
  const keys = Object.keys(emptyGoodsKcModel());
  for (const row of value) {
    if (!record(row) || Object.keys(row).length !== keys.length || Object.keys(row).some((key) => !keys.includes(key))) return null;
    if (typeof row.family !== 'string' || (row.family !== '' && !Object.hasOwn(GOODS_KC_FAMILY_LABELS, row.family))
      || typeof row.scheme !== 'string' || (row.scheme !== '' && !Object.hasOwn(GOODS_KC_SCHEME_LABELS, row.scheme))
      || typeof row.businessRole !== 'string' || (row.businessRole !== '' && !Object.hasOwn(GOODS_KC_BUSINESS_LABELS, row.businessRole))) return null;
    const family = row.family as GoodsKcModelInput['family']; const scheme = row.scheme as GoodsKcModelInput['scheme'];
    if (scheme && (!family || !goodsKcSchemeAllowed(family, scheme))) return null;
    const normalized = { ...emptyGoodsKcModel(), family, scheme, businessRole: row.businessRole as GoodsKcModelInput['businessRole'] };
    for (const key of ['productCategory', 'modelName', 'businessName', 'identifier', 'publicNote', 'basis'] as const) {
      const text = boundedText(row[key], key === 'basis' ? 2000 : key === 'publicNote' ? 1000 : key === 'identifier' ? 100 : 200,
        key === 'basis' || key === 'publicNote');
      if (text === null) return null;
      normalized[key] = text;
    }
    if (!Array.isArray(row.variantIds) || row.variantIds.length > 200 || row.variantIds.some((id) => typeof id !== 'string' || !isUuid(id))
      || new Set(row.variantIds).size !== row.variantIds.length) return null;
    normalized.variantIds = (row.variantIds as string[]).map((id) => id.toLowerCase()).sort();
    if (new Set(normalized.variantIds).size !== normalized.variantIds.length || !record(row.evidence)
      || Object.keys(row.evidence).length !== 4 || Object.keys(row.evidence).some((key) => !Object.hasOwn(GOODS_KC_EVIDENCE_LABELS, key))) return null;
    for (const key of Object.keys(GOODS_KC_EVIDENCE_LABELS) as (keyof GoodsKcModelInput['evidence'])[]) {
      const text = boundedText(row.evidence[key], 500);
      if (text === null) return null;
      normalized.evidence[key] = text;
    }
    models.push(normalized);
  }
  return models;
}

/** These are data/review completeness requirements, not a product's legal
 * classification or an authenticity check of a certificate. Mirrors
 * private.goods_kc_review_problems: a not-applicable model only needs its
 * family, scheme and options; model, business, basis and note are optional. */
export function goodsKcReviewProblems(models: readonly GoodsKcModelInput[], variants?: readonly GoodsKcVariant[]): string[] {
  const normalized = normalizeGoodsKcModels(models);
  if (!normalized) return ['KC 입력 형식과 제품군·제도 조합을 확인해주세요.'];
  if (normalized.length === 0) return ['KC 대상이 아니면 상품 전체 KC 해당 없음을 선택하고, KC 대상이면 검토할 모델을 추가해주세요.'];
  const problems: string[] = [];
  const coverage = new Set<string>();
  for (const [index, model] of normalized.entries()) {
    const label = `모델 ${index + 1}`;
    const subject = model.scheme !== 'not_applicable';
    if (!model.family || !model.scheme || (model.family && model.scheme && !goodsKcSchemeAllowed(model.family, model.scheme))) {
      problems.push(`${label}: 제품군과 적용 제도를 선택해주세요.`);
    }
    if (subject && (!model.productCategory || !model.modelName || !model.businessRole || !model.businessName)) {
      problems.push(`${label}: 품목 분류·모델명·사업자 구분·사업자명을 입력해주세요.`);
    }
    if (subject && (!model.basis || !model.evidence.applicability)) problems.push(`${label}: 적용 판단 사유와 근거 참조를 입력해주세요.`);
    if (!model.variantIds.length) problems.push(`${label}: 적용 옵션을 선택해주세요.`);
    for (const id of model.variantIds) {
      coverage.add(id);
      if (variants && !variants.some((variant) => variant.id === id)) problems.push(`${label}: 이 상품에 없는 옵션입니다.`);
    }
    if (model.scheme && goodsKcNeedsIdentifier(model.scheme)) {
      if (!model.identifier) problems.push(`${label}: 인증·신고번호를 입력해주세요.`);
      if (!model.evidence.certificate) problems.push(`${label}: 인증·신고 문서 근거를 입력해주세요.`);
    } else if (model.identifier) problems.push(`${label}: 선택한 제도에는 인증·신고번호를 입력하지 않습니다.`);
    if (model.scheme === 'supplier_conformity' && (!model.evidence.testReport || !model.evidence.declaration)) {
      problems.push(`${label}: 시험성적서와 공급자 확인서의 근거 참조를 입력해주세요.`);
    }
  }
  for (const variant of variants ?? []) {
    if (variant.active && !coverage.has(variant.id)) problems.push(`${variant.name}: 사용 중인 옵션의 KC 모델 연결이 필요합니다.`);
  }
  return problems;
}

export function publicGoodsKcDisclosures(models: readonly GoodsKcModelInput[], variants: readonly GoodsKcVariant[]): GoodsKcDisclosure[] {
  const normalized = normalizeGoodsKcModels(models);
  if (!normalized || goodsKcReviewProblems(normalized, variants).length) return [];
  return normalized.map((model) => ({
    family: model.family as GoodsKcFamily, scheme: model.scheme as GoodsKcScheme,
    productCategory: model.productCategory, modelName: model.modelName,
    businessRole: model.businessRole, businessName: model.businessName,
    identifier: model.identifier, publicNote: model.publicNote,
    variants: model.variantIds.map((id) => ({ id, name: variants.find((variant) => variant.id === id)!.name })),
  }));
}

export function parseGoodsKcSaveInput(value: unknown): GoodsKcSaveInput | null {
  if (!record(value) || Object.keys(value).length !== 5 || Object.keys(value).some((key) => ![
    'models', 'status', 'expectedRevision', 'expectedContextFingerprint', 'attested',
  ].includes(key)) || !['unreviewed', 'reviewed'].includes(String(value.status))
    || (value.expectedRevision !== null && !integer(value.expectedRevision))
    || typeof value.expectedContextFingerprint !== 'string' || !FINGERPRINT.test(value.expectedContextFingerprint)
    || typeof value.attested !== 'boolean') return null;
  const models = normalizeGoodsKcModels(value.models);
  if (!models || (value.status === 'reviewed' && (!value.attested || goodsKcReviewProblems(models).length))) return null;
  return { models, status: value.status as GoodsKcSaveInput['status'], expectedRevision: value.expectedRevision as number | null,
    expectedContextFingerprint: value.expectedContextFingerprint, attested: value.attested };
}

export function parseAdminGoodsKc(value: unknown): AdminGoodsKc | null {
  if (!record(value) || (value.revision !== null && !integer(value.revision))
    || (value.status !== 'unreviewed' && value.status !== 'reviewed')
    || typeof value.contextFingerprint !== 'string' || !FINGERPRINT.test(value.contextFingerprint)
    || !instantOrNull(value.publishedAt) || !instantOrNull(value.archivedAt) || !instantOrNull(value.reviewedAt)
    || (value.reviewerName !== null && typeof value.reviewerName !== 'string')
    || !Array.isArray(value.variants) || !Array.isArray(value.history) || value.history.length > 20) return null;
  const models = normalizeGoodsKcModels(value.models);
  if (!models) return null;
  const variants: GoodsKcVariant[] = [];
  for (const variant of value.variants) {
    if (!record(variant) || typeof variant.id !== 'string' || !isUuid(variant.id)
      || typeof variant.code !== 'string' || !variant.code || typeof variant.name !== 'string' || !variant.name
      || typeof variant.active !== 'boolean' || variants.some((entry) => entry.id === variant.id)) return null;
    variants.push({ id: variant.id, code: variant.code, name: variant.name, active: variant.active });
  }
  const history: GoodsKcHistoryEntry[] = [];
  for (const entry of value.history) {
    if (!record(entry) || !integer(entry.revision) || !['unreviewed', 'reviewed'].includes(String(entry.status))
      || typeof entry.changedAt !== 'string' || !Number.isFinite(Date.parse(entry.changedAt))
      || (entry.actorName !== null && typeof entry.actorName !== 'string') || typeof entry.reason !== 'string') return null;
    history.push({ revision: entry.revision, status: entry.status as GoodsKcHistoryEntry['status'], changedAt: entry.changedAt,
      actorName: entry.actorName as string | null, reason: entry.reason });
  }
  if ((value.revision === null && (models.length || value.status !== 'unreviewed'))
    || (value.status === 'reviewed' && (value.reviewedAt === null || goodsKcReviewProblems(models, variants).length))
    || (value.status === 'unreviewed' && (value.reviewedAt !== null || value.reviewerName !== null))) return null;
  return { revision: value.revision as number | null, status: value.status, models, contextFingerprint: value.contextFingerprint,
    publishedAt: value.publishedAt, archivedAt: value.archivedAt, reviewedAt: value.reviewedAt,
    reviewerName: value.reviewerName as string | null, variants, history };
}
