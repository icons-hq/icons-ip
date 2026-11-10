import { parseGoodsAttributeSubmission } from '@/lib/goods-attributes';
export const GOODS_ATTRIBUTES_PATH = '/admin/catalog/attributes';
export const GOODS_ATTRIBUTE_KIND_LABELS = { single: '단일 선택', multi: '복수 선택', text: '텍스트', number: '숫자' } as const;
/** A category change must finish loading its schema before the product can submit. */
export function goodsAttributeSubmissionReady(serialized: string | undefined, categoryId: string): boolean {
  try {
    const value = parseGoodsAttributeSubmission(JSON.parse(serialized ?? ''));
    return Boolean(value && value.categoryId === (categoryId || null));
  } catch { return false; }
}
export function readGoodsAttributeSubmission(form: FormData) {
  if (!form.has('productAttributes')) return { ok: true as const, fields: {} };
  try {
    const submission = parseGoodsAttributeSubmission(JSON.parse(String(form.get('productAttributes'))));
    if (!submission) throw new Error();
    return { ok: true as const, fields: { product_attributes: submission } };
  } catch { return { ok: false as const, error: '상품속성 입력과 조회 버전을 확인해주세요. 입력은 유지됩니다.' }; }
}
