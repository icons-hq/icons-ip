import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
import { loadOperatorDirectory } from './operator-directory.server';
import { normalizeOperatorFilters } from './operator-directory';
beforeEach(() => mocks.rpc.mockReset());
describe('operator directory loader', () => {
  it('passes filters before server pagination', async () => {
    mocks.rpc.mockResolvedValue({ data: { mode: 'legacy', revision: 1, actorManagerRole: null, actorMembershipRevision: 0, setupCandidates: [], rows: [], total: 0 }, error: null });
    const filters = normalizeOperatorFilters({ query: 'old member', role: 'all', page: '4', pageSize: '50' });
    expect((await loadOperatorDirectory(filters)).rows).toEqual([]);
    expect(mocks.rpc).toHaveBeenCalledWith('admin_search_operators', { p_query: 'old member', p_role: 'all', p_status: 'all', p_page: 4, p_page_size: 50 });
  });
  it('reports failure instead of showing an empty directory', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'offline' } });
    await expect(loadOperatorDirectory(normalizeOperatorFilters({}))).rejects.toThrow('불러오지');
  });
});
