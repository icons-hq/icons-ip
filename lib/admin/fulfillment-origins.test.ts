import { describe, expect, it } from 'vitest';
import {
  changedFulfillmentOriginFields, fulfillmentOriginFormValues, fulfillmentOriginSaveConfirm, originCarrierChangeGroupWarning, originCarrierChangeWarning, originDeactivateGoodsLine,
  originDeactivateRestrictionLine, originFeeReadback, parseFulfillmentOriginInput, type FulfillmentOrigin, type OriginChargeGroupUse, type OriginRegionalFeeUse, type OriginSaveImpact,
} from './fulfillment-origins';

describe('origin settings input', () => {
  it('accepts explicit zero fees and absent free thresholds, and bounds invalid values', () => {
    const input={code:'gimpo',name:' 김포 ',defaultCarrier:'hanjin',baseFee:'0',freeThreshold:'',returnAddress:' 창고 주소 ',cutoff:'17:30',exportTemplate:'wms_csv',active:'true'};
    expect(parseFulfillmentOriginInput(input)).toMatchObject({ok:true,value:{name:'김포',base_fee:0,free_threshold:null,return_address:'창고 주소',is_active:true}});
    expect(parseFulfillmentOriginInput({...input,baseFee:'-1'})).toMatchObject({ok:false,errors:{baseFee:expect.any(String)}});
    expect(parseFulfillmentOriginInput({...input,cutoff:'25:80',defaultCarrier:''})).toMatchObject({ok:false,errors:{cutoff:expect.any(String),defaultCarrier:expect.any(String)}});
  });
  it('말하는 이름은 화면의 칸 이름과 같고, 고칠 방법까지 적는다', () => {
    const input = { code: 'GIMPO', name: '김포', defaultCarrier: '', baseFee: '3000', freeThreshold: '-1', returnAddress: '', cutoff: '', exportTemplate: 'standard', active: 'true' };
    const result = parseFulfillmentOriginInput(input);
    expect(result).toMatchObject({ ok: false, errors: {
      code: '출고지 코드는 영문 소문자로 시작하는 영문·숫자·하이픈 2~40자로 적어 주세요. 예: gimpo',
      defaultCarrier: '사용으로 저장하려면 기본 택배사를 골라 주세요.',
      freeThreshold: '무료 배송 기준은 0~100,000,000원 사이로 입력하거나 비워 주세요.',
    } });
    expect(JSON.stringify(result)).not.toMatch(/활성/);
  });
});

const origin: FulfillmentOrigin = { id: '00000000-0000-4000-8000-000000042201', code: 'gimpo', name: '김포', defaultCarrier: 'hanjin', baseFee: 4700, freeThreshold: 62000,
  returnAddress: '김포 주소', cutoff: '17:00', exportTemplate: 'standard', active: true, updatedAt: '2026-09-01T00:00:00Z' };
const LABELS: Record<string, string> = { hanjin: '한진택배', cj: 'CJ대한통운' };
const label = (code: string) => code ? LABELS[code] ?? code : '고르지 않음';
const managedOnHanjin: OriginRegionalFeeUse = { managed: true, inEffectCarrierCodes: ['hanjin'], scheduledCarrierCodes: [] };

describe('폼 값', () => {
  it('출고지가 없으면 새 폼의 기본값이고, 있으면 저장된 값을 글자로 돌려준다', () => {
    expect(fulfillmentOriginFormValues()).toEqual({ code: '', name: '', defaultCarrier: '', baseFee: '', freeThreshold: '', returnAddress: '', cutoff: '', exportTemplate: 'standard', active: 'false' });
    expect(fulfillmentOriginFormValues(origin)).toEqual({ code: 'gimpo', name: '김포', defaultCarrier: 'hanjin', baseFee: '4700', freeThreshold: '62000', returnAddress: '김포 주소', cutoff: '17:00', exportTemplate: 'standard', active: 'true' });
    expect(fulfillmentOriginFormValues({ ...origin, freeThreshold: null, defaultCarrier: null, cutoff: null }))
      .toMatchObject({ freeThreshold: '', defaultCarrier: '', cutoff: '' });
  });
  it('다른 사람이 바꾼 칸의 이름만 돌려준다(금액은 숫자로 같으면 같은 값)', () => {
    const mine = fulfillmentOriginFormValues(origin);
    expect(changedFulfillmentOriginFields(mine, { ...mine })).toEqual([]);
    expect(changedFulfillmentOriginFields(mine, { ...mine, baseFee: '04700' })).toEqual([]);
    expect(changedFulfillmentOriginFields(mine, { ...mine, baseFee: '5000', active: 'false', freeThreshold: '' })).toEqual(['기본 배송비', '무료 배송 기준', '사용 여부']);
  });
});

describe('기본 배송비·무료 배송 기준 되읽기', () => {
  it('금액이 비었거나 숫자가 아니면 말하지 않는다', () => {
    expect(originFeeReadback({ baseFee: '', freeThreshold: '' })).toBeNull();
    expect(originFeeReadback({ baseFee: '3000', freeThreshold: '5만원' })).toBeNull();
    expect(originFeeReadback({ baseFee: '-1', freeThreshold: '' })).toBeNull();
  });
  it('기준이 비면 금액과 관계없이 받고, 있으면 기준 이상에서 무료다(쿠폰·적립금 전 금액)', () => {
    expect(originFeeReadback({ baseFee: '3000', freeThreshold: '' })).toBe("'출고지 정책 따름' 상품은 금액과 관계없이 주문마다 배송비 3,000원을 받습니다.");
    expect(originFeeReadback({ baseFee: '3000', freeThreshold: '50000' })).toBe("'출고지 정책 따름' 상품은 주문마다 배송비 3,000원을 받고, 상품 금액이 50,000원 이상이면 무료입니다(쿠폰·적립금을 쓰기 전 금액).");
  });
  it('배송비나 기준이 0이면 받지 않는다(기준 0은 늘 무료 — calculate_goods_shipping과 같다)', () => {
    expect(originFeeReadback({ baseFee: '0', freeThreshold: '' })).toBe("'출고지 정책 따름' 상품은 배송비를 받지 않습니다.");
    expect(originFeeReadback({ baseFee: '3000', freeThreshold: '0' })).toBe("'출고지 정책 따름' 상품은 배송비를 받지 않습니다.");
  });
});

describe('기본 택배사를 바꿀 때의 경고', () => {
  const warn = (patch: Partial<Parameters<typeof originCarrierChangeWarning>[0]> = {}) =>
    originCarrierChangeWarning({ from: 'hanjin', to: 'cj', active: true, regionalFee: managedOnHanjin, label, ...patch });
  it('지역별 추가배송비를 쓰는 출고지는 새 택배사로 정한 설정이 없으면 새 주문이 막힌다고 알리고 무엇을 바꿔야 하는지 말한다', () => {
    expect(warn()).toEqual({ certain: true, title: '바꾸면 이 출고지의 새 주문이 막힙니다',
      body: '지역별 추가배송비가 한진택배 기준으로 정해져 있어 CJ대한통운에는 적용되지 않습니다. 바꾼 뒤 지역별 추가배송비에서 CJ대한통운 기준으로 만들어 적용하면 새 주문을 다시 받습니다.' });
  });
  it('새 택배사 기준이 시작 전이면 시작할 때까지 막힌다고 말한다', () => {
    expect(warn({ regionalFee: { ...managedOnHanjin, scheduledCarrierCodes: ['cj'] } })?.body).toBe('CJ대한통운 기준 지역별 추가배송비는 아직 적용 시작 전이라, 시작할 때까지 이 출고지의 새 주문이 막힙니다.');
  });
  it('알릴 것이 없을 때는 null이다', () => {
    expect(warn({ active: false })).toBeNull();
    expect(warn({ to: 'hanjin' })).toBeNull();
    expect(warn({ to: '' })).toBeNull();
    expect(warn({ regionalFee: { managed: false, inEffectCarrierCodes: [], scheduledCarrierCodes: [] } })).toBeNull();
    expect(warn({ regionalFee: { ...managedOnHanjin, inEffectCarrierCodes: ['hanjin', 'cj'] } })).toBeNull();
    /* 지금도 한진 기준 설정이 적용 중이 아니면 이미 막혀 있다 — 바꿔도 달라지는 것이 없다. */
    expect(warn({ regionalFee: { managed: true, inEffectCarrierCodes: [], scheduledCarrierCodes: [] } })).toBeNull();
    expect(warn({ from: '' })).toBeNull();
  });
  it('지역별 추가배송비를 읽지 못했으면 막히는지 모른다고 말하고 안전하다고 하지 않는다', () => {
    expect(warn({ regionalFee: null })).toMatchObject({ certain: false, title: '새 주문이 막히는지 확인하지 못했습니다' });
    expect(warn({ regionalFee: null, to: 'hanjin' })).toBeNull();
  });
});

/*
 * 주문 견적(private.calculate_shipping_charge_group_shipping)은 자체 지역표를 쓰는 '사용' 묶음그룹의 지역표 택배사가 출고지의 기본 택배사와 다르면
 * 그 묶음그룹 상품의 새 주문을 막는다. 그래서 기본 택배사를 바꾸는 저장은 지역별 추가배송비 말고 묶음그룹 상품에도 닿는다.
 */
describe('기본 택배사를 바꿀 때 자체 지역표를 쓰는 묶음그룹 경고', () => {
  const onHanjin: OriginChargeGroupUse[] = [{ carrierCode: 'hanjin', groups: 2, goods: 15 }];
  const warn = (patch: Partial<Parameters<typeof originCarrierChangeGroupWarning>[0]> = {}) =>
    originCarrierChangeGroupWarning({ from: 'hanjin', to: 'cj', active: true, chargeGroups: onHanjin, label, ...patch });
  const BODY = '자체 지역표를 쓰는 묶음그룹 2개(넣은 상품 15개)는 지역표가 한진택배 기준이라 CJ대한통운에는 맞지 않습니다. '
    + '배송비 묶음그룹 목록의 [수정]에서 지역표의 택배사를 CJ대한통운 기준으로 맞출 때까지 그 묶음그룹 상품의 새 주문이 막힙니다.';
  it('지금 기본 택배사로 지역표를 정한 묶음그룹이 있으면 바꾸는 순간 그 묶음그룹 상품의 새 주문이 막힌다고 수와 함께 말한다', () => {
    expect(warn()).toEqual({ certain: true, title: '바꾸면 묶음그룹 상품의 새 주문이 막힙니다', body: BODY });
    expect(warn({ chargeGroups: [{ carrierCode: 'cj', groups: 1, goods: 1 }, ...onHanjin] })?.body).toBe(BODY);
  });
  it('알릴 것이 없을 때는 null이다', () => {
    expect(warn({ active: false })).toBeNull();
    expect(warn({ to: 'hanjin' })).toBeNull();
    expect(warn({ to: '' })).toBeNull();
    expect(warn({ chargeGroups: [] })).toBeNull();
    /* 묶음그룹의 지역표가 지금 기본 택배사가 아니면 이미 막혀 있다 — 바꿔도 달라지는 것이 없다. 새 택배사에 맞는 지역표는 오히려 풀린다. */
    expect(warn({ chargeGroups: [{ carrierCode: 'old', groups: 3, goods: 9 }] })).toBeNull();
    expect(warn({ chargeGroups: [{ carrierCode: 'cj', groups: 3, goods: 9 }] })).toBeNull();
    expect(warn({ from: '' })).toBeNull();
    /* 묶음그룹을 읽지 않은 화면은 묶음그룹에 대해 말하지 않는다. */
    expect(warn({ chargeGroups: undefined })).toBeNull();
  });
  it('묶음그룹을 읽지 못했으면 막히는지 모른다고 말하고 안전하다고 하지 않는다', () => {
    expect(warn({ chargeGroups: null })).toMatchObject({ certain: false, title: '묶음그룹 상품의 새 주문이 막히는지 확인하지 못했습니다' });
    expect(warn({ chargeGroups: null })?.body).toContain('배송비 묶음그룹을 읽지 못했습니다.');
    expect(warn({ chargeGroups: null, to: 'hanjin' })).toBeNull();
    expect(warn({ chargeGroups: null, active: false })).toBeNull();
  });
  it('큰 수는 쉼표를 찍어 말한다', () => {
    expect(warn({ chargeGroups: [{ carrierCode: 'hanjin', groups: 12, goods: 1234 }] })?.body).toContain('묶음그룹 12개(넣은 상품 1,234개)');
  });
});

describe('사용 안 함으로 바꿀 때 영향', () => {
  it('공개 상품 수를 말한다 — 상품은 계속 보이고 새 주문만 막힌다', () => {
    expect(originDeactivateGoodsLine({ publicGoods: 1234, policyFeeGoods: 10 })).toBe('공개 상품 1,234개는 고객에게 계속 보이지만 새 주문은 받을 수 없습니다.');
    expect(originDeactivateGoodsLine({ publicGoods: 0, policyFeeGoods: 0 })).toBe('이 출고지의 공개 상품이 없어 지금 막히는 주문은 없습니다.');
    expect(originDeactivateGoodsLine(null)).toBe('이 출고지의 공개 상품은 고객에게 계속 보이지만 새 주문은 받을 수 없습니다.');
  });
  it('이미 들어온 주문에 남는 제한은 출고지시 양식에 따라 다르다', () => {
    expect(originDeactivateRestrictionLine('standard')).toBe("이미 들어온 주문의 배송비는 그대로입니다. 다만 다시 '사용'으로 바꾸기 전까지 이 출고지 주문은 택배가 아닌 배송 방식으로 바꿀 수 없습니다.");
    expect(originDeactivateRestrictionLine('wms_csv')).toBe("이미 들어온 주문의 배송비는 그대로입니다. 다만 다시 '사용'으로 바꾸기 전까지 이 출고지 주문은 기존 창고 양식으로 운송장 회신을 올릴 수 없고, 택배가 아닌 배송 방식으로도 바꿀 수 없습니다.");
    expect(originDeactivateRestrictionLine('seowon_xlsx')).toContain('기존 창고 양식으로 운송장 회신을 올릴 수 없고');
  });
});

describe('저장 전 확인창', () => {
  const impact: OriginSaveImpact = { goods: { publicGoods: 12, policyFeeGoods: 7 }, regionalFee: managedOnHanjin };
  const same = { active: 'true', defaultCarrier: 'hanjin', baseFee: '4700', freeThreshold: '62000' };
  const confirm = (after: Partial<typeof same & { exportTemplate: string }>, extra: { before?: Partial<typeof same>; impact?: OriginSaveImpact | undefined } = {}) =>
    fulfillmentOriginSaveConfirm({ name: '김포', before: { ...same, ...extra.before }, after: { ...same, exportTemplate: 'standard', ...after },
      impact: 'impact' in extra ? extra.impact : impact, label });

  it('이름·주소·반품 주소처럼 새 주문과 돈에 닿지 않는 저장은 묻지 않는다', () => {
    expect(confirm({})).toBeNull();
    expect(confirm({ baseFee: '04700' })).toBeNull();
  });
  it('사용 안 함으로 바꾸면 대상 출고지·공개 상품 수·남는 제한을 보인다', () => {
    const request = confirm({ active: 'false' });
    expect(request).toMatchObject({ title: '김포 출고지를 사용 안 함으로 바꿀까요?', confirmLabel: '사용 안 함으로 바꾸기', cancelLabel: '돌아가기' });
    expect(request?.message).toBe([
      '사용 여부: 사용 → 사용 안 함',
      '공개 상품 12개는 고객에게 계속 보이지만 새 주문은 받을 수 없습니다.',
      originDeactivateRestrictionLine('standard'),
    ].join('\n'));
  });
  it('사용 안 함으로 바꾸면서 금액을 바꿔도 금액은 묻지 않는다(주문을 받지 않는 동안 달라지는 것이 없다)', () => {
    expect(confirm({ active: 'false', baseFee: '5000' })?.message).not.toContain('기본 배송비');
  });
  it('영향을 읽지 못해도 묻고, 수는 말하지 않는다', () => {
    expect(confirm({ active: 'false' }, { impact: { goods: null, regionalFee: null } })?.message).toContain('이 출고지의 공개 상품은 고객에게 계속 보이지만');
    expect(confirm({ active: 'false' }, { impact: undefined })?.message).toContain('이 출고지의 공개 상품은 고객에게 계속 보이지만');
  });
  it('이미 사용 안 함인 출고지를 그대로 두거나 사용으로 바꾸는 저장은 묻지 않는다', () => {
    expect(confirm({ active: 'false' }, { before: { active: 'false' } })).toBeNull();
    expect(confirm({ active: 'true', baseFee: '5000' }, { before: { active: 'false' } })).toBeNull();
  });
  it('지역별 추가배송비가 막는 택배사로 바꾸면 무엇이 막히고 무엇을 해야 하는지 말한다', () => {
    const request = confirm({ defaultCarrier: 'cj' });
    expect(request).toMatchObject({ title: '김포 기본 택배사를 바꿀까요?', confirmLabel: '택배사 바꾸기', cancelLabel: '돌아가기' });
    expect(request?.message).toBe('기본 택배사: 한진택배 → CJ대한통운\n지역별 추가배송비가 한진택배 기준으로 정해져 있어 CJ대한통운에는 적용되지 않습니다. 바꾼 뒤 지역별 추가배송비에서 CJ대한통운 기준으로 만들어 적용하면 새 주문을 다시 받습니다.');
  });
  it('막히지 않는 택배사 변경은 묻지 않는다(지역별 추가배송비를 안 쓰거나 새 택배사 기준이 이미 적용 중)', () => {
    expect(confirm({ defaultCarrier: 'cj' }, { impact: { goods: impact.goods, regionalFee: { managed: false, inEffectCarrierCodes: [], scheduledCarrierCodes: [] } } })).toBeNull();
    expect(confirm({ defaultCarrier: 'cj' }, { impact: { goods: impact.goods, regionalFee: { ...managedOnHanjin, inEffectCarrierCodes: ['hanjin', 'cj'] } } })).toBeNull();
    /* 새 출고지·읽기 전용 화면은 영향을 읽어 오지 않는다. */
    expect(confirm({ defaultCarrier: 'cj' }, { impact: undefined })).toBeNull();
  });
  it('자체 지역표를 쓰는 묶음그룹이 막히는 택배사로 바꾸면 확인창이 그 묶음그룹 수와 고칠 곳을 말한다 — 지역별 추가배송비를 쓰지 않는 출고지여도 묻는다', () => {
    const chargeGroups: OriginChargeGroupUse[] = [{ carrierCode: 'hanjin', groups: 2, goods: 15 }];
    const notManaged = { managed: false, inEffectCarrierCodes: [], scheduledCarrierCodes: [] };
    const groupsOnly = confirm({ defaultCarrier: 'cj' }, { impact: { goods: impact.goods, regionalFee: notManaged, chargeGroups } });
    expect(groupsOnly).toMatchObject({ title: '김포 기본 택배사를 바꿀까요?', confirmLabel: '택배사 바꾸기', cancelLabel: '돌아가기' });
    expect(groupsOnly?.message).toBe('기본 택배사: 한진택배 → CJ대한통운\n자체 지역표를 쓰는 묶음그룹 2개(넣은 상품 15개)는 지역표가 한진택배 기준이라 CJ대한통운에는 맞지 않습니다. '
      + '배송비 묶음그룹 목록의 [수정]에서 지역표의 택배사를 CJ대한통운 기준으로 맞출 때까지 그 묶음그룹 상품의 새 주문이 막힙니다.');
    /* 지역별 추가배송비도 막히면 한 확인창에 두 줄이다. */
    const both = confirm({ defaultCarrier: 'cj' }, { impact: { ...impact, chargeGroups } });
    expect(both?.message.split('\n')).toEqual(['기본 택배사: 한진택배 → CJ대한통운',
      '지역별 추가배송비가 한진택배 기준으로 정해져 있어 CJ대한통운에는 적용되지 않습니다. 바꾼 뒤 지역별 추가배송비에서 CJ대한통운 기준으로 만들어 적용하면 새 주문을 다시 받습니다.',
      expect.stringContaining('자체 지역표를 쓰는 묶음그룹 2개(넣은 상품 15개)')]);
    /* 묶음그룹을 읽지 못했으면 모른다고 말한 뒤 묻는다. */
    expect(confirm({ defaultCarrier: 'cj' }, { impact: { goods: impact.goods, regionalFee: notManaged, chargeGroups: null } })?.message).toContain('배송비 묶음그룹을 읽지 못했습니다.');
  });
  it('막히는 묶음그룹이 없으면(없거나 지역표 택배사가 지금도 다르거나 새 택배사와 같다) 택배사를 바꿔도 묻지 않는다', () => {
    const notManaged = { managed: false, inEffectCarrierCodes: [], scheduledCarrierCodes: [] };
    for (const chargeGroups of [[], [{ carrierCode: 'old', groups: 1, goods: 1 }], [{ carrierCode: 'cj', groups: 1, goods: 1 }]] as OriginChargeGroupUse[][]) {
      expect(confirm({ defaultCarrier: 'cj' }, { impact: { goods: impact.goods, regionalFee: notManaged, chargeGroups } })).toBeNull();
    }
    /* 택배사가 그대로면 묶음그룹이 있어도 묻지 않는다. */
    expect(confirm({ baseFee: '04700' }, { impact: { goods: impact.goods, regionalFee: notManaged, chargeGroups: [{ carrierCode: 'hanjin', groups: 1, goods: 1 }] } })).toBeNull();
  });
  it('기본 배송비·무료 배송 기준을 바꾸면 이전 값 → 새 값과 \'출고지 정책 따름\' 공개 상품 수를 보인다', () => {
    const request = confirm({ baseFee: '5000', freeThreshold: '' });
    expect(request).toMatchObject({ title: '김포 배송비를 바꿀까요?', confirmLabel: '배송비 바꾸기' });
    expect(request?.message).toBe("기본 배송비 4,700원 → 5,000원\n무료 배송 기준 62,000원 → 없음\n'출고지 정책 따름' 공개 상품 7개\n\n지금부터 새 주문에 적용됩니다. 이미 들어온 주문의 배송비는 그대로입니다.");
    expect(confirm({ freeThreshold: '70000' })?.message).toBe("무료 배송 기준 62,000원 → 70,000원\n'출고지 정책 따름' 공개 상품 7개\n\n지금부터 새 주문에 적용됩니다. 이미 들어온 주문의 배송비는 그대로입니다.");
    /* 상품 수를 읽지 못하면 수는 빼고 말한다. */
    expect(confirm({ baseFee: '5000', freeThreshold: '' }, { before: { freeThreshold: '' }, impact: { goods: null, regionalFee: null } })?.message)
      .toBe('기본 배송비 4,700원 → 5,000원\n\n지금부터 새 주문에 적용됩니다. 이미 들어온 주문의 배송비는 그대로입니다.');
  });
  it('숫자가 아닌 금액은 묻지 않는다 — 저장이 거절돼 입력 안내가 먼저다', () => {
    expect(confirm({ baseFee: '오천' })).toBeNull();
    expect(confirm({ freeThreshold: '5만' })).toBeNull();
  });
  it('택배사와 금액을 함께 바꾸면 한 번에 묻는다', () => {
    const request = confirm({ defaultCarrier: 'cj', baseFee: '5000' });
    expect(request).toMatchObject({ title: '김포 출고지 설정을 바꿀까요?', confirmLabel: '이대로 저장' });
    expect(request?.message).toContain('기본 택배사: 한진택배 → CJ대한통운');
    expect(request?.message).toContain('기본 배송비 4,700원 → 5,000원');
    expect(request?.message.indexOf('기본 택배사')).toBeLessThan(request?.message.indexOf('기본 배송비') ?? -1);
  });
});
