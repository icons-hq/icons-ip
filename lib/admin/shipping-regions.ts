import { krw } from '@/lib/format';
import { isUuid } from '@/lib/uuid';
import { normalizeShippingAddress, type ShippingRegionFeeUnit } from '../shipping-regions';

export const SHIPPING_REGIONS_PATH = '/admin/settings/shipping-regions';
export const MAX_SHIPPING_REGION_RULES = 1000;
export type RegionRuleDisposition = 'standard' | 'surcharge' | 'unavailable' | 'manual_review';
export interface ShippingRegionRuleInput {
  id: string | null; postalFrom: string; postalTo: string; addressPrefix: string;
  regionLabel: string; disposition: RegionRuleDisposition | ''; amount: number | null;
}
export interface ShippingRegionPolicyInput {
  originId: string; carrierCode: string; name: string; startsAt: string | null; endsAt: string | null;
  openEnded: boolean | null; sourceEvidence: string; unlistedDisposition: 'standard' | 'manual_review' | null;
  feeUnit: ShippingRegionFeeUnit | null; chargePolicyGoods: boolean | null; waivePolicyThreshold: boolean | null;
  chargeFreeGoods: boolean | null; chargeIndividualGoods: boolean | null;
  noRulesConfirmed: boolean; rules: ShippingRegionRuleInput[];
}
export interface ShippingRegionPolicy extends ShippingRegionPolicyInput {
  id: string; version: number; revision: number; status: 'draft' | 'active' | 'retired';
  confirmedAt: string | null; confirmedBy: string | null; updatedAt: string;
}

export interface ShippingRegionExpiryWarning {
  id: string; name: string; version: number; endsAt: string; status: 'expired' | 'expiring';
  originName: string; carrierLabel: string;
}
export type ShippingRegionExpiryPolicy = Pick<ShippingRegionPolicy,'id'|'name'|'version'|'status'|'originId'|'carrierCode'|'startsAt'|'endsAt'> & {originName:string;carrierLabel:string};
export interface ShippingRegionExpiryState {
  warnings: ShippingRegionExpiryWarning[];
  unavailable?: boolean;
}

/** Warn for upcoming active versions and the latest started version, including a coverage gap. */
/** 이 정책이 지금 견적에 쓰이는가. `private.apply_shipping_region_quote`와 같은 조건이다(활성·출고지 기본 택배사·적용 기간). */
export function shippingRegionPolicyInEffect(policy: Pick<ShippingRegionPolicy, 'originId' | 'carrierCode' | 'status' | 'startsAt' | 'endsAt'>, origin: { id: string; defaultCarrier: string | null }, now: number): boolean {
  if (policy.status !== 'active' || policy.originId !== origin.id || policy.carrierCode !== origin.defaultCarrier || !policy.startsAt) return false;
  return Date.parse(policy.startsAt) <= now && (!policy.endsAt || now < Date.parse(policy.endsAt));
}

/** 활성으로 확정했지만 적용 시작 전인 정책 — 화면은 '활성'이 아니라 '예정'이라고 말한다(아직 견적에 쓰이지 않는다). */
export function shippingRegionPolicyScheduled(policy: Pick<ShippingRegionPolicy, 'status' | 'startsAt'>, now: number): boolean {
  return policy.status === 'active' && Boolean(policy.startsAt) && Date.parse(policy.startsAt!) > now;
}

/** DB 겹침 판정(`tstzrange(starts_at, ends_at, '[)')` &&)과 같은 기간 겹침. 시작·끝이 비면 무한이다. */
export function shippingRegionPeriodsOverlap(a: Pick<ShippingRegionPolicyInput, 'startsAt' | 'endsAt'>, b: Pick<ShippingRegionPolicyInput, 'startsAt' | 'endsAt'>): boolean {
  const start = (value: string | null) => value ? Date.parse(value) : -Infinity;
  const end = (value: string | null) => value ? Date.parse(value) : Infinity;
  return start(a.startsAt) < end(b.endsAt) && start(b.startsAt) < end(a.endsAt);
}

export function shippingRegionExpiryWarnings(policies: ShippingRegionExpiryPolicy[], now: number): ShippingRegionExpiryWarning[] {
  const latest = new Map<string, ShippingRegionExpiryPolicy>();
  const upcoming: ShippingRegionExpiryPolicy[] = [];
  for (const policy of policies) {
    if (policy.status !== 'active' || !policy.startsAt) continue;
    if (Date.parse(policy.startsAt) > now) {
      upcoming.push(policy);
      continue;
    }
    const key = `${policy.originId}:${policy.carrierCode}`;
    const previous = latest.get(key);
    if (!previous || Date.parse(policy.startsAt) > Date.parse(previous.startsAt!)
      || (policy.startsAt === previous.startsAt && policy.version > previous.version)) latest.set(key, policy);
  }
  const warnings: ShippingRegionExpiryWarning[] = [];
  const deadline = now + 7 * 24 * 60 * 60 * 1000;
  for (const policy of [...latest.values(), ...upcoming]) {
    if (!policy.endsAt || Date.parse(policy.endsAt) > deadline) continue;
    warnings.push({ id: policy.id, name: policy.name, version: policy.version, endsAt: policy.endsAt,originName:policy.originName,carrierLabel:policy.carrierLabel,
      status: Date.parse(policy.endsAt) <= now ? 'expired' : 'expiring' });
  }
  return warnings.sort((a, b) => Date.parse(a.endsAt) - Date.parse(b.endsAt) || a.id.localeCompare(b.id));
}

export const REGION_DISPOSITION_LABELS: Record<RegionRuleDisposition, string> = {
  standard: '추가배송비 없음', surcharge: '추가배송비 받음', unavailable: '배송 불가', manual_review: '개별 확인 필요',
};
/** 이름을 바꾸기 전에 만든 지역표 파일의 처리 이름. 붙여넣을 때는 계속 읽는다(올릴 때 읽는 이름은 옛 것도 읽는다). */
const PREVIOUS_DISPOSITION_LABELS: Readonly<Record<string, RegionRuleDisposition>> = { '추가료 없음': 'standard', '추가료 부과': 'surcharge' };
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const booleanOrNull = (value: unknown): value is boolean | null => value === null || typeof value === 'boolean';
const instantOrNull = (value: unknown): value is string | null => value === null || (typeof value === 'string' && Number.isFinite(Date.parse(value)));
function text(value: unknown, max: number): value is string { return typeof value === 'string' && value.length <= max && !/[\u0000-\u0008\u000e-\u001f\u007f]/.test(value); }
export function emptyShippingRegionPolicy(originId = '', carrierCode = ''): ShippingRegionPolicyInput {
  return { originId, carrierCode, name: '', startsAt: null, endsAt: null, openEnded: null, sourceEvidence: '',
    unlistedDisposition: null, feeUnit: null, chargePolicyGoods: null, waivePolicyThreshold: null, chargeFreeGoods: null,
    chargeIndividualGoods: null, noRulesConfirmed: false, rules: [] };
}
/**
 * 새로 만들 때 채워 두는 값 — 대부분이 쓰는 값이다(끝을 정하지 않음, 표에 없는 지역은 추가배송비 없음, 한 주문에 한 번,
 * 어느 배송비 유형의 상품이든 받음, 무료 배송 기준을 채워도 받음). 묶음그룹 지역표가 늘 쓰는 조합과 같다.
 */
export const SHIPPING_REGION_POLICY_DEFAULTS = { openEnded: true, unlistedDisposition: 'standard', feeUnit: 'per_shipment',
  chargePolicyGoods: true, waivePolicyThreshold: false, chargeFreeGoods: true, chargeIndividualGoods: true,
} as const satisfies Partial<ShippingRegionPolicyInput>;
export function defaultShippingRegionPolicy(originId = '', carrierCode = ''): ShippingRegionPolicyInput {
  return { ...emptyShippingRegionPolicy(originId, carrierCode), ...SHIPPING_REGION_POLICY_DEFAULTS };
}
/** 아직 고르지 않은 값(null)에 새로 만들 때의 기본값을 채운다. 이미 고른 값과 근거·지역표는 그대로 둔다. */
export function withShippingRegionPolicyDefaults(input: ShippingRegionPolicyInput): ShippingRegionPolicyInput {
  const openEnded = input.openEnded ?? (input.endsAt ? false : SHIPPING_REGION_POLICY_DEFAULTS.openEnded);
  return { ...input, openEnded, unlistedDisposition: input.unlistedDisposition ?? SHIPPING_REGION_POLICY_DEFAULTS.unlistedDisposition,
    feeUnit: input.feeUnit ?? SHIPPING_REGION_POLICY_DEFAULTS.feeUnit,
    chargePolicyGoods: input.chargePolicyGoods ?? SHIPPING_REGION_POLICY_DEFAULTS.chargePolicyGoods,
    waivePolicyThreshold: input.waivePolicyThreshold ?? SHIPPING_REGION_POLICY_DEFAULTS.waivePolicyThreshold,
    chargeFreeGoods: input.chargeFreeGoods ?? SHIPPING_REGION_POLICY_DEFAULTS.chargeFreeGoods,
    chargeIndividualGoods: input.chargeIndividualGoods ?? SHIPPING_REGION_POLICY_DEFAULTS.chargeIndividualGoods };
}
export function parseShippingRegionPolicyInput(value: unknown): ShippingRegionPolicyInput | null {
  if (!object(value) || typeof value.originId !== 'string' || !isUuid(value.originId)
    || !text(value.carrierCode, 80) || !value.carrierCode.trim() || !text(value.name, 100)
    || !instantOrNull(value.startsAt) || !instantOrNull(value.endsAt) || !booleanOrNull(value.openEnded)
    || !text(value.sourceEvidence, 2000) || ![null, 'standard', 'manual_review'].includes(value.unlistedDisposition as null)
    || ![null, 'per_shipment', 'per_good'].includes(value.feeUnit as null)
    || !['chargePolicyGoods', 'waivePolicyThreshold', 'chargeFreeGoods', 'chargeIndividualGoods'].every((key) => booleanOrNull(value[key]))
    || typeof value.noRulesConfirmed !== 'boolean' || !Array.isArray(value.rules) || value.rules.length > MAX_SHIPPING_REGION_RULES) return null;
  const ids = new Set<string>(); const rules: ShippingRegionRuleInput[] = [];
  for (const row of value.rules) {
    if (!object(row) || !(row.id === null || (typeof row.id === 'string' && isUuid(row.id) && !ids.has(row.id)))
      || !text(row.postalFrom, 5) || !text(row.postalTo, 5) || !/^(\d{5})?$/.test(row.postalFrom) || !/^(\d{5})?$/.test(row.postalTo)
      || !text(row.addressPrefix, 200) || !text(row.regionLabel, 100)
      || !['', ...Object.keys(REGION_DISPOSITION_LABELS)].includes(String(row.disposition))
      || !(row.amount === null || (typeof row.amount === 'number' && Number.isSafeInteger(row.amount) && row.amount >= 0 && row.amount <= 1000000))) return null;
    if (row.id) ids.add(row.id);
    rules.push({ id: row.id, postalFrom: row.postalFrom, postalTo: row.postalTo, addressPrefix: normalizeShippingAddress(row.addressPrefix),
      regionLabel: row.regionLabel.trim(), disposition: row.disposition as ShippingRegionRuleInput['disposition'], amount: row.amount as number | null });
  }
  return { originId: value.originId, carrierCode: value.carrierCode.trim(), name: value.name.trim(), startsAt: value.startsAt, endsAt: value.endsAt,
    openEnded: value.openEnded, sourceEvidence: value.sourceEvidence.trim(), unlistedDisposition: value.unlistedDisposition as ShippingRegionPolicyInput['unlistedDisposition'],
    feeUnit: value.feeUnit as ShippingRegionFeeUnit | null, chargePolicyGoods: value.chargePolicyGoods as boolean | null,
    waivePolicyThreshold: value.waivePolicyThreshold as boolean | null, chargeFreeGoods: value.chargeFreeGoods as boolean | null,
    chargeIndividualGoods: value.chargeIndividualGoods as boolean | null, noRulesConfirmed: value.noRulesConfirmed, rules };
}
export function parseShippingRegionPolicy(value: unknown): ShippingRegionPolicy | null {
  const input = parseShippingRegionPolicyInput(value);
  if (!input || !object(value) || typeof value.id !== 'string' || !isUuid(value.id)
    || !Number.isSafeInteger(value.version) || Number(value.version) < 1 || !Number.isSafeInteger(value.revision) || Number(value.revision) < 1
    || !['draft', 'active', 'retired'].includes(String(value.status)) || !instantOrNull(value.confirmedAt)
    || !(value.confirmedBy === null || typeof value.confirmedBy === 'string')
    || typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt))) return null;
  if (value.status !== 'draft' && (value.confirmedAt === null || value.confirmedBy === null)) return null;
  return { ...input, id: value.id, version: Number(value.version), revision: Number(value.revision), status: value.status as ShippingRegionPolicy['status'],
    confirmedAt: value.confirmedAt, confirmedBy: value.confirmedBy as string | null, updatedAt: value.updatedAt };
}
/** 지역표 한 줄에서 틀린 곳 하나와 고칠 방법. 틀린 곳이 없으면 null. */
function shippingRegionRuleProblem(rule: ShippingRegionRuleInput): string | null {
  if (!/^\d{5}$/.test(rule.postalFrom)) return `우편번호 시작(${rule.postalFrom || '빈칸'})이 5자리 숫자가 아닙니다. 0으로 시작하는 번호는 앞의 0까지 적어 주세요.`;
  if (!/^\d{5}$/.test(rule.postalTo)) return `우편번호 끝(${rule.postalTo || '빈칸'})이 5자리 숫자가 아닙니다. 0으로 시작하는 번호는 앞의 0까지 적어 주세요.`;
  if (rule.postalFrom > rule.postalTo) return '우편번호 시작이 끝보다 큽니다. 두 번호를 바꿔 적어 주세요.';
  if (!rule.regionLabel.trim()) return '지역명이 비어 있습니다. 고객에게 보일 이름(예: 제주)을 적어 주세요.';
  if (!rule.disposition) return `처리가 비어 있습니다. ${SHIPPING_REGION_DISPOSITION_CHOICES} 가운데 하나를 적어 주세요.`;
  if (rule.disposition === 'surcharge' && rule.amount === null) return '추가배송비 금액이 비어 있습니다. 0원이면 0을 적어 주세요.';
  if (rule.disposition !== 'surcharge' && rule.amount !== null) return `‘${REGION_DISPOSITION_LABELS[rule.disposition]}’ 줄에는 금액을 적지 않습니다. 금액 칸을 비우거나 처리를 ‘${REGION_DISPOSITION_LABELS.surcharge}’으로 바꿔 주세요.`;
  return null;
}
/**
 * 적용하려면 고쳐야 할 것들. 지역별 추가배송비 화면과 묶음그룹 지역표가 함께 쓴다.
 * 물류사 회신·계약 근거(sourceEvidence)는 더는 요구하지 않는다(2026-11-26, DB `assert_shipping_region_policy_complete`도 같다).
 */
export function shippingRegionPolicyProblems(policy: ShippingRegionPolicyInput): string[] {
  const problems: string[] = [];
  if (!policy.name.trim()) problems.push('이름을 적어 주세요.');
  if (!policy.startsAt) problems.push('적용 시작 날짜와 시각을 정해 주세요.');
  if (policy.openEnded === null || (policy.openEnded === false && !policy.endsAt) || (policy.openEnded && policy.endsAt)) problems.push('적용 종료를 정해 주세요. 끝을 정하지 않거나, 끝나는 날짜와 시각을 넣습니다.');
  /* 묶음그룹 지역표 검사(`shippingChargeGroupRegionalProblems`)가 이 문장을 그대로 찾아 걸러 낸다 — 문장을 바꾸면 그쪽도 함께 바꾼다. */
  if (policy.startsAt && policy.endsAt && Date.parse(policy.startsAt) >= Date.parse(policy.endsAt)) problems.push('종료 일시는 시작 일시보다 뒤여야 합니다.');
  if (!policy.unlistedDisposition) problems.push('‘표에 없는 지역’을 골라 주세요.');
  if (!policy.feeUnit || [policy.chargePolicyGoods, policy.waivePolicyThreshold, policy.chargeFreeGoods, policy.chargeIndividualGoods].includes(null)) {
    problems.push('추가배송비를 받는 단위와 받을 상품을 정해 주세요.');
  }
  if (!policy.rules.length && !policy.noRulesConfirmed) problems.push('지역표를 붙여넣거나 ‘추가배송비를 받는 지역 없음’을 골라 주세요.');
  if (policy.rules.length && policy.noRulesConfirmed) problems.push('지역표가 있으면 ‘추가배송비를 받는 지역 없음’을 고를 수 없습니다. 지역표를 지우거나 ‘지역표로 정하기’를 골라 주세요.');
  for (const [index, rule] of policy.rules.entries()) {
    const problem = shippingRegionRuleProblem(rule);
    if (problem) problems.push(`지역표 ${index + 1}번째 줄: ${problem}`);
    for (let before = 0; before < index; before++) {
      const other = policy.rules[before];
      if (rule.postalFrom && rule.postalTo && other.postalFrom && other.postalTo && rule.postalFrom <= other.postalTo && other.postalFrom <= rule.postalTo
        && (!rule.addressPrefix || !other.addressPrefix || rule.addressPrefix === other.addressPrefix
          || rule.addressPrefix.startsWith(`${other.addressPrefix} `) || other.addressPrefix.startsWith(`${rule.addressPrefix} `))) {
        problems.push(`지역표 ${before + 1}번째 줄과 ${index + 1}번째 줄의 우편번호·주소 범위가 겹칩니다. 한 주소가 한 줄에만 맞도록 고쳐 주세요.`); break;
      }
    }
    if (problems.length >= 25) { problems.push('지역표의 나머지 줄도 같은 기준으로 확인해 주세요.'); break; }
  }
  return problems;
}
export const MAX_SHIPPING_REGION_FEE = 1000000;
/** 적용 중인 설정의 '추가배송비 받음' 줄을 고객 지역명별로 묶는다. 금액 바꾸기(`admin_change_shipping_region_fees`)는 지역명 단위로 금액을 바꾼다. */
export interface ShippingRegionFeeGroup { regionLabel: string; rowCount: number; minAmount: number; maxAmount: number }
export function shippingRegionFeeGroups(rules: readonly ShippingRegionRuleInput[]): ShippingRegionFeeGroup[] {
  const groups = new Map<string, ShippingRegionFeeGroup>();
  for (const rule of rules) {
    if (rule.disposition !== 'surcharge' || rule.amount === null) continue;
    const group = groups.get(rule.regionLabel);
    if (group) Object.assign(group, { rowCount: group.rowCount + 1, minAmount: Math.min(group.minAmount, rule.amount), maxAmount: Math.max(group.maxAmount, rule.amount) });
    else groups.set(rule.regionLabel, { regionLabel: rule.regionLabel, rowCount: 1, minAmount: rule.amount, maxAmount: rule.amount });
  }
  return [...groups.values()];
}
/** 금액 바꾸기 요청 `{지역명: 금액}`. 지역명 100자, 금액은 0~1,000,000원 정수다. 비었거나 형식이 다르면 null. */
export function parseShippingRegionFees(value: unknown): Record<string, number> | null {
  if (!object(value)) return null;
  const entries = Object.entries(value);
  if (!entries.length || entries.length > MAX_SHIPPING_REGION_RULES) return null;
  for (const [label, amount] of entries) {
    if (!label.trim() || !text(label, 100) || typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 0 || amount > MAX_SHIPPING_REGION_FEE) return null;
  }
  return Object.fromEntries(entries) as Record<string, number>;
}
const feeRange = (group: Pick<ShippingRegionFeeGroup, 'minAmount' | 'maxAmount'>) =>
  group.minAmount === group.maxAmount ? krw(group.minAmount) : `${krw(group.minAmount)}~${krw(group.maxAmount)}`;
/** 지역명별 금액 한 줄: '제주 ₩3,000 · 도서산간 ₩5,000~₩7,000'. `limit`곳까지 적고 나머지는 '외 N곳'. 받는 지역이 없으면 빈 글. */
export function shippingRegionFeeSummary(rules: readonly ShippingRegionRuleInput[], limit = 6): string {
  const groups = shippingRegionFeeGroups(rules);
  const shown = groups.slice(0, limit).map((group) => `${group.regionLabel} ${feeRange(group)}`);
  return groups.length > limit ? `${shown.join(' · ')} 외 ${groups.length - limit}곳` : shown.join(' · ');
}

/**
 * 목록·배지에 보이는 상태. 저장 값(draft·active·retired)에 적용 기간과 출고지의 기본 택배사를 겹쳐 본다.
 * `unused`는 활성인데 출고지의 기본 택배사가 다르거나 그 택배사가 사용 안 함이라 주문에 쓰이지 않는 설정이다(견적 판정과 같다).
 */
export type ShippingRegionPolicyState = 'draft' | 'scheduled' | 'in_effect' | 'unused' | 'expired' | 'retired';
export const SHIPPING_REGION_STATE_LABELS: Record<ShippingRegionPolicyState, string> = {
  draft: '준비 중', scheduled: '예정', in_effect: '적용 중', unused: '택배사 다름', expired: '기간 끝남', retired: '끝냄',
};
export function shippingRegionPolicyState(policy: Pick<ShippingRegionPolicy, 'status' | 'carrierCode' | 'startsAt' | 'endsAt'>,
  origin: { defaultCarrier: string | null } | undefined, carrierActive: boolean, now: number): ShippingRegionPolicyState {
  if (policy.status !== 'active') return policy.status;
  if (policy.endsAt && Date.parse(policy.endsAt) <= now) return 'expired';
  if (!origin || policy.carrierCode !== origin.defaultCarrier || !carrierActive) return 'unused';
  return policy.startsAt && Date.parse(policy.startsAt) > now ? 'scheduled' : 'in_effect';
}

/**
 * 새 설정을 적용할 때 함께 정리되는 설정. DB `admin_apply_shipping_region_policy`와 같은 판정이다:
 * 같은 출고지·택배사에서 기간이 겹치는 활성 설정이 대상이고, 새 설정이 나중에 시작하면 그 전에 시작한 설정은
 * 끝만 새 시작 시각으로 맞추고(`period_ended`), 나머지는 끝낸다(`retired`).
 */
export interface ShippingRegionReplacement { policy: ShippingRegionPolicy; mode: 'retired' | 'period_ended' }
export function shippingRegionReplacements(candidate: Pick<ShippingRegionPolicyInput, 'originId' | 'carrierCode' | 'startsAt' | 'endsAt'>,
  policies: readonly ShippingRegionPolicy[], selfId: string | null, now: number): ShippingRegionReplacement[] {
  if (!candidate.startsAt) return [];
  const start = Date.parse(candidate.startsAt);
  return policies.filter((policy) => policy.status === 'active' && policy.id !== selfId && policy.originId === candidate.originId
    && policy.carrierCode === candidate.carrierCode && shippingRegionPeriodsOverlap(policy, candidate))
    .sort((a, b) => Date.parse(a.startsAt ?? '') - Date.parse(b.startsAt ?? '') || a.id.localeCompare(b.id))
    .map((policy) => ({ policy, mode: start > now && Boolean(policy.startsAt) && Date.parse(policy.startsAt!) < start ? 'period_ended' : 'retired' }));
}

/**
 * 지금부터 적용되는 변경의 결과 한 줄(적용·금액 바꾸기 확인창이 함께 쓴다). 주문은 만드는 순간의 설정으로 배송비를 정해
 * 저장하고(`private.goods_shipping_fee_for`), 견적이 달라진 주문서는 새 금액을 다시 확인한다 — 이미 만든 주문은 바뀌지 않는다.
 */
export const SHIPPING_REGION_EFFECT_NOW = '지금부터 새 주문에 적용됩니다. 아직 결제하지 않은 장바구니·주문서에도 적용되고, 이미 들어온 주문의 배송비는 그대로입니다.';

/**
 * [저장하고 적용] 확인창에 보이는 글. 저장하는 순간 고객 주문에 적용되므로 출고지·금액·적용 기간과,
 * 지금 적용 중인 설정이 무엇으로 바뀌는지를 말한다. `input.startsAt`은 '저장하면 바로'일 때 지금 시각이다.
 */
export function shippingRegionApplyConfirmMessage({ input, startNow, originName, carrierLabel, replacements, adoption, coveredNow, now, formatDate }: {
  input: ShippingRegionPolicyInput; startNow: boolean; originName: string; carrierLabel: string;
  replacements: readonly ShippingRegionReplacement[];
  /** 이 출고지가 지역별 추가배송비를 쓰기 시작했는가: 아직 안 씀 / 쓰기로 예정됨 / 이미 씀. */
  adoption: 'none' | 'scheduled' | 'started';
  /** 지금 이 출고지에 적용 중인 설정이 있는가. */
  coveredNow: boolean; now: number; formatDate: (value: string) => string;
}): string {
  const startText = startNow || !input.startsAt ? '지금' : formatDate(input.startsAt);
  const immediate = startNow || !input.startsAt || Date.parse(input.startsAt) <= now;
  const blockedRows = input.rules.filter((rule) => rule.disposition === 'unavailable' || rule.disposition === 'manual_review').length;
  const lines = [`${originName} · ${carrierLabel} · ${input.name}`,
    `추가배송비: ${shippingRegionFeeSummary(input.rules) || '받는 지역 없음'}${blockedRows ? ` · 주문받지 않는 지역 ${blockedRows}줄` : ''}`,
    `표에 없는 지역: ${input.unlistedDisposition === 'manual_review' ? '주문받지 않음' : '추가배송비 없음'}`,
    `적용 기간: ${startText}부터${input.endsAt ? ` ${formatDate(input.endsAt)}까지` : ''}`, ''];
  const changes: string[] = [];
  for (const { policy, mode } of replacements) {
    /* 이름 뒤에 조사를 바로 붙이지 않는다(받침에 따라 달라진다) — '설정(이름)은'처럼 쓴다. */
    const name = policy.name || originName;
    if (mode === 'period_ended') changes.push(`지금 설정(${name})은 ${startText}까지 적용하고, 그 뒤로 이 내용을 적용합니다.`);
    else if (policy.endsAt && Date.parse(policy.endsAt) <= now) changes.push(`기간이 끝난 설정(${name})은 ‘${SHIPPING_REGION_STATE_LABELS.retired}’으로 바뀝니다.`);
    else if (policy.startsAt && Date.parse(policy.startsAt) > now) changes.push(`${formatDate(policy.startsAt)}에 시작하려던 설정(${name})은 시작하지 않고 끝냅니다.`);
    else changes.push(`지금 적용 중인 설정(${name})을 끝내고 이 내용으로 바꿉니다.`);
  }
  /* 지금 적용 중인 설정과 지역명별 금액을 견준다. 우편번호 범위만 바뀐 지역은 금액이 같아 여기에 나오지 않는다. */
  const current = replacements.find(({ policy }) => policy.startsAt && Date.parse(policy.startsAt) <= now && !(policy.endsAt && Date.parse(policy.endsAt) <= now));
  if (current) {
    const before = new Map(shippingRegionFeeGroups(current.policy.rules).map((group) => [group.regionLabel, group]));
    const after = new Map(shippingRegionFeeGroups(input.rules).map((group) => [group.regionLabel, group]));
    const diffs = [...[...after.values()].flatMap((group) => {
      const old = before.get(group.regionLabel);
      if (!old) return [`${group.regionLabel} ${feeRange(group)} (새로 받음)`];
      return feeRange(old) === feeRange(group) ? [] : [`${group.regionLabel} ${feeRange(old)} → ${feeRange(group)}`];
    }), ...[...before.values()].filter((group) => !after.has(group.regionLabel)).map((group) => `${group.regionLabel} ${feeRange(group)} → 지역표에서 빠짐`)];
    changes.push(diffs.length ? `금액이 바뀌는 지역: ${diffs.slice(0, 8).join(' · ')}${diffs.length > 8 ? ` 외 ${diffs.length - 8}곳` : ''}` : '지역명별 금액은 지금과 같습니다.');
  }
  if (!replacements.length && adoption === 'none') changes.push(`${originName} 출고지가 지역별 추가배송비를 쓰기 시작합니다. 쓰기 시작한 출고지는 적용 중인 설정이 없으면 새 주문이 막힙니다.`);
  if (!replacements.length && adoption === 'started' && !coveredNow) {
    changes.push(immediate ? `적용 중인 설정이 없어 막혀 있던 ${originName} 출고지의 새 주문을 다시 받습니다.`
      : `${startText}까지는 지금처럼 ${originName} 출고지의 새 주문이 막혀 있습니다.`);
  }
  if (input.unlistedDisposition === 'manual_review') changes.push('지역표에 없는 주소는 주문할 수 없게 됩니다.');
  if (input.endsAt) changes.push(`${formatDate(input.endsAt)} 뒤에 이어서 적용할 설정이 없으면 새 주문이 막힙니다.`);
  if (changes.length) lines.push(...changes, '');
  lines.push(immediate ? SHIPPING_REGION_EFFECT_NOW
    : `${startText}부터 들어오는 주문에 적용됩니다. 그 전에 들어온 주문의 배송비는 그대로입니다.`);
  return lines.join('\n');
}

/** [끝내기] 확인창에 보이는 글. 끝내면 이 출고지의 주문이 어떻게 되는지를 상태별로 말한다. */
export function shippingRegionEndConfirmMessage({ policy, originName, state, formatDate }: {
  policy: Pick<ShippingRegionPolicy, 'name' | 'startsAt'>; originName: string; state: ShippingRegionPolicyState; formatDate: (value: string) => string;
}): string {
  const consequence = state === 'in_effect'
    ? [`${originName} 출고지에 적용 중인 설정이 없어져 지금부터 새 주문이 막힙니다.`,
      '금액이나 지역을 바꾸려는 것이면 끝내지 말고 [이 내용으로 새로 만들기]로 새로 적용해 주세요. 그러면 주문이 막히지 않고 바뀝니다.']
    : state === 'scheduled' && policy.startsAt
      ? ['아직 시작 전이라 지금 들어오는 주문은 그대로입니다.',
        `다만 ${formatDate(policy.startsAt)}부터 적용할 설정이 없어집니다. 그 전에 새로 적용하지 않으면 그때부터 ${originName} 출고지의 새 주문이 막힙니다.`]
      : ['지금 주문에 쓰이지 않는 설정이라 끝내도 주문은 달라지지 않습니다.'];
  return [`${originName} · ${policy.name}`, '', ...consequence, '', '이미 들어온 주문의 배송비는 그대로입니다. 끝낸 설정은 다시 적용할 수 없습니다.'].join('\n');
}

/**
 * 고른 값대로 계산한 주문 예시. 설명 글 대신 "이 지역으로 가면 얼마를 받는지"를 되읽어 준다.
 * 주문 견적(`private.apply_shipping_region_quote`)과 같은 규칙이다. 추가배송비를 받는 줄이 없거나 출고지를 고르지 않았으면 빈 배열.
 */
export function shippingRegionExampleLines(input: ShippingRegionPolicyInput, origin: { baseFee: number; freeThreshold: number | null } | null): string[] {
  const groups = shippingRegionFeeGroups(input.rules);
  const sample = groups.find((group) => group.minAmount > 0) ?? groups[0];
  if (!sample || !origin) return [];
  const fee = sample.minAmount, charges = (value: boolean | null) => value === true;
  const lines = [charges(input.chargePolicyGoods)
    ? `‘출고지 정책 따름’ 상품: 기본 배송비 ${krw(origin.baseFee)} + 추가배송비 ${krw(fee)} = ${krw(origin.baseFee + fee)}`
    : `‘출고지 정책 따름’ 상품: 기본 배송비 ${krw(origin.baseFee)}만`];
  if (origin.freeThreshold !== null && charges(input.chargePolicyGoods)) {
    lines.push(input.waivePolicyThreshold === true ? `‘출고지 정책 따름’ 상품을 ${krw(origin.freeThreshold)} 이상 사면: 배송비 없음`
      : `‘출고지 정책 따름’ 상품을 ${krw(origin.freeThreshold)} 이상 사면: 추가배송비 ${krw(fee)}만`);
  }
  lines.push(charges(input.chargeFreeGoods) ? `‘무료배송’ 상품: 추가배송비 ${krw(fee)}` : '‘무료배송’ 상품: 배송비 없음');
  lines.push(charges(input.chargeIndividualGoods) ? `‘개별 배송비’ 상품: 상품의 개별 배송비 + 추가배송비 ${krw(fee)}` : '‘개별 배송비’ 상품: 상품의 개별 배송비만');
  lines.push(input.feeUnit === 'per_good' ? `추가배송비는 상품 종류마다 받습니다. 두 가지 상품을 함께 주문하면 ${krw(fee * 2)}입니다(같은 상품의 옵션·수량은 한 번).`
    : '이 출고지 상품을 여러 개 함께 주문해도 추가배송비는 한 번만 받습니다.');
  return [`주문 예시 · 배송지 ${sample.regionLabel}(추가배송비 ${krw(fee)})`, ...lines];
}
export const SHIPPING_REGION_TSV_HEADER = '우편번호 시작\t우편번호 끝\t주소 시작문구\t지역명\t처리\t추가배송비';
/** 지역표 입력칸의 예시 글. 머리글 한 줄과 예시 두 줄이다(금액은 예시). */
export const SHIPPING_REGION_TSV_EXAMPLE = [SHIPPING_REGION_TSV_HEADER,
  `63000\t63644\t\t제주\t${REGION_DISPOSITION_LABELS.surcharge}\t3000`, `40200\t40240\t\t울릉도\t${REGION_DISPOSITION_LABELS.surcharge}\t5000`].join('\n');
const SHIPPING_REGION_DISPOSITION_CHOICES = Object.values(REGION_DISPOSITION_LABELS).map((label) => `‘${label}’`).join('·');
export function shippingRegionRulesTsv(rules: readonly ShippingRegionRuleInput[]): string {
  return [SHIPPING_REGION_TSV_HEADER, ...rules.map((rule) => [rule.postalFrom, rule.postalTo, rule.addressPrefix, rule.regionLabel,
    rule.disposition ? REGION_DISPOSITION_LABELS[rule.disposition] : '', rule.amount ?? ''].join('\t'))].join('\n');
}
/**
 * 엑셀에서 복사한 지역표(탭으로 나뉜 6개 열)를 읽는다. 줄 번호는 머리글과 빈 줄을 뺀 순서다(미리보기 표의 번호와 같다).
 * 머리글을 함께 붙여넣었으면 '머리글 아래 N번째 줄'이라고 말해 입력칸에서 그 줄을 바로 찾게 한다.
 * 머리글 줄(첫 칸이 '우편번호…')은 건너뛰고, 처리 이름은 바꾸기 전 이름(추가료 없음·추가료 부과)도 읽는다.
 * 금액은 `3,000`·`3000원`처럼 적어도 읽고, 마지막 금액 칸이 통째로 빠진 5개 열은 금액이 빈 줄로 읽는다.
 */
export function parseShippingRegionRulesTsv(value: string, previous: readonly ShippingRegionRuleInput[] = []): { rules: ShippingRegionRuleInput[]; error?: never } | { error: string; rules?: never } {
  if (value.length > 500000) return { error: '지역표가 너무 깁니다. 500,000자 안으로 줄여 주세요.' };
  const rows = value.replace(/^\uFEFF/, '').split(/\r?\n/).filter((row) => row.trim());
  const hasHeader = Boolean(rows[0]) && /^\s*우편번호/.test(rows[0]);
  if (hasHeader) rows.shift();
  const line = (index: number) => `지역표 ${hasHeader ? '머리글 아래 ' : ''}${index + 1}번째 줄`;
  if (rows.length > MAX_SHIPPING_REGION_RULES) return { error: `지역표는 ${MAX_SHIPPING_REGION_RULES.toLocaleString()}줄까지 넣을 수 있습니다. 지금 ${rows.length.toLocaleString()}줄입니다.` };
  const rules: ShippingRegionRuleInput[] = [];
  for (const [index, row] of rows.entries()) {
    const cells = row.split('\t').map((cell) => cell.trim());
    if (cells.length === 5) cells.push('');
    if (cells.length !== 6) return { error: `${line(index)}은 열이 ${cells.length}개입니다. 엑셀에서 6개 열(우편번호 시작, 우편번호 끝, 주소 시작문구, 지역명, 처리, 추가배송비)을 한꺼번에 복사해 붙여넣어 주세요.` };
    const [postalFrom, postalTo, addressPrefix, regionLabel, label] = cells;
    const fee = cells[5].replace(/[,\s]/g, '').replace(/원$/, '');
    const disposition = label ? (Object.entries(REGION_DISPOSITION_LABELS).find(([, title]) => title === label)?.[0] as RegionRuleDisposition | undefined) ?? PREVIOUS_DISPOSITION_LABELS[label] : '';
    if (disposition === undefined) return { error: `${line(index)}의 처리(${label})를 읽지 못했습니다. ${SHIPPING_REGION_DISPOSITION_CHOICES} 가운데 하나로 적어 주세요.` };
    if (fee && (!/^\d{1,7}$/.test(fee) || Number(fee) > MAX_SHIPPING_REGION_FEE)) return { error: `${line(index)}의 추가배송비(${cells[5]})를 읽지 못했습니다. 0부터 1,000,000까지 숫자만 적어 주세요.` };
    const rule: ShippingRegionRuleInput = { id: null, postalFrom, postalTo, addressPrefix: normalizeShippingAddress(addressPrefix), regionLabel,
      disposition, amount: fee ? Number(fee) : null };
    const previousRule = previous[index];
    if (previousRule && JSON.stringify({ ...previousRule, id: null }) === JSON.stringify(rule)) rule.id = previousRule.id;
    rules.push(rule);
  }
  return { rules };
}
