import { describe, expect, it } from 'vitest';
import { emptyShippingRegionPolicy, parseShippingRegionFees, parseShippingRegionPolicyInput, shippingRegionFeeGroups, parseShippingRegionRulesTsv, shippingRegionPolicyProblems, shippingRegionRulesTsv, shippingRegionExpiryWarnings, type ShippingRegionPolicy, type ShippingRegionPolicyInput } from './shipping-regions';
const draft = emptyShippingRegionPolicy('00000000-0000-4000-8000-000000000001', 'hanjin');
const policy: ShippingRegionPolicyInput = { ...draft, name: '합성 정책', startsAt: '2026-09-10T00:00:00Z', endsAt: null, openEnded: true,
  sourceEvidence: 'TEST-ONLY:synthetic-carrier-reply', feeUnit: 'per_shipment', unlistedDisposition: 'standard', chargePolicyGoods: true,
  waivePolicyThreshold: true, chargeFreeGoods: false, chargeIndividualGoods: true,
  rules: [{ id: null, postalFrom: '10000', postalTo: '10010', addressPrefix: '', regionLabel: '합성 지역', disposition: 'surcharge', amount: 0 }] };

describe('지역 배송 정책 만료 경고', () => {
  const now = Date.parse('2026-09-28T00:00:00Z');
  const active: ShippingRegionPolicy & {originName:string;carrierLabel:string} = { ...policy, originName:'김포',carrierLabel:'한진택배', id: 'policy-1', version: 1, revision: 1, status: 'active',
    confirmedAt: '2026-09-10T00:00:00Z', confirmedBy: 'admin', updatedAt: '2026-09-10T00:00:00Z' };

  it.each([
    ['2026-09-27T23:59:59Z', 'expired'],
    ['2026-09-28T00:00:00Z', 'expired'],
    ['2026-10-05T00:00:00Z', 'expiring'],
  ])('종료 7일 전 경계와 종료 후를 경고한다: %s', (endsAt, status) => {
    expect(shippingRegionExpiryWarnings([{ ...active, endsAt }], now)).toEqual([
      { originName:'김포',carrierLabel:'한진택배', id: 'policy-1', name: '합성 정책', version: 1, endsAt, status },
    ]);
  });

  it('미등록·여유 기간·무기한·초안·퇴역 정책은 경고하지 않는다', () => {
    expect(shippingRegionExpiryWarnings([], now)).toEqual([]);
    for (const item of [active,
      { ...active, endsAt: '2026-10-05T00:00:01Z' },
      { ...active, endsAt: '2026-09-27T00:00:00Z', status: 'draft' as const },
      { ...active, endsAt: '2026-09-27T00:00:00Z', status: 'retired' as const },
    ]) expect(shippingRegionExpiryWarnings([item], now)).toEqual([]);
  });

  it('같은 출고지·택배사의 새 적용 정책이 있으면 이전 만료 경고를 남기지 않는다', () => {
    const old = { ...active, endsAt: '2026-09-27T00:00:00Z' };
    const next = { ...active, id: 'policy-2', version: 2, startsAt: '2026-09-27T00:00:00Z' };
    expect(shippingRegionExpiryWarnings([old, next], now)).toEqual([]);
    expect(shippingRegionExpiryWarnings([old, { ...next, startsAt: '2026-09-29T00:00:00Z' }], now)).toHaveLength(1);
  });

  it('아직 시작하지 않았어도 7일 안에 끝나는 활성 정책을 경고한다', () => {
    expect(shippingRegionExpiryWarnings([{ ...active, startsAt: '2026-09-29T00:00:00Z',
      endsAt: '2026-10-01T00:00:00Z' }], now)).toEqual([
      { originName:'김포',carrierLabel:'한진택배', id: 'policy-1', name: '합성 정책', version: 1, endsAt: '2026-10-01T00:00:00Z', status: 'expiring' },
    ]);
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
    expect(shippingRegionPolicyProblems({ ...policy, rules: [{ ...policy.rules[0], amount: null }] }).join(' ')).toContain('추가료를 꼭 적고(0원이면 0)');
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

describe('지역 추가료 금액 바꾸기', () => {
  it('추가료 부과 줄만 지역명별로 묶어 줄 수와 금액 범위를 센다', () => {
    const row = (regionLabel: string, disposition: '' | 'surcharge' | 'standard', amount: number | null) => ({ id: null, postalFrom: '10000', postalTo: '10000', addressPrefix: '', regionLabel, disposition, amount });
    expect(shippingRegionFeeGroups([row('도서산간', 'surcharge', 1000), row('제주', 'surcharge', 3000), row('도서산간', 'surcharge', 1000),
      row('제주', 'surcharge', 5000), row('표준', 'standard', null), row('미정', 'surcharge', null), row('빈 처리', '', 2000)])).toEqual([
      { regionLabel: '도서산간', rowCount: 2, minAmount: 1000, maxAmount: 1000 },
      { regionLabel: '제주', rowCount: 2, minAmount: 3000, maxAmount: 5000 },
    ]);
  });
  it('지역명별 금액은 0~1,000,000원 정수만 받는다', () => {
    expect(parseShippingRegionFees({ 도서산간: 0, 제주: 1000000 })).toEqual({ 도서산간: 0, 제주: 1000000 });
    for (const value of [{}, null, [], 'x', { 도서산간: -1 }, { 도서산간: 1.5 }, { 도서산간: 1000001 }, { 도서산간: '1000' }, { ' ': 1000 }, { ['가'.repeat(101)]: 1000 }]) {
      expect(parseShippingRegionFees(value)).toBeNull();
    }
  });
});
