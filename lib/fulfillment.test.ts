import { describe, expect, it } from 'vitest';
import { claimCollectionRowLabel, customerShipmentGroupLabels, parseGoodShippingPolicy, parseShippingNoticeSnapshot, parseShippingQuote, parseShippingQuoteItems, shipmentGroupLabel, shippingGroupLabel, shippingGroupsNotice, shippingPolicyDescription } from './fulfillment';

describe('shipping quote contract', () => {
  it('accepts server groups and rejects inconsistent or missing totals', () => {
    const group={originId:'00000000-0000-4000-8000-000000042201',originCode:'gimpo',originName:'김포',policySubtotal:20000,baseFee:3000,freeThreshold:50000,policyFee:3000,individualFee:5000,totalFee:8000};
    expect(parseShippingQuote({totalFee:8000,groups:[group]})).toEqual({totalFee:8000,groups:[group]});
    expect(parseShippingQuote({totalFee:0,groups:[group]})).toBeNull();
    expect(parseShippingQuote({totalFee:0})).toBeNull();
  });
  it('describes policy/free/individual terms without hardcoded fee rules', () => {
    const policy={originId:'origin',originName:'김포',baseFee:4200,freeThreshold:65000,feeType:'policy' as const,individualFee:0};
    expect(shippingPolicyDescription(policy)).toContain('4,200');
    /* 고객 화면은 출고지 이름을 말하지 않는다(10/14 회의 S7). */
    expect(shippingPolicyDescription(policy)).not.toContain('김포');
    expect(shippingPolicyDescription({...policy,feeType:'free'})).toBe('무료배송');
    expect(shippingPolicyDescription({...policy,feeType:'individual',individualFee:2700})).toContain('굿즈당 1회');
  });
});

it('retains the cart quantity and 1000-line merge limits', () => {
  const items=Array.from({length:1000},()=>({goodId:'g1',variantId:'00000000-0000-4000-8000-000000000001',qty:2147483647}));
  expect(parseShippingQuoteItems(items)).toEqual(items);
  expect(parseShippingQuoteItems([...items,items[0]])).toBeNull();
  expect(parseShippingQuoteItems([{goodId:'g1',qty:2147483648}])).toBeNull();
});

it('requires a canonical option UUID before quoting a cart', () => {
  expect(parseShippingQuoteItems([{goodId:'g1',qty:1}])).toBeNull();
  expect(parseShippingQuoteItems([{goodId:'g1',variantId:'bad',qty:1}])).toBeNull();
});

 it('배송 안내는 고객 문구와 연락처만 전달하고 내부 확인 근거는 제거한다', () => {
  const snapshot = { templateId: 'id', templateVersion: 2, code: 'notice', name: '일반배송', shippingNotice: '첫 줄\n둘째 줄', returnExchangeNotice: '사전 접수', csName: '고객센터', csPhone: '02-123', csEmail: '', confirmationEvidence: '내부 증빙' };
  expect(parseShippingNoticeSnapshot(snapshot)).toEqual({ templateId: 'id', version: 2, code: 'notice', name: '일반배송', shippingNotice: '첫 줄\n둘째 줄', returnExchangeNotice: '사전 접수', csName: '고객센터', csPhone: '02-123', csEmail: '' });
  const policy = { originId: 'id', originName: '출고지', baseFee: 3000, freeThreshold: null, feeType: 'policy', individualFee: 0, returnAddress: '확인된 주소', shippingNotice: snapshot.shippingNotice, cs: { name: '고객센터', phone: '02-123', email: '' }, confirmationEvidence: '내부 증빙' };
  expect(parseGoodShippingPolicy(policy)).not.toHaveProperty('confirmationEvidence');
  expect(parseGoodShippingPolicy(policy)?.shippingNotice).toBe(snapshot.shippingNotice);
  expect(parseGoodShippingPolicy({ ...policy, cs: { name: 42 } })).toBeNull();
});

/* R26(D4①): 고객 화면 배송 묶음 이름은 출고지 기본 택배사다. 출고지 이름(김포·남양주)은 여전히 내지 않는다. */
describe('배송 묶음 이름', () => {
  const hanjin = { carrierLabel: '한진택배' }, epost = { carrierLabel: '우체국택배' }, none = { carrierLabel: null };
  it('택배사 이름으로 부르고, 같은 택배사 묶음이 둘 이상일 때만 번호를 붙인다', () => {
    expect(shippingGroupLabel([hanjin], 0)).toBe('한진택배 배송');
    expect([0, 1].map(index => shippingGroupLabel([hanjin, epost], index))).toEqual(['한진택배 배송', '우체국택배 배송']);
    expect([0, 1, 2].map(index => shippingGroupLabel([hanjin, epost, hanjin], index))).toEqual(['한진택배 배송 1', '우체국택배 배송', '한진택배 배송 2']);
  });
  it('택배사를 모르면 택배 배송으로 부르고, 그런 묶음이 둘 이상이면 번호를 붙인다', () => {
    expect(shippingGroupLabel([none], 0)).toBe('택배 배송');
    expect(shippingGroupLabel([{}], 0)).toBe('택배 배송');
    expect(shippingGroupLabel([{ carrierLabel: '  ' }], 0)).toBe('택배 배송');
    expect([0, 1, 2].map(index => shippingGroupLabel([none, hanjin, none], index))).toEqual(['택배 배송 1', '한진택배 배송', '택배 배송 2']);
  });
  it('주문 상세는 배송 건의 택배사를 알면 같은 규칙, 모르면 기존 배송 묶음 번호를 쓴다', () => {
    expect(shipmentGroupLabel([none], 0)).toBe('배송 묶음');
    expect([0, 1].map(index => shipmentGroupLabel([none, none], index))).toEqual(['배송 묶음 1', '배송 묶음 2']);
    expect([0, 1].map(index => shipmentGroupLabel([hanjin, none], index))).toEqual(['한진택배 배송', '배송 묶음 2']);
    expect([0, 1].map(index => shipmentGroupLabel([hanjin, hanjin], index))).toEqual(['한진택배 배송 1', '한진택배 배송 2']);
  });
  /* m27 CUST-2: 같은 주문 상세 안에서 배송 건 머리(ShipmentDetails)와 회수 계획 행(ClaimCollectionPlan)이 같은 이름을 쓴다. */
  it('주문 상세의 배송 건 이름표는 택배 배송 건만 택배사로 부르고, 회수 계획 행이 그 이름을 그대로 쓴다', () => {
    const shipment = (id: string, carrierLabel: string | null, method?: string) => ({ id, carrierLabel, ...(method ? { delivery: { method } } : {}) });
    expect(customerShipmentGroupLabels([shipment('a', '한진택배'), shipment('b', '우체국택배')])).toEqual({ a: '한진택배 배송', b: '우체국택배 배송' });
    expect(customerShipmentGroupLabels([shipment('a', '한진택배', 'parcel'), shipment('b', '한진택배')])).toEqual({ a: '한진택배 배송 1', b: '한진택배 배송 2' });
    /* 택배가 아닌 수령 방식·택배사를 모르는 건은 기존 '배송 묶음 N'이다. */
    expect(customerShipmentGroupLabels([shipment('a', '한진택배', 'pickup'), shipment('b', null)])).toEqual({ a: '배송 묶음 1', b: '배송 묶음 2' });
    expect(customerShipmentGroupLabels([{ id: 'a', carrierLabel: '한진택배', delivery: null }])).toEqual({ a: '배송 묶음' });
    const labels = { a: '한진택배 배송 1', b: '한진택배 배송 2' };
    /* 회수 문서가 배송 건 일부만 실어도 배송 건 머리의 번호를 그대로 따른다. */
    expect(claimCollectionRowLabel('b', 0, 1, labels)).toBe('한진택배 배송 2');
    /* 이름표가 없거나(어드민 밖 다른 화면) 모르는 배송 건이면 회수 행 순서로 번호를 붙인다. */
    expect(claimCollectionRowLabel('c', 1, 2, labels)).toBe('배송 묶음 2');
    expect(claimCollectionRowLabel('a', 0, 1)).toBe('배송 묶음');
  });
  it('묶음이 둘 이상이면 배송비가 따로 계산되는 이유를 한 줄로 알린다', () => {
    expect(shippingGroupsNotice([hanjin])).toBeNull();
    expect(shippingGroupsNotice([hanjin, epost])).toBe('택배사가 달라 배송비가 각각 계산됩니다.');
    /* 택배사가 같거나 모르면 '택배사가 달라'는 사실이 아니다 — 묶음별 계산만 알린다. */
    expect(shippingGroupsNotice([hanjin, hanjin])).toBe('배송 묶음마다 배송비가 각각 계산됩니다.');
    expect(shippingGroupsNotice([hanjin, none])).toBe('배송 묶음마다 배송비가 각각 계산됩니다.');
  });
});

it('견적 묶음의 택배사 이름은 문자열이거나 null 이다', () => {
  const group={originId:'00000000-0000-4000-8000-000000042201',originCode:'gimpo',originName:'김포',policySubtotal:20000,baseFee:3000,freeThreshold:50000,policyFee:3000,individualFee:0,totalFee:3000};
  expect(parseShippingQuote({totalFee:3000,groups:[{...group,carrierLabel:'한진택배'}]})?.groups[0].carrierLabel).toBe('한진택배');
  expect(parseShippingQuote({totalFee:3000,groups:[{...group,carrierLabel:null}]})?.groups[0].carrierLabel).toBeNull();
  expect(parseShippingQuote({totalFee:3000,groups:[group]})).not.toBeNull();
  expect(parseShippingQuote({totalFee:3000,groups:[{...group,carrierLabel:42}]})).toBeNull();
});
