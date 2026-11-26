import { isUuid } from '@/lib/uuid';
export const SHIPPING_NOTICE_TEMPLATES_PATH = '/admin/settings/shipping-notices';
export const SHIPPING_NOTICE_TEMPLATE_PAGE_SIZE = 20;
export const SHIPPING_NOTICE_TEMPLATE_NAME_MAX = 80;
export const SHIPPING_NOTICE_TEMPLATE_NOTICE_MAX = 4000;
export const SHIPPING_NOTICE_TEMPLATE_CS_NAME_MAX = 120;
export const SHIPPING_NOTICE_TEMPLATE_CS_PHONE_MAX = 80;
export const SHIPPING_NOTICE_TEMPLATE_CS_EMAIL_MAX = 320;
/** [상품에 적용]에서 한 번에 고를 수 있는 상품 수. */
export const SHIPPING_NOTICE_TEMPLATE_APPLY_MAX = 100;

/**
 * 관리 화면이 이 템플릿을 부르는 이름. 메뉴 이름('배송 안내 템플릿 관리')과 같은 말이다 — 셸이 메뉴 이름을 화면 제목으로 쓴다.
 * 상품등록의 칸 이름은 '배송·교환·반품 안내 템플릿'이고, 그 칸에서 이 화면을 가리킬 때는 메뉴 이름을 쓴다.
 */
export const SHIPPING_NOTICE_TEMPLATE_LABEL = '배송 안내 템플릿';
export const SHIPPING_NOTICE_TEMPLATE_CREATE_LABEL = `${SHIPPING_NOTICE_TEMPLATE_LABEL} 등록`;
export const SHIPPING_NOTICE_TEMPLATE_APPLY_LABEL = '상품에 적용';

/**
 * 'active'는 상품에서 고를 수 있는 템플릿(화면 이름 '사용'), 'draft'는 예전 방식으로 만들어 두고 아직 켜지 않은 템플릿('준비 중')이다.
 * 지금은 [저장]하면 바로 'active'가 된다.
 */
export type ShippingNoticeTemplateStatus = 'draft' | 'active';

/**
 * 목록의 한 줄 = 템플릿 하나. DB는 고칠 때마다 새 줄(같은 코드·다음 버전)을 넣지만 화면은 가장 큰 버전만 보인다.
 * 코드와 버전은 운영자가 다루지 않는 내부 값이다(화면 규칙 8). `id`·`updatedAt`은 저장할 때 '내가 연 뒤 바뀌지 않았는지' 확인하는 데 쓴다.
 */
export interface ShippingNoticeTemplate {
  id: string;
  code: string;
  version: number;
  name: string;
  shippingNotice: string;
  returnExchangeNotice: string;
  /** 제주·도서산간 고객 안내(선택). 금액은 지역별 추가배송비가 정한다. */
  remoteAreaNotice: string;
  csName: string;
  csPhone: string;
  csEmail: string;
  status: ShippingNoticeTemplateStatus;
  updatedAt: string;
  /** 이 템플릿을 쓰는 상품 수(보관한 상품 제외). 저장하면 이 상품들의 안내가 새 내용으로 바뀐다. */
  goodsCount: number;
}

export interface ShippingNoticeTemplateFilters {
  query: string;
  page: number;
}

export interface ShippingNoticeTemplatePageData {
  templates: ShippingNoticeTemplate[];
  total: number;
  filters: ShippingNoticeTemplateFilters;
}

/** 편집 창이 다루는 칸. 이름과 본문뿐이다. */
export interface ShippingNoticeTemplateValues {
  name: string;
  shippingNotice: string;
  returnExchangeNotice: string;
  remoteAreaNotice: string;
  csName: string;
  csPhone: string;
  csEmail: string;
}
export const SHIPPING_NOTICE_TEMPLATE_VALUE_KEYS: readonly (keyof ShippingNoticeTemplateValues)[] = [
  'name', 'shippingNotice', 'returnExchangeNotice', 'remoteAreaNotice', 'csName', 'csPhone', 'csEmail',
];

export interface ShippingNoticeTemplateInput {
  name: string;
  shipping_notice: string;
  return_exchange_notice: string;
  remote_area_notice: string;
  cs_name: string;
  cs_phone: string;
  cs_email: string;
}

const DISALLOWED_CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

/** Tabs, LF and CR are valid in customer copy; other control characters are not. */
export function hasDisallowedShippingNoticeControl(value: string): boolean {
  return DISALLOWED_CONTROL_CHARS.test(value);
}

export function shippingNoticeTemplateValues(template?: ShippingNoticeTemplateValues | null): ShippingNoticeTemplateValues {
  return {
    name: template?.name ?? '', shippingNotice: template?.shippingNotice ?? '', returnExchangeNotice: template?.returnExchangeNotice ?? '',
    remoteAreaNotice: template?.remoteAreaNotice ?? '', csName: template?.csName ?? '', csPhone: template?.csPhone ?? '', csEmail: template?.csEmail ?? '',
  };
}

/** 적은 내용이 저장된 내용과 같은가(앞뒤 공백은 저장할 때 지우므로 보지 않는다). */
export function sameShippingNoticeTemplateValues(left: ShippingNoticeTemplateValues, right: ShippingNoticeTemplateValues): boolean {
  return SHIPPING_NOTICE_TEMPLATE_VALUE_KEYS.every((key) => left[key].trim() === right[key].trim());
}

export function normalizeShippingNoticeTemplateFilters(
  params: Record<string, string | string[] | undefined>,
): ShippingNoticeTemplateFilters {
  const query = typeof params.q === 'string' ? params.q.trim().slice(0, SHIPPING_NOTICE_TEMPLATE_NAME_MAX) : '';
  return {
    query,
    page: Math.min(10000, Math.max(1, Number.parseInt(typeof params.page === 'string' ? params.page : '', 10) || 1)),
  };
}

export function shippingNoticeTemplateHref(
  filters: ShippingNoticeTemplateFilters,
  page = filters.page,
): string {
  const params = new URLSearchParams();
  if (filters.query) params.set('q', filters.query);
  if (page > 1) params.set('page', String(page));
  return `${SHIPPING_NOTICE_TEMPLATES_PATH}${params.size ? `?${params}` : ''}`;
}

/**
 * 저장할 수 있는 모양으로 읽는다. 저장하면 바로 상품에서 고를 수 있으므로 고객에게 보일 필수 안내
 * (배송 안내, 교환·반품 안내, 고객센터 이름, 전화나 이메일)가 비어 있으면 그 칸에서 말한다.
 */
export function parseShippingNoticeTemplateInput(input: Record<string, string>):
  | { ok: true; value: ShippingNoticeTemplateInput }
  | { ok: false; errors: Record<string, string> } {
  const value: ShippingNoticeTemplateInput = {
    name: (input.name ?? '').trim(),
    shipping_notice: (input.shippingNotice ?? '').trim(),
    return_exchange_notice: (input.returnExchangeNotice ?? '').trim(),
    remote_area_notice: (input.remoteAreaNotice ?? '').trim(),
    cs_name: (input.csName ?? '').trim(),
    cs_phone: (input.csPhone ?? '').trim(),
    cs_email: (input.csEmail ?? '').trim(),
  };
  const errors: Record<string, string> = {};
  if (!value.name || value.name.length > SHIPPING_NOTICE_TEMPLATE_NAME_MAX || hasDisallowedShippingNoticeControl(value.name)) {
    errors.name = `템플릿 이름을 1~${SHIPPING_NOTICE_TEMPLATE_NAME_MAX}자로 적어 주세요.`;
  }
  if (!value.shipping_notice) {
    errors.shippingNotice = '배송 안내를 적어 주세요. 상품 상세에 그대로 보입니다.';
  } else if (value.shipping_notice.length > SHIPPING_NOTICE_TEMPLATE_NOTICE_MAX || hasDisallowedShippingNoticeControl(value.shipping_notice)) {
    errors.shippingNotice = `배송 안내는 ${SHIPPING_NOTICE_TEMPLATE_NOTICE_MAX}자 이내로 적어 주세요.`;
  }
  if (!value.return_exchange_notice) {
    errors.returnExchangeNotice = '교환·반품 안내를 적어 주세요. 상품 상세에 그대로 보입니다.';
  } else if (value.return_exchange_notice.length > SHIPPING_NOTICE_TEMPLATE_NOTICE_MAX || hasDisallowedShippingNoticeControl(value.return_exchange_notice)) {
    errors.returnExchangeNotice = `교환·반품 안내는 ${SHIPPING_NOTICE_TEMPLATE_NOTICE_MAX}자 이내로 적어 주세요.`;
  }
  if (value.remote_area_notice.length > SHIPPING_NOTICE_TEMPLATE_NOTICE_MAX || hasDisallowedShippingNoticeControl(value.remote_area_notice)) {
    errors.remoteAreaNotice = `도서산간 안내는 ${SHIPPING_NOTICE_TEMPLATE_NOTICE_MAX}자 이내로 적어 주세요.`;
  }
  if (!value.cs_name) {
    errors.csName = '고객센터 이름을 적어 주세요.';
  } else if (value.cs_name.length > SHIPPING_NOTICE_TEMPLATE_CS_NAME_MAX || hasDisallowedShippingNoticeControl(value.cs_name)) {
    errors.csName = `고객센터 이름은 ${SHIPPING_NOTICE_TEMPLATE_CS_NAME_MAX}자 이내로 적어 주세요.`;
  }
  if (value.cs_phone.length > SHIPPING_NOTICE_TEMPLATE_CS_PHONE_MAX || hasDisallowedShippingNoticeControl(value.cs_phone)) {
    errors.csPhone = `고객센터 전화는 ${SHIPPING_NOTICE_TEMPLATE_CS_PHONE_MAX}자 이내로 적어 주세요.`;
  }
  if (value.cs_email.length > SHIPPING_NOTICE_TEMPLATE_CS_EMAIL_MAX || hasDisallowedShippingNoticeControl(value.cs_email)) {
    errors.csEmail = `고객센터 이메일은 ${SHIPPING_NOTICE_TEMPLATE_CS_EMAIL_MAX}자 이내로 적어 주세요.`;
  } else if (value.cs_email && !/^\S+@\S+\.\S+$/.test(value.cs_email)) {
    errors.csEmail = '고객센터 이메일을 name@example.com처럼 적어 주세요.';
  }
  if (!value.cs_phone && !value.cs_email && !errors.csPhone && !errors.csEmail) {
    errors.csPhone = '고객센터 전화와 이메일 가운데 하나는 적어 주세요.';
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value };
}

export function isShippingNoticeTemplateId(value: string): boolean {
  return isUuid(value);
}

/**
 * 저장 전 확인창. 이 템플릿을 쓰는 상품이 있을 때만 띄운다 — 저장하는 순간 그 상품들의 상품 상세 안내가 바뀐다.
 * 보관한 상품은 세지 않는다(바뀌지 않는다). 주문에는 이 안내 글이 따로 저장되지 않는다.
 */
export function shippingNoticeTemplateSaveConfirm(name: string, goodsCount: number): { title: string; message: string; confirmLabel: string; cancelLabel: string } {
  return {
    title: `‘${name}’ 템플릿을 저장할까요?`,
    message: `이 템플릿을 쓰는 상품 ${goodsCount.toLocaleString('ko-KR')}개의 배송·교환·반품 안내가 새 내용으로 바뀝니다. 공개 중인 상품은 고객이 보는 상품 상세에 바로 반영됩니다.`,
    confirmLabel: '저장', cancelLabel: '돌아가기',
  };
}

/** 저장한 뒤 목록 위에 보이는 결과 한 줄. 바뀐 상품 수는 저장이 실제로 바꾼 수다. */
export function shippingNoticeTemplateSavedNotice(saved: { name: string; created: boolean; appliedGoods: number }): string {
  if (saved.created) return `‘${saved.name}’ 템플릿을 등록했습니다. 상품등록의 [템플릿 고르기]에서 바로 고를 수 있습니다.`;
  return saved.appliedGoods > 0
    ? `‘${saved.name}’ 템플릿을 저장했습니다. 이 템플릿을 쓰는 상품 ${saved.appliedGoods.toLocaleString('ko-KR')}개의 안내를 새 내용으로 바꿨습니다.`
    : `‘${saved.name}’ 템플릿을 저장했습니다.`;
}

export interface ShippingNoticeTemplateApplyResult {
  /** 새로 이 템플릿으로 바뀐 상품 수. */
  applied: number;
  /** 이미 이 템플릿의 지금 내용을 쓰고 있어 그대로 둔 상품 수. */
  unchanged: number;
  /** 적용하지 못한 상품과 이유. */
  failed: { name: string; reason: string }[];
  /** 중간에 멈췄다. 그 뒤의 상품은 적용하지 않았다. */
  stopped?: boolean;
}

/** [상품에 적용] 뒤 목록 위에 보이는 결과 한 줄. 된 것과 안 된 것을 나눠 말한다. */
export function shippingNoticeTemplateAppliedNotice(name: string, result: ShippingNoticeTemplateApplyResult): string {
  const parts = [result.applied > 0
    ? `‘${name}’ 템플릿을 상품 ${result.applied.toLocaleString('ko-KR')}개에 적용했습니다.`
    : `‘${name}’ 템플릿을 새로 적용한 상품이 없습니다.`];
  if (result.unchanged > 0) parts.push(`이미 이 템플릿을 쓰던 ${result.unchanged.toLocaleString('ko-KR')}개는 그대로입니다.`);
  if (result.failed.length) {
    const shown = result.failed.slice(0, 3).map((item) => `${item.name}(${item.reason})`).join(', ');
    const more = result.failed.length > 3 ? ` 외 ${result.failed.length - 3}개` : '';
    parts.push(`적용하지 못한 상품 ${result.failed.length.toLocaleString('ko-KR')}개: ${shown}${more}.`);
  }
  if (result.stopped) parts.push(`중간에 멈춰 남은 상품에는 적용하지 못했습니다. 목록의 ‘쓰는 상품’ 수를 확인한 뒤 [${SHIPPING_NOTICE_TEMPLATE_APPLY_LABEL}]으로 다시 넣어 주세요.`);
  return parts.join(' ');
}
