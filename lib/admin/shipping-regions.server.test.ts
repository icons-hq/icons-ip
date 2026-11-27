import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { emptyShippingRegionPolicy } from './shipping-regions';
import { loadAdminShippingRegionExpiry } from './shipping-regions.server';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc }) }));

const ORIGIN = '00000000-0000-4000-8000-000000000001';
const POLICY = '00000000-0000-4000-8000-000000000002';
const NEXT = '00000000-0000-4000-8000-000000000003';
/** 만료 조회가 돌려주는 줄 — 김포 9월 설정이 9월 30일에 끝난다. */
const endingRow = {
  ...emptyShippingRegionPolicy(ORIGIN, 'hanjin'),
  originName:'김포',carrierLabel:'한진택배',id: POLICY, name: '9월 정책', version: 1, revision: 1,
  status: 'active', startsAt: '2026-09-01T00:00:00Z', endsAt: '2026-09-30T00:00:00Z', openEnded: false,
  confirmedAt: '2026-09-01T00:00:00Z', confirmedBy: 'staff', updatedAt: '2026-09-01T00:00:00Z', sourceEvidence: 'INTERNAL-REFERENCE',
};
/** 전체 설정 조회가 돌려주는 줄 — parseShippingRegionPolicy가 읽는 모양. */
const listedPolicy = (patch: Record<string, unknown>) => ({
  id: POLICY, version: 1, revision: 1, status: 'active', originId: ORIGIN, carrierCode: 'hanjin', name: '정책', startsAt: '2026-09-01T00:00:00Z', endsAt: null,
  openEnded: true, sourceEvidence: '', unlistedDisposition: 'standard', feeUnit: 'per_shipment', chargePolicyGoods: true, waivePolicyThreshold: false,
  chargeFreeGoods: true, chargeIndividualGoods: true, noRulesConfirmed: true, rules: [], confirmedAt: '2026-09-01T00:00:00Z', confirmedBy: 'staff', updatedAt: '2026-09-01T00:00:00Z', ...patch,
});
const answers = (byName: Record<string, unknown>) => rpc.mockImplementation(async (name: string) => byName[name] ?? { data: [], error: null });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-28T00:00:00Z'));
  rpc.mockReset().mockResolvedValue({ data: [], error: null });
});
afterEach(() => vi.useRealTimers());

it('staff 정책 조회 결과로 경고를 파생하고 운영 근거 원문은 반환하지 않는다', async () => {
  answers({ admin_shipping_region_expiry_metadata: { error: null, data: [endingRow] },
    admin_list_shipping_region_policies: { error: null, data: { policies: [listedPolicy({ endsAt: '2026-09-30T00:00:00Z', openEnded: false })], adoptions: [] } } });
  const state = await loadAdminShippingRegionExpiry();
  expect(state).toEqual({ warnings: [{ originName:'김포',carrierLabel:'한진택배',originId: ORIGIN,id: POLICY, name: '9월 정책', version: 1,
    endsAt: '2026-09-30T00:00:00Z', status: 'expiring' }] });
  expect(rpc).toHaveBeenCalledWith('admin_shipping_region_expiry_metadata',{p_at:'2026-09-28T00:00:00.000Z'});
});

it('조회 실패를 정상 또는 미등록 정책으로 취급하지 않는다', async () => {
  rpc.mockResolvedValue({ data: null, error: { message: 'staff_required' } });
  expect(await loadAdminShippingRegionExpiry()).toEqual({ warnings: [], unavailable: true });
});

it('정책이 없으면 경고도 없다', async () => {
  expect(await loadAdminShippingRegionExpiry()).toEqual({ warnings: [] });
});

/* S5-2: 만료 조회는 끝이 없거나 먼 설정을 돌려주지 않는다 — 7일 안에 끝나는 설정이 있을 때만 전체 설정을 한 번 더 읽어 이어지는 설정을 찾는다. */
it('끝나는 때에 바로 이어지는 예정 설정이 있으면 경고하지 않는다', async () => {
  answers({ admin_shipping_region_expiry_metadata: { error: null, data: [endingRow] },
    admin_list_shipping_region_policies: { error: null, data: { adoptions: [{ originId: ORIGIN, managedFrom: '2026-09-01T00:00:00Z' }], policies: [
      listedPolicy({ endsAt: '2026-09-30T00:00:00Z', openEnded: false }),
      listedPolicy({ id: NEXT, version: 2, name: '10월 정책', startsAt: '2026-09-30T00:00:00Z', endsAt: null }),
    ] } } });
  expect(await loadAdminShippingRegionExpiry()).toEqual({ warnings: [] });
  expect(rpc).toHaveBeenCalledWith('admin_list_shipping_region_policies');
});

it('이어지는 설정과 사이에 틈이 있거나 이어지는 설정이 끝났으면 그대로 경고한다', async () => {
  const run = async (next: Record<string, unknown>) => {
    answers({ admin_shipping_region_expiry_metadata: { error: null, data: [endingRow] },
      admin_list_shipping_region_policies: { error: null, data: { adoptions: [], policies: [listedPolicy({ endsAt: '2026-09-30T00:00:00Z', openEnded: false }), listedPolicy({ id: NEXT, version: 2, ...next })] } } });
    return (await loadAdminShippingRegionExpiry()).warnings.map((warning) => warning.id);
  };
  expect(await run({ startsAt: '2026-10-02T00:00:00Z', endsAt: null })).toEqual([POLICY]);
  expect(await run({ startsAt: '2026-09-30T00:00:00Z', status: 'retired' })).toEqual([POLICY]);
});

it('전체 설정을 읽지 못하면 이어지는지 알 수 없으니 경고를 그대로 둔다', async () => {
  answers({ admin_shipping_region_expiry_metadata: { error: null, data: [endingRow] }, admin_list_shipping_region_policies: { data: null, error: { message: 'boom' } } });
  const state = await loadAdminShippingRegionExpiry();
  expect(state.unavailable).toBeUndefined();
  expect(state.warnings.map((warning) => warning.id)).toEqual([POLICY]);
});

it('이미 끝난 설정만 있거나 경고가 없으면 전체 설정을 읽지 않는다', async () => {
  answers({ admin_shipping_region_expiry_metadata: { error: null, data: [{ ...endingRow, endsAt: '2026-09-27T00:00:00Z' }] } });
  expect((await loadAdminShippingRegionExpiry()).warnings.map((warning) => warning.status)).toEqual(['expired']);
  expect(rpc).toHaveBeenCalledTimes(1);
  rpc.mockClear();
  answers({});
  expect(await loadAdminShippingRegionExpiry()).toEqual({ warnings: [] });
  expect(rpc).toHaveBeenCalledTimes(1);
});
