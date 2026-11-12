import { isUuid } from '@/lib/uuid';
/** Customer-safe KC disclosure fields. Review evidence and staff identities live
 * in lib/admin/goods-kc.ts and must never be serialized into this shape. */
export const GOODS_KC_FAMILY_LABELS = {
  electrical: '전기용품', living: '생활용품', children: '어린이제품', other: '그 외',
} as const;
export const GOODS_KC_SCHEME_LABELS = {
  safety_certification: '안전인증', safety_confirmation: '안전확인',
  supplier_conformity: '공급자적합성확인', safety_standard_compliance: '안전기준준수',
  not_applicable: '해당 없음',
} as const;
export const GOODS_KC_BUSINESS_LABELS = { manufacturer: '제조업자', importer: '수입업자' } as const;
export type GoodsKcFamily = keyof typeof GOODS_KC_FAMILY_LABELS;
export type GoodsKcScheme = keyof typeof GOODS_KC_SCHEME_LABELS;
export type GoodsKcBusinessRole = keyof typeof GOODS_KC_BUSINESS_LABELS;
export interface GoodsKcDisclosure {
  family: GoodsKcFamily;
  scheme: GoodsKcScheme;
  productCategory: string;
  modelName: string;
  /** Empty only for a not-applicable model, where model/business fields are optional. */
  businessRole: GoodsKcBusinessRole | '';
  businessName: string;
  identifier: string;
  publicNote: string;
  variants: { id: string; name: string }[];
}
/** Product-level wording only for a product's sole not-applicable model. Next
 * to other models (possibly KC-subject ones) the notice covers its options only. */
export const GOODS_KC_NOT_APPLICABLE_NOTICE = 'KC 인증 대상이 아닌 상품입니다.';
export const GOODS_KC_NOT_APPLICABLE_OPTION_NOTICE = '적용 옵션은 KC 인증 대상이 아닙니다.';

export function goodsKcSchemeAllowed(family: GoodsKcFamily, scheme: GoodsKcScheme): boolean {
  if (scheme === 'not_applicable') return true;
  if (family === 'other') return false;
  return scheme !== 'safety_standard_compliance' || family === 'living';
}
export function goodsKcNeedsIdentifier(scheme: GoodsKcScheme): boolean {
  return scheme === 'safety_certification' || scheme === 'safety_confirmation';
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Strict allowlist: an accidental private payload fails closed instead of
 * being forwarded by an object spread into the public product component. */
export function parseGoodsKcDisclosures(value: unknown): GoodsKcDisclosure[] | null {
  if (!Array.isArray(value) || value.length > 50) return null;
  const result: GoodsKcDisclosure[] = [];
  for (const row of value) {
    if (!record(row) || Object.keys(row).some((key) => ![
      'family', 'scheme', 'productCategory', 'modelName', 'businessRole', 'businessName', 'identifier', 'publicNote', 'variants',
    ].includes(key))) return null;
    if (typeof row.family !== 'string' || !Object.hasOwn(GOODS_KC_FAMILY_LABELS, row.family)
      || typeof row.scheme !== 'string' || !Object.hasOwn(GOODS_KC_SCHEME_LABELS, row.scheme)) return null;
    const family = row.family as GoodsKcFamily; const scheme = row.scheme as GoodsKcScheme;
    if (!goodsKcSchemeAllowed(family, scheme)) return null;
    // A not-applicable review only requires family, scheme and options; every
    // other customer field may be blank. KC-subject schemes stay complete.
    const optional = scheme === 'not_applicable';
    if (typeof row.businessRole !== 'string'
      || (row.businessRole === '' ? !optional : !Object.hasOwn(GOODS_KC_BUSINESS_LABELS, row.businessRole))) return null;
    for (const key of ['productCategory', 'modelName', 'businessName'] as const) {
      if (typeof row[key] !== 'string' || (!optional && !row[key].trim()) || row[key].length > 200) return null;
    }
    if (typeof row.identifier !== 'string' || row.identifier.length > 100
      || Boolean(row.identifier.trim()) !== goodsKcNeedsIdentifier(scheme)
      || typeof row.publicNote !== 'string' || row.publicNote.length > 1000
      || !Array.isArray(row.variants) || row.variants.length < 1 || row.variants.length > 200) return null;
    const variants: GoodsKcDisclosure['variants'] = [];
    for (const variant of row.variants) {
      if (!record(variant) || Object.keys(variant).some((key) => !['id', 'name'].includes(key))
        || typeof variant.id !== 'string' || !isUuid(variant.id)
        || typeof variant.name !== 'string' || !variant.name.trim() || variant.name.length > 200
        || variants.some((entry) => entry.id === variant.id)) return null;
      variants.push({ id: variant.id, name: variant.name });
    }
    result.push({ family, scheme, productCategory: row.productCategory as string, modelName: row.modelName as string,
      businessRole: row.businessRole as GoodsKcDisclosure['businessRole'], businessName: row.businessName as string,
      identifier: row.identifier, publicNote: row.publicNote, variants });
  }
  return result;
}

/**
 * 기타 인증(SHEET-014·ADR-0036)의 고객 표시 항목. 고객 노출을 고른 항목만 DB가
 * goods.other_certification_disclosures로 내보내고, 노출 여부·작성자는 담지 않는다.
 */
export interface GoodsOtherCertificationDisclosure { kind: string; agency: string; number: string }
export const MAX_GOODS_OTHER_CERTIFICATIONS = 20;
export const GOODS_OTHER_CERTIFICATION_TEXT_LIMIT = 100;
/** 자주 쓰는 인증 종류 제안. 자유 입력이며 MD 품목별 인증 종류 목록이 오면 채운다. */
export const GOODS_OTHER_CERTIFICATION_KIND_SUGGESTIONS = [
  '방송통신기자재 적합성평가(적합인증)', '방송통신기자재 적합성평가(적합등록)', '어린이보호포장', '생활화학제품 안전기준확인',
] as const;

/** Strict allowlist like parseGoodsKcDisclosures: any private field fails closed. */
export function parseGoodsOtherCertificationDisclosures(value: unknown): GoodsOtherCertificationDisclosure[] | null {
  if (!Array.isArray(value) || value.length > MAX_GOODS_OTHER_CERTIFICATIONS) return null;
  const result: GoodsOtherCertificationDisclosure[] = [];
  for (const row of value) {
    if (!record(row) || Object.keys(row).length !== 3 || Object.keys(row).some((key) => !['kind', 'agency', 'number'].includes(key))) return null;
    const { kind, agency, number } = row;
    // 길이는 DB char_length처럼 코드 포인트로 센다.
    if (typeof kind !== 'string' || !kind.trim() || [...kind].length > GOODS_OTHER_CERTIFICATION_TEXT_LIMIT
      || typeof agency !== 'string' || [...agency].length > GOODS_OTHER_CERTIFICATION_TEXT_LIMIT
      || typeof number !== 'string' || !number.trim() || [...number].length > GOODS_OTHER_CERTIFICATION_TEXT_LIMIT) return null;
    result.push({ kind, agency, number });
  }
  return result;
}

/** 고객 상세 표의 한 줄: 종류 | 인증번호(인증기관). */
export function goodsOtherCertificationRow(certification: GoodsOtherCertificationDisclosure): [string, string] {
  return [certification.kind, `인증번호 ${certification.number}${certification.agency ? ` · 인증기관 ${certification.agency}` : ''}`];
}

/** `sole` marks the only disclosure of a product: a not-applicable row then
 * covers every option, so the customer table states it for the product and
 * omits the option list. Otherwise it is stated for the listed options. */
export function goodsKcDisclosureRows(disclosure: GoodsKcDisclosure, { sole = false }: { sole?: boolean } = {}): [string, string][] {
  const variants: [string, string] = ['적용 옵션', disclosure.variants.map((variant) => variant.name).join(', ')];
  const note: [string, string][] = disclosure.publicNote ? [['안내', disclosure.publicNote]] : [];
  if (disclosure.scheme === 'not_applicable') {
    const filled = (rows: [string, string][]) => rows.filter(([, value]) => value.trim());
    return [
      ['KC 인증', sole ? GOODS_KC_NOT_APPLICABLE_NOTICE : GOODS_KC_NOT_APPLICABLE_OPTION_NOTICE],
      ...filled([['품목 분류', disclosure.productCategory], ['모델명', disclosure.modelName],
        [disclosure.businessRole ? GOODS_KC_BUSINESS_LABELS[disclosure.businessRole] : '사업자', disclosure.businessName]]),
      ...(sole ? [] : [variants]),
      ...note,
    ];
  }
  return [
    ['제품군', GOODS_KC_FAMILY_LABELS[disclosure.family]],
    ['적용 제도', GOODS_KC_SCHEME_LABELS[disclosure.scheme]],
    ['품목 분류', disclosure.productCategory], ['모델명', disclosure.modelName],
    variants,
    [disclosure.businessRole ? GOODS_KC_BUSINESS_LABELS[disclosure.businessRole] : '사업자', disclosure.businessName],
    ...(disclosure.identifier ? [[disclosure.scheme === 'safety_certification' ? '안전인증번호' : '안전확인 신고번호', disclosure.identifier] as [string, string]] : []),
    ...note,
  ];
}
