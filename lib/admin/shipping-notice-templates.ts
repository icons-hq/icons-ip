export const SHIPPING_NOTICE_TEMPLATES_PATH = '/admin/settings/shipping-notices';
// This is the customer-notice template version, independent from the goods
// workbook format version. A new code starts at v1; later copy changes use the
// same code with the next version.
export const SHIPPING_NOTICE_TEMPLATE_VERSION_DEFAULT = 1;
export const SHIPPING_NOTICE_TEMPLATE_PAGE_SIZE = 20;
export const SHIPPING_NOTICE_TEMPLATE_CODE_MAX = 40;
export const SHIPPING_NOTICE_TEMPLATE_NAME_MAX = 80;
export const SHIPPING_NOTICE_TEMPLATE_NOTICE_MAX = 4000;
export const SHIPPING_NOTICE_TEMPLATE_CS_NAME_MAX = 120;
export const SHIPPING_NOTICE_TEMPLATE_CS_PHONE_MAX = 80;
export const SHIPPING_NOTICE_TEMPLATE_CS_EMAIL_MAX = 320;
export const SHIPPING_NOTICE_TEMPLATE_EVIDENCE_MAX = 2000;

export type ShippingNoticeTemplateStatus = 'draft' | 'active';

export interface ShippingNoticeTemplate {
  id: string;
  code: string;
  version: number;
  name: string;
  shippingNotice: string;
  returnExchangeNotice: string;
  csName: string;
  csPhone: string;
  csEmail: string;
  confirmationEvidence: string;
  status: ShippingNoticeTemplateStatus;
  confirmedBy: string | null;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ShippingNoticeTemplateImpactGood {
  id: string;
  name: string;
  templateId: string | null;
  templateVersion: number | null;
  publishedAt: string | null;
  updatedAt: string;
}

export interface ShippingNoticeTemplateFilters {
  query: string;
  goodQuery: string;
  page: number;
}

export interface ShippingNoticeTemplatePageData {
  templates: ShippingNoticeTemplate[];
  impactGoods: ShippingNoticeTemplateImpactGood[];
  total: number;
  filters: ShippingNoticeTemplateFilters;
}

export interface ShippingNoticeTemplateInput {
  code: string;
  version: number;
  name: string;
  shipping_notice: string;
  return_exchange_notice: string;
  cs_name: string;
  cs_phone: string;
  cs_email: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DISALLOWED_CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

/** Tabs, LF and CR are valid in customer copy; other control characters are not. */
export function hasDisallowedShippingNoticeControl(value: string): boolean {
  return DISALLOWED_CONTROL_CHARS.test(value);
}

export function normalizeShippingNoticeTemplateFilters(
  params: Record<string, string | string[] | undefined>,
): ShippingNoticeTemplateFilters {
  const query = typeof params.q === 'string' ? params.q.trim().slice(0, SHIPPING_NOTICE_TEMPLATE_NAME_MAX) : '';
  const goodQuery = typeof params.good === 'string' ? params.good.trim().slice(0, 120) : '';
  return {
    query,
    goodQuery,
    page: Math.min(10000, Math.max(1, Number.parseInt(typeof params.page === 'string' ? params.page : '', 10) || 1)),
  };
}

export function shippingNoticeTemplateHref(
  filters: ShippingNoticeTemplateFilters,
  page = filters.page,
): string {
  const params = new URLSearchParams();
  if (filters.query) params.set('q', filters.query);
  if (filters.goodQuery) params.set('good', filters.goodQuery);
  if (page > 1) params.set('page', String(page));
  return `${SHIPPING_NOTICE_TEMPLATES_PATH}${params.size ? `?${params}` : ''}`;
}

export function parseShippingNoticeTemplateInput(input: Record<string, string>):
  | { ok: true; value: ShippingNoticeTemplateInput }
  | { ok: false; errors: Record<string, string> } {
  const value: ShippingNoticeTemplateInput = {
    code: (input.code ?? '').trim(),
    version: Number(input.version),
    name: (input.name ?? '').trim(),
    shipping_notice: (input.shippingNotice ?? '').trim(),
    return_exchange_notice: (input.returnExchangeNotice ?? '').trim(),
    cs_name: (input.csName ?? '').trim(),
    cs_phone: (input.csPhone ?? '').trim(),
    cs_email: (input.csEmail ?? '').trim(),
  };
  const errors: Record<string, string> = {};
  if (!/^[a-z][a-z0-9-]{1,39}$/.test(value.code)) {
    errors.code = '코드는 영문 소문자로 시작하는 영문·숫자·하이픈 2~40자입니다.';
  }
  if (!Number.isSafeInteger(value.version) || value.version < 1 || value.version > 1000000) {
    errors.version = '버전은 1~1,000,000 사이의 정수입니다.';
  }
  if (!value.name || value.name.length > SHIPPING_NOTICE_TEMPLATE_NAME_MAX) {
    errors.name = `이름은 1~${SHIPPING_NOTICE_TEMPLATE_NAME_MAX}자로 입력해주세요.`;
  }
  if (value.shipping_notice.length > SHIPPING_NOTICE_TEMPLATE_NOTICE_MAX || hasDisallowedShippingNoticeControl(value.shipping_notice)) {
    errors.shippingNotice = `배송 안내는 ${SHIPPING_NOTICE_TEMPLATE_NOTICE_MAX}자 이내로 입력해주세요.`;
  }
  if (value.return_exchange_notice.length > SHIPPING_NOTICE_TEMPLATE_NOTICE_MAX || hasDisallowedShippingNoticeControl(value.return_exchange_notice)) {
    errors.returnExchangeNotice = `교환·반품 안내는 ${SHIPPING_NOTICE_TEMPLATE_NOTICE_MAX}자 이내로 입력해주세요.`;
  }
  if (value.cs_name.length > SHIPPING_NOTICE_TEMPLATE_CS_NAME_MAX || hasDisallowedShippingNoticeControl(value.cs_name)) {
    errors.csName = `고객센터 이름은 ${SHIPPING_NOTICE_TEMPLATE_CS_NAME_MAX}자 이내로 입력해주세요.`;
  }
  if (value.cs_phone.length > SHIPPING_NOTICE_TEMPLATE_CS_PHONE_MAX || hasDisallowedShippingNoticeControl(value.cs_phone)) {
    errors.csPhone = `고객센터 전화번호는 ${SHIPPING_NOTICE_TEMPLATE_CS_PHONE_MAX}자 이내로 입력해주세요.`;
  }
  if (value.cs_email.length > SHIPPING_NOTICE_TEMPLATE_CS_EMAIL_MAX || hasDisallowedShippingNoticeControl(value.cs_email)) {
    errors.csEmail = `고객센터 이메일은 ${SHIPPING_NOTICE_TEMPLATE_CS_EMAIL_MAX}자 이내로 입력해주세요.`;
  } else if (value.cs_email && !/^\S+@\S+\.\S+$/.test(value.cs_email)) {
    errors.csEmail = '고객센터 이메일 형식을 확인해주세요.';
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value };
}

export function isShippingNoticeTemplateId(value: string): boolean {
  return UUID.test(value);
}
