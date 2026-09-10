import {
  GOODS_KC_BUSINESS_LABELS, GOODS_KC_FAMILY_LABELS, GOODS_KC_SCHEME_LABELS,
  type GoodsKcBusinessRole, type GoodsKcFamily, type GoodsKcScheme,
} from '@/lib/goods-kc';
import { emptyGoodsKcModel, normalizeGoodsKcModels, type AdminGoodsKc, type GoodsKcModelInput } from './goods-kc';

export const GOODS_KC_WORKBOOK_SHEET = 'KC 검토';
export const GOODS_KC_WORKBOOK_HEADERS = {
  goodCode: '상품코드', modelIndex: 'KC행번호', variantCodes: '적용 옵션코드',
  family: 'KC 제품군', scheme: 'KC 적용제도', productCategory: '품목 분류', modelName: '모델명',
  businessRole: '사업자 구분', businessName: '사업자명', identifier: '인증·신고번호', publicNote: '고객 안내',
  basis: '적용 판단 사유', applicabilityReference: '적용판단 근거 참조', certificateReference: '인증·신고문서 참조',
  testReportReference: '시험성적서 참조', declarationReference: '공급자 확인서 참조',
  reviewStatus: '검토 상태 (읽기 전용)', reviewRevision: '검토 버전 (읽기 전용)',
} as const;
export type GoodsKcWorkbookKey = keyof typeof GOODS_KC_WORKBOOK_HEADERS;
export type GoodsKcWorkbookRow = Record<GoodsKcWorkbookKey, string>;
export type GoodsKcWorkbookInputRow = { row: number; values: GoodsKcWorkbookRow };
export type GoodsKcImportModel = Omit<GoodsKcModelInput, 'variantIds'> & { variantCodes: string[] };
/** Attach only when plan.kind === 'save' as target_good.kc_update. The database
 * resolves codes after saving the ordinary options in the same transaction. */
export interface GoodsKcWorkbookMutation {
  models: GoodsKcImportModel[];
  expectedRevision: number | null;
  expectedContextFingerprint: string | null;
}
export type GoodsKcWorkbookPlan = { kind: 'keep'; warnings: string[] }
  | { kind: 'save'; update: GoodsKcWorkbookMutation; warnings: string[] }
  | { kind: 'error'; errors: string[]; warnings: string[] };

export function emptyGoodsKcWorkbookRow(): GoodsKcWorkbookRow {
  return Object.fromEntries(Object.keys(GOODS_KC_WORKBOOK_HEADERS).map((key) => [key, ''])) as GoodsKcWorkbookRow;
}
function reviewStatus(review: AdminGoodsKc | null): string {
  return review?.revision ? review.status === 'reviewed' ? '검토 완료' : '미검토' : '';
}
function importModel(model: GoodsKcModelInput, variantCodes: string[]): GoodsKcImportModel {
  return { family: model.family, scheme: model.scheme, productCategory: model.productCategory, modelName: model.modelName,
    businessRole: model.businessRole, businessName: model.businessName, identifier: model.identifier,
    publicNote: model.publicNote, basis: model.basis, evidence: { ...model.evidence }, variantCodes };
}
function modelWithCodes(model: GoodsKcModelInput, review: AdminGoodsKc): GoodsKcImportModel | null {
  const variantCodes: string[] = [];
  for (const id of model.variantIds) {
    const variant = review.variants.find((entry) => entry.id === id);
    if (!variant) return null;
    variantCodes.push(variant.code);
  }
  return importModel(model, variantCodes.sort());
}

export function exportGoodsKcWorkbookRows(records: readonly { goodCode: string; review: AdminGoodsKc | null }[]): GoodsKcWorkbookRow[] {
  return records.flatMap(({ goodCode, review }) => {
    if (!review) return [];
    return review.models.map((model, index) => {
      const mapped = modelWithCodes(model, review);
      if (!mapped) throw new Error('저장된 KC 모델의 옵션코드를 확인하지 못했습니다. 상품과 KC 검토를 다시 확인해주세요.');
      return {
        goodCode, modelIndex: String(index + 1), variantCodes: mapped.variantCodes.join('\n'),
        family: model.family ? GOODS_KC_FAMILY_LABELS[model.family] : '',
        scheme: model.scheme ? GOODS_KC_SCHEME_LABELS[model.scheme] : '',
        productCategory: model.productCategory, modelName: model.modelName,
        businessRole: model.businessRole ? GOODS_KC_BUSINESS_LABELS[model.businessRole] : '',
        businessName: model.businessName, identifier: model.identifier, publicNote: model.publicNote, basis: model.basis,
        applicabilityReference: model.evidence.applicability, certificateReference: model.evidence.certificate,
        testReportReference: model.evidence.testReport, declarationReference: model.evidence.declaration,
        reviewStatus: reviewStatus(review), reviewRevision: review.revision === null ? '' : String(review.revision),
      };
    });
  });
}
function labelValue<T extends string>(labels: Record<T, string>, value: string): T | '' | null {
  if (!value.trim()) return '';
  return Object.entries(labels).find(([, label]) => label === value.trim())?.[0] as T | undefined ?? null;
}
function parseRow(values: GoodsKcWorkbookRow): GoodsKcImportModel | null {
  if (Object.keys(GOODS_KC_WORKBOOK_HEADERS).some((key) => typeof values[key as GoodsKcWorkbookKey] !== 'string')) return null;
  const family = labelValue<GoodsKcFamily>(GOODS_KC_FAMILY_LABELS, values.family);
  const scheme = labelValue<GoodsKcScheme>(GOODS_KC_SCHEME_LABELS, values.scheme);
  const businessRole = labelValue<GoodsKcBusinessRole>(GOODS_KC_BUSINESS_LABELS, values.businessRole);
  if (family === null || scheme === null || businessRole === null) return null;
  const variantCodes = values.variantCodes.split(/\r?\n/).map((code) => code.trim()).filter(Boolean).sort();
  if (variantCodes.length > 200 || new Set(variantCodes).size !== variantCodes.length
    || variantCodes.some((code) => code.length > 120 || /[\u0000-\u001f\u007f]/.test(code))) return null;
  const models = normalizeGoodsKcModels([{
    ...emptyGoodsKcModel(), family, scheme, businessRole,
    productCategory: values.productCategory, modelName: values.modelName, businessName: values.businessName,
    identifier: values.identifier, publicNote: values.publicNote, basis: values.basis,
    evidence: { applicability: values.applicabilityReference, certificate: values.certificateReference,
      testReport: values.testReportReference, declaration: values.declarationReference },
  }]);
  if (!models) return null;
  return importModel(models[0], variantCodes);
}
function canonical(models: readonly GoodsKcImportModel[]): string {
  // Enumerate known fields rather than relying on object insertion order in a
  // raw source XLSX or a database JSON response.
  return JSON.stringify(models.map((model) => [model.family, model.scheme, model.productCategory, model.modelName,
    model.businessRole, model.businessName, model.identifier, model.publicNote, [...model.variantCodes].sort(), model.basis,
    model.evidence.applicability, model.evidence.certificate, model.evidence.testReport, model.evidence.declaration]));
}

/** One call per ordinary goods import group. A missing sheet/absent product rows
 * means keep, never erase. `reset` is the explicit 商品-sheet "KC 초기화=예"
 * request. `willBeDraft` must come from the ordinary product publication plan. */
export function planGoodsKcWorkbookRows(rows: readonly GoodsKcWorkbookInputRow[] | null | undefined, context: {
  goodCode: string;
  existing: AdminGoodsKc | null;
  variantCodes: readonly string[];
  willBeDraft: boolean;
  reset?: boolean;
}): GoodsKcWorkbookPlan {
  const source = (rows ?? []).filter((row) => row.values.goodCode.trim() === context.goodCode);
  if (!context.reset && source.length === 0) return { kind: 'keep', warnings: [] };
  if (!context.goodCode || source.length > 50) return { kind: 'error', errors: ['KC 시트는 저장된 상품코드와 모델 50행 이내가 필요합니다.'], warnings: [] };
  const errors: string[] = [];
  const indices = new Set<number>();
  const parsed: { index: number; model: GoodsKcImportModel }[] = [];
  for (const row of source) {
    const label = `KC 검토 ${row.row}행`;
    const index = Number(row.values.modelIndex);
    if (!/^[1-9][0-9]?$/.test(row.values.modelIndex) || index > 50 || indices.has(index)) errors.push(`${label}: KC행번호는 상품 안에서 겹치지 않는 1~50이어야 합니다.`);
    indices.add(index);
    if (row.values.reviewStatus !== reviewStatus(context.existing)
      || row.values.reviewRevision !== (context.existing?.revision == null ? '' : String(context.existing.revision))) {
      errors.push(`${label}: 검토 상태·버전은 읽기 전용입니다. 최신 파일을 내려받아주세요.`);
    }
    const model = parseRow(row.values);
    if (!model) errors.push(`${label}: 제품군·제도·사업자·옵션코드 또는 텍스트 형식을 확인해주세요.`);
    else {
      for (const code of model.variantCodes) {
        if (!context.variantCodes.includes(code)) errors.push(`${label}: 상품 옵션에 없는 코드 ${code}입니다. 새 상품·옵션은 코드를 먼저 저장해주세요.`);
      }
      parsed.push({ index, model });
    }
  }
  if (errors.length) return { kind: 'error', errors, warnings: [] };
  const models = context.reset ? [] : parsed.sort((left, right) => left.index - right.index).map((row) => row.model);
  const existing = context.existing?.models.map((model) => modelWithCodes(model, context.existing!)) ?? [];
  if (existing.some((model) => model === null)) return { kind: 'error', errors: ['저장된 KC 모델의 옵션 연결을 확인하지 못했습니다.'], warnings: [] };
  if (canonical(models) === canonical(existing as GoodsKcImportModel[])) return { kind: 'keep', warnings: [] };
  if (!context.willBeDraft) return { kind: 'error', errors: ['KC 정보 변경·초기화는 상품 시트의 게시 상태를 초안으로 변경한 경우에만 적용할 수 있습니다.'], warnings: [] };
  return { kind: 'save', update: { models, expectedRevision: context.existing?.revision ?? null,
    expectedContextFingerprint: context.existing?.contextFingerprint ?? null },
  warnings: [context.reset ? '기존 KC 모델을 모두 비우고 미검토로 저장합니다.'
    : 'KC 시트 변경은 미검토로 저장됩니다. 실제 원본 확인과 검토 완료는 상품의 KC 검토 화면에서 진행해주세요.'] };
}

/** The file reader should reject orphan KC rows before planning individual
 * groups, so an unrecognized or missing goods code is never silently dropped. */
export function goodsKcWorkbookOrphanErrors(rows: readonly GoodsKcWorkbookInputRow[], goodCodes: readonly string[]): string[] {
  return rows.flatMap((row) => !row.values.goodCode.trim() || !goodCodes.includes(row.values.goodCode.trim())
    ? [`KC 검토 ${row.row}행: 상품 시트에 같은 상품코드가 필요합니다. 자동 발급할 새 코드는 초안 저장 후 다시 내려받아 연결해주세요.`] : []);
}
