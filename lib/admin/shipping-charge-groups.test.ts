import { describe, expect, it } from 'vitest';
import { chargeAdminFixtures, chargeId, chargeIds, chargeIdentity, chargeLater, chargeTime } from '@/test/fixtures/shipping-charge-groups';
import { SHIPPING_CHARGE_GROUP_BLOCKERS, SHIPPING_CHARGE_GROUP_BLOCKER_LABELS, SHIPPING_CHARGE_GROUP_RUNTIME_OFF, defaultShippingChargeGroupRegionPolicy,
  shippingChargeGroupPreviewSplit, shippingChargeGroupRegionBlock, shippingChargeGroupRegionConfirmMessage,
  emptyShippingChargeGroupRegionPolicy, emptyShippingChargeGroupValues, parseShippingChargeGroup, parseShippingChargeGroupAssignRequest,
  parseShippingChargeGroupGood, parseShippingChargeGroupGoodGuard, parseShippingChargeGroupIdentity, parseShippingChargeGroupOperationContext,
  parseShippingChargeGroupOperationReceipt, parseShippingChargeGroupRegionPolicy, parseShippingChargeGroupSaveRequest, parseShippingChargeGroupValues,
  shippingChargeGroupGoodGuard, shippingChargeGroupOperationContext, shippingChargeGroupReceiptMatches, shippingChargeGroupRegionalProblems,
  shippingChargeGroupValuesMatch } from './shipping-charge-groups';

describe('배송비 묶음그룹 운영 DTO', () => {
  it('관리 값·원상품 guard·context를 독립 계약으로 읽는다', () => {
    const f = chargeAdminFixtures();
    expect(parseShippingChargeGroup(f.group)).toEqual(f.group);
    expect(parseShippingChargeGroupSaveRequest(f.save)).toEqual(f.save);
    expect(parseShippingChargeGroupAssignRequest(f.assign)).toEqual(f.assign);
    expect(shippingChargeGroupGoodGuard(f.good)).toEqual(f.guard);
    expect(parseShippingChargeGroupOperationContext(shippingChargeGroupOperationContext(f.save))).not.toBeNull();
    expect(parseShippingChargeGroupOperationContext(f.save)).toBeNull();
    expect(parseShippingChargeGroupIdentity(chargeIdentity)).toEqual(chargeIdentity);
    expect(parseShippingChargeGroupIdentity({ ...chargeIdentity, role:'admin' })).toBeNull();
  });
  it.each(['actorId', 'sessionId', 'canManageRegional', 'ignored'])('save에 caller supplied %s를 추가할 수 없다', key => {
    const { save } = chargeAdminFixtures(); expect(parseShippingChargeGroupSaveRequest({ ...save, [key]:'PRIVATE' })).toBeNull();
  });
  it('기본 그룹은 활성이고 연결 상품이 있으면 중지/보관할 수 없다', () => {
    const { group, save } = chargeAdminFixtures();
    for (const values of [{ ...save.values, isDefault:true, enabled:false }, { ...save.values, archived:true }]) expect(parseShippingChargeGroupValues(values)).toBeNull();
    expect(parseShippingChargeGroup({ ...group, assignedCount:1, enabled:false })).toBeNull();
    expect(parseShippingChargeGroup({ ...group, assignedCount:0, enabled:false })).not.toBeNull();
    expect(parseShippingChargeGroup({ ...group, createdAt:chargeLater, updatedAt:chargeTime })).toBeNull();
  });
  it('출고지 미지정 상품은 읽되 실제 배정 요청은 거절한다', () => {
    const { good, assign } = chargeAdminFixtures();
    const missing = { ...good, originId:null, blocker:'shipping_charge_group_origin_unavailable' };
    expect(parseShippingChargeGroupGood(missing)).toEqual(missing);
    expect(parseShippingChargeGroupAssignRequest({ ...assign, goods:[shippingChargeGroupGoodGuard(missing as typeof good)] })).toBeNull();
    expect(parseShippingChargeGroupAssignRequest({ ...assign, groupId:null,expectedRevision:0,origins:[],
      goods:[shippingChargeGroupGoodGuard(missing as typeof good)] })).not.toBeNull();
  });
  it('자식은 원상품 소유권을 보존하며 가짜 family와 상충하는 버전을 거절한다', () => {
    const { good, guard, assign } = chargeAdminFixtures();
    const child = { ...good, id:'child', familyGoodIds:['child','good-a'], editable:false,
      blocker:'goods_aggregation_policy_owned_by_source', effectiveCount:2 };
    expect(parseShippingChargeGroupGood(child)).toEqual(child);
    expect(parseShippingChargeGroupAssignRequest({ ...assign, goods:[shippingChargeGroupGoodGuard(child as typeof good)] })).toBeNull();
    for (const patch of [{ familyGoodIds:['other'] }, { familyGoodIds:['good-a','good-a'] }, { assignmentRevision:1 },
      { groupId:chargeIds.group }, { transactionRevision:0, deliveryVersionId:chargeId(50) }, { ownerUpdatedAt:chargeLater }]) {
      expect(parseShippingChargeGroupGoodGuard({ ...guard, ...patch })).toBeNull();
    }
  });
  it('owner의 editable과 운영 차단 사유를 별개로 보존한다', () => {
    const { good } = chargeAdminFixtures();
    expect(parseShippingChargeGroupGood({ ...good, blocker:'checkout_contract_upgrade_required' })).not.toBeNull();
    expect(parseShippingChargeGroupGood({ ...good, editable:false, blocker:'checkout_contract_upgrade_required' })).toBeNull();
  });
  it('배정 대상 중복·출고지 누락·100개 초과·명시 clear의 잘못된 revision을 거절한다', () => {
    const { assign } = chargeAdminFixtures();
    for (const input of [{ ...assign, goods:[assign.goods[0],assign.goods[0]] }, { ...assign, origins:[] },
      { ...assign, origins:[...assign.origins,{ ...assign.origins[0],id:chargeIds.other }] },
      { ...assign, goods:Array.from({length:101},(_,i)=>({ ...assign.goods[0],id:`g-${i}`,ownerGoodId:`g-${i}`,familyGoodIds:[`g-${i}`] })) },
      { ...assign, groupId:null }, { ...assign, expectedRevision:0 }]) expect(parseShippingChargeGroupAssignRequest(input)).toBeNull();
    expect(parseShippingChargeGroupAssignRequest({ ...assign, groupId:null, expectedRevision:0 })).not.toBeNull();
  });
  it('지역 원문은 별도 wire와 실제 시각/완성도 검증을 따른다', () => {
    const { region, save } = chargeAdminFixtures();
    expect(parseShippingChargeGroupRegionPolicy(region)).toEqual(region);
    expect(shippingChargeGroupRegionalProblems(region)).toEqual([]);
    expect(parseShippingChargeGroupValues({ ...save.values, regional:{ mode:'override',policy:region } })).not.toBeNull();
    expect(parseShippingChargeGroupRegionPolicy({ ...region, feeUnit:'per_shipment' })).toBeNull();
    expect(parseShippingChargeGroupRegionPolicy({ ...region, startsAt:'2026-02-30T00:00:00Z' })).toBeNull();
    expect(parseShippingChargeGroupRegionPolicy({ ...region, startsAt:chargeLater, endsAt:chargeTime })).toBeNull();
    /* 물류사 회신·계약 근거는 더는 요구하지 않는다(2026-11-26). 비어 있어도 '사용'으로 저장할 수 있다. */
    expect(shippingChargeGroupRegionalProblems({ ...region,sourceEvidence:'' })).toEqual([]);
    expect(parseShippingChargeGroupValues({ ...save.values, regional:{ mode:'override',policy:{ ...region,sourceEvidence:'' } } })).not.toBeNull();
    expect(parseShippingChargeGroupValues({ ...save.values, enabled:false, regional:{ mode:'override',policy:{ ...region,sourceEvidence:'' } } })).not.toBeNull();
    /* 빠진 값이 있으면 '사용'으로는 저장하지 못하고, '사용 안 함'으로는 저장해 둘 수 있다. */
    expect(parseShippingChargeGroupValues({ ...save.values, regional:{ mode:'override',policy:{ ...region,startsAt:null } } })).toBeNull();
    expect(parseShippingChargeGroupValues({ ...save.values, enabled:false, regional:{ mode:'override',policy:{ ...region,startsAt:null } } })).not.toBeNull();
    expect(shippingChargeGroupRegionalProblems({ ...region,carrierCode:'',unlistedDisposition:null })).toEqual(['택배사를 골라 주세요.', '‘표에 없는 지역’을 골라 주세요.']);
    expect(shippingChargeGroupRegionalProblems({ ...region,openEnded:false,endsAt:chargeTime,startsAt:chargeLater })).toEqual(['적용 종료를 적용 시작보다 뒤로 고쳐 주세요.']);
    const micros = { ...region, openEnded:false, endsAt:'2026-10-14T00:00:00.123457Z' };
    expect(shippingChargeGroupRegionalProblems(micros)).toEqual([]);
    expect(parseShippingChargeGroupValues({ ...save.values,regional:{mode:'override',policy:micros} })).not.toBeNull();
  });
  it('지역 규칙 중복/겹침과 0원/미입력을 구분한다', () => {
    const { region, save } = chargeAdminFixtures();
    const rule = { id:null, postalFrom:'12345', postalTo:'12345', addressPrefix:'TEST 시', regionLabel:'TEST 권역', disposition:'surcharge' as const, amount:0 };
    const policy = { ...region,noRulesConfirmed:false,rules:[rule] };
    expect(parseShippingChargeGroupValues({ ...save.values,regional:{mode:'override',policy} })).not.toBeNull();
    expect(shippingChargeGroupRegionalProblems({ ...policy,rules:[rule,rule] }).join(' ')).toContain('겹칩니다');
    expect(parseShippingChargeGroupValues({ ...save.values,regional:{mode:'override',policy:{ ...policy,rules:[{...rule,amount:null}] }} })).toBeNull();
    expect(parseShippingChargeGroupRegionPolicy({ ...policy,rules:[{...rule,id:chargeIds.other},{...rule,id:chargeIds.other}] })).toBeNull();
    expect(emptyShippingChargeGroupRegionPolicy('cj').carrierCode).toBe('cj');
    expect(emptyShippingChargeGroupValues().regional).toEqual({mode:'inherit',policy:null});
  });
});

describe('저장·배정 영수증의 복구 계약', () => {
  it('저장/배정/봉인과 동일값 저장 no-op을 구분하고 원 context에 결속한다', () => {
    const f = chargeAdminFixtures();
    for (const receipt of [f.saved,f.assigned,f.sealed]) expect(parseShippingChargeGroupOperationReceipt(receipt)).toEqual(receipt);
    expect(parseShippingChargeGroupOperationReceipt({ ...f.saved,expectedRevision:1 })).not.toBeNull();
    expect(shippingChargeGroupReceiptMatches(f.saved,f.save)).toBe(true);
    expect(shippingChargeGroupReceiptMatches({ ...f.saved,sessionId:chargeIds.other },f.save)).toBe(false);
    expect(parseShippingChargeGroupOperationReceipt({ ...f.saved,group:{...f.group,revision:3} })).toBeNull();
    expect(parseShippingChargeGroupOperationReceipt({ ...f.sealed,group:f.group })).toBeNull();
  });
  it('이미 해제된 상품의 no-op은 없는 assignment head를 만들었다고 주장하지 않는다', () => {
    const f = chargeAdminFixtures(), receipt = { ...f.assigned,groupId:null,expectedRevision:0,group:null,goods:[f.guard] };
    expect(parseShippingChargeGroupOperationReceipt(receipt)).toEqual(receipt);
    expect(parseShippingChargeGroupOperationReceipt({ ...receipt,goods:[{...f.guard,groupRevision:1}] })).toBeNull();
  });
  it('생성된 rule UUID와 동등한 microsecond 시각만 정규화 차이로 인정한다', () => {
    const { region,save } = chargeAdminFixtures();
    const expected = { ...save.values,regional:{mode:'override' as const,policy:{...region,noRulesConfirmed:false,rules:[{id:null,postalFrom:'12345',postalTo:'12345',addressPrefix:'',regionLabel:'TEST',disposition:'surcharge' as const,amount:0}]}} };
    const actual = structuredClone(expected); Object.assign(actual.regional.policy.rules[0],{id:chargeIds.other});
    actual.regional.policy.startsAt = '2026-10-14T09:00:00.123456+09:00';
    expect(shippingChargeGroupValuesMatch(actual,expected)).toBe(true);
    actual.regional.policy.startsAt = '2026-10-14T09:00:00.123457+09:00';
    expect(shippingChargeGroupValuesMatch(actual,expected)).toBe(false);
  });
});

describe('화면이 쓰는 말과 판정', () => {
  it('새 지역표는 오늘 0시(KST)부터·계속 적용·표에 없는 지역은 추가배송비 없음으로 채워 두고 근거는 비워 둔다', () => {
    const policy = defaultShippingChargeGroupRegionPolicy('cj', Date.parse('2026-12-01T03:04:56.789Z'));
    expect(policy).toEqual({ carrierCode:'cj', startsAt:'2026-11-30T15:00:00.000Z', endsAt:null, openEnded:true, sourceEvidence:'', unlistedDisposition:'standard', noRulesConfirmed:false, rules:[] });
    /* KST 자정 직전·직후에도 그날 0시다. */
    expect(defaultShippingChargeGroupRegionPolicy('cj', Date.parse('2026-11-30T14:59:59.999Z')).startsAt).toBe('2026-11-29T15:00:00.000Z');
    expect(defaultShippingChargeGroupRegionPolicy('cj', Date.parse('2026-11-30T15:00:00.000Z')).startsAt).toBe('2026-11-30T15:00:00.000Z');
    expect(parseShippingChargeGroupRegionPolicy(policy)).toEqual(policy);
    expect(shippingChargeGroupRegionalProblems({ ...policy, noRulesConfirmed:true })).toEqual([]);
  });
  it('미리보기에서 바꿀 수 있는 상품과 건너뛰는 상품을 가르고, 건너뛴 이유는 고칠 곳까지 말한다', () => {
    const { preview, good, summary } = chargeAdminFixtures();
    const blocked = { ...good, id:'good-b', ownerGoodId:'good-b', familyGoodIds:['good-b'], name:'착불 상품', blocker:'collect_contract_not_ready' as const, beforeGroup:null, afterGroup:summary };
    const child = { ...good, id:'child', ownerGoodId:'good-a', familyGoodIds:['good-a','child'], effectiveCount:2, name:'나눈 상품', editable:false,
      blocker:'goods_aggregation_policy_owned_by_source' as const, beforeGroup:null, afterGroup:summary };
    const split = shippingChargeGroupPreviewSplit({ ...preview, canAssign:false, goods:[preview.goods[0], blocked, child] });
    expect(split.ready.map(row => row.id)).toEqual(['good-a']);
    expect(split.skipped).toEqual([{ id:'good-b', name:'착불 상품', reason:SHIPPING_CHARGE_GROUP_BLOCKER_LABELS.collect_contract_not_ready },
      { id:'child', name:'나눈 상품', reason:'원상품에서 나눈 상품이라 원상품에서 바꿔야 합니다' }]);
    expect(shippingChargeGroupPreviewSplit(preview)).toEqual({ ready:preview.goods, skipped:[] });
  });
  it('막힌 이유와 쇼핑몰 설정 안내는 내부 값·개발 용어 없이 다음에 할 일을 말한다', () => {
    for (const blocker of SHIPPING_CHARGE_GROUP_BLOCKERS) {
      expect(SHIPPING_CHARGE_GROUP_BLOCKER_LABELS[blocker]).not.toMatch(/합산군|거래 경로|운영 설정|계약|버전|[a-z_]{6,}/);
      expect(SHIPPING_CHARGE_GROUP_BLOCKER_LABELS[blocker].endsWith('.')).toBe(false);
    }
    expect(SHIPPING_CHARGE_GROUP_RUNTIME_OFF).toBe("지금 쇼핑몰 설정에서는 묶음그룹을 '사용'으로 저장하거나 상품을 넣고 뺄 수 없습니다. 써야 하면 개발 담당자에게 요청해 주세요.");
  });
  it('지역표가 주문에 쓰이지 않는 이유를 견적과 같은 조건으로 가린다', () => {
    const { region } = chargeAdminFixtures(), origin = { defaultCarrier:'cj' }, now = Date.parse('2026-12-01T00:00:00Z');
    expect(shippingChargeGroupRegionBlock(region, origin, true, now)).toBeNull();
    expect(shippingChargeGroupRegionBlock(region, origin, undefined, now)).toBeNull();
    expect(shippingChargeGroupRegionBlock({ ...region, carrierCode:'hanjin' }, origin, true, now)).toBe('carrier_mismatch');
    expect(shippingChargeGroupRegionBlock(region, origin, false, now)).toBe('carrier_inactive');
    expect(shippingChargeGroupRegionBlock({ ...region, startsAt:'2026-12-02T00:00:00Z' }, origin, true, now)).toBe('not_started');
    expect(shippingChargeGroupRegionBlock({ ...region, startsAt:null }, origin, true, now)).toBe('not_started');
    expect(shippingChargeGroupRegionBlock({ ...region, endsAt:'2026-12-01T00:00:00Z' }, origin, true, now)).toBe('ended');
    expect(shippingChargeGroupRegionBlock({ ...region, endsAt:'2026-12-01T00:00:01Z' }, origin, true, now)).toBeNull();
    expect(shippingChargeGroupRegionBlock(region, null, true, now)).toBeNull();
  });
  it('지역 설정이 바뀌는 저장의 확인창은 대상·금액·적용 기간과 주문이 막히는 경우를 말한다', () => {
    const { region } = chargeAdminFixtures(), now = Date.parse('2026-12-01T00:00:00Z'), formatDate = (value: string) => `<${value}>`;
    const rules = [{ id:null, postalFrom:'63000', postalTo:'63644', addressPrefix:'', regionLabel:'제주', disposition:'surcharge' as const, amount:3000 },
      { id:null, postalFrom:'40200', postalTo:'40240', addressPrefix:'', regionLabel:'울릉도', disposition:'unavailable' as const, amount:null }];
    const common = { name:'김포 기본 묶음', originName:'김포', assignedCount:1234, now, formatDate };
    expect(shippingChargeGroupRegionConfirmMessage({ ...common, enabled:true, regional:{ mode:'override', policy:{ ...region, noRulesConfirmed:false, rules } } })).toBe([
      '김포 · 김포 기본 묶음 · 넣은 상품 1,234개', '추가배송비: 제주 ₩3,000 · 주문받지 않는 지역 1줄 · 묶음그룹마다 한 번', '표에 없는 지역: 추가배송비 없음',
      `적용 기간: <${region.startsAt}>부터`, '', '저장하면 바로 새 주문에 적용됩니다. 이미 들어온 주문의 배송비는 그대로입니다.'].join('\n'));
    const scheduled = shippingChargeGroupRegionConfirmMessage({ ...common, enabled:true, regional:{ mode:'override',
      policy:{ ...region, startsAt:'2026-12-10T00:00:00Z', openEnded:false, endsAt:'2026-12-31T00:00:00Z', unlistedDisposition:'manual_review' } } });
    expect(scheduled).toContain('추가배송비: 받는 지역 없음 · 묶음그룹마다 한 번'); expect(scheduled).toContain('표에 없는 지역: 주문받지 않음');
    expect(scheduled).toContain('적용 기간: <2026-12-10T00:00:00Z>부터 <2026-12-31T00:00:00Z>까지');
    expect(scheduled).toContain('<2026-12-10T00:00:00Z> 전에는 이 묶음그룹 상품의 새 주문이 막힙니다.');
    expect(scheduled).toContain('지역표에 없는 주소로는 이 묶음그룹 상품을 주문할 수 없게 됩니다.');
    expect(scheduled).toContain('<2026-12-31T00:00:00Z> 뒤에는 이 묶음그룹 상품의 새 주문이 막힙니다.');
    const inherit = shippingChargeGroupRegionConfirmMessage({ ...common, enabled:false, regional:{ mode:'inherit', policy:null } });
    expect(inherit).toContain('지역별 추가배송비: 출고지 설정을 그대로 따릅니다. 이 묶음그룹의 지역표는 더 쓰지 않습니다.');
    expect(inherit).toContain("'사용 안 함'이라 지금 주문에는 쓰이지 않습니다. '사용'으로 바꿔 저장하면 그때부터 적용됩니다.");
    for (const message of [scheduled, inherit]) expect(message).not.toMatch(/근거|계약|추가료|확인했습니다|버전/);
  });
});
