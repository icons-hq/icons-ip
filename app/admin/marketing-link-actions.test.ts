import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ access: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: mocks.access }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));
import { issueMarketingLinksAction } from './marketing-link-actions';
const op = '80000000-0000-4000-8000-000000000001';
const row = { id: op, token: 'b'.repeat(32), source: 'good', targetId: 'sample', originalTargetId: 'sample', title: '상품', available: true, createdAt: '2026-10-13T00:00:00Z' };
beforeEach(() => { vi.clearAllMocks(); mocks.access.mockResolvedValue({ user: { id: op } }); mocks.rpc.mockResolvedValue({ data: { rows: [row] }, error: null }); });
describe('issue marketing links action', () => {
  it('requires source-specific authority before writes and rejects invalid selections', async () => {
    mocks.access.mockResolvedValue(null); expect(await issueMarketingLinksAction('good', ['sample'], op)).toHaveProperty('error'); expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.access.mockResolvedValue({ user: { id: op } }); expect(await issueMarketingLinksAction('good', ['sample', 'sample'], op)).toHaveProperty('error'); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('uses original surface guards for home and story', async () => {
    mocks.rpc.mockResolvedValue({ error: { code: '42501' } });
    await issueMarketingLinksAction('home', ['home'], op); expect(mocks.access).toHaveBeenLastCalledWith('/admin/display/curations', { capability: 'store.manage' });
    await issueMarketingLinksAction('story', [op], op); expect(mocks.access).toHaveBeenLastCalledWith('/admin/display/stories', { capability: 'store.manage' });
  });
  it('preserves operation identity and validates the returned rows', async () => {
    expect(await issueMarketingLinksAction('good', ['sample'], op)).toEqual({ rows: [row] }); expect(mocks.rpc).toHaveBeenCalledWith('admin_issue_marketing_links', { p_source: 'good', p_target_ids: ['sample'], p_operation_id: op });
    mocks.rpc.mockResolvedValue({ data: { rows: [] } }); expect(await issueMarketingLinksAction('good', ['sample'], op)).toHaveProperty('uncertain', true);
  });
  it('distinguishes missing material from uncertain writes', async () => {
    mocks.rpc.mockResolvedValue({ error: { code: 'P0002', message: 'marketing_target_missing' } }); expect(await issueMarketingLinksAction('good', ['sample'], op)).not.toHaveProperty('uncertain');
    mocks.rpc.mockRejectedValue(new Error('network')); expect(await issueMarketingLinksAction('good', ['sample'], op)).toHaveProperty('uncertain', true);
  });
});
