import { describe, expect, it } from 'vitest';
import { defaultShippingRegionPolicy, emptyShippingRegionPolicy, parseShippingRegionFeeCell, parseShippingRegionFees, parseShippingRegionPolicyInput, shippingRegionFeeGroups, parseShippingRegionRulesTsv, shippingRegionPolicyProblems, shippingRegionRulesTsv, shippingRegionExpiryWarnings,
  SHIPPING_REGION_CARRIER_OFF_LABEL, SHIPPING_REGION_PERIOD_PROBLEM, SHIPPING_REGION_TSV_EXAMPLE, SHIPPING_REGION_TSV_HEADER, shippingRegionApplyConfirmMessage, shippingRegionClockAfterApply, shippingRegionEndConfirmMessage, shippingRegionExampleLines, shippingRegionFeeSummary,
  shippingRegionBlockedSentence, shippingRegionBlockReasonText, shippingRegionOriginOverview, shippingRegionOriginStatus,
  shippingRegionPolicyInEffect, shippingRegionPolicyState, shippingRegionReplacements, shippingRegionStateLabel,
  withShippingRegionPolicyDefaults, type ShippingRegionPolicy, type ShippingRegionPolicyInput } from './shipping-regions';
const ORIGIN = '00000000-0000-4000-8000-000000000001';
const draft = emptyShippingRegionPolicy(ORIGIN, 'hanjin');
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
      { originName:'김포',carrierLabel:'한진택배', originId: ORIGIN, id: 'policy-1', name: '합성 정책', version: 1, endsAt, status },
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
      { originName:'김포',carrierLabel:'한진택배', originId: ORIGIN, id: 'policy-1', name: '합성 정책', version: 1, endsAt: '2026-10-01T00:00:00Z', status: 'expiring' },
    ]);
  });

  /* S5-2: '나중 시작으로 적용'은 이전 설정의 끝을 새 시작에 맞춘다 — 끝나는 시각에 바로 이어지는 설정이 있으면 새 주문이 막히는 틈이 없다. */
  describe('끝나는 때에 이어지는 설정이 있으면 경고하지 않는다', () => {
    const ending = { ...active, endsAt: '2026-10-01T00:00:00Z' };
    const follow = { id: 'policy-2', originId: ORIGIN, carrierCode: 'hanjin', status: 'active' as const, startsAt: '2026-10-01T00:00:00Z', endsAt: null };

    it('같은 출고지·택배사에서 끝나는 시각에 시작하는 설정이 있으면 경고하지 않는다', () => {
      expect(shippingRegionExpiryWarnings([ending], now)).toHaveLength(1);
      expect(shippingRegionExpiryWarnings([ending], now, [follow])).toEqual([]);
      /* 끝나는 시각 이전에 시작해 그 뒤까지 이어져도(겹침 없이는 드물지만) 틈이 없다. */
      expect(shippingRegionExpiryWarnings([ending], now, [{ ...follow, startsAt: '2026-09-30T00:00:00Z' }])).toEqual([]);
      /* 전체 목록에 자기 자신이 섞여 있어도 이어지는 설정으로 세지 않는다. */
      expect(shippingRegionExpiryWarnings([ending], now, [{ ...follow, id: 'policy-1' }])).toHaveLength(1);
    });
    it('만료 조회 결과 안의 예정 설정도 이어지는 설정이다', () => {
      const next = { ...active, id: 'policy-2', version: 2, startsAt: '2026-10-01T00:00:00Z', endsAt: '2026-12-01T00:00:00Z' };
      expect(shippingRegionExpiryWarnings([ending, next], now)).toEqual([]);
    });
    it('틈이 있으면 그대로 경고한다: 시작이 끝보다 늦거나 끝이 앞서거나 다른 출고지·택배사거나 활성이 아니다', () => {
      for (const other of [
        { ...follow, startsAt: '2026-10-01T00:00:00.001Z' },
        { ...follow, startsAt: '2026-09-29T00:00:00Z', endsAt: '2026-10-01T00:00:00Z' },
        { ...follow, endsAt: '2026-09-30T00:00:00Z' },
        { ...follow, originId: '00000000-0000-4000-8000-000000000002' },
        { ...follow, carrierCode: 'cj' },
        { ...follow, status: 'draft' as const },
        { ...follow, status: 'retired' as const },
        { ...follow, startsAt: null },
      ]) expect(shippingRegionExpiryWarnings([ending], now, [other]), JSON.stringify(other)).toHaveLength(1);
    });
    it('이어지는 설정이 곧 끝나면 그 설정을 따로 경고하고, 끝난 설정은 이어진다고 보지 않는다', () => {
      const next = { ...active, id: 'policy-2', version: 2, startsAt: '2026-10-01T00:00:00Z', endsAt: '2026-10-03T00:00:00Z' };
      expect(shippingRegionExpiryWarnings([ending, next], now).map((warning) => warning.id)).toEqual(['policy-2']);
      /* 이미 끝난 설정은 틈이 이미 생긴 것이다 — 이어지는 설정이 있다고 가리지 않는다. */
      const expired = { ...active, endsAt: '2026-09-27T00:00:00Z' };
      expect(shippingRegionExpiryWarnings([expired], now, [{ ...follow, startsAt: '2026-09-27T00:00:00Z' }]).map((warning) => warning.status)).toEqual(['expired']);
    });
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
  it('적용 종료가 시작과 같거나 앞서면 고칠 방법을 말하고, 묶음그룹 지역표와 같은 문장을 쓴다', () => {
    expect(SHIPPING_REGION_PERIOD_PROBLEM).toBe('적용 종료를 적용 시작보다 뒤로 고쳐 주세요.');
    expect(shippingRegionPolicyProblems({ ...policy, openEnded: false, endsAt: policy.startsAt })).toEqual([SHIPPING_REGION_PERIOD_PROBLEM]);
    expect(shippingRegionPolicyProblems({ ...policy, openEnded: false, endsAt: '2026-09-09T00:00:00Z' })).toEqual([SHIPPING_REGION_PERIOD_PROBLEM]);
    expect(shippingRegionPolicyProblems({ ...policy, openEnded: false, endsAt: '2026-09-11T00:00:00Z' })).toEqual([]);
  });
});

/*
 * 지역표 금액 칸. 쉼표는 세 자리마다 찍은 것만 읽는다 — `3,000`을 치다 0을 빠뜨린 `3,00`이 300원으로 조용히 들어가면 안 된다.
 * 묶음그룹 지역표 편집(ShippingChargeGroupEditor)도 같은 `parseShippingRegionRulesTsv`로 읽는다.
 */
describe('지역표 금액 칸 읽기', () => {
  const line = (cell: string) => `00100\t00110\t\t합성 지역\t추가배송비 받음\t${cell}`;
  const base = '0부터 1,000,000까지 숫자만 적어 주세요.';
  it.each([['3000', 3000], ['3,000', 3000], ['3,000원', 3000], ['3000원', 3000], ['3,000 원', 3000], ['12,345', 12345], ['1,000,000', 1000000], ['1000000', 1000000], ['0', 0], ['0원', 0]])(
    '%s은(는) %i원으로 읽는다', (cell, amount) => {
      expect(parseShippingRegionFeeCell(cell)).toBe(amount);
      expect(parseShippingRegionRulesTsv(line(cell)).rules?.[0].amount).toBe(amount);
    });
  it('빈 칸은 금액 없음이고, 금액 열이 통째로 빠진 5개 열 줄도 금액 없음이다', () => {
    expect(parseShippingRegionFeeCell('')).toBeNull();
    expect(parseShippingRegionFeeCell('   ')).toBeNull();
    expect(parseShippingRegionRulesTsv(line('')).rules?.[0].amount).toBeNull();
    expect(parseShippingRegionRulesTsv('00100\t00110\t\t합성 지역\t추가배송비 받음').rules?.[0].amount).toBeNull();
  });
  it.each(['3,00', '1,5', ',300', '3,0000', '3 000', '30,00', '3,000,0', '1,0000,000', '1,000,001', '1,000,000,000', '3.000', '₩3,000', '-3000', '3000.0', '천원', '원', '12345678'])(
    '%s은(는) 읽지 않고 몇 번째 줄의 어떤 값인지 말한다', (cell) => {
      expect(parseShippingRegionFeeCell(cell)).toBeUndefined();
      const result = parseShippingRegionRulesTsv(line(cell));
      expect(result.rules).toBeUndefined();
      expect(result.error).toContain(`지역표 1번째 줄의 추가배송비(${cell})를 읽지 못했습니다. ${base}`);
    });
  it('쉼표 자리가 틀린 금액에는 쉼표 쓰는 법을 한 줄 더 말하고, 그 밖의 틀린 금액에는 말하지 않는다', () => {
    const hint = '쉼표는 3,000처럼 세 자리마다만 찍어 주세요.';
    for (const cell of ['3,00', '1,5', ',300', '3,0000']) expect(parseShippingRegionRulesTsv(line(cell)).error).toBe(`지역표 1번째 줄의 추가배송비(${cell})를 읽지 못했습니다. ${base} ${hint}`);
    for (const cell of ['3 000', '1,000,001', '삼천']) expect(parseShippingRegionRulesTsv(line(cell)).error).not.toContain('쉼표');
  });
  it('고치지 않은 줄의 번호는 그대로 두고, 한 줄만 틀려도 지역표 전체를 저장하지 않는다', () => {
    const rules = [{ ...policy.rules[0], id: '00000000-0000-4000-8000-000000000002', postalFrom: '00100', postalTo: '00110', amount: 3000 }];
    expect(parseShippingRegionRulesTsv(`${line('3,000')}`, rules).rules?.[0].id).toBe(rules[0].id);
    const table = `${line('3,000')}\n00200\t00210\t\t합성 지역\t추가배송비 받음\t3,00`;
    const message = `지역표 2번째 줄의 추가배송비(3,00)를 읽지 못했습니다. ${base} 쉼표는 3,000처럼 세 자리마다만 찍어 주세요.`;
    expect(parseShippingRegionRulesTsv(table)).toEqual({ error: message, errors: [message] });
  });
  /* 지역표 오류는 한 번에 한 건씩 나오지 않고, 틀린 줄을 줄 순서대로 모두 알린다 — 고치고 다음 오류를 보는 일을 되풀이하지 않게. */
  it('틀린 줄이 여럿이면 줄 순서대로 모두 알리고, 맞는 줄은 알리지 않는다', () => {
    const table = ['00100\t00110\t\t합성 지역\t추가배송비 받음\t3,000', '00200\t00210\t\t합성 지역\t알 수 없음\t3,000', '00300\t00310\t\t합성 지역\t추가배송비 받음\t삼천',
      '00400\t00410', '00500\t00510\t\t합성 지역\t추가배송비 받음\t3,000'].join('\n');
    const result = parseShippingRegionRulesTsv(table);
    expect(result.rules).toBeUndefined();
    expect(result.errors).toHaveLength(3);
    expect(result.errors!.map((message) => message.match(/^지역표 (\d+)번째 줄/)?.[1])).toEqual(['2', '3', '4']);
    /* 첫 오류는 예전 호출부(error 하나만 읽는 곳)가 그대로 쓴다. */
    expect(result.error).toBe(result.errors![0]);
    /* 머리글을 붙여넣었으면 줄 부르는 말은 그대로 '머리글 아래 N번째 줄'이다. */
    expect(parseShippingRegionRulesTsv(`${SHIPPING_REGION_TSV_HEADER}\n${table}`).errors!.every((message) => message.startsWith('지역표 머리글 아래 '))).toBe(true);
  });
  it('틀린 줄이 너무 많으면 앞의 열 줄만 알리고 나머지도 확인하라고 말한다', () => {
    const bad = Array.from({ length: 14 }, (_, index) => `${10000 + index}\t${10000 + index}\t\t합성 지역\t알 수 없음\t0`).join('\n');
    const result = parseShippingRegionRulesTsv(bad);
    expect(result.errors).toHaveLength(11);
    expect(result.errors!.at(-1)).toBe('지역표의 나머지 줄도 같은 기준으로 확인해 주세요.');
    expect(result.errors![9]).toContain('지역표 10번째 줄');
    /* 열 개수·길이 한도 같은 지역표 전체의 문제는 하나뿐이다. */
    expect(parseShippingRegionRulesTsv('x'.repeat(500001)).errors).toEqual(['지역표가 너무 깁니다. 500,000자 안으로 줄여 주세요.']);
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

  it('택배사가 같은데 사용 안 함이어서 쓰이지 않는 설정에는 \'택배사 다름\'이라 하지 않고 까닭을 그대로 말한다', () => {
    expect(shippingRegionStateLabel('unused', saved('a', { carrierCode: 'cj' }), origin)).toBe('택배사 다름');
    expect(shippingRegionStateLabel('unused', saved('a'), origin)).toBe(SHIPPING_REGION_CARRIER_OFF_LABEL);
    expect(SHIPPING_REGION_CARRIER_OFF_LABEL).toBe('택배사 사용 안 함');
    /* 출고지를 찾지 못했거나 다른 상태는 그대로다. */
    expect(shippingRegionStateLabel('unused', saved('a'), undefined)).toBe('택배사 다름');
    expect(shippingRegionStateLabel('in_effect', saved('a'), origin)).toBe('적용 중');
    expect(shippingRegionStateLabel('scheduled', saved('a'), origin)).toBe('예정');
  });

  describe('적용 직후 화면 시계', () => {
    const PC = Date.parse('2026-11-26T03:00:00Z');
    const server = '2026-11-26T03:01:30Z';
    const originRow = { id: policy.originId, defaultCarrier: 'hanjin' };
    it('저장하면 바로: PC 시계가 서버보다 느려도 서버가 정한 시작 시각까지 당겨 방금 적용한 설정이 예정으로 보이지 않는다', () => {
      const applied = saved('new', { startsAt: server });
      const clock = shippingRegionClockAfterApply({ clock: 0, deviceNow: PC, startsAt: server, startNow: true });
      expect(clock).toBe(Date.parse(server));
      expect(shippingRegionPolicyState(applied, origin, true, clock)).toBe('in_effect');
      expect(shippingRegionPolicyInEffect(applied, originRow, clock)).toBe(true);
      /* 이전 설정을 끝낸 것으로 보여도(retired) 새 설정이 적용 중이므로 이 출고지는 막혀 있지 않다. */
      expect(shippingRegionPolicyInEffect(saved('old', { status: 'retired' }), originRow, clock)).toBe(false);
      /* 시계를 PC 시각에 두면(옛 동작) 예정으로 보이고 이 출고지에 적용 중인 설정이 없어 보인다. */
      expect(shippingRegionPolicyState(applied, origin, true, PC)).toBe('scheduled');
      expect(shippingRegionPolicyInEffect(applied, originRow, PC)).toBe(false);
    });
    it('PC 시계가 서버보다 빠르거나 같으면 PC 시계 그대로 두고, 시계는 뒤로 가지 않는다', () => {
      expect(shippingRegionClockAfterApply({ clock: 0, deviceNow: PC, startsAt: '2026-11-26T02:59:00Z', startNow: true })).toBe(PC);
      expect(shippingRegionClockAfterApply({ clock: 0, deviceNow: PC, startsAt: '2026-11-26T03:00:00Z', startNow: true })).toBe(PC);
      expect(shippingRegionClockAfterApply({ clock: PC + 600000, deviceNow: PC, startsAt: server, startNow: true })).toBe(PC + 600000);
      expect(shippingRegionClockAfterApply({ clock: PC + 600000, deviceNow: PC, startsAt: null, startNow: false })).toBe(PC + 600000);
    });
    it('날짜를 정해 둔 설정은 시작 시각까지 당기지 않는다 — 예정으로 남는다', () => {
      const later = '2026-12-01T00:00:00Z';
      const clock = shippingRegionClockAfterApply({ clock: 0, deviceNow: PC, startsAt: later, startNow: false });
      expect(clock).toBe(PC);
      expect(shippingRegionPolicyState(saved('later', { startsAt: later }), origin, true, clock)).toBe('scheduled');
    });
    it('시작 시각이 없거나 읽을 수 없으면 PC 시계 그대로다', () => {
      expect(shippingRegionClockAfterApply({ clock: 0, deviceNow: PC, startsAt: null, startNow: true })).toBe(PC);
      expect(shippingRegionClockAfterApply({ clock: 0, deviceNow: PC, startsAt: '날짜 아님', startNow: true })).toBe(PC);
    });
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
    expect(message.split('\n')).toEqual(['김포 · 한진택배 · 겨울 지역표', '추가배송비: 제주 4,000원 · 도서산간 5,000원 · 독도 9,000원 · 주문받지 않는 지역 1줄', '표에 없는 지역: 추가배송비 없음', '적용 기간: 지금부터', '',
      '지금 적용 중인 설정(기본 지역표)을 끝내고 이 내용으로 바꿉니다.', '금액이 바뀌는 지역: 제주 3,000원 → 4,000원 · 독도 9,000원 (새로 받음) · 울릉도 7,000원 → 지역표에서 빠짐', '',
      '지금부터 새 주문에 적용됩니다. 아직 결제하지 않은 장바구니·주문서에도 적용되고, 이미 들어온 주문의 배송비는 그대로입니다.']);
  });

  it('지역명별 금액이 같아도 추가배송비를 받는 방식(받는 단위·받는 상품)이 달라지면 그것도 말한다', () => {
    const current = saved('a', { name: '기본 지역표', rules: [row('제주', 3000)] });
    const input: ShippingRegionPolicyInput = { ...policy, name: '방식 변경', startsAt: '2026-11-26T00:00:00Z', rules: [row('제주', 3000)],
      feeUnit: 'per_good', chargeFreeGoods: true, chargeIndividualGoods: false, waivePolicyThreshold: false };
    const args = { input, startNow: true, originName: '김포', carrierLabel: '한진택배', replacements: [{ policy: current, mode: 'retired' as const }], adoption: 'started' as const, coveredNow: true, now: NOW, formatDate: fmt };
    const message = shippingRegionApplyConfirmMessage({ ...args, freeThresholdSet: true });
    expect(message).toContain('지역명별 금액은 지금과 같습니다.');
    expect(message).toContain('받는 방식이 바뀝니다: 받는 단위 한 주문에 한 번 → 상품 종류마다 한 번 · ‘무료배송’ 상품 안 받음 → 받음 · ‘개별 배송비’ 상품 받음 → 안 받음 · 무료 배송 기준을 채운 주문 안 받음 → 받음');
    expect(message.indexOf('지역명별 금액은 지금과 같습니다.')).toBeLessThan(message.indexOf('받는 방식이 바뀝니다'));
    /* 출고지에 무료 배송 기준이 없으면 그 설정은 어느 쪽이어도 같아 말하지 않는다. */
    const noThreshold = shippingRegionApplyConfirmMessage({ ...args, freeThresholdSet: false });
    expect(noThreshold).toContain('받는 방식이 바뀝니다: 받는 단위 한 주문에 한 번 → 상품 종류마다 한 번');
    expect(noThreshold).not.toContain('무료 배송 기준을 채운 주문');
    expect(shippingRegionApplyConfirmMessage({ ...args, input: { ...input, waivePolicyThreshold: true, feeUnit: 'per_shipment', chargeFreeGoods: false, chargeIndividualGoods: true }, freeThresholdSet: true })).not.toContain('받는 방식이 바뀝니다');
    /* 켠 것과 끈 것이 거꾸로면 말도 거꾸로다. */
    expect(shippingRegionApplyConfirmMessage({ ...args, input: { ...input, waivePolicyThreshold: true, feeUnit: 'per_shipment', chargeFreeGoods: false, chargeIndividualGoods: true, chargePolicyGoods: false }, freeThresholdSet: true }))
      .toContain('받는 방식이 바뀝니다: ‘출고지 정책 따름’ 상품 받음 → 안 받음');
    /* 적용 중인 설정이 없으면 견줄 것이 없다. */
    expect(shippingRegionApplyConfirmMessage({ ...args, replacements: [], freeThresholdSet: true })).not.toContain('받는 방식이 바뀝니다');
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
    expect(shippingRegionExampleLines(input, { baseFee: 3000, freeThreshold: 50000 })).toEqual(['주문 예시 · 배송지 제주(추가배송비 3,000원)',
      '‘출고지 정책 따름’ 상품: 기본 배송비 3,000원 + 추가배송비 3,000원 = 6,000원', '‘출고지 정책 따름’ 상품을 50,000원 이상 사면: 추가배송비 3,000원만',
      '‘무료배송’ 상품: 추가배송비 3,000원', '‘개별 배송비’ 상품: 상품의 개별 배송비 + 추가배송비 3,000원', '이 출고지 상품을 여러 개 함께 주문해도 추가배송비는 한 번만 받습니다.']);
    expect(shippingRegionExampleLines({ ...input, chargePolicyGoods: false, chargeFreeGoods: false, chargeIndividualGoods: false, feeUnit: 'per_good' }, { baseFee: 3000, freeThreshold: 50000 })).toEqual(['주문 예시 · 배송지 제주(추가배송비 3,000원)',
      '‘출고지 정책 따름’ 상품: 기본 배송비 3,000원만', '‘무료배송’ 상품: 배송비 없음', '‘개별 배송비’ 상품: 상품의 개별 배송비만',
      '추가배송비는 상품 종류마다 받습니다. 두 가지 상품을 함께 주문하면 6,000원입니다(같은 상품의 옵션·수량은 한 번).']);
    expect(shippingRegionExampleLines({ ...input, waivePolicyThreshold: true }, { baseFee: 3000, freeThreshold: 50000 })[2]).toBe('‘출고지 정책 따름’ 상품을 50,000원 이상 사면: 배송비 없음');
    expect(shippingRegionExampleLines(input, null)).toEqual([]);
    expect(shippingRegionExampleLines({ ...input, rules: [] }, { baseFee: 3000, freeThreshold: null })).toEqual([]);
  });

  it('지역명별 금액은 여섯 곳까지 적고 나머지는 수로 줄인다', () => {
    expect(shippingRegionFeeSummary([row('제주', 3000), row('제주', 5000, 'surcharge', '10001'), row('도서산간', 5000, 'surcharge', '20000'), row('섬', null, 'unavailable', '30000')])).toBe('제주 3,000원~5,000원 · 도서산간 5,000원');
    expect(shippingRegionFeeSummary(Array.from({ length: 8 }, (_, index) => row(`지역${index}`, 1000, 'surcharge', String(10000 + index))))).toBe('지역0 1,000원 · 지역1 1,000원 · 지역2 1,000원 · 지역3 1,000원 · 지역4 1,000원 · 지역5 1,000원 외 2곳');
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

/* S5-1: 지역별 추가배송비 화면·배송정보 관리·운영 준비가 같은 함수로 '출고지 상태'를 가린다. */
describe('출고지별 지역별 추가배송비 상태', () => {
  const NOW = Date.parse('2026-11-26T00:00:00Z');
  const fmt = (value: string) => `<${value.slice(0, 10)}>`;
  const ORIGIN_ID = '00000000-0000-4000-8000-000000000001';
  const saved = (id: string, patch: Partial<ShippingRegionPolicy> = {}): ShippingRegionPolicy => ({ ...policy, name: `설정 ${id}`, id, version: 1, revision: 1, status: 'active',
    confirmedAt: '2026-09-10T00:00:00Z', confirmedBy: '관리자', updatedAt: '2026-09-10T00:00:00Z', ...patch });
  const origin = { id: ORIGIN_ID, defaultCarrier: 'hanjin' };
  const adoption = (managedFrom = '2026-09-10T00:00:00Z') => ({ originId: ORIGIN_ID, managedFrom });
  const status = (policies: ShippingRegionPolicy[], options: { adoptions?: { originId: string; managedFrom: string }[]; carrierActive?: boolean; origin?: { id: string; defaultCarrier: string | null } } = {}) =>
    shippingRegionOriginStatus({ origin: options.origin ?? origin, policies, adoptions: options.adoptions ?? [adoption()], carrierActive: () => options.carrierActive ?? true, now: NOW });

  it('안 씀·예정·적용 중을 가린다', () => {
    expect(status([], { adoptions: [] })).toEqual({ kind: 'unused' });
    expect(status([saved('a')], { adoptions: [adoption('2026-12-01T00:00:00Z')] })).toEqual({ kind: 'upcoming', managedFrom: '2026-12-01T00:00:00Z' });
    const current = saved('a');
    expect(status([current])).toEqual({ kind: 'in_effect', policy: current });
    /* 도입 기록이 여러 줄이면 가장 이른 시각이 쓰기 시작한 때다. */
    expect(status([current], { adoptions: [adoption('2026-12-01T00:00:00Z'), adoption('2026-09-10T00:00:00Z')] }).kind).toBe('in_effect');
  });

  it('쓰기 시작했는데 적용 중인 설정이 없으면 막힌 것이고, 까닭은 넷 중 하나다', () => {
    /* 끝난 설정만 있다 */
    expect(status([saved('a', { endsAt: '2026-11-25T00:00:00Z', openEnded: false })])).toEqual({ kind: 'blocked', reason: 'ended' });
    /* [끝내기]로 끝냈다 */
    expect(status([saved('a', { status: 'retired' })])).toEqual({ kind: 'blocked', reason: 'ended' });
    /* 준비 중(적용하지 않음)만 있다 */
    expect(status([saved('a', { status: 'draft' })])).toEqual({ kind: 'blocked', reason: 'ended' });
    /* 다음 설정이 나중에 시작한다 — 가장 이른 시작이 보인다 */
    expect(status([saved('a', { endsAt: '2026-11-25T00:00:00Z', openEnded: false }), saved('b', { startsAt: '2026-12-10T00:00:00Z' }), saved('c', { startsAt: '2026-12-03T00:00:00Z' })]))
      .toEqual({ kind: 'blocked', reason: 'next_scheduled', nextStartsAt: '2026-12-03T00:00:00Z' });
    /* 출고지의 기본 택배사가 적용해 둔 설정의 택배사와 다르다 */
    expect(status([saved('a', { carrierCode: 'cj' })])).toEqual({ kind: 'blocked', reason: 'carrier_mismatch' });
    /* 기본 택배사가 사용 안 함이거나 없다 — 설정이 적용 기간 안이어도 막힌다 */
    expect(status([saved('a')], { carrierActive: false })).toEqual({ kind: 'blocked', reason: 'carrier_off' });
    expect(status([saved('a')], { origin: { id: ORIGIN_ID, defaultCarrier: null }, carrierActive: false })).toEqual({ kind: 'blocked', reason: 'carrier_off' });
  });

  it('다른 출고지의 설정·도입 기록은 보지 않는다', () => {
    const other = '00000000-0000-4000-8000-000000000002';
    expect(status([saved('a', { originId: other })], { adoptions: [{ originId: other, managedFrom: '2026-09-10T00:00:00Z' }] })).toEqual({ kind: 'unused' });
    expect(status([saved('a', { originId: other })])).toEqual({ kind: 'blocked', reason: 'ended' });
  });

  it('막힌 까닭의 문장: 지역별 추가배송비 화면의 문장과 다른 화면의 한 문장', () => {
    const blocked = (reason: 'carrier_off' | 'carrier_mismatch' | 'next_scheduled' | 'ended', nextStartsAt?: string) => ({ kind: 'blocked' as const, reason, nextStartsAt });
    expect(shippingRegionBlockReasonText(blocked('carrier_off'), fmt)).toBe('기본 택배사가 없거나 ‘사용 안 함’입니다');
    expect(shippingRegionBlockReasonText(blocked('carrier_mismatch'), fmt)).toBe('출고지의 기본 택배사가 적용해 둔 설정의 택배사와 다릅니다');
    expect(shippingRegionBlockReasonText(blocked('ended'), fmt)).toBe('적용 기간이 끝났거나 끝낸 설정만 있습니다');
    expect(shippingRegionBlockReasonText(blocked('next_scheduled', '2026-12-03T00:00:00Z'), fmt)).toBe('다음 설정이 <2026-12-03>에 시작합니다. 그때까지 막혀 있습니다');
    expect(shippingRegionBlockedSentence(blocked('ended'), fmt)).toBe('지역별 추가배송비 설정이 끝나 새 주문이 막혀 있습니다.');
    expect(shippingRegionBlockedSentence(blocked('next_scheduled', '2026-12-03T00:00:00Z'), fmt)).toBe('지역별 추가배송비 설정이 끝나 새 주문이 막혀 있습니다. 다음 설정이 <2026-12-03>에 시작합니다.');
    expect(shippingRegionBlockedSentence(blocked('carrier_off'), fmt)).toContain('새 주문이 막혀 있습니다.');
    expect(shippingRegionBlockedSentence(blocked('carrier_mismatch'), fmt)).toContain('택배사');
    for (const reason of ['carrier_off', 'carrier_mismatch', 'ended', 'next_scheduled'] as const) {
      expect(shippingRegionBlockedSentence(blocked(reason, '2026-12-03T00:00:00Z'), fmt), reason).not.toMatch(/정책|버전|\bID\b/);
    }
  });

  it('새 주문이 막힌 출고지 목록은 사용 중인 출고지만 담는다', () => {
    const second = '00000000-0000-4000-8000-000000000002';
    const origins = [{ id: ORIGIN_ID, name: '김포', defaultCarrier: 'hanjin', active: true }, { id: second, name: '남양주', defaultCarrier: 'hanjin', active: true },
      { id: '00000000-0000-4000-8000-000000000003', name: '옛 출고지', defaultCarrier: 'hanjin', active: false }];
    const adoptions = [adoption(), { originId: second, managedFrom: '2026-09-10T00:00:00Z' }, { originId: '00000000-0000-4000-8000-000000000003', managedFrom: '2026-09-10T00:00:00Z' }];
    const policies = [saved('a', { status: 'retired' }), saved('b', { originId: second })];
    const overview = shippingRegionOriginOverview({ origins, carriers: [{ code: 'hanjin', active: true }], policies, adoptions, now: NOW });
    expect(overview.blocked).toEqual([{ originId: ORIGIN_ID, originName: '김포', reason: 'ended' }]);
    /* 상태는 사용 중인 출고지마다 하나씩 — 김포는 막힘, 남양주는 적용 중이고, 사용 안 함인 출고지는 없다. */
    expect(overview.statuses.map((row) => row.kind)).toEqual(['blocked', 'in_effect']);
    /* 택배사를 끄면 설정이 적용 기간 안인 출고지도 막힌다 */
    expect(shippingRegionOriginOverview({ origins, carriers: [{ code: 'hanjin', active: false }], policies, adoptions, now: NOW }).blocked.map((row) => [row.originName, row.reason]))
      .toEqual([['김포', 'carrier_off'], ['남양주', 'carrier_off']]);
    /* 다음 설정이 시작하는 시각이 함께 온다 */
    expect(shippingRegionOriginOverview({ origins: [origins[0]], carriers: [{ code: 'hanjin', active: true }], policies: [saved('a', { status: 'retired' }), saved('n', { startsAt: '2026-12-03T00:00:00Z' })], adoptions, now: NOW }).blocked)
      .toEqual([{ originId: ORIGIN_ID, originName: '김포', reason: 'next_scheduled', nextStartsAt: '2026-12-03T00:00:00Z' }]);
    expect(shippingRegionOriginOverview({ origins: [], carriers: [], policies: [], adoptions: [], now: NOW })).toEqual({ statuses: [], blocked: [] });
  });
});
