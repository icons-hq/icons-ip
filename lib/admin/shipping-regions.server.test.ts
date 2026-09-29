import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { emptyShippingRegionPolicy } from './shipping-regions';
import { loadAdminShippingRegionExpiry } from './shipping-regions.server';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc }) }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-28T00:00:00Z'));
  rpc.mockReset().mockResolvedValue({ data: [], error: null });
});
afterEach(() => vi.useRealTimers());

it('staff 정책 조회 결과로 경고를 파생하고 운영 근거 원문은 반환하지 않는다', async () => {
  rpc.mockResolvedValue({ error: null, data: [{
    ...emptyShippingRegionPolicy('00000000-0000-4000-8000-000000000001', 'hanjin'),
    originName:'김포',carrierLabel:'한진택배',id: '00000000-0000-4000-8000-000000000002', name: '9월 정책', version: 1, revision: 1,
    status: 'active', startsAt: '2026-09-01T00:00:00Z', endsAt: '2026-09-30T00:00:00Z', openEnded: false,
    confirmedAt: '2026-09-01T00:00:00Z', confirmedBy: 'staff', updatedAt: '2026-09-01T00:00:00Z', sourceEvidence: 'INTERNAL-REFERENCE',
  }] });
  const state = await loadAdminShippingRegionExpiry();
  expect(state).toEqual({ warnings: [{ originName:'김포',carrierLabel:'한진택배',id: '00000000-0000-4000-8000-000000000002', name: '9월 정책', version: 1,
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
