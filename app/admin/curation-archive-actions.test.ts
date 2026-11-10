const { legacyOperatorAccessFixture } = await vi.hoisted(() => import('@/lib/admin/access.test-fixtures'));
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { curationArchiveForm } from '@/lib/admin/curation-archive';
import { readArchivedHeroBannersAction, setHeroBannerArchivedAction } from './curation-archive-actions';

const request = { operationId: '11111111-1111-4111-8111-111111111111', id: '22222222-2222-4222-8222-222222222222', expectedUpdatedAt: '2026-10-13T19:10:10.123456+00:00', archive: true };
const mocks = vi.hoisted(() => ({ auth: vi.fn(), client: vi.fn(), rpc: vi.fn(), revalidate: vi.fn(), select: vi.fn(), eq: vi.fn(), not: vi.fn(), order: vi.fn(), range: vi.fn(), getPublicUrl: vi.fn() }));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: mocks.auth }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.client }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('next/navigation', () => ({ redirect: (path: string) => { throw new Error(`NEXT_REDIRECT:${path}`); } }));

describe('banner archive actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ isConfigured: true, user: { id: 'staff' }, isStaff: true, role: 'staff', operatorAccess: legacyOperatorAccessFixture() });
    const query = { select: mocks.select, eq: mocks.eq, not: mocks.not, order: mocks.order, range: mocks.range };
    for (const name of ['select', 'eq', 'not', 'order'] as const) mocks[name].mockReturnValue(query);
    mocks.range.mockResolvedValue({ data: [], error: null, count: 0 });
    mocks.rpc.mockResolvedValue({ data: request.id, error: null });
    mocks.getPublicUrl.mockImplementation((path: string) => ({ data: { publicUrl: `https://cdn.example/${path}` } }));
    mocks.client.mockResolvedValue({ rpc: mocks.rpc, from: () => query, storage: { from: () => ({ getPublicUrl: mocks.getPublicUrl }) } });
  });
  it('passes the exact saved version and operation receipt, then refreshes public and admin surfaces', async () => {
    expect(await setHeroBannerArchivedAction(curationArchiveForm(request))).toHaveProperty('message');
    expect(mocks.rpc).toHaveBeenCalledWith('admin_set_home_banner_archived', { target_operation_id: request.operationId, target_curation_id: request.id, target_expected_updated_at: request.expectedUpdatedAt, archive_requested: true });
    expect(mocks.revalidate.mock.calls).toEqual([['/'], ['/admin'], ['/admin/display/curations']]);
  });
  it('rejects current capability loss before RPC and archive reads', async () => {
    mocks.auth.mockResolvedValue({ isConfigured: true, user: { id: 'user' }, isStaff: false, role: 'user' });
    expect(await setHeroBannerArchivedAction(curationArchiveForm(request))).toHaveProperty('errors.form');
    expect(await readArchivedHeroBannersAction(1)).toHaveProperty('error');
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it('distinguishes stale versions, capacity refusals and uncertain transport outcomes', async () => {
    mocks.rpc.mockResolvedValueOnce({ error: { message: 'curation_conflict' } });
    expect(await setHeroBannerArchivedAction(curationArchiveForm(request))).toMatchObject({ conflict: true });
    mocks.rpc.mockResolvedValueOnce({ error: { message: 'home_hero_limit' } });
    const cap = await setHeroBannerArchivedAction(curationArchiveForm({ ...request, archive: false }));
    expect(cap.errors?.form).toContain('10개');
    expect(cap.uncertain).toBeUndefined();
    mocks.rpc.mockRejectedValueOnce(new Error('network'));
    expect(await setHeroBannerArchivedAction(curationArchiveForm(request))).toMatchObject({ uncertain: true });
    mocks.rpc.mockResolvedValueOnce({ error: null, data: null });
    expect(await setHeroBannerArchivedAction(curationArchiveForm(request))).toMatchObject({ uncertain: true });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it('reads only archived heroes with stable pagination and returns no audit metadata', async () => {
    mocks.range.mockResolvedValue({ data: [{ id: request.id, title: '배너', image_path: 'public-media/catalog/curation/a.webp', archived_at: request.expectedUpdatedAt, updated_at: request.expectedUpdatedAt, actor_id: 'secret' }], error: null, count: 21 });
    const result = await readArchivedHeroBannersAction(2);
    expect(mocks.eq).toHaveBeenCalledWith('kind', 'hero');
    expect(mocks.not).toHaveBeenCalledWith('archived_at', 'is', null);
    expect(mocks.range).toHaveBeenCalledWith(20, 39);
    expect(mocks.order.mock.calls).toEqual([['archived_at', { ascending: false }], ['id', { ascending: false }]]);
    expect(result.page?.rows[0]).toEqual({ id: request.id, title: '배너', imageUrl: 'https://cdn.example/catalog/curation/a.webp', archivedAt: request.expectedUpdatedAt, updatedAt: request.expectedUpdatedAt });
  });
  it('reports read failure instead of a false empty archive and validates page and CAS input', async () => {
    mocks.range.mockResolvedValueOnce({ data: [], error: null, count: null });
    expect(await readArchivedHeroBannersAction(1)).toHaveProperty('error');
    expect(await readArchivedHeroBannersAction(0)).toHaveProperty('error');
    const form = curationArchiveForm(request); form.set('expectedUpdatedAt', 'yesterday');
    expect(await setHeroBannerArchivedAction(form)).toHaveProperty('errors.form');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
