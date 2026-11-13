import { isUuid } from '@/lib/uuid';
import { adminGoodsCopy } from './vocabulary';
import { GOOD_TYPE_CATEGORY_MESSAGES } from './good-workspace';
import {
  MAX_GOODS_KC_MODELS, emptyGoodsKcModel, goodsKcReviewProblems, goodsKcSoleNotApplicable, kcModelFromTemplate, normalizeGoodsKcModels,
  planGoodsKcProductNotApplicable, type GoodsKcModelInput, type GoodsKcVariant,
} from './goods-kc';
import type { GoodsKcPresetTemplate } from './goods-notice-presets';
import {
  goodsOtherCertificationProblems, goodsOtherCertificationsSaveError, normalizeGoodsOtherCertifications, type GoodsOtherCertificationInput,
} from './goods-kc-other-certifications';
import { goodsOptionRowKey, type GoodsOptionRow } from './goods-option-editor';
import { parseGoodsPreorderInput, type GoodsPreorderInput } from './goods-preorders';
import {
  GOOD_WORKSPACE_EXTRA_ERROR_SECTIONS, GOOD_WORKSPACE_EXTRA_KEYS, goodWorkspaceExtraSectionFailure, parseGoodWorkspaceExtraSections,
  prepareGoodWorkspaceExtraSections, type GoodWorkspaceExtraDraft, type GoodWorkspaceExtraSubmission,
} from './good-workspace-extra-sections';

/*
 * 상품 등록 화면의 원자 저장 섹션(10/27 회의 R13·D6②).
 *
 * 등록 화면은 KC(기타 인증 포함)·예약판매를 1단계 입력과 함께 받아 public.admin_save_good_workspace 하나로 저장한다.
 * 새 옵션은 저장 전 id가 없으므로 화면은 옵션을 행 키로 가리키고, 제출할 때 저장된 옵션은 {id},
 * 새 옵션은 {attributes}(옵션값 조합) 참조로 바꾼다. DB가 저장 직후 활성 옵션, 없으면 이번 저장이 만든 옵션(사용 중지로
 * 등록해 바로 보관된 새 옵션 포함) 하나로 해석한다.
 * 섹션 입력은 브라우저 자동복구·서버 임시저장에 담지 않는다(KC 근거 참조 보호, DQ3).
 * T15b(1027T-024): 나머지 설정 13개(판매 방식·매입단가·기간 할인·추가 구성·사은품·A/S·사이즈·색상칩·복수구매 할인/배송비·묶음그룹·
 * 정기배송·수령 방식·제작)도 같은 방식으로 함께 저장한다(good-workspace-extra-sections.ts).
 */

export const GOOD_WORKSPACE_SECTIONS_FIELD = 'workspaceSections';
export const GOOD_WORKSPACE_OPERATION_FIELD = 'workspaceOperationId';
/** 섹션 오류 필드 → 같은 자리의 운영 섹션 id(`good-operation-<id>`). */
export const GOOD_WORKSPACE_ERROR_SECTIONS = { workspaceKc: 'kc', workspacePreorders: 'preorders', ...GOOD_WORKSPACE_EXTRA_ERROR_SECTIONS } as const;
export type GoodWorkspaceErrorField = keyof typeof GOOD_WORKSPACE_ERROR_SECTIONS;

export type GoodWorkspaceVariantRef = { id: string } | { attributes: Record<string, string> };
export interface GoodWorkspaceKcDraft {
  /** variantIds는 goodWorkspaceVariantId(행)로 만든 화면용 id다. 제출할 때 옵션 참조로 바뀐다. */
  models: GoodsKcModelInput[];
  attested: boolean;
  /** "상품 전체 KC 해당 없음" 체크로 만든 상태. 연결 옵션을 제출 때 현재 옵션으로 다시 맞춘다. */
  productNotApplicable?: boolean;
}
export interface GoodWorkspacePreorderDraft {
  key: string;
  optionKey: string;
  state: 'draft' | 'active';
  capacityQty: string;
  startsAt: string;
  endsAt: string;
  expectedShipDate: string;
  approvalReference: string;
}
export interface GoodWorkspaceSectionsDraft {
  kc: GoodWorkspaceKcDraft;
  preorders: GoodWorkspacePreorderDraft[];
  /** KC 카드의 기타 인증(SHEET-014). 없거나 비어 있으면 섹션을 보내지 않는다. */
  otherCertifications?: GoodsOtherCertificationInput[];
  /** T15b 나머지 설정. 키가 없는 섹션은 기본값(입력 안 함)이라 보내지 않는다. */
  extras?: Partial<GoodWorkspaceExtraDraft>;
}
export const EMPTY_GOOD_WORKSPACE_SECTIONS: GoodWorkspaceSectionsDraft = { kc: { models: [], attested: false }, preorders: [], otherCertifications: [], extras: {} };

/** 제출 형식(hidden input). 서버가 다시 검증한다. */
export interface GoodWorkspaceSectionsSubmission extends GoodWorkspaceExtraSubmission {
  kc: { status: 'unreviewed' | 'reviewed'; attested: boolean; models: (Omit<GoodsKcModelInput, 'variantIds'> & { variantRefs: GoodWorkspaceVariantRef[] })[] } | null;
  preorders: { variant: GoodWorkspaceVariantRef; values: { state: 'draft' | 'active'; capacityQty: string; startsAt: string; endsAt: string; expectedShipDate: string; approvalReference: string } }[];
  /** 입력한 기타 인증이 있을 때만 싣는다(새 상품이라 버전은 서버가 null로 확인한다). */
  otherCertifications?: GoodsOtherCertificationInput[];
}
/** admin_save_good_workspace의 sections 인자. */
export interface GoodWorkspaceRpcSections extends GoodWorkspaceExtraSubmission {
  kc?: { status: 'unreviewed' | 'reviewed'; attested: boolean; expectedRevision: null; expectedContextFingerprint: null;
    models: (Omit<GoodsKcModelInput, 'variantIds'> & { variantRefs: GoodWorkspaceVariantRef[] })[] };
  preorders?: { variant: GoodWorkspaceVariantRef; policyId: null; expectedRevision: null; values: GoodsPreorderInput }[];
  otherCertifications?: { entries: GoodsOtherCertificationInput[]; expectedRevision: null };
}

/** 새 옵션 행 키를 KC 편집기가 다룰 수 있는 고정 uuid 형식으로 바꾼다. 저장된 옵션은 id 그대로다. */
export function goodWorkspaceVariantId(row: Pick<GoodsOptionRow, 'id' | 'attributes'>): string {
  if (row.id && isUuid(row.id)) return row.id.toLowerCase();
  const key = goodsOptionRowKey(row);
  let hex = '';
  for (let seed = 0; seed < 4; seed += 1) {
    let hash = 0x811c9dc5 ^ seed;
    for (const character of key) { hash ^= character.codePointAt(0)!; hash = Math.imul(hash, 0x01000193) >>> 0; }
    hex += hash.toString(16).padStart(8, '0');
  }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * TKT-006·TKT-086: 등록 화면에서 고시 프리셋의 KC 틀을 같은 화면 KC 입력에 미검토 모델로 채운다(함께 저장해도 남는다).
 * 틀은 제품군·제도·해당 없음 안내만 채우고 옵션·번호·사업자·근거는 비운다. 확인 체크는 언제나 풀어 미검토 초안으로 둔다.
 * KC 입력이 비었거나 상품 전체 해당 없음뿐이면 틀로 바꾸고(해당 없음 틀은 '대상 아님' 미확인 상태), 다른 모델이 있으면 뒤에 더한다.
 * 적용할 수 없으면(제품군·제도 조합 오류·최대 개수) null.
 */
export function goodWorkspaceKcWithTemplate(kc: GoodWorkspaceKcDraft, template: GoodsKcPresetTemplate): GoodWorkspaceKcDraft | null {
  const model = kcModelFromTemplate(template.family, template.scheme, template.publicNote);
  if (!model) return null;
  if (!kc.models.length || goodsKcSoleNotApplicable(kc.models)) {
    return { models: [model], attested: false, productNotApplicable: model.scheme === 'not_applicable' };
  }
  return kc.models.length >= MAX_GOODS_KC_MODELS ? null : { models: [...kc.models, model], attested: false };
}

/** KC 편집기·옵션 선택에 쓰는 옵션 목록(화면 id·이름·관리코드·사용 여부). */
export function goodWorkspaceKcVariants(rows: readonly GoodsOptionRow[]): GoodsKcVariant[] {
  return rows.map((row, index) => ({ id: goodWorkspaceVariantId(row), code: row.code.trim() || '저장 시 생성',
    name: row.name.trim() || `옵션 ${index + 1}`, active: row.isActive !== false }));
}

function variantRef(row: GoodsOptionRow): GoodWorkspaceVariantRef {
  return row.id && isUuid(row.id) ? { id: row.id.toLowerCase() } : { attributes: { ...row.attributes } };
}

export type GoodWorkspaceSectionsResult =
  | { ok: true; value: GoodWorkspaceSectionsSubmission }
  | { ok: false; field: GoodWorkspaceErrorField; error: string };

export const GOOD_WORKSPACE_SALE_PERIOD_PREORDER_CONFLICT = '판매기간을 설정한 상품은 예약판매를 활성화할 수 없습니다. 예약 조건을 초안으로 바꾸거나 판매기간을 설정안함으로 바꿔주세요.';

/**
 * 화면 상태 + 현재 옵션 행 → 제출 JSON. 입력이 없는 섹션은 빼서 기존 저장과 같은 결과를 낸다.
 * `salePeriodEnabled`: 이번 제출의 판매기간 설정 여부. 판매기간과 활성 예약은 함께 저장할 수 없다(DB가 다시 막는다).
 */
export function prepareGoodWorkspaceSections(draft: GoodWorkspaceSectionsDraft, rows: readonly GoodsOptionRow[], canActivate: boolean,
  { salePeriodEnabled = false }: { salePeriodEnabled?: boolean } = {}): GoodWorkspaceSectionsResult {
  const byId = new Map(rows.map((row) => [goodWorkspaceVariantId(row), row]));
  let kc: GoodWorkspaceSectionsSubmission['kc'] = null;
  if (draft.kc.models.length || draft.kc.attested) {
    const variants = goodWorkspaceKcVariants(rows);
    /* 등록 화면의 해당 없음(해당 없음 모델 1개)은 '대상 아님' 칸으로만 보이고 옵션 연결 칸이 없다. 확인 체크와 무관하게 연결 옵션은
       제출 시점의 사용 옵션 전체로 다시 맞추고, 제품군·고객 안내 등 나머지 값은 그대로 둔다(체크를 푼 뒤 옵션을 바꿔도 저장된다). */
    const models = goodsKcSoleNotApplicable(draft.kc.models) ? planGoodsKcProductNotApplicable(draft.kc.models, variants).models : draft.kc.models;
    if (draft.kc.attested) {
      const problems = goodsKcReviewProblems(models, variants);
      if (problems.length) return { ok: false, field: 'workspaceKc', error: `KC 검토 완료 전 확인: ${problems[0]}` };
    }
    const normalized = normalizeGoodsKcModels(models);
    if (!normalized) return { ok: false, field: 'workspaceKc', error: 'KC 입력 형식과 제품군·제도 조합을 확인해주세요.' };
    if (normalized.some((model) => model.variantIds.some((id) => !byId.has(id)))) {
      return { ok: false, field: 'workspaceKc', error: 'KC 모델에 연결한 옵션이 옵션목록에 없습니다. 적용 옵션을 다시 선택해주세요.' };
    }
    kc = { status: draft.kc.attested ? 'reviewed' : 'unreviewed', attested: draft.kc.attested,
      models: normalized.map(({ variantIds, ...model }) => ({ ...model, variantRefs: variantIds.map((id) => variantRef(byId.get(id)!)) })) };
  }
  /* 기타 인증은 KC 카드 안 입력이다. 종류·인증번호가 빠지면 같은 카드에 알리고 저장하지 않는다. */
  const otherEntries = draft.otherCertifications ?? [];
  const otherProblems = otherEntries.length ? goodsOtherCertificationProblems(otherEntries) : [];
  if (otherProblems.length) return { ok: false, field: 'workspaceKc', error: otherProblems[0] };
  const otherCertifications = otherEntries.length ? normalizeGoodsOtherCertifications(otherEntries)! : [];
  const preorders: GoodWorkspaceSectionsSubmission['preorders'] = [];
  const used = new Set<string>();
  for (const [index, entry] of draft.preorders.entries()) {
    const label = `예약 조건 ${index + 1}`;
    const row = rows.find((candidate) => goodsOptionRowKey(candidate) === entry.optionKey);
    if (!row) return { ok: false, field: 'workspacePreorders', error: `${label}: 예약 대상 옵션을 다시 선택해주세요.` };
    if (used.has(entry.optionKey)) return { ok: false, field: 'workspacePreorders', error: `${label}: 한 옵션에는 예약 조건을 하나만 입력합니다.` };
    used.add(entry.optionKey);
    if (entry.state === 'active' && !canActivate) return { ok: false, field: 'workspacePreorders', error: `${label}: 예약 활성화는 관리자 계정에서 할 수 있습니다. 초안으로 저장해주세요.` };
    if (entry.state === 'active' && salePeriodEnabled) return { ok: false, field: 'workspacePreorders', error: `${label}: ${GOOD_WORKSPACE_SALE_PERIOD_PREORDER_CONFLICT}` };
    const values = { state: entry.state, capacityQty: entry.capacityQty.trim(), startsAt: entry.startsAt, endsAt: entry.endsAt,
      expectedShipDate: entry.expectedShipDate, approvalReference: entry.approvalReference };
    if (!parseGoodsPreorderInput(values)) {
      return { ok: false, field: 'workspacePreorders', error: entry.state === 'active'
        ? `${label}: 활성화하려면 승인 물량·접수 기간·발송 예정일(접수 종료일 이후)·승인 근거를 모두 입력해주세요.`
        : `${label}: 승인 물량은 1 이상의 정수, 접수 시작은 종료보다 앞서야 합니다.` };
    }
    preorders.push({ variant: variantRef(row), values });
  }
  /* T15b 나머지 설정: 매입단가 입력 권한은 예약 활성화와 같은 관리자(platform.manage+admin)다. 서버·DB가 다시 막는다. */
  const extra = prepareGoodWorkspaceExtraSections(draft.extras, rows, { canManageCosts: canActivate });
  if (!extra.ok) return extra;
  return { ok: true, value: { kc, preorders, ...(otherCertifications.length ? { otherCertifications } : {}), ...extra.value } };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function parseRef(value: unknown): GoodWorkspaceVariantRef | null {
  if (!record(value) || Object.keys(value).length !== 1) return null;
  if (Object.hasOwn(value, 'id')) return isUuid(value.id) ? { id: (value.id as string).toLowerCase() } : null;
  const attributes = value.attributes;
  if (!record(attributes) || Object.keys(attributes).length > 3
    || Object.entries(attributes).some(([key, text]) => !key.trim() || key.length > 40 || typeof text !== 'string' || !text.trim() || text.length > 80)) return null;
  return { attributes: attributes as Record<string, string> };
}

/** 서버 액션: hidden input을 RPC sections로 바꾼다. 권한 밖 예약 활성화는 여기서 막는다. */
export function parseGoodWorkspaceSections(raw: FormDataEntryValue | null, canActivate: boolean):
  { ok: true; sections: GoodWorkspaceRpcSections } | { ok: false; field: GoodWorkspaceErrorField; error: string } {
  if (raw === null || raw === '') return { ok: true, sections: {} };
  let value: unknown;
  try { value = JSON.parse(String(raw)); } catch { return { ok: false, field: 'workspaceKc', error: 'KC·예약판매 입력을 확인하지 못했습니다. 새로고침 후 다시 입력해주세요.' }; }
  if (!record(value) || Object.keys(value).some((key) => key !== 'kc' && key !== 'preorders' && key !== 'otherCertifications'
    && !(GOOD_WORKSPACE_EXTRA_KEYS as readonly string[]).includes(key))) {
    return { ok: false, field: 'workspaceKc', error: 'KC·예약판매 입력을 확인하지 못했습니다. 새로고침 후 다시 입력해주세요.' };
  }
  const sections: GoodWorkspaceRpcSections = {};
  if (value.kc !== null && value.kc !== undefined) {
    const kc = value.kc;
    const invalid = { ok: false as const, field: 'workspaceKc' as const, error: 'KC 입력 형식과 모델별 필수 정보를 확인해주세요.' };
    if (!record(kc) || !['unreviewed', 'reviewed'].includes(String(kc.status)) || typeof kc.attested !== 'boolean'
      || (kc.status === 'reviewed') !== kc.attested || !Array.isArray(kc.models)) return invalid;
    const models: NonNullable<GoodWorkspaceRpcSections['kc']>['models'] = [];
    for (const model of kc.models) {
      if (!record(model) || !Array.isArray(model.variantRefs) || model.variantRefs.length > 200 || Object.hasOwn(model, 'variantIds')) return invalid;
      const refs = model.variantRefs.map(parseRef);
      if (refs.some((ref) => ref === null)) return invalid;
      const { variantRefs, ...fields } = model;
      void variantRefs;
      const normalized = normalizeGoodsKcModels([{ ...fields, variantIds: [] }]);
      if (!normalized || Object.keys(fields).length !== Object.keys(emptyGoodsKcModel()).length - 1) return invalid;
      const { variantIds, ...clean } = normalized[0];
      void variantIds;
      models.push({ ...clean, variantRefs: refs as GoodWorkspaceVariantRef[] });
    }
    if (models.length > 50) return invalid;
    sections.kc = { status: kc.status as 'unreviewed' | 'reviewed', attested: kc.attested, expectedRevision: null, expectedContextFingerprint: null, models };
  }
  if (value.preorders !== undefined) {
    if (!Array.isArray(value.preorders) || value.preorders.length > 100) return { ok: false, field: 'workspacePreorders', error: '예약 조건 입력을 확인해주세요.' };
    const preorders: NonNullable<GoodWorkspaceRpcSections['preorders']> = [];
    for (const [index, entry] of value.preorders.entries()) {
      const label = `예약 조건 ${index + 1}`;
      const variant = record(entry) ? parseRef(entry.variant) : null;
      const values = record(entry) && record(entry.values) && ['draft', 'active'].includes(String(entry.values.state)) ? parseGoodsPreorderInput(entry.values) : null;
      if (!variant || !values) return { ok: false, field: 'workspacePreorders', error: `${label}: 승인 물량·접수 기간·발송 예정일·승인 근거와 대상 옵션을 확인해주세요.` };
      if (values.state === 'active' && !canActivate) return { ok: false, field: 'workspacePreorders', error: '예약 활성화와 일반 재고 판매 전환은 관리자 계정에서 할 수 있습니다.' };
      preorders.push({ variant, policyId: null, expectedRevision: null, values });
    }
    if (preorders.length) sections.preorders = preorders;
  }
  if (value.otherCertifications !== undefined) {
    const entries = normalizeGoodsOtherCertifications(value.otherCertifications);
    if (!entries || goodsOtherCertificationProblems(entries).length) {
      return { ok: false, field: 'workspaceKc', error: '기타 인증마다 인증 종류와 인증번호를 확인해주세요. 같은 인증은 한 번만 입력합니다.' };
    }
    if (entries.length) sections.otherCertifications = { entries, expectedRevision: null };
  }
  const extra = parseGoodWorkspaceExtraSections(value, { canManageCosts: canActivate });
  if (!extra.ok) return extra;
  return { ok: true, sections: { ...sections, ...extra.value } };
}

/**
 * T15b(0901-008): 새 상품 원자 저장의 공개 결과(영수증 publish). 공개됐으면 null, 거절됐으면 저장은 끝났다는 문장과 이유.
 * 이유는 기존 '저장 후 공개' 오류 안내와 같은 문장을 쓴다(판정은 서버 공개 경로 그대로). 결과가 없으면 공개 여부를 모르므로 거절로 다룬다.
 */
export function goodWorkspacePublishRejection(publish: unknown): { message: string; kc: boolean } | null {
  const result = record(publish) ? publish as { published?: unknown; error?: unknown } : null;
  if (result?.published === true) return null;
  const reason = typeof result?.error === 'string' ? result.error : '';
  const saved = adminGoodsCopy('굿즈를 저장했지만 공개하지 않았습니다.');
  if (reason.includes('goods_kc_')) return { kc: true, message: `${saved} KC 검토를 마쳐야 공개할 수 있습니다. KC 정보에서 검토를 완료한 뒤 판매 준비에서 공개해주세요.` };
  const why = reason.includes('goods_publish_incomplete') ? '상품 유형·대표 이미지·상품정보제공고시와 옵션을 채운 뒤 판매 준비에서 공개해주세요.'
    : /invalid_good_origin|fulfillment_origin_required|fulfillment_origin_inactive/.test(reason) ? '활성 출고지를 고른 뒤 판매 준비에서 공개해주세요.'
    : reason.includes('goods_type_category_required') ? GOOD_TYPE_CATEGORY_MESSAGES.required
    : reason.includes('goods_type_category_changed') ? GOOD_TYPE_CATEGORY_MESSAGES.changed
    : '공개 조건을 확인한 뒤 판매 준비에서 공개해주세요.';
  return { kc: false, message: `${saved} ${why}` };
}

/** admin_save_good_workspace 오류 → 섹션 칸 안내. 섹션과 무관한 오류는 null(기본 저장 매핑이 맡는다). */
export function goodWorkspaceSectionFailure(message: string, code?: string): Partial<Record<GoodWorkspaceErrorField | 'form' | 'saleStartsAt', string>> | null {
  /* T15b 나머지 설정의 실패는 래퍼가 섹션 이름을 담아 다시 던진다. 그 섹션 칸에 안내한다(아래 KC·예약판매 매핑보다 먼저 본다). */
  const extraFailure = goodWorkspaceExtraSectionFailure(message, code);
  if (extraFailure) return extraFailure;
  /*
   * 등록 화면에서 판매기간·예약 충돌은 이번 제출의 예약 활성화 때문이다. 저장된 상품의 '일반재고로 전환'은 여기 없으므로
   * 예약 조건 카드와 판매기간 칸에 등록 화면에서 할 수 있는 방법을 알린다. 다른 판매기간 오류는 기본 저장 매핑이 맡는다.
   */
  if (message.includes('goods_sale_period_preorder_conflict')) {
    return { saleStartsAt: '판매기간을 설정하면 이번에 함께 저장하는 예약판매를 활성화할 수 없습니다. 판매기간을 설정안함으로 바꾸거나 아래 예약 조건을 초안으로 바꿔주세요.',
      workspacePreorders: `${GOOD_WORKSPACE_SALE_PERIOD_PREORDER_CONFLICT} 상품은 저장되지 않았고 입력은 유지됩니다.` };
  }
  if (message.includes('goods_sale_period')) return null;
  if (message.includes('goods_workspace_operation_conflict')) {
    return { form: '이미 처리된 저장 요청입니다. 입력은 유지됩니다. 목록을 새로고침해 저장된 상품을 확인해주세요.' };
  }
  if (message.includes('goods_workspace_draft_completed_sections_skipped')) {
    return { form: '이 임시저장은 다른 저장에서 이미 상품으로 등록됐습니다. 이번 KC·예약판매·추가 설정 입력과 공개 요청은 처리되지 않았고 입력은 유지됩니다. 상품 목록에서 등록된 상품을 열어 확인한 뒤 입력해주세요.' };
  }
  if (message.includes('goods_workspace_publish_unsupported')) return { form: '저장된 상품은 판매 준비의 게시 상태에서 공개해주세요.' };
  /* 옵션 참조 해석 실패는 래퍼가 섹션(kc·preorder)을 담아 알린다. 아래 예약판매 일반 매핑(preorder_)보다 먼저 본다. */
  if (message.includes('goods_workspace_preorder_variant_unresolved') || message.includes('invalid_goods_workspace_preorder_variant')) {
    return { workspacePreorders: '예약 대상 옵션을 저장된 옵션목록에서 찾지 못했습니다. 예약 대상 옵션을 다시 선택해주세요. 상품은 저장되지 않았고 입력은 유지됩니다.' };
  }
  if (message.includes('goods_workspace_kc_variant_unresolved') || message.includes('invalid_goods_workspace_kc_variant')) {
    return { workspaceKc: 'KC 모델에 연결한 옵션을 저장된 옵션목록에서 찾지 못했습니다. 적용 옵션을 다시 선택해주세요. 상품은 저장되지 않았고 입력은 유지됩니다.' };
  }
  // 화면이 확인한 상품 유형과 저장 시점의 대표 카테고리 연결값이 다르면 KC를 검토 완료로 두지 않고 전체를 거절한다.
  if (message.includes('goods_type_category_changed')) return { workspaceKc: '카테고리에 연결된 상품 유형이 바뀌었습니다. 새로고침한 뒤 KC를 다시 확인해주세요.' };
  if (message.includes('goods_kc_review_changed')) return { workspaceKc: '다른 작업에서 KC 검토가 바뀌었습니다. 입력은 유지됩니다. 새로고침 후 KC 정보를 확인해주세요.' };
  if (message.includes('goods_kc_attestation_required') || message.includes('goods_kc_review_incomplete')) {
    return { workspaceKc: '사용 중인 옵션 연결과, KC 대상이면 제품군·제도·품목·모델·사업자와 인증·신고번호(안전인증·안전확인)를 확인한 뒤 확인을 체크해주세요. 아니면 확인 체크를 풀어 미검토로 저장합니다.' };
  }
  if (/goods_other_certification|invalid_goods_other_certifications/.test(message)) {
    return { workspaceKc: `${goodsOtherCertificationsSaveError(message)} 상품은 저장되지 않았고 입력은 유지됩니다.` };
  }
  if (/invalid_goods_kc|goods_kc_variant/.test(message)) return { workspaceKc: 'KC 입력 형식과 제품군·제도 조합을 확인해주세요.' };
  if (/preorder_|invalid_preorder_policy|goods_variant_inactive/.test(message)) {
    const reason = message.includes('preorder_admin_required') ? '예약 활성화는 관리자 계정에서 할 수 있습니다.'
      : message.includes('preorder_policy_not_configured') ? '활성화하려면 승인 물량·접수 기간·발송 예정일·승인 근거를 모두 입력해주세요(접수 종료는 지금 이후).'
      : message.includes('preorder_runtime_not_ready') ? '예약판매 기능을 준비 중입니다. 아직 활성화할 수 없습니다.'
      : message.includes('goods_variant_inactive') ? '사용 중지한 옵션은 예약을 활성화할 수 없습니다.'
      : '예약 조건 입력을 확인해주세요.';
    return { workspacePreorders: `${reason} 상품은 저장되지 않았고 입력은 유지됩니다.` };
  }
  if (message.includes('invalid_goods_workspace_request')) return { form: '저장 요청을 확인하지 못했습니다. 새로고침 후 다시 시도해주세요. 입력은 유지됩니다.' };
  return null;
}
