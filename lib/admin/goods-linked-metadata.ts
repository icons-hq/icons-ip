import { isUuid } from '@/lib/uuid';
export interface GoodsLinkedMetadataInput {
  categoryId?: string | null;
  additionalCategoryIds?: string[];
  shippingNoticeTemplateCode?: string | null;
  shippingNoticeTemplateVersion?: number | null;
}

export function readGoodsLinkedMetadata(form: FormData) {
  const value: GoodsLinkedMetadataInput = {};
  const errors: Record<string, string> = {};
  if (form.has('categoryId')) {
    const id = String(form.get('categoryId') ?? '').trim();
    if (id && !isUuid(id)) {
      errors.categoryId = '카테고리를 다시 선택해주세요.';
    } else value.categoryId = id || null;
  }
  if (form.has('additionalCategoryIds')) {
    try {
      const ids: unknown = JSON.parse(String(form.get('additionalCategoryIds')));
      if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string'
        || !isUuid(id))) throw new Error('invalid');
      value.additionalCategoryIds = [...new Set((ids as string[]).map(id => id.toLowerCase()))]
        .filter(id => id !== value.categoryId?.toLowerCase()).sort();
    } catch {
      errors.additionalCategoryIds = '추가 카테고리를 다시 선택해주세요.';
    }
  }
  if (form.has('shippingNoticeTemplate') || form.has('shippingNoticeTemplateCode') || form.has('shippingNoticeTemplateVersion')) {
    const combined = String(form.get('shippingNoticeTemplate') ?? '').trim();
    const [code, versionText, extra] = form.has('shippingNoticeTemplate')
      ? combined.split('@')
      : [String(form.get('shippingNoticeTemplateCode') ?? '').trim(), String(form.get('shippingNoticeTemplateVersion') ?? '').trim()];
    const version = versionText ? Number(versionText) : null;
    if (extra !== undefined || (code && (!/^[a-z][a-z0-9-]{1,39}$/.test(code) || !/^[1-9][0-9]*$/.test(versionText ?? '')
      || version === null || !Number.isSafeInteger(version) || version > 1_000_000)) || (!code && versionText)) {
      errors.shippingNoticeTemplate = '배송 안내 템플릿과 버전을 다시 선택해주세요.';
    } else {
      value.shippingNoticeTemplateCode = code || null;
      value.shippingNoticeTemplateVersion = version;
    }
  }
  return { value, errors };
}

export function goodsLinkedMetadataRpcFields(value: GoodsLinkedMetadataInput): Record<string, unknown> {
  return {
    ...(value.categoryId !== undefined ? { category_id: value.categoryId } : {}),
    ...(value.additionalCategoryIds !== undefined ? { additional_category_ids: value.additionalCategoryIds } : {}),
    ...(value.shippingNoticeTemplateCode !== undefined ? {
      shipping_notice_template_code: value.shippingNoticeTemplateCode,
      shipping_notice_template_version: value.shippingNoticeTemplateVersion ?? null,
    } : {}),
  };
}
