import { describe, expect, it } from 'vitest';
import { defaultShippingRegionPolicy, emptyShippingRegionPolicy, parseShippingRegionFees, parseShippingRegionPolicyInput, shippingRegionFeeGroups, parseShippingRegionRulesTsv, shippingRegionPolicyProblems, shippingRegionRulesTsv, shippingRegionExpiryWarnings,
  SHIPPING_REGION_TSV_EXAMPLE, SHIPPING_REGION_TSV_HEADER, shippingRegionApplyConfirmMessage, shippingRegionEndConfirmMessage, shippingRegionExampleLines, shippingRegionFeeSummary, shippingRegionPolicyState, shippingRegionReplacements,
  withShippingRegionPolicyDefaults, type ShippingRegionPolicy, type ShippingRegionPolicyInput } from './shipping-regions';
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
describe('지역별 추가배송비를 적용하려면 채워야 하는 것', () => {
  it('빈 칸은 저장해 둘 수 있지만 기간·받는 상품이 비면 적용하지 않고, 근거는 요구하지 않는다', () => {
    expect(parseShippingRegionPolicyInput(draft)).toEqual(draft);
    expect(shippingRegionPolicyProblems(draft).length).toBeGreaterThan(4);
    expect(shippingRegionPolicyProblems(policy)).toEqual([]);
    expect(shippingRegionPolicyProblems({ ...policy, chargeFreeGoods: null }).join(' ')).toContain('받을 상품');
    /* 2026-11-26: 물류사 회신·계약 근거 칸을 없앴다. 비어 있어도 적용할 수 있고, 저장돼 있던 값은 그대로 오간다. */
    expect(shippingRegionPolicyProblems({ ...policy, sourceEvidence: '' })).toEqual([]);
    expect(parseShippingRegionPolicyInput({ ...policy, sourceEvidence: ' 사내 문서 12 ' })?.sourceEvidence).toBe('사내 문서 12');
  });
  it('새로 만들 때는 대부분이 쓰는 값을 채워 두고, 이미 고른 값은 건드리지 않는다', () => {
    const fresh = defaultShippingRegionPolicy();
    expect(fresh).toMatchObject({ openEnded: true, unlistedDisposition: 'standard', feeUnit: 'per_shipment', chargePolicyGoods: true, waivePolicyThreshold: false, chargeFreeGoods: true, chargeIndividualGoods: true });
    expect(shippingRegionPolicyProblems(fresh).join(' ')).not.toContain('받을 상품');
    expect(withShippingRegionPolicyDefaults({ ...draft, chargeFreeGoods: false, endsAt: '2026-12-01T00:00:00Z', sourceEvidence: '사내 문서 12' }))
      .toMatchObject({ chargeFreeGoods: false, chargePolicyGoods: true, openEnded: false, endsAt: '2026-12-01T00:00:00Z', sourceEvidence: '사내 문서 12' });
  });
  it('0원은 받아 주고, 금액이 빈 줄은 몇 번째 줄의 무엇이 틀렸는지와 고칠 방법을 말한다', () => {
    expect(shippingRegionPolicyProblems({ ...policy, rules: [{ ...policy.rules[0], amount: null }] })).toEqual(['지역표 1번째 줄: 추가배송비 금액이 비어 있습니다. 0원이면 0을 적어 주세요.']);
    expect(shippingRegionPolicyProblems({ ...policy, rules: [policy.rules[0], { ...policy.rules[0], postalFrom: '4524', postalTo: '20000' }] })[0])
      .toBe('지역표 2번째 줄: 우편번호 시작(4524)이 5자리 숫자가 아닙니다. 0으로 시작하는 번호는 앞의 0까지 적어 주세요.');
    expect(shippingRegionPolicyProblems({ ...policy, rules: [{ ...policy.rules[0], postalFrom: '10010', postalTo: '10000' }] })[0]).toContain('우편번호 시작이 끝보다 큽니다');
    expect(shippingRegionPolicyProblems({ ...policy, rules: [{ ...policy.rules[0], regionLabel: ' ' }] })[0]).toContain('지역명이 비어 있습니다');
    expect(shippingRegionPolicyProblems({ ...policy, rules: [{ ...policy.rules[0], disposition: '', amount: null }] })[0]).toContain('처리가 비어 있습니다');
    expect(shippingRegionPolicyProblems({ ...policy, rules: [{ ...policy.rules[0], disposition: 'unavailable', amount: null }] })).toEqual([]);
    expect(shippingRegionPolicyProblems({ ...policy, rules: [{ ...policy.rules[0], disposition: 'standard', amount: 0 }] })[0]).toContain('‘추가배송비 없음’ 줄에는 금액을 적지 않습니다');
  });
  it('구간 양 끝과 주소 단어 경계를 기준으로 모호한 중첩만 차단한다', () => {
    const first = policy.rules[0];
    expect(shippingRegionPolicyProblems({ ...policy, rules: [first, { ...first, postalFrom: '10010', postalTo: '10020' }] }).join(' ')).toContain('겹칩니다');
    expect(shippingRegionPolicyProblems({ ...policy, rules: [first, { ...first, postalFrom: '10011', postalTo: '10020' }] })).toEqual([]);
    expect(shippingRegionPolicyProblems({ ...policy, rules: [{ ...first, addressPrefix: '합성시 검증구' }, { ...first, addressPrefix: '합성시 검증구역' }] })).toEqual([]);
    expect(shippingRegionPolicyProblems({ ...policy, rules: [{ ...first, addressPrefix: '합성시' }, { ...first, addressPrefix: '합성시 검증구' }] }).join(' ')).toContain('겹칩니다');
  });
  it('지역표가 비면 받는 지역이 없다고 골라야 하고, 둘을 함께 고를 수는 없다', () => {
    expect(shippingRegionPolicyProblems({ ...policy, rules: [] })).toEqual(['지역표를 붙여넣거나 ‘추가배송비를 받는 지역 없음’을 골라 주세요.']);
    expect(shippingRegionPolicyProblems({ ...policy, rules: [], noRulesConfirmed: true })).toEqual([]);
    expect(shippingRegionPolicyProblems({ ...policy, noRulesConfirmed: true }).join(' ')).toContain('고를 수 없습니다');
  });
  it('엑셀 붙여넣기는 0으로 시작하는 우편번호와 빈 금액·0원, 고치지 않은 줄의 번호를 그대로 둔다', () => {
    const rules = [{ ...policy.rules[0], id: '00000000-0000-4000-8000-000000000002', postalFrom: '00100', postalTo: '00110' }];
    expect(shippingRegionRulesTsv(rules).split('\n')).toEqual([SHIPPING_REGION_TSV_HEADER, '00100\t00110\t\t합성 지역\t추가배송비 받음\t0']);
    expect(parseShippingRegionRulesTsv(shippingRegionRulesTsv(rules), rules)).toEqual({ rules });
    expect(parseShippingRegionRulesTsv('00100\t00110\t\t합성 지역\t추가배송비 받음\t').rules?.[0].amount).toBeNull();
    /* 입력칸의 예시 글도 그대로 붙여넣으면 읽힌다. */
    expect(parseShippingRegionRulesTsv(SHIPPING_REGION_TSV_EXAMPLE).rules).toHaveLength(2);
  });
  it('이름을 바꾸기 전의 머리글·처리 이름과 흔한 금액 표기도 읽는다', () => {
    const old = '우편번호 시작\t우편번호 끝\t주소 시작문구\t지역명\t처리\t추가료\n63000\t63644\t\t제주\t추가료 부과\t3,000원\n40200\t40240\t\t울릉도\t추가료 없음';
    expect(parseShippingRegionRulesTsv(old).rules).toEqual([
      { id: null, postalFrom: '63000', postalTo: '63644', addressPrefix: '', regionLabel: '제주', disposition: 'surcharge', amount: 3000 },
      { id: null, postalFrom: '40200', postalTo: '40240', addressPrefix: '', regionLabel: '울릉도', disposition: 'standard', amount: null },
    ]);
  });
  it('읽지 못한 줄은 몇 번째 줄의 무엇이 틀렸는지와 고칠 방법을 말한다', () => {
    expect(parseShippingRegionRulesTsv('100,110,가나다').error).toBe('지역표 1번째 줄은 열이 1개입니다. 엑셀에서 6개 열(우편번호 시작, 우편번호 끝, 주소 시작문구, 지역명, 처리, 추가배송비)을 한꺼번에 복사해 붙여넣어 주세요.');
    expect(parseShippingRegionRulesTsv(`${SHIPPING_REGION_TSV_HEADER}\n\n00100\t00110\t\t합성 지역\t추가배송비 받음\t0\n00200\t00210\t\t합성 지역\t알 수 없음\t0`).error)
      .toBe('지역표 머리글 아래 2번째 줄의 처리(알 수 없음)를 읽지 못했습니다. ‘추가배송비 없음’·‘추가배송비 받음’·‘배송 불가’·‘개별 확인 필요’ 가운데 하나로 적어 주세요.');
    expect(parseShippingRegionRulesTsv('00100\t00110\t\t합성 지역\t추가배송비 받음\t삼천').error).toBe('지역표 1번째 줄의 추가배송비(삼천)를 읽지 못했습니다. 0부터 1,000,000까지 숫자만 적어 주세요.');
    expect(parseShippingRegionRulesTsv('00100\t00110\t\t합성 지역\t추가배송비 받음\t1000001').error).toContain('추가배송비(1000001)를');
  });
});

describe('한 번에 저장하고 적용하기', () => {
  const NOW = Date.parse('2026-11-26T00:00:00Z');
  const fmt = (value: string) => `<${value.slice(0, 16)}>`;
  const row = (regionLabel: string, amount: number | null, disposition: 'surcharge' | 'unavailable' | 'standard' = 'surcharge', postalFrom = '10000') =>
    ({ id: null, postalFrom, postalTo: postalFrom, addressPrefix: '', regionLabel, disposition, amount });
  const saved = (id: string, patch: Partial<ShippingRegionPolicy> = {}): ShippingRegionPolicy => ({ ...policy, name: `설정 ${id}`, id, version: 1, revision: 1, status: 'active',
    confirmedAt: '2026-09-10T00:00:00Z', confirmedBy: '관리자', updatedAt: '2026-09-10T00:00:00Z', ...patch });
  const origin = { defaultCarrier: 'hanjin' };

  it('목록의 상태는 저장 값에 적용 기간과 출고지의 기본 택배사를 겹쳐 본다', () => {
    expect(shippingRegionPolicyState(saved('a', { status: 'draft' }), origin, true, NOW)).toBe('draft');
    expect(shippingRegionPolicyState(saved('a'), origin, true, NOW)).toBe('in_effect');
    expect(shippingRegionPolicyState(saved('a', { startsAt: '2026-12-01T00:00:00Z' }), origin, true, NOW)).toBe('scheduled');
    expect(shippingRegionPolicyState(saved('a', { endsAt: '2026-11-26T00:00:00Z', openEnded: false }), origin, true, NOW)).toBe('expired');
    expect(shippingRegionPolicyState(saved('a', { carrierCode: 'cj' }), origin, true, NOW)).toBe('unused');
    expect(shippingRegionPolicyState(saved('a'), origin, false, NOW)).toBe('unused');
    expect(shippingRegionPolicyState(saved('a', { status: 'retired' }), origin, true, NOW)).toBe('retired');
  });

  it('함께 바뀌는 설정: 지금부터면 끝내고, 나중에 시작하면 먼저 시작한 설정은 끝만 맞춘다', () => {
    const current = saved('a'), scheduled = saved('b', { startsAt: '2026-12-10T00:00:00Z' });
    const others = [current, saved('c', { carrierCode: 'cj' }), saved('d', { originId: '00000000-0000-4000-8000-000000000009' }), saved('e', { status: 'retired' }), saved('f', { status: 'draft' })];
    const candidate = { originId: policy.originId, carrierCode: 'hanjin', endsAt: null };
    expect(shippingRegionReplacements({ ...candidate, startsAt: '2026-11-26T00:00:00Z' }, others, null, NOW)).toEqual([{ policy: current, mode: 'retired' }]);
    expect(shippingRegionReplacements({ ...candidate, startsAt: '2026-12-01T00:00:00Z' }, others, null, NOW)).toEqual([{ policy: current, mode: 'period_ended' }]);
    /* 새 시작 뒤에 시작하려던 설정은 끝낸다. 적용하려는 설정 자신과 기간이 겹치지 않는 설정은 대상이 아니다. */
    expect(shippingRegionReplacements({ ...candidate, startsAt: '2026-12-01T00:00:00Z' }, [{ ...current, endsAt: '2026-12-10T00:00:00Z', openEnded: false }, scheduled], null, NOW))
      .toEqual([{ policy: { ...current, endsAt: '2026-12-10T00:00:00Z', openEnded: false }, mode: 'period_ended' }, { policy: scheduled, mode: 'retired' }]);
    expect(shippingRegionReplacements({ ...candidate, startsAt: '2026-11-26T00:00:00Z' }, [current], 'a', NOW)).toEqual([]);
    expect(shippingRegionReplacements({ ...candidate, startsAt: '2026-11-26T00:00:00Z', endsAt: '2026-12-01T00:00:00Z' }, [scheduled], null, NOW)).toEqual([]);
    expect(shippingRegionReplacements({ ...candidate, startsAt: null }, others, null, NOW)).toEqual([]);
  });

  it('적용 확인창은 출고지·금액·적용 기간과 지금 적용 중인 설정이 무엇으로 바뀌는지를 말한다', () => {
    const current = saved('a', { name: '기본 지역표', rules: [row('제주', 3000), row('도서산간', 5000, 'surcharge', '20000'), row('울릉도', 7000, 'surcharge', '30000')] });
    const input: ShippingRegionPolicyInput = { ...policy, name: '겨울 지역표', startsAt: '2026-11-26T00:00:00Z',
      rules: [row('제주', 4000), row('도서산간', 5000, 'surcharge', '20000'), row('독도', 9000, 'surcharge', '40000'), row('섬', null, 'unavailable', '50000')] };
    const message = shippingRegionApplyConfirmMessage({ input, startNow: true, originName: '김포', carrierLabel: '한진택배',
      replacements: [{ policy: current, mode: 'retired' }], adoption: 'started', coveredNow: true, now: NOW, formatDate: fmt });
    expect(message.split('\n')).toEqual(['김포 · 한진택배 · 겨울 지역표', '추가배송비: 제주 ₩4,000 · 도서산간 ₩5,000 · 독도 ₩9,000 · 주문받지 않는 지역 1줄', '표에 없는 지역: 추가배송비 없음', '적용 기간: 지금부터', '',
      '지금 적용 중인 설정(기본 지역표)을 끝내고 이 내용으로 바꿉니다.', '금액이 바뀌는 지역: 제주 ₩3,000 → ₩4,000 · 독도 ₩9,000 (새로 받음) · 울릉도 ₩7,000 → 지역표에서 빠짐', '',
      '지금부터 새 주문에 적용됩니다. 아직 결제하지 않은 장바구니·주문서에도 적용되고, 이미 들어온 주문의 배송비는 그대로입니다.']);
  });

  it('나중에 시작하는 설정은 이전 설정이 언제까지 쓰이는지와 끝난 뒤의 위험을 말한다', () => {
    const current = saved('a', { name: '기본 지역표' }), next = saved('b', { name: '예정 지역표', startsAt: '2026-12-20T00:00:00Z' });
    const input: ShippingRegionPolicyInput = { ...policy, name: '12월 지역표', startsAt: '2026-12-01T00:00:00Z', endsAt: '2026-12-31T00:00:00Z', openEnded: false, unlistedDisposition: 'manual_review' };
    const message = shippingRegionApplyConfirmMessage({ input, startNow: false, originName: '김포', carrierLabel: '한진택배',
      replacements: [{ policy: current, mode: 'period_ended' }, { policy: next, mode: 'retired' }], adoption: 'started', coveredNow: true, now: NOW, formatDate: fmt });
    expect(message).toContain('적용 기간: <2026-12-01T00:00>부터 <2026-12-31T00:00>까지');
    expect(message).toContain('지금 설정(기본 지역표)은 <2026-12-01T00:00>까지 적용하고, 그 뒤로 이 내용을 적용합니다.');
    expect(message).toContain('<2026-12-20T00:00>에 시작하려던 설정(예정 지역표)은 시작하지 않고 끝냅니다.');
    expect(message).toContain('지역명별 금액은 지금과 같습니다.');
    expect(message).toContain('표에 없는 지역: 주문받지 않음');
    expect(message).toContain('지역표에 없는 주소는 주문할 수 없게 됩니다.');
    expect(message).toContain('<2026-12-31T00:00> 뒤에 이어서 적용할 설정이 없으면 새 주문이 막힙니다.');
    expect(message.split('\n').at(-1)).toBe('<2026-12-01T00:00>부터 들어오는 주문에 적용됩니다. 그 전에 들어온 주문의 배송비는 그대로입니다.');
    expect(message).not.toContain('지금부터 새 주문에 적용됩니다');
  });

  it('처음 쓰는 출고지와 주문이 막혀 있던 출고지는 그 사실을 말한다', () => {
    const base = { input: { ...policy, startsAt: '2026-11-26T00:00:00Z', rules: [], noRulesConfirmed: true }, originName: '김포', carrierLabel: '한진택배', replacements: [], now: NOW, formatDate: fmt };
    const first = shippingRegionApplyConfirmMessage({ ...base, startNow: true, adoption: 'none', coveredNow: false });
    expect(first).toContain('추가배송비: 받는 지역 없음');
    expect(first).toContain('김포 출고지가 지역별 추가배송비를 쓰기 시작합니다. 쓰기 시작한 출고지는 적용 중인 설정이 없으면 새 주문이 막힙니다.');
    expect(shippingRegionApplyConfirmMessage({ ...base, startNow: true, adoption: 'started', coveredNow: false })).toContain('적용 중인 설정이 없어 막혀 있던 김포 출고지의 새 주문을 다시 받습니다.');
    expect(shippingRegionApplyConfirmMessage({ ...base, input: { ...base.input, startsAt: '2026-12-01T00:00:00Z' }, startNow: false, adoption: 'started', coveredNow: false }))
      .toContain('<2026-12-01T00:00>까지는 지금처럼 김포 출고지의 새 주문이 막혀 있습니다.');
    expect(shippingRegionApplyConfirmMessage({ ...base, startNow: true, adoption: 'started', coveredNow: true })).not.toContain('막혀');
  });

  it('끝내기 확인창은 이 출고지의 주문이 어떻게 되는지를 상태별로 말한다', () => {
    const target = { name: '기본 지역표', startsAt: '2026-12-01T00:00:00Z' };
    const inEffect = shippingRegionEndConfirmMessage({ policy: target, originName: '김포', state: 'in_effect', formatDate: fmt });
    expect(inEffect.split('\n')[0]).toBe('김포 · 기본 지역표');
    expect(inEffect).toContain('김포 출고지에 적용 중인 설정이 없어져 지금부터 새 주문이 막힙니다.');
    expect(inEffect).toContain('[이 내용으로 새로 만들기]');
    const scheduled = shippingRegionEndConfirmMessage({ policy: target, originName: '김포', state: 'scheduled', formatDate: fmt });
    expect(scheduled).toContain('아직 시작 전이라 지금 들어오는 주문은 그대로입니다.');
    expect(scheduled).toContain('<2026-12-01T00:00>부터 적용할 설정이 없어집니다.');
    for (const state of ['expired', 'unused'] as const) {
      expect(shippingRegionEndConfirmMessage({ policy: target, originName: '김포', state, formatDate: fmt })).toContain('지금 주문에 쓰이지 않는 설정이라 끝내도 주문은 달라지지 않습니다.');
    }
    expect(scheduled).toContain('끝낸 설정은 다시 적용할 수 없습니다.');
  });

  it('고른 값대로 주문 예시를 되읽는다', () => {
    const input: ShippingRegionPolicyInput = { ...defaultShippingRegionPolicy(), rules: [row('무료 구간', 0), row('제주', 3000, 'surcharge', '20000')] };
    expect(shippingRegionExampleLines(input, { baseFee: 3000, freeThreshold: 50000 })).toEqual(['주문 예시 · 배송지 제주(추가배송비 ₩3,000)',
      '‘출고지 정책 따름’ 상품: 기본 배송비 ₩3,000 + 추가배송비 ₩3,000 = ₩6,000', '‘출고지 정책 따름’ 상품을 ₩50,000 이상 사면: 추가배송비 ₩3,000만',
      '‘무료배송’ 상품: 추가배송비 ₩3,000', '‘개별 배송비’ 상품: 상품의 개별 배송비 + 추가배송비 ₩3,000', '이 출고지 상품을 여러 개 함께 주문해도 추가배송비는 한 번만 받습니다.']);
    expect(shippingRegionExampleLines({ ...input, chargePolicyGoods: false, chargeFreeGoods: false, chargeIndividualGoods: false, feeUnit: 'per_good' }, { baseFee: 3000, freeThreshold: 50000 })).toEqual(['주문 예시 · 배송지 제주(추가배송비 ₩3,000)',
      '‘출고지 정책 따름’ 상품: 기본 배송비 ₩3,000만', '‘무료배송’ 상품: 배송비 없음', '‘개별 배송비’ 상품: 상품의 개별 배송비만',
      '추가배송비는 상품 종류마다 받습니다. 두 가지 상품을 함께 주문하면 ₩6,000입니다(같은 상품의 옵션·수량은 한 번).']);
    expect(shippingRegionExampleLines({ ...input, waivePolicyThreshold: true }, { baseFee: 3000, freeThreshold: 50000 })[2]).toBe('‘출고지 정책 따름’ 상품을 ₩50,000 이상 사면: 배송비 없음');
    expect(shippingRegionExampleLines(input, null)).toEqual([]);
    expect(shippingRegionExampleLines({ ...input, rules: [] }, { baseFee: 3000, freeThreshold: null })).toEqual([]);
  });

  it('지역명별 금액은 여섯 곳까지 적고 나머지는 수로 줄인다', () => {
    expect(shippingRegionFeeSummary([row('제주', 3000), row('제주', 5000, 'surcharge', '10001'), row('도서산간', 5000, 'surcharge', '20000'), row('섬', null, 'unavailable', '30000')])).toBe('제주 ₩3,000~₩5,000 · 도서산간 ₩5,000');
    expect(shippingRegionFeeSummary(Array.from({ length: 8 }, (_, index) => row(`지역${index}`, 1000, 'surcharge', String(10000 + index))))).toBe('지역0 ₩1,000 · 지역1 ₩1,000 · 지역2 ₩1,000 · 지역3 ₩1,000 · 지역4 ₩1,000 · 지역5 ₩1,000 외 2곳');
    expect(shippingRegionFeeSummary([])).toBe('');
  });
});

describe('추가배송비 금액 바꾸기', () => {
  it('추가배송비를 받는 줄만 지역명별로 묶어 줄 수와 금액 범위를 센다', () => {
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
