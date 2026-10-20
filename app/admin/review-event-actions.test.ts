import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ access: vi.fn(), rpc: vi.fn(), client: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: mocks.access }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.client }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));
import { publishReviewEventAction, saveReviewEventAction, selectReviewEventEntriesAction } from './review-event-actions';
import { newReviewEventValues } from '@/lib/review-events';
const id = '92000000-0000-4000-8000-000000000001', operation = '92000000-0000-4000-8000-000000000002';
const values = () => ({ ...newReviewEventValues('2026-10-13'), title: '합성 이벤트', description: '별점과 무관한 후기' });
const event = () => ({ ...values(), id, number: 1, revision: 1, createdAt: '2026-10-13T00:00:00Z', updatedAt: '2026-10-13T00:00:00Z', archivedAt: null, announcedAt: null, state: 'scheduled', canEdit: true, entryCount: 0, selectedCount: 0, awardedCount: 0, revokedCount: 0 });
beforeEach(() => { vi.resetAllMocks(); mocks.access.mockResolvedValue(true); mocks.client.mockResolvedValue({ rpc: mocks.rpc }); });
describe('review event action authorization and durable results', () => {
  it('checks access before validation and DB creation', async () => {
    mocks.access.mockResolvedValue(false);
    expect(await saveReviewEventAction('invalid', 0, operation, null)).toHaveProperty('error');
    expect(mocks.client).not.toHaveBeenCalled();
    await publishReviewEventAction(id, 1, operation);
    expect(mocks.access).toHaveBeenLastCalledWith('/admin/cs/review-events', { capability: 'marketing.manage', adminOnly: true });
  });
  it('confirms persisted event state before reporting success', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: event(), error: null }).mockResolvedValueOnce({ data: { event: event() }, error: null });
    expect(await saveReviewEventAction(id, 0, operation, values())).toEqual({ event: event() });
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, 'admin_save_review_event', expect.objectContaining({ p_operation_id: operation, p_expected_revision: 0 }));
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'admin_get_review_event', expect.objectContaining({ p_id: id }));
    expect(mocks.revalidate).toHaveBeenCalledWith('/my/store-credits');
  });
  it('keeps the same operation retry contract when save or readback is ambiguous', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: event(), error: null }).mockResolvedValueOnce({ data: null, error: { message: 'offline' } });
    expect(await saveReviewEventAction(id, 0, operation, values())).toMatchObject({ uncertain: true });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it('surfaces review changes without treating a rejected request as uncertain', async () => {
    const entries = [{ id, reviewUpdatedAt: '2026-10-13T00:00:00Z', reviewFingerprint: 'a'.repeat(32) }];
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PT409', message: 'review_event_review_changed' } });
    const result = await selectReviewEventEntriesAction(id, 1, operation, entries, '사용 경험 확인');
    expect(result).toMatchObject({ error: expect.stringContaining('선정한 리뷰가 변경') });
    expect(result).not.toHaveProperty('uncertain');
  });
});
