import { describe, expect, it } from 'vitest';
import { emptyShippingRegionPolicy, parseShippingRegionPolicyInput, parseShippingRegionRulesTsv, shippingRegionPolicyProblems, shippingRegionRulesTsv, shippingRegionExpiryWarnings, type ShippingRegionPolicy, type ShippingRegionPolicyInput } from './shipping-regions';
const draft = emptyShippingRegionPolicy('00000000-0000-4000-8000-000000000001', 'hanjin');
const policy: ShippingRegionPolicyInput = { ...draft, name: '합성 정책', startsAt: '2026-09-10T00:00:00Z', endsAt: null, openEnded: true,
  sourceEvidence: 'TEST-ONLY:synthetic-carrier-reply', feeUnit: 'per_shipment', unlistedDisposition: 'standard', chargePolicyGoods: true,
  waivePolicyThreshold: true, chargeFreeGoods: false, chargeIndividualGoods: true,
  rules: [{ id: null, postalFrom: '10000', postalTo: '10010', addressPrefix: '', regionLabel: '합성 지역', disposition: 'surcharge', amount: 0 }] };

describe('지역 배송 정책 만료 경고', () => {
  const now = Date.parse('2026-09-28T00:00:00Z');
  const active: ShippingRegionPolicy = { ...policy, id: 'policy-1', version: 1, revision: 1, status: 'active',
    confirmedAt: '2026-09-10T00:00:00Z', confirmedBy: 'admin', updatedAt: '2026-09-10T00:00:00Z' };

  it.each([
    ['2026-09-27T23:59:59Z', 'expired'],
    ['2026-09-28T00:00:00Z', 'expired'],
    ['2026-10-05T00:00:00Z', 'expiring'],
  ])('종료 7일 전 경계와 종료 후를 경고한다: %s', (endsAt, status) => {
    expect(shippingRegionExpiryWarnings([{ ...active, openEnded: false, endsAt }], now)).toEqual([
      { id: 'policy-1', name: '합성 정책', version: 1, endsAt, status },
    ]);
  });

  it('미등록·여유 기간·무기한·초안·퇴역 정책은 경고하지 않는다', () => {
    expect(shippingRegionExpiryWarnings([], now)).toEqual([]);
    for (const item of [active,
      { ...active, endsAt: '2026-10-05T00:00:01Z', openEnded: false },
      { ...active, endsAt: '2026-09-27T00:00:00Z', status: 'draft' as const },
      { ...active, endsAt: '2026-09-27T00:00:00Z', status: 'retired' as const },
    ]) expect(shippingRegionExpiryWarnings([item], now)).toEqual([]);
  });

  it('같은 출고지·택배사의 새 적용 정책이 있으면 이전 만료 경고를 남기지 않는다', () => {
    const old = { ...active, endsAt: '2026-09-27T00:00:00Z', openEnded: false };
    const next = { ...active, id: 'policy-2', version: 2, startsAt: '2026-09-27T00:00:00Z' };
    expect(shippingRegionExpiryWarnings([old, next], now)).toEqual([]);
    expect(shippingRegionExpiryWarnings([old, { ...next, startsAt: '2026-09-29T00:00:00Z' }], now)).toHaveLength(1);
  });
});
describe('지역 배송 정책 초안과 활성화', () => {
  it('공란은 초안으로 보존하되 확인되지 않은 기간·근거·무료 관계로 활성화하지 않는다', () => {
    expect(parseShippingRegionPolicyInput(draft)).toEqual(draft);
    expect(shippingRegionPolicyProblems(draft).length).toBeGreaterThan(4);
    expect(shippingRegionPolicyProblems(policy)).toEqual([]);
    expect(shippingRegionPolicyProblems({ ...policy, chargeFreeGoods: null }).join(' ')).toContain('무료');
    expect(shippingRegionPolicyProblems({ ...policy, sourceEvidence: '\u00a0' }).join(' ')).toContain('근거');
  });
  it('명시적 0원을 허용하며 추가료 부과의 미입력을 거절한다', () => {
    expect(shippingRegionPolicyProblems({ ...policy, rules: [{ ...policy.rules[0], amount: null }] }).join(' ')).toContain('미입력');
    expect(shippingRegionPolicyProblems({ ...policy, rules: [{ ...policy.rules[0], disposition: 'unavailable', amount: null }] })).toEqual([]);
    expect(shippingRegionPolicyProblems({ ...policy, rules: [{ ...policy.rules[0], disposition: 'standard', amount: 0 }] })).not.toEqual([]);
  });
  it('구간 양 끝과 주소 단어 경계를 기준으로 모호한 중첩만 차단한다', () => {
    const first = policy.rules[0];
    expect(shippingRegionPolicyProblems({ ...policy, rules: [first, { ...first, postalFrom: '10010', postalTo: '10020' }] }).join(' ')).toContain('겹칩니다');
    expect(shippingRegionPolicyProblems({ ...policy, rules: [first, { ...first, postalFrom: '10011', postalTo: '10020' }] })).toEqual([]);
    expect(shippingRegionPolicyProblems({ ...policy, rules: [{ ...first, addressPrefix: '합성시 검증구' }, { ...first, addressPrefix: '합성시 검증구역' }] })).toEqual([]);
    expect(shippingRegionPolicyProblems({ ...policy, rules: [{ ...first, addressPrefix: '합성시' }, { ...first, addressPrefix: '합성시 검증구' }] }).join(' ')).toContain('겹칩니다');
  });
  it('표가 비었을 때도 실제 예외 없음 확인을 별도로 요구한다', () => {
    expect(shippingRegionPolicyProblems({ ...policy, rules: [] }).join(' ')).toContain('실제 회신');
    expect(shippingRegionPolicyProblems({ ...policy, rules: [], noRulesConfirmed: true })).toEqual([]);
    expect(shippingRegionPolicyProblems({ ...policy, noRulesConfirmed: true }).join(' ')).toContain('해제');
  });
  it('스프레드시트 붙여넣기는 우편번호의 선행 0과 공란/0원·수정하지 않은 rule id를 보존한다', () => {
    const rules = [{ ...policy.rules[0], id: '00000000-0000-4000-8000-000000000002', postalFrom: '00100', postalTo: '00110' }];
    expect(parseShippingRegionRulesTsv(shippingRegionRulesTsv(rules), rules)).toEqual({ rules });
    expect(parseShippingRegionRulesTsv('00100\t00110\t\t합성 지역\t추가료 부과\t').rules?.[0].amount).toBeNull();
    expect(parseShippingRegionRulesTsv('100,110,가나다').error).toContain('6개 열');
    expect(parseShippingRegionRulesTsv('00100\t00110\t\t합성 지역\t알 수 없음\t0').error).toContain('처리');
  });
});
