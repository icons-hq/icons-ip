import { isUuid } from '@/lib/uuid';
import { emptyGoodsKcModel, goodsKcReviewProblems, normalizeGoodsKcModels, type GoodsKcModelInput, type GoodsKcVariant } from './goods-kc';
import { goodsOptionRowKey, type GoodsOptionRow } from './goods-option-editor';
import { parseGoodsPreorderInput, type GoodsPreorderInput } from './goods-preorders';

/*
 * 상품 등록 화면의 원자 저장 섹션(10/27 회의 R13·D6②).
 *
 * 등록 화면은 KC·예약판매를 1단계 입력과 함께 받아 public.admin_save_good_workspace 하나로 저장한다.
 * 새 옵션은 저장 전 id가 없으므로 화면은 옵션을 행 키로 가리키고, 제출할 때 저장된 옵션은 {id},
 * 새 옵션은 {attributes}(옵션값 조합) 참조로 바꾼다. DB가 저장 직후 활성 옵션 하나로 해석한다.
 * 섹션 입력은 브라우저 자동복구·서버 임시저장에 담지 않는다(KC 근거 참조 보호, DQ3).
 */

export const GOOD_WORKSPACE_SECTIONS_FIELD = 'workspaceSections';
export const GOOD_WORKSPACE_OPERATION_FIELD = 'workspaceOperationId';
/** 섹션 오류 필드 → 같은 자리의 운영 섹션 id(`good-operation-<id>`). */
export const GOOD_WORKSPACE_ERROR_SECTIONS = { workspaceKc: 'kc', workspacePreorders: 'preorders' } as const;
export type GoodWorkspaceErrorField = keyof typeof GOOD_WORKSPACE_ERROR_SECTIONS;

export type GoodWorkspaceVariantRef = { id: string } | { attributes: Record<string, string> };
export interface GoodWorkspaceKcDraft {
  /** variantIds는 goodWorkspaceVariantId(행)로 만든 화면용 id다. 제출할 때 옵션 참조로 바뀐다. */
  models: GoodsKcModelInput[];
  attested: boolean;
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
export interface GoodWorkspaceSectionsDraft { kc: GoodWorkspaceKcDraft; preorders: GoodWorkspacePreorderDraft[] }
export const EMPTY_GOOD_WORKSPACE_SECTIONS: GoodWorkspaceSectionsDraft = { kc: { models: [], attested: false }, preorders: [] };

/** 제출 형식(hidden input). 서버가 다시 검증한다. */
export interface GoodWorkspaceSectionsSubmission {
  kc: { status: 'unreviewed' | 'reviewed'; attested: boolean; models: (Omit<GoodsKcModelInput, 'variantIds'> & { variantRefs: GoodWorkspaceVariantRef[] })[] } | null;
  preorders: { variant: GoodWorkspaceVariantRef; values: { state: 'draft' | 'active'; capacityQty: string; startsAt: string; endsAt: string; expectedShipDate: string; approvalReference: string } }[];
}
/** admin_save_good_workspace의 sections 인자. */
export interface GoodWorkspaceRpcSections {
  kc?: { status: 'unreviewed' | 'reviewed'; attested: boolean; expectedRevision: null; expectedContextFingerprint: null;
    models: (Omit<GoodsKcModelInput, 'variantIds'> & { variantRefs: GoodWorkspaceVariantRef[] })[] };
  preorders?: { variant: GoodWorkspaceVariantRef; policyId: null; expectedRevision: null; values: GoodsPreorderInput }[];
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

/** 화면 상태 + 현재 옵션 행 → 제출 JSON. 입력이 없는 섹션은 빼서 기존 저장과 같은 결과를 낸다. */
export function prepareGoodWorkspaceSections(draft: GoodWorkspaceSectionsDraft, rows: readonly GoodsOptionRow[], canActivate: boolean): GoodWorkspaceSectionsResult {
  const byId = new Map(rows.map((row) => [goodWorkspaceVariantId(row), row]));
  let kc: GoodWorkspaceSectionsSubmission['kc'] = null;
  if (draft.kc.models.length || draft.kc.attested) {
    const variants = goodWorkspaceKcVariants(rows);
    if (draft.kc.attested) {
      const problems = goodsKcReviewProblems(draft.kc.models, variants);
      if (problems.length) return { ok: false, field: 'workspaceKc', error: `KC 검토 완료 전 확인: ${problems[0]}` };
    }
    const normalized = normalizeGoodsKcModels(draft.kc.models);
    if (!normalized) return { ok: false, field: 'workspaceKc', error: 'KC 입력 형식과 제품군·제도 조합을 확인해주세요.' };
    if (normalized.some((model) => model.variantIds.some((id) => !byId.has(id)))) {
      return { ok: false, field: 'workspaceKc', error: 'KC 모델에 연결한 옵션이 옵션목록에 없습니다. 적용 옵션을 다시 선택해주세요.' };
    }
    kc = { status: draft.kc.attested ? 'reviewed' : 'unreviewed', attested: draft.kc.attested,
      models: normalized.map(({ variantIds, ...model }) => ({ ...model, variantRefs: variantIds.map((id) => variantRef(byId.get(id)!)) })) };
  }
  const preorders: GoodWorkspaceSectionsSubmission['preorders'] = [];
  const used = new Set<string>();
  for (const [index, entry] of draft.preorders.entries()) {
    const label = `예약 조건 ${index + 1}`;
    const row = rows.find((candidate) => goodsOptionRowKey(candidate) === entry.optionKey);
    if (!row) return { ok: false, field: 'workspacePreorders', error: `${label}: 예약 대상 옵션을 다시 선택해주세요.` };
    if (used.has(entry.optionKey)) return { ok: false, field: 'workspacePreorders', error: `${label}: 한 옵션에는 예약 조건을 하나만 입력합니다.` };
    used.add(entry.optionKey);
    if (entry.state === 'active' && !canActivate) return { ok: false, field: 'workspacePreorders', error: `${label}: 예약 활성화는 관리자 계정에서 할 수 있습니다. 초안으로 저장해주세요.` };
    const values = { state: entry.state, capacityQty: entry.capacityQty.trim(), startsAt: entry.startsAt, endsAt: entry.endsAt,
      expectedShipDate: entry.expectedShipDate, approvalReference: entry.approvalReference };
    if (!parseGoodsPreorderInput(values)) {
      return { ok: false, field: 'workspacePreorders', error: entry.state === 'active'
        ? `${label}: 활성화하려면 승인 물량·접수 기간·발송 예정일(접수 종료일 이후)·승인 근거를 모두 입력해주세요.`
        : `${label}: 승인 물량은 1 이상의 정수, 접수 시작은 종료보다 앞서야 합니다.` };
    }
    preorders.push({ variant: variantRef(row), values });
  }
  return { ok: true, value: { kc, preorders } };
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
  if (!record(value) || Object.keys(value).some((key) => key !== 'kc' && key !== 'preorders')) {
    return { ok: false, field: 'workspaceKc', error: 'KC·예약판매 입력을 확인하지 못했습니다. 새로고침 후 다시 입력해주세요.' };
  }
  const sections: GoodWorkspaceRpcSections = {};
  if (value.kc !== null && value.kc !== undefined) {
    const kc = value.kc;
    const invalid = { ok: false as const, field: 'workspaceKc' as const, error: 'KC 입력 형식과 모델별 필수 정보·근거를 확인해주세요.' };
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
  return { ok: true, sections };
}

/** admin_save_good_workspace 오류 → 섹션 칸 안내. 섹션과 무관한 오류는 null(기본 저장 매핑이 맡는다). */
export function goodWorkspaceSectionFailure(message: string): Partial<Record<GoodWorkspaceErrorField | 'form', string>> | null {
  /* 판매기간·예약 충돌은 기본 저장 매핑(판매기간 칸)이 안내한다. */
  if (message.includes('goods_sale_period')) return null;
  if (message.includes('goods_workspace_operation_conflict')) {
    return { form: '이미 처리된 저장 요청입니다. 입력은 유지됩니다. 목록을 새로고침해 저장된 상품을 확인해주세요.' };
  }
  if (message.includes('goods_workspace_publish_unsupported')) return { form: '새 상품은 저장한 뒤 게시 상태에서 공개해주세요.' };
  if (message.includes('goods_workspace_variant_unresolved') || message.includes('invalid_goods_workspace_variant')) {
    return { workspaceKc: 'KC·예약판매에서 고른 옵션을 저장된 옵션목록에서 찾지 못했습니다. 옵션을 다시 선택해주세요. 입력은 유지됩니다.' };
  }
  if (message.includes('goods_kc_review_changed')) return { workspaceKc: '다른 작업에서 KC 검토가 바뀌었습니다. 입력은 유지됩니다. 새로고침 후 KC 정보를 확인해주세요.' };
  if (message.includes('goods_kc_attestation_required') || message.includes('goods_kc_review_incomplete')) {
    return { workspaceKc: '사용 중인 옵션 연결과, KC 대상 제도는 모델별 필수 정보·원본 증빙을 확인한 뒤 검토 완료 확인을 체크해주세요. 아니면 확인 체크를 풀어 미검토로 저장합니다.' };
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
