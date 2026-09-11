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
  businessRole: GoodsKcBusinessRole;
  businessName: string;
  identifier: string;
  publicNote: string;
  variants: { id: string; name: string }[];
}

export function goodsKcSchemeAllowed(family: GoodsKcFamily, scheme: GoodsKcScheme): boolean {
  if (scheme === 'not_applicable') return true;
  if (family === 'other') return false;
  return scheme !== 'safety_standard_compliance' || family === 'living';
}
export function goodsKcNeedsIdentifier(scheme: GoodsKcScheme): boolean {
  return scheme === 'safety_certification' || scheme === 'safety_confirmation';
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
      || typeof row.scheme !== 'string' || !Object.hasOwn(GOODS_KC_SCHEME_LABELS, row.scheme)
      || typeof row.businessRole !== 'string' || !Object.hasOwn(GOODS_KC_BUSINESS_LABELS, row.businessRole)) return null;
    const family = row.family as GoodsKcFamily; const scheme = row.scheme as GoodsKcScheme;
    if (!goodsKcSchemeAllowed(family, scheme)) return null;
    for (const key of ['productCategory', 'modelName', 'businessName'] as const) {
      if (typeof row[key] !== 'string' || !row[key].trim() || row[key].length > 200) return null;
    }
    if (typeof row.identifier !== 'string' || row.identifier.length > 100
      || Boolean(row.identifier.trim()) !== goodsKcNeedsIdentifier(scheme)
      || typeof row.publicNote !== 'string' || row.publicNote.length > 1000
      || (scheme === 'not_applicable' && !row.publicNote.trim())
      || !Array.isArray(row.variants) || row.variants.length < 1 || row.variants.length > 200) return null;
    const variants: GoodsKcDisclosure['variants'] = [];
    for (const variant of row.variants) {
      if (!record(variant) || Object.keys(variant).some((key) => !['id', 'name'].includes(key))
        || typeof variant.id !== 'string' || !UUID.test(variant.id)
        || typeof variant.name !== 'string' || !variant.name.trim() || variant.name.length > 200
        || variants.some((entry) => entry.id === variant.id)) return null;
      variants.push({ id: variant.id, name: variant.name });
    }
    result.push({ family, scheme, productCategory: row.productCategory as string, modelName: row.modelName as string,
      businessRole: row.businessRole as GoodsKcBusinessRole, businessName: row.businessName as string,
      identifier: row.identifier, publicNote: row.publicNote, variants });
  }
  return result;
}

export function goodsKcDisclosureRows(disclosure: GoodsKcDisclosure): [string, string][] {
  return [
    ['제품군', GOODS_KC_FAMILY_LABELS[disclosure.family]],
    ['적용 제도', GOODS_KC_SCHEME_LABELS[disclosure.scheme]],
    ['품목 분류', disclosure.productCategory], ['모델명', disclosure.modelName],
    ['적용 옵션', disclosure.variants.map((variant) => variant.name).join(', ')],
    [GOODS_KC_BUSINESS_LABELS[disclosure.businessRole], disclosure.businessName],
    ...(disclosure.identifier ? [[disclosure.scheme === 'safety_certification' ? '안전인증번호' : '안전확인 신고번호', disclosure.identifier] as [string, string]] : []),
    ...(disclosure.publicNote ? [['안내', disclosure.publicNote] as [string, string]] : []),
  ];
}
