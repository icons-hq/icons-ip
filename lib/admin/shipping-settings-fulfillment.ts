import { FULFILLMENT_METHOD_LABELS, parseFulfillmentMethodTerms, parseGoodsFulfillment, type FulfillmentMethodTerms, type GoodsFulfillment } from '@/lib/goods-fulfillment';
import { transactionExactKeys, transactionRecord } from '@/lib/goods-transaction-values';
import { krwAmountWords } from '@/lib/format';
import { FULFILLMENT_AMOUNT_INVALID, FULFILLMENT_METHOD_REQUIRED } from './goods-fulfillment-messages';

/**
 * 템플릿이 함께 바꾸는 수령 방식. 적용 근거(evidence)와 확인 체크(confirmed)는 받지 않는다(2026-11-25 결정 — 저장 = 적용,
 * DB는 20261127105000). 그 전에 저장한 템플릿에는 두 키가 남아 있어 읽을 때는 있는 모양도 받고, 화면에서 다시 저장하면 빠진다.
 */
export interface ShippingFulfillmentPolicy {
  mode: 'shipping' | 'no_delivery'; methods: FulfillmentMethodTerms[]; publicNote: string; evidence?: string; confirmed?: boolean;
}
export type ShippingSettingsFulfillment = { mode: 'preserve' } | { mode: 'replace'; policy: ShippingFulfillmentPolicy };
export function parseShippingSettingsFulfillment(value: unknown): ShippingSettingsFulfillment | null {
  if (!transactionRecord(value)) return null;
  if (value.mode === 'preserve' && transactionExactKeys(value, ['mode'])) return { mode: 'preserve' };
  if (value.mode !== 'replace' || !transactionExactKeys(value, ['mode', 'policy']) || !transactionRecord(value.policy)) return null;
  const p = value.policy;
  if (!transactionExactKeys(p, ['mode', 'methods', 'publicNote', ...('evidence' in p ? ['evidence'] : []), ...('confirmed' in p ? ['confirmed'] : [])])
    || !['shipping', 'no_delivery'].includes(String(p.mode)) || !Array.isArray(p.methods) || p.methods.some(m => !parseFulfillmentMethodTerms(m))
    || 'confirmed' in p && typeof p.confirmed !== 'boolean'
    || 'evidence' in p && (typeof p.evidence !== 'string' || p.evidence !== p.evidence.trim() || p.evidence.length > 1000 || /[\u0000-\u001f\u007f]/u.test(p.evidence))
    || typeof p.publicNote !== 'string' || p.publicNote !== p.publicNote.trim()
    || !parseGoodsFulfillment({ goodId: 'shipping-template', revision: 1, mode: p.mode, methods: p.methods, files: [], publicNote: p.publicNote })) return null;
  return value as unknown as ShippingSettingsFulfillment;
}
export function shippingFulfillmentAfter(before: GoodsFulfillment, directive: ShippingSettingsFulfillment): GoodsFulfillment {
  if (directive.mode === 'preserve') return before;
  return { goodId: before.goodId, revision: before.revision + 1, mode: directive.policy.mode, methods: directive.policy.methods, files: [], publicNote: directive.policy.publicNote };
}
export interface ShippingFulfillmentDraft {
  action: 'preserve' | 'replace'; mode: 'shipping' | 'no_delivery'; publicNote: string;
  methods: { method: 'parcel' | 'quick' | 'pickup' | 'direct' | 'freight'; enabled: boolean; feeAmount: string; feeBasis: 'per_order' | 'per_item'; installationFee: string }[];
}
export function shippingFulfillmentDraft(value?: ShippingSettingsFulfillment): ShippingFulfillmentDraft {
  const policy = value?.mode === 'replace' ? value.policy : null;
  return { action: value?.mode ?? 'preserve', mode: policy?.mode ?? 'shipping', publicNote: policy?.publicNote ?? '',
    methods: (['parcel', 'quick', 'pickup', 'direct', 'freight'] as const).map(method => {
      const m = policy?.methods.find(item => item.method === method);
      return { method, enabled: policy ? Boolean(m) : method === 'parcel', feeAmount: String(m?.feeAmount ?? 0), feeBasis: m?.feeBasis ?? 'per_order', installationFee: String(m?.installationFee ?? 0) };
    }) };
}
/** 적은 수령 방식을 저장할 모양으로 바꾼다. 수령 방식이 없거나 금액이 숫자가 아니면 null이다(무엇이 틀렸는지는 `shippingFulfillmentProblem`). */
export function prepareShippingFulfillment(draft: ShippingFulfillmentDraft): ShippingSettingsFulfillment | null {
  if (draft.action === 'preserve') return { mode: 'preserve' };
  const integer = (v: string) => /^\d+$/.test(v) ? Number(v) : NaN;
  const methods = draft.mode === 'no_delivery' ? [{ method: 'none', feeAmount: 0, feeBasis: 'per_order', installationFee: 0 }] : draft.methods.filter(m => m.enabled).map(m => ({
    method: m.method, feeAmount: m.method === 'parcel' ? null : m.method === 'pickup' ? 0 : integer(m.feeAmount),
    feeBasis: ['parcel', 'pickup'].includes(m.method) ? 'per_order' : m.feeBasis, installationFee: m.method === 'pickup' ? 0 : integer(m.installationFee),
  }));
  return parseShippingSettingsFulfillment({ mode: 'replace', policy: { mode: draft.mode, methods, publicNote: draft.publicNote.trim() } });
}
/** 저장할 수 없는 수령 방식이면 무엇을 고칠지 말한다(상품의 수령 방식 패널과 같은 말). 저장할 수 있으면 null. */
export function shippingFulfillmentProblem(draft: ShippingFulfillmentDraft): string | null {
  if (prepareShippingFulfillment(draft)) return null;
  const selected = draft.methods.filter(m => m.enabled);
  if (draft.mode === 'shipping' && !selected.length) return FULFILLMENT_METHOD_REQUIRED;
  if (draft.mode === 'shipping' && selected.some(m => m.method !== 'pickup' && (m.method !== 'parcel' && !/^\d+$/.test(m.feeAmount) || !/^\d+$/.test(m.installationFee)))) return FULFILLMENT_AMOUNT_INVALID;
  return '배송비와 설치비는 1,000,000원 이하로, 고객 안내는 1,000자 이내 한 줄로 적어 주세요.';
}
/**
 * 수령 방식을 한 줄로 되읽는다('글보다 화면' 3단계). 상품의 수령 방식 패널(GoodsFulfillmentPanel)과 같은 문장이다.
 * 템플릿은 상품의 방식을 이 값으로 바꾸므로, 택배 하나뿐이어도 그렇다고 말한다.
 */
export function shippingFulfillmentReadback(policy: Pick<ShippingFulfillmentPolicy, 'mode' | 'methods'>): string {
  if (policy.mode === 'no_delivery') return '배송비 없이 주문받고 직접 전달합니다.';
  const items = policy.methods.map(m => {
    const costs = [m.feeAmount ? `배송비 ${m.feeBasis === 'per_item' ? '수량 1개마다 ' : ''}${krwAmountWords(m.feeAmount)}` : '',
      m.installationFee ? `설치비 개당 ${krwAmountWords(m.installationFee)}` : ''].filter(Boolean);
    return `${FULFILLMENT_METHOD_LABELS[m.method]}${costs.length ? `(${costs.join(' · ')})` : ''}`;
  });
  return items.length === 1 ? `수령 방식은 ${items[0]} 하나입니다.` : `고객은 주문서에서 ${items.join(', ')} 중 하나를 고릅니다.`;
}
