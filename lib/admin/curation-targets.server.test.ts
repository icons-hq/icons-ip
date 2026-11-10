import { beforeEach, expect, it, vi } from 'vitest';
import { loadAdminCurationTargets } from './curation-targets.server';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => mocks }));
beforeEach(() => vi.clearAllMocks());

it('loads narrow curation choices without broad catalog or ticket records and keeps more than 1000 IDs', async () => {
  const goods = Array.from({ length: 1001 }, (_, i) => ({ id: `g${i}`, title: `상품${i}`, archivedAt: null, internalNote: 'must not be forwarded' }));
  mocks.rpc.mockResolvedValue({ data: { ips: [{ id: 'ip', publicSlug: 'public-ip', title: 'IP', archivedAt: null }], goods, events: [] }, error: null });
  const result = await loadAdminCurationTargets();
  expect(result.goods).toHaveLength(1001);
  expect(result.goods[1000]).toEqual({ id: 'g1000', title: '상품1000', archivedAt: null });
  expect(mocks.rpc).toHaveBeenCalledWith('admin_curation_target_options');
  expect(mocks.from).not.toHaveBeenCalled();
});

it.each([
  { data: null, error: { message: 'denied' } },
  { data: { ips: [], goods: [{ id: 'g', title: '상품', archivedAt: 'invalid' }], events: [] }, error: null },
  { data: { ips: [], goods: [{ id: 'g', title: '상품', archivedAt: null }, { id: 'g', title: '상품', archivedAt: null }], events: [] }, error: null },
])('does not present an incomplete or malformed projection as an empty catalog', async value => {
  mocks.rpc.mockResolvedValue(value);
  await expect(loadAdminCurationTargets()).rejects.toThrow('전시 대상 목록');
});
