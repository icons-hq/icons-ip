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
export const REGION_DISPOSITION_LABELS: Record<RegionRuleDisposition, string> = {
  standard: '추가료 없음', surcharge: '추가료 부과', unavailable: '배송 불가', manual_review: '개별 확인 필요',
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const booleanOrNull = (value: unknown): value is boolean | null => value === null || typeof value === 'boolean';
const instantOrNull = (value: unknown): value is string | null => value === null || (typeof value === 'string' && Number.isFinite(Date.parse(value)));
function text(value: unknown, max: number): value is string { return typeof value === 'string' && value.length <= max && !/[\u0000-\u0008\u000e-\u001f\u007f]/.test(value); }
export function emptyShippingRegionPolicy(originId = '', carrierCode = ''): ShippingRegionPolicyInput {
  return { originId, carrierCode, name: '', startsAt: null, endsAt: null, openEnded: null, sourceEvidence: '',
    unlistedDisposition: null, feeUnit: null, chargePolicyGoods: null, waivePolicyThreshold: null, chargeFreeGoods: null,
    chargeIndividualGoods: null, noRulesConfirmed: false, rules: [] };
}
export function parseShippingRegionPolicyInput(value: unknown): ShippingRegionPolicyInput | null {
  if (!object(value) || typeof value.originId !== 'string' || !UUID.test(value.originId)
    || !text(value.carrierCode, 80) || !value.carrierCode.trim() || !text(value.name, 100)
    || !instantOrNull(value.startsAt) || !instantOrNull(value.endsAt) || !booleanOrNull(value.openEnded)
    || !text(value.sourceEvidence, 2000) || ![null, 'standard', 'manual_review'].includes(value.unlistedDisposition as null)
    || ![null, 'per_shipment', 'per_good'].includes(value.feeUnit as null)
    || !['chargePolicyGoods', 'waivePolicyThreshold', 'chargeFreeGoods', 'chargeIndividualGoods'].every((key) => booleanOrNull(value[key]))
    || typeof value.noRulesConfirmed !== 'boolean' || !Array.isArray(value.rules) || value.rules.length > MAX_SHIPPING_REGION_RULES) return null;
  const ids = new Set<string>(); const rules: ShippingRegionRuleInput[] = [];
  for (const row of value.rules) {
    if (!object(row) || !(row.id === null || (typeof row.id === 'string' && UUID.test(row.id) && !ids.has(row.id)))
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
  if (!input || !object(value) || typeof value.id !== 'string' || !UUID.test(value.id)
    || !Number.isSafeInteger(value.version) || Number(value.version) < 1 || !Number.isSafeInteger(value.revision) || Number(value.revision) < 1
    || !['draft', 'active', 'retired'].includes(String(value.status)) || !instantOrNull(value.confirmedAt)
    || !(value.confirmedBy === null || typeof value.confirmedBy === 'string')
    || typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt))) return null;
  if (value.status !== 'draft' && (value.confirmedAt === null || value.confirmedBy === null)) return null;
  return { ...input, id: value.id, version: Number(value.version), revision: Number(value.revision), status: value.status as ShippingRegionPolicy['status'],
    confirmedAt: value.confirmedAt, confirmedBy: value.confirmedBy as string | null, updatedAt: value.updatedAt };
}
export function shippingRegionPolicyProblems(policy: ShippingRegionPolicyInput): string[] {
  const problems: string[] = [];
  if (!policy.name.trim()) problems.push('정책 이름을 입력해주세요.');
  if (!policy.sourceEvidence.trim()) problems.push('실제 물류사 회신·계약 문서를 찾을 수 있는 근거 참조를 입력해주세요.');
  if (!policy.startsAt) problems.push('적용 시작 일시를 입력해주세요.');
  if (policy.openEnded === null || (policy.openEnded === false && !policy.endsAt) || (policy.openEnded && policy.endsAt)) problems.push('적용 종료 일시 또는 무기한 적용을 명시해주세요.');
  if (policy.startsAt && policy.endsAt && Date.parse(policy.startsAt) >= Date.parse(policy.endsAt)) problems.push('종료 일시는 시작 일시보다 뒤여야 합니다.');
  if (!policy.unlistedDisposition) problems.push('표에 없는 지역의 처리 방법을 확인해주세요.');
  if (!policy.feeUnit || [policy.chargePolicyGoods, policy.waivePolicyThreshold, policy.chargeFreeGoods, policy.chargeIndividualGoods].includes(null)) {
    problems.push('추가료 부과 단위와 정책·무료·개별 배송 상품의 적용 관계를 모두 확인해주세요.');
  }
  if (!policy.rules.length && !policy.noRulesConfirmed) problems.push('지역표를 입력하거나, 예외 지역이 없다는 실제 회신을 확인해주세요.');
  if (policy.rules.length && policy.noRulesConfirmed) problems.push('지역표가 있으므로 예외 지역 없음 확인을 해제해주세요.');
  for (const [index, rule] of policy.rules.entries()) {
    if (!/^\d{5}$/.test(rule.postalFrom) || !/^\d{5}$/.test(rule.postalTo) || rule.postalFrom > rule.postalTo
      || !rule.regionLabel.trim() || !rule.disposition || (rule.disposition === 'surcharge' ? rule.amount === null : rule.amount !== null)) {
      problems.push(`지역표 ${index + 1}행의 우편번호 구간·지역명·처리·추가료를 확인해주세요. 추가료 부과 행의 0원과 미입력은 구분됩니다.`);
    }
    for (let before = 0; before < index; before++) {
      const other = policy.rules[before];
      if (rule.postalFrom && rule.postalTo && other.postalFrom && other.postalTo && rule.postalFrom <= other.postalTo && other.postalFrom <= rule.postalTo
        && (!rule.addressPrefix || !other.addressPrefix || rule.addressPrefix === other.addressPrefix
          || rule.addressPrefix.startsWith(`${other.addressPrefix} `) || other.addressPrefix.startsWith(`${rule.addressPrefix} `))) {
        problems.push(`지역표 ${before + 1}행과 ${index + 1}행의 적용 범위가 겹칩니다.`); break;
      }
    }
    if (problems.length >= 25) { problems.push('표의 나머지 행도 같은 기준으로 확인해주세요.'); break; }
  }
  return problems;
}
export const SHIPPING_REGION_TSV_HEADER = '우편번호 시작\t우편번호 끝\t주소 시작문구\t지역명\t처리\t추가료';
export function shippingRegionRulesTsv(rules: readonly ShippingRegionRuleInput[]): string {
  return [SHIPPING_REGION_TSV_HEADER, ...rules.map((rule) => [rule.postalFrom, rule.postalTo, rule.addressPrefix, rule.regionLabel,
    rule.disposition ? REGION_DISPOSITION_LABELS[rule.disposition] : '', rule.amount ?? ''].join('\t'))].join('\n');
}
export function parseShippingRegionRulesTsv(value: string, previous: readonly ShippingRegionRuleInput[] = []): { rules: ShippingRegionRuleInput[]; error?: never } | { error: string; rules?: never } {
  if (value.length > 500000) return { error: '지역표는 500,000자 이내로 입력해주세요.' };
  const rows = value.replace(/^\uFEFF/, '').split(/\r?\n/).filter((row) => row.trim());
  if (rows[0] === SHIPPING_REGION_TSV_HEADER) rows.shift();
  if (rows.length > MAX_SHIPPING_REGION_RULES) return { error: `지역표는 ${MAX_SHIPPING_REGION_RULES.toLocaleString()}행 이내로 입력해주세요.` };
  const rules: ShippingRegionRuleInput[] = [];
  for (const [index, row] of rows.entries()) {
    const cells = row.split('\t').map((cell) => cell.trim());
    if (cells.length !== 6) return { error: `${index + 1}행은 탭으로 구분한 6개 열이어야 합니다.` };
    const [postalFrom, postalTo, addressPrefix, regionLabel, label, fee] = cells;
    const disposition = label ? Object.entries(REGION_DISPOSITION_LABELS).find(([, title]) => title === label)?.[0] as RegionRuleDisposition | undefined : '';
    if (disposition === undefined || (fee && !/^\d{1,7}$/.test(fee)) || (fee && Number(fee) > 1000000)) return { error: `${index + 1}행의 처리 문구·추가료를 확인해주세요.` };
    const rule: ShippingRegionRuleInput = { id: null, postalFrom, postalTo, addressPrefix: normalizeShippingAddress(addressPrefix), regionLabel,
      disposition, amount: fee ? Number(fee) : null };
    const previousRule = previous[index];
    if (previousRule && JSON.stringify({ ...previousRule, id: null }) === JSON.stringify(rule)) rule.id = previousRule.id;
    rules.push(rule);
  }
  return { rules };
}
