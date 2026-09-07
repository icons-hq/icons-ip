import type { AdminFieldErrors, AdminFormResult } from './catalog';

/*
 * 배송·교환반품 정책 (현업 슬라이스 2).
 *
 * 정책은 **템플릿**이다 — 상품마다 배송비를 적으면 값이 바뀔 때 상품 수천 개를 고쳐야 한다.
 * 상품은 정책을 가리키고, 비우면 기본 정책을 쓴다.
 */

export const SHIPPING_METHODS = [
  { value: 'parcel', label: '택배' },
  { value: 'quick', label: '퀵' },
  { value: 'pickup', label: '방문수령' },
  { value: 'freight', label: '화물' },
] as const;

export const SHIPPING_FEE_KINDS = [
  { value: 'conditional', label: '조건부 무료' },
  { value: 'paid', label: '유료' },
  { value: 'free', label: '무료' },
] as const;

export interface AdminShippingPolicy {
  id: string;
  name: string;
  method: string;
  bundling: boolean;
  feeKind: string;
  feeAmount: number;
  freeThreshold: number | null;
  remoteSurcharge: number;
  shipFromLocationId: string | null;
  exchangeLocationId: string | null;
  returnLocationId: string | null;
  exchangeFee: number;
  returnFee: number;
  returnRestrictions: string | null;
  supportNote: string | null;
  allowBankTransfer: boolean;
  isDefault: boolean;
  archivedAt: string | null;
}

export function shippingPolicySummary(policy: AdminShippingPolicy): string {
  const method = SHIPPING_METHODS.find((entry) => entry.value === policy.method)?.label ?? policy.method;
  if (policy.feeKind === 'free') return `${method} · 무료배송`;
  if (policy.feeKind === 'conditional') {
    return `${method} · ${policy.feeAmount.toLocaleString('ko-KR')}원 (${(policy.freeThreshold ?? 0).toLocaleString('ko-KR')}원 이상 무료)`;
  }
  return `${method} · ${policy.feeAmount.toLocaleString('ko-KR')}원`;
}

export interface AdminShippingPolicyValue {
  id: string;
  name: string;
  method: string;
  bundling: boolean;
  feeKind: string;
  feeAmount: number;
  freeThreshold: number | null;
  remoteSurcharge: number;
  shipFromLocationId: string | null;
  exchangeLocationId: string | null;
  returnLocationId: string | null;
  exchangeFee: number;
  returnFee: number;
  returnRestrictions: string | null;
  supportNote: string | null;
  allowBankTransfer: boolean;
  isDefault: boolean;
}

function text(formData: FormData, name: string): string {
  const raw = formData.get(name);
  return typeof raw === 'string' ? raw.trim() : '';
}

function amount(formData: FormData, name: string, errors: AdminFieldErrors, label: string): number {
  const raw = text(formData, name);
  if (!raw) return 0;
  if (!/^\d+$/.test(raw)) {
    errors[name] = `${label}는 0 이상의 정수여야 합니다.`;
    return 0;
  }
  return Number(raw);
}

export function normalizeShippingPolicyForm(
  formData: FormData,
): AdminFormResult<AdminShippingPolicyValue> {
  const errors: AdminFieldErrors = {};
  const id = text(formData, 'id');
  const name = text(formData, 'name');
  const method = text(formData, 'method') || 'parcel';
  const feeKind = text(formData, 'feeKind') || 'conditional';

  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(id)) {
    errors.id = '정책 ID는 소문자·숫자·하이픈 2~41자여야 합니다.';
  }
  if (!name) errors.name = '정책 이름을 입력해주세요.';
  if (!SHIPPING_METHODS.some((entry) => entry.value === method)) errors.method = '배송 방법을 선택해주세요.';
  if (!SHIPPING_FEE_KINDS.some((entry) => entry.value === feeKind)) errors.feeKind = '배송비 유형을 선택해주세요.';

  const feeAmount = amount(formData, 'feeAmount', errors, '배송비');
  const remoteSurcharge = amount(formData, 'remoteSurcharge', errors, '도서산간 추가비');
  const exchangeFee = amount(formData, 'exchangeFee', errors, '교환 배송비');
  const returnFee = amount(formData, 'returnFee', errors, '반품 배송비');

  const thresholdRaw = text(formData, 'freeThreshold');
  let freeThreshold: number | null = null;
  if (feeKind === 'conditional') {
    /* 조건부 무료인데 임계가 없으면 「언제 무료인지」가 없는 정책이 된다 — DB CHECK 도 막는다. */
    if (!/^\d+$/.test(thresholdRaw) || Number(thresholdRaw) <= 0) {
      errors.freeThreshold = '조건부 무료는 무료 기준 금액이 있어야 합니다.';
    } else {
      freeThreshold = Number(thresholdRaw);
    }
  }
  if (feeKind === 'free' && feeAmount > 0) {
    errors.feeAmount = '무료배송 정책에는 배송비를 적을 수 없습니다.';
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      id,
      name,
      method,
      bundling: formData.get('bundling') !== null,
      feeKind,
      feeAmount: feeKind === 'free' ? 0 : feeAmount,
      freeThreshold,
      remoteSurcharge,
      shipFromLocationId: text(formData, 'shipFromLocationId') || null,
      exchangeLocationId: text(formData, 'exchangeLocationId') || null,
      returnLocationId: text(formData, 'returnLocationId') || null,
      exchangeFee,
      returnFee,
      returnRestrictions: text(formData, 'returnRestrictions') || null,
      supportNote: text(formData, 'supportNote') || null,
      allowBankTransfer: formData.get('allowBankTransfer') !== null,
      isDefault: formData.get('isDefault') !== null,
    },
  };
}
