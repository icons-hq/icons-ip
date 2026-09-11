export interface GoodsLinkedMetadataInput {
  categoryId?: string | null;
  shippingNoticeTemplateCode?: string | null;
  shippingNoticeTemplateVersion?: number | null;
}

export function readGoodsLinkedMetadata(form: FormData) {
  const value: GoodsLinkedMetadataInput = {};
  const errors: Record<string, string> = {};
  if (form.has('categoryId')) {
    const id = String(form.get('categoryId') ?? '').trim();
    if (id && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      errors.categoryId = '카테고리를 다시 선택해주세요.';
    } else value.categoryId = id || null;
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
    ...(value.shippingNoticeTemplateCode !== undefined ? {
      shipping_notice_template_code: value.shippingNoticeTemplateCode,
      shipping_notice_template_version: value.shippingNoticeTemplateVersion ?? null,
    } : {}),
  };
}
