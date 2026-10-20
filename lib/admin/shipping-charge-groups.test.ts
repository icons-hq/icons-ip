import { describe, expect, it } from 'vitest';
import { chargeAdminFixtures, chargeId, chargeIds, chargeIdentity, chargeLater, chargeTime } from '@/test/fixtures/shipping-charge-groups';
import { emptyShippingChargeGroupRegionPolicy, emptyShippingChargeGroupValues, parseShippingChargeGroup, parseShippingChargeGroupAssignRequest,
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
    expect(parseShippingChargeGroupValues({ ...save.values, regional:{ mode:'override',policy:{ ...region,sourceEvidence:'' } } })).toBeNull();
    expect(parseShippingChargeGroupValues({ ...save.values, enabled:false, regional:{ mode:'override',policy:{ ...region,sourceEvidence:'' } } })).not.toBeNull();
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
