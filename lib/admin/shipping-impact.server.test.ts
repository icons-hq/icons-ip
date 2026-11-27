import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chargeAdminFixtures, chargeId, chargeIds } from '@/test/fixtures/shipping-charge-groups';
import type { ShippingChargeGroup } from './shipping-charge-groups';
import { deriveOriginRegionalFeeUse, loadCarrierOriginUses, loadOriginChargeGroupUse, loadOriginGoodsImpact, loadOriginRegionalFeeUse, loadOriginSaveImpact } from './shipping-impact.server';

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), options: vi.fn(), createClient: vi.fn(), claims: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('./fulfillment-origins.server', () => ({ loadGoodsFulfillmentOptions: mocks.options }));

const NOW = Date.parse('2026-11-26T03:00:00Z');
const PAST = '2026-11-01T00:00:00Z', FUTURE = '2026-12-01T00:00:00Z';

type GoodsRow = { origin_id: string; published_at: string | null; archived_at: string | null; shipping_fee_type: string };
/** 필터를 그대로 적용해 세는 가짜 goods 표. 상품 수 읽기가 거는 조건(출고지·공개·보관 안 됨·배송비 유형)이 맞는지 본다. */
function goodsTable(rows: GoodsRow[], failFor?: string) {
  return () => {
    const filters: ((row: GoodsRow) => boolean)[] = [];
    let origin = '';
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (column: keyof GoodsRow, value: string) => { if (column === 'origin_id') origin = value; filters.push(row => row[column] === value); return builder; },
      is: (column: keyof GoodsRow, value: null) => { filters.push(row => row[column] === value); return builder; },
      not: (column: keyof GoodsRow, operator: string, value: null) => { filters.push(row => !(operator === 'is' && row[column] === value)); return builder; },
      then: (resolve: (value: unknown) => unknown) => resolve(origin === failFor ? { count: null, error: { message: 'x' } } : { count: rows.filter(row => filters.every(test => test(row))).length, error: null }),
    };
    return builder;
  };
}
const good = (origin_id: string, shipping_fee_type: string, patch: Partial<GoodsRow> = {}): GoodsRow => ({ origin_id, shipping_fee_type, published_at: PAST, archived_at: null, ...patch });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.createClient.mockImplementation(async () => ({ from: mocks.from, rpc: mocks.rpc, auth: { getClaims: mocks.claims } }));
  mocks.claims.mockResolvedValue({ data: { claims: { sub: chargeIds.actor, session_id: chargeIds.session } }, error: null });
});

describe('출고지마다 영향받는 공개 상품 수', () => {
  it('공개 중이고 보관되지 않은 상품만 세고, 그 가운데 출고지 정책 따름 상품을 따로 센다', async () => {
    mocks.from.mockImplementation(goodsTable([
      good('a', 'policy'), good('a', 'policy'), good('a', 'policy'), good('a', 'free'),
      good('a', 'policy', { published_at: null }), good('a', 'policy', { archived_at: PAST }), good('b', 'individual'),
    ]));
    expect(await loadOriginGoodsImpact(['a', 'b', 'c'])).toEqual({
      a: { publicGoods: 4, policyFeeGoods: 3 }, b: { publicGoods: 1, policyFeeGoods: 0 }, c: { publicGoods: 0, policyFeeGoods: 0 },
    });
    expect(mocks.from).toHaveBeenCalledWith('goods');
  });
  it('같은 출고지를 여러 번 주어도 한 번만 읽는다', async () => {
    mocks.from.mockImplementation(goodsTable([good('a', 'policy')]));
    expect(await loadOriginGoodsImpact(['a', 'a'])).toEqual({ a: { publicGoods: 1, policyFeeGoods: 1 } });
    expect(mocks.from).toHaveBeenCalledTimes(2);
  });
  it('읽지 못한 출고지는 빠지고(0으로 말하지 않는다), 출고지를 안 주면 읽지 않는다', async () => {
    mocks.from.mockImplementation(goodsTable([good('a', 'policy')], 'b'));
    expect(await loadOriginGoodsImpact(['a', 'b'])).toEqual({ a: { publicGoods: 1, policyFeeGoods: 1 } });
    mocks.from.mockClear();
    expect(await loadOriginGoodsImpact([])).toEqual({});
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it('연결을 만들지 못하면 던지지 않고 비워 돌려준다', async () => {
    mocks.createClient.mockRejectedValue(new Error('down'));
    expect(await loadOriginGoodsImpact(['a'])).toEqual({});
  });
});

describe('지역별 추가배송비 사용 여부', () => {
  const adoptions = [{ originId: 'a', managedFrom: PAST }, { originId: 'b', managedFrom: FUTURE }];
  const policy = (originId: string, carrierCode: string, patch: Record<string, unknown> = {}) => ({ originId, carrierCode, status: 'active', startsAt: PAST, endsAt: null, ...patch });

  it('도입 시각이 지난 출고지만 쓰는 출고지이고, 활성이면서 적용 기간 안인 택배사가 적용 중이다', () => {
    expect(deriveOriginRegionalFeeUse([
      policy('a', 'hanjin'), policy('a', 'hanjin', { startsAt: '2026-11-10T00:00:00Z' }),
      policy('a', 'cj', { startsAt: FUTURE }), policy('a', 'lotte', { endsAt: '2026-11-20T00:00:00Z' }), policy('a', 'post', { status: 'draft', startsAt: null }), policy('a', 'old', { status: 'retired' }),
      policy('b', 'hanjin'),
    ], adoptions, NOW)).toEqual({
      a: { managed: true, inEffectCarrierCodes: ['hanjin'], scheduledCarrierCodes: ['cj'] },
      b: { managed: false, inEffectCarrierCodes: ['hanjin'], scheduledCarrierCodes: [] },
    });
  });
  it('도입 기록이 없거나 아직 도입 시각 전인 출고지는 키가 없다(쓰지 않는다)', () => {
    expect(deriveOriginRegionalFeeUse([], [], NOW)).toEqual({});
    /* 도입 시각이 아직 안 된 출고지(b)는 정책이 없으면 키도 없다. 지금은 쓰지 않는 출고지와 같다. */
    expect(deriveOriginRegionalFeeUse([], adoptions, NOW)).toEqual({ a: { managed: true, inEffectCarrierCodes: [], scheduledCarrierCodes: [] } });
  });
  it('읽히지 않는 행이 하나라도 있으면 단정하지 않고 null이다', () => {
    expect(deriveOriginRegionalFeeUse([policy('a', 'hanjin'), { originId: 'a' }], adoptions, NOW)).toBeNull();
    expect(deriveOriginRegionalFeeUse([], [{ originId: 'a', managedFrom: '날짜 아님' }], NOW)).toBeNull();
    expect(deriveOriginRegionalFeeUse([null], [], NOW)).toBeNull();
  });

  it('지역별 추가배송비 목록을 읽어 출고지별로 가린다', async () => {
    mocks.rpc.mockResolvedValue({ data: { policies: [policy('a', 'hanjin')], adoptions }, error: null });
    expect(await loadOriginRegionalFeeUse(NOW)).toMatchObject({ a: { managed: true, inEffectCarrierCodes: ['hanjin'] } });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_list_shipping_region_policies');
  });
  it('읽지 못하거나 모양이 다르면 null이다(안전하다고 말하지 않는다)', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'denied' } });
    expect(await loadOriginRegionalFeeUse(NOW)).toBeNull();
    mocks.rpc.mockResolvedValue({ data: { policies: 'x', adoptions: [] }, error: null });
    expect(await loadOriginRegionalFeeUse(NOW)).toBeNull();
    mocks.rpc.mockRejectedValue(new Error('down'));
    expect(await loadOriginRegionalFeeUse(NOW)).toBeNull();
  });
});

/** 묶음그룹 목록 조회(admin_list_shipping_charge_groups)가 돌려주는 모양. 읽는 쪽이 같은 검사로 받는다. */
const groupList = (groups: ShippingChargeGroup[], patch: Record<string, unknown> = {}) => ({ actorId: chargeIds.actor, sessionId: chargeIds.session, runtimeEnabled: true,
  page: 1, pageSize: 20, total: groups.length, groups, origins: [chargeAdminFixtures().origin], canManageRegional: true, ...patch });
/** 지역표를 쓰는 '사용' 묶음그룹. `n`으로 번호를 달리 한다. */
function overrideGroup(n: number, carrierCode: string, assignedCount: number, policy: Record<string, unknown> = {}): ShippingChargeGroup {
  const { group, region } = chargeAdminFixtures();
  return { ...group, id: chargeId(100 + n), versionId: chargeId(200 + n), name: `묶음그룹 ${n}`, assignedCount, regional: { mode: 'override', policy: { ...region, carrierCode, ...policy } } };
}
const inheritGroup = (n: number, assignedCount = 0): ShippingChargeGroup => ({ ...chargeAdminFixtures().group, id: chargeId(100 + n), versionId: chargeId(200 + n), name: `묶음그룹 ${n}`, assignedCount });

describe('출고지의 자체 지역표 묶음그룹', () => {
  const O = chargeIds.origin;
  it('지금 적용 기간 안인 지역표를 택배사별로 묶음그룹 수와 넣은 상품 수로 센다', async () => {
    mocks.rpc.mockResolvedValue({ data: groupList([
      overrideGroup(1, 'hanjin', 2), overrideGroup(2, 'hanjin', 3), overrideGroup(3, 'cj', 1),
      /* 출고지 설정을 따르는 묶음그룹, 시작 전인 지역표, 이미 끝난 지역표는 센다고 해서 이 저장이 막는 것이 아니다. */
      inheritGroup(4, 5), overrideGroup(5, 'hanjin', 4, { startsAt: '2027-01-01T00:00:00.000Z' }), overrideGroup(6, 'hanjin', 6, { openEnded: false, endsAt: '2026-11-01T00:00:00.000Z' }),
    ]), error: null });
    expect(await loadOriginChargeGroupUse(O, NOW)).toEqual([{ carrierCode: 'cj', groups: 1, goods: 1 }, { carrierCode: 'hanjin', groups: 2, goods: 5 }]);
    /* 이 출고지의 '사용' 묶음그룹만, 첫 쪽부터 읽는다. 로그인·세션은 지금 로그인한 계정의 것이다. */
    expect(mocks.rpc).toHaveBeenCalledWith('admin_list_shipping_charge_groups', { p_origin_id: O, p_query: '', p_status: 'active', p_page: 1,
      p_expected_actor_id: chargeIds.actor, p_expected_session_id: chargeIds.session });
  });
  it('자체 지역표를 쓰는 묶음그룹이 없으면 빈 목록이다(읽지 못한 것과 다르다)', async () => {
    mocks.rpc.mockResolvedValue({ data: groupList([inheritGroup(1, 3)]), error: null });
    expect(await loadOriginChargeGroupUse(O, NOW)).toEqual([]);
    mocks.rpc.mockResolvedValue({ data: groupList([]), error: null });
    expect(await loadOriginChargeGroupUse(O, NOW)).toEqual([]);
  });
  it('묶음그룹이 20개를 넘으면 쪽마다 이어 읽는다', async () => {
    const first = Array.from({ length: 20 }, (_, i) => overrideGroup(i + 1, 'hanjin', 1));
    const second = [overrideGroup(21, 'hanjin', 2), overrideGroup(22, 'cj', 4)];
    mocks.rpc.mockImplementation(async (_name: string, args: { p_page: number }) => ({ data: args.p_page === 1 ? groupList(first, { total: 22 }) : groupList(second, { total: 22, page: 2 }), error: null }));
    expect(await loadOriginChargeGroupUse(O, NOW)).toEqual([{ carrierCode: 'cj', groups: 1, goods: 4 }, { carrierCode: 'hanjin', groups: 21, goods: 22 }]);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });
  it('읽지 못하면 null이다 — 로그인 정보가 없거나, 조회가 거절됐거나, 다른 계정의 답이거나, 너무 많아 다 읽지 못한 경우', async () => {
    mocks.rpc.mockResolvedValue({ data: groupList([overrideGroup(1, 'hanjin', 1)]), error: null });
    mocks.claims.mockResolvedValue({ data: null, error: { message: 'x' } });
    expect(await loadOriginChargeGroupUse(O, NOW)).toBeNull();
    mocks.claims.mockResolvedValue({ data: { claims: { sub: chargeIds.actor } }, error: null });
    expect(await loadOriginChargeGroupUse(O, NOW)).toBeNull();
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.claims.mockResolvedValue({ data: { claims: { sub: chargeIds.actor, session_id: chargeIds.session } }, error: null });
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'denied', code: '42501' } });
    expect(await loadOriginChargeGroupUse(O, NOW)).toBeNull();
    mocks.rpc.mockResolvedValue({ data: groupList([overrideGroup(1, 'hanjin', 1)], { actorId: chargeIds.other }), error: null });
    expect(await loadOriginChargeGroupUse(O, NOW)).toBeNull();
    mocks.rpc.mockResolvedValue({ data: groupList([overrideGroup(1, 'hanjin', 1)], { total: 600 }), error: null });
    expect(await loadOriginChargeGroupUse(O, NOW)).toBeNull();
    mocks.createClient.mockRejectedValue(new Error('down'));
    expect(await loadOriginChargeGroupUse(O, NOW)).toBeNull();
  });
});

describe('출고지 저장 전에 알릴 영향', () => {
  it('상품 수·지역별 추가배송비 사용 여부·자체 지역표 묶음그룹을 함께 돌려주고, 읽지 못한 쪽은 null이다', async () => {
    mocks.from.mockImplementation(goodsTable([good(chargeIds.origin, 'policy'), good(chargeIds.origin, 'free')]));
    mocks.rpc.mockImplementation(async (name: string) => name === 'admin_list_shipping_charge_groups'
      ? { data: groupList([overrideGroup(1, 'hanjin', 2)]), error: null }
      : { data: { policies: [{ originId: chargeIds.origin, carrierCode: 'hanjin', status: 'active', startsAt: PAST, endsAt: null }], adoptions: [{ originId: chargeIds.origin, managedFrom: PAST }] }, error: null });
    expect(await loadOriginSaveImpact(chargeIds.origin, NOW)).toEqual({ goods: { publicGoods: 2, policyFeeGoods: 1 },
      regionalFee: { managed: true, inEffectCarrierCodes: ['hanjin'], scheduledCarrierCodes: [] }, chargeGroups: [{ carrierCode: 'hanjin', groups: 1, goods: 2 }] });
    /* 도입 기록이 없는 출고지는 쓰지 않는 출고지이고, 묶음그룹이 없으면 빈 목록이다. */
    mocks.from.mockImplementation(goodsTable([]));
    mocks.rpc.mockImplementation(async (name: string) => name === 'admin_list_shipping_charge_groups' ? { data: groupList([]), error: null } : { data: { policies: [], adoptions: [] }, error: null });
    expect(await loadOriginSaveImpact(chargeIds.origin, NOW)).toEqual({ goods: { publicGoods: 0, policyFeeGoods: 0 },
      regionalFee: { managed: false, inEffectCarrierCodes: [], scheduledCarrierCodes: [] }, chargeGroups: [] });
    mocks.from.mockImplementation(goodsTable([], 'a'));
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'x' } });
    expect(await loadOriginSaveImpact('a', NOW)).toEqual({ goods: null, regionalFee: null, chargeGroups: null });
  });
});

describe('택배사를 기본으로 쓰는 출고지', () => {
  const options = [
    { id: 'a', name: '김포', defaultCarrier: 'hanjin', active: true }, { id: 'b', name: '남양주', defaultCarrier: 'hanjin', active: false },
    { id: 'c', name: '택배사 없음', defaultCarrier: null, active: false }, { id: 'd', name: '대구', defaultCarrier: 'cj', active: true },
  ];
  it('택배사 코드마다 쓰는 출고지(사용 안 함 포함)와 지역별 추가배송비 사용 여부를 돌려준다', async () => {
    mocks.options.mockResolvedValue(options);
    mocks.rpc.mockResolvedValue({ data: { policies: [], adoptions: [{ originId: 'a', managedFrom: PAST }] }, error: null });
    expect(await loadCarrierOriginUses(NOW)).toEqual({
      hanjin: [{ originId: 'a', originName: '김포', active: true, usesRegionalFee: true }, { originId: 'b', originName: '남양주', active: false, usesRegionalFee: false }],
      cj: [{ originId: 'd', originName: '대구', active: true, usesRegionalFee: false }],
    });
  });
  it('지역별 추가배송비를 읽지 못하면 쓰는지 모른다(null)고 하되 쓰는 출고지 목록은 돌려준다', async () => {
    mocks.options.mockResolvedValue(options);
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'x' } });
    const uses = await loadCarrierOriginUses(NOW);
    expect(uses?.hanjin).toHaveLength(2);
    expect(uses?.hanjin.every(use => use.usesRegionalFee === null)).toBe(true);
  });
  it('출고지 목록을 읽지 못하면 null이다 — 쓰는 출고지가 없다는 뜻이 아니다', async () => {
    mocks.options.mockRejectedValue(new Error('상품 출고지 선택지를 불러오지 못했습니다.'));
    mocks.rpc.mockResolvedValue({ data: { policies: [], adoptions: [] }, error: null });
    expect(await loadCarrierOriginUses(NOW)).toBeNull();
  });
});
