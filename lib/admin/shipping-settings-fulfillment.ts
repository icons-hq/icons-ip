import { parseFulfillmentMethodTerms, parseGoodsFulfillment, type FulfillmentMethodTerms, type GoodsFulfillment } from '@/lib/goods-fulfillment';
import { transactionExactKeys, transactionRecord } from '@/lib/goods-transaction-values';

export interface ShippingFulfillmentPolicy {
  mode: 'shipping' | 'no_delivery'; methods: FulfillmentMethodTerms[]; publicNote: string; evidence: string; confirmed: true;
}
export type ShippingSettingsFulfillment = { mode: 'preserve' } | { mode: 'replace'; policy: ShippingFulfillmentPolicy };
export function parseShippingSettingsFulfillment(value: unknown): ShippingSettingsFulfillment | null {
  if (!transactionRecord(value)) return null;
  if (value.mode === 'preserve' && transactionExactKeys(value, ['mode'])) return { mode: 'preserve' };
  if (value.mode !== 'replace' || !transactionExactKeys(value, ['mode', 'policy']) || !transactionRecord(value.policy)) return null;
  const p = value.policy;
  if (!transactionExactKeys(p, ['mode', 'methods', 'publicNote', 'evidence', 'confirmed']) || !['shipping', 'no_delivery'].includes(String(p.mode))
    || !Array.isArray(p.methods) || p.methods.some(m => !parseFulfillmentMethodTerms(m)) || p.confirmed !== true
    || typeof p.evidence !== 'string' || p.evidence !== p.evidence.trim() || p.evidence.length < 2 || p.evidence.length > 1000 || /[\u0000-\u001f\u007f]/u.test(p.evidence)
    || typeof p.publicNote !== 'string' || p.publicNote !== p.publicNote.trim()
    || !parseGoodsFulfillment({ goodId: 'shipping-template', revision: 1, mode: p.mode, methods: p.methods, files: [], publicNote: p.publicNote })) return null;
  return value as unknown as ShippingSettingsFulfillment;
}
export function shippingFulfillmentAfter(before: GoodsFulfillment, directive: ShippingSettingsFulfillment): GoodsFulfillment {
  if (directive.mode === 'preserve') return before;
  return { goodId: before.goodId, revision: before.revision + 1, mode: directive.policy.mode, methods: directive.policy.methods, files: [], publicNote: directive.policy.publicNote };
}
export interface ShippingFulfillmentDraft {
  action: 'preserve' | 'replace'; mode: 'shipping' | 'no_delivery'; publicNote: string; evidence: string; confirmed: boolean;
  methods: { method: 'parcel' | 'quick' | 'pickup' | 'direct' | 'freight'; enabled: boolean; feeAmount: string; feeBasis: 'per_order' | 'per_item'; installationFee: string }[];
}
export function shippingFulfillmentDraft(value?: ShippingSettingsFulfillment): ShippingFulfillmentDraft {
  const policy = value?.mode === 'replace' ? value.policy : null;
  return { action: value?.mode ?? 'preserve', mode: policy?.mode ?? 'shipping', publicNote: policy?.publicNote ?? '', evidence: policy?.evidence ?? '', confirmed: false,
    methods: (['parcel', 'quick', 'pickup', 'direct', 'freight'] as const).map(method => {
      const m = policy?.methods.find(item => item.method === method);
      return { method, enabled: policy ? Boolean(m) : method === 'parcel', feeAmount: String(m?.feeAmount ?? 0), feeBasis: m?.feeBasis ?? 'per_order', installationFee: String(m?.installationFee ?? 0) };
    }) };
}
export function prepareShippingFulfillment(draft: ShippingFulfillmentDraft): ShippingSettingsFulfillment | null {
  if (draft.action === 'preserve') return { mode: 'preserve' };
  const integer = (v: string) => /^\d+$/.test(v) ? Number(v) : NaN;
  const methods = draft.mode === 'no_delivery' ? [{ method: 'none', feeAmount: 0, feeBasis: 'per_order', installationFee: 0 }] : draft.methods.filter(m => m.enabled).map(m => ({
    method: m.method, feeAmount: m.method === 'parcel' ? null : m.method === 'pickup' ? 0 : integer(m.feeAmount),
    feeBasis: ['parcel', 'pickup'].includes(m.method) ? 'per_order' : m.feeBasis, installationFee: m.method === 'pickup' ? 0 : integer(m.installationFee),
  }));
  return parseShippingSettingsFulfillment({ mode: 'replace', policy: { mode: draft.mode, methods, publicNote: draft.publicNote.trim(), evidence: draft.evidence.trim(), confirmed: draft.confirmed } });
}
