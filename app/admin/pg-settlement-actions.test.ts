import { beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ access: vi.fn(), start: vi.fn(), advance: vi.fn(), read: vi.fn() }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: mock.access }));
vi.mock('@/lib/settlements/worker.server', () => ({ pgSettlementWorker: async () => ({ start: mock.start, advance: mock.advance, read: mock.read }) }));
vi.mock('next/navigation', () => ({ unstable_rethrow: () => {} }));
import { advancePgSettlementImportAction, readPgSettlementImportAction, startPgSettlementImportAction } from './pg-settlement-actions';
import { SETTLEMENT_FIXTURE_JOB as job } from '@/lib/settlements/fixture';
const actor = '287b949d-af67-4398-b0d2-09adbd123454';
beforeEach(() => { vi.clearAllMocks(); mock.access.mockResolvedValue({ user: { id: actor } }); });
it('checks current sensitive sales permission before each action and derives actor on the server', async () => {
  mock.start.mockResolvedValue({ ok: true, kind: 'created', job });
  const query = { dateType: job.dateType, startDate: job.startDate, endDate: job.endDate, mode: job.mode };
  await startPgSettlementImportAction(job.operationId, query); expect(mock.start).toHaveBeenCalledWith(actor, job.operationId, query);
  expect(mock.access).toHaveBeenCalledWith('/admin/settlements', { capability: 'sales.manage', adminOnly: true });
  mock.access.mockResolvedValue(null); await advancePgSettlementImportAction(job.id); await readPgSettlementImportAction(job.id);
  expect(mock.advance).not.toHaveBeenCalled(); expect(mock.read).not.toHaveBeenCalled();
});
it('keeps unknown action outcomes private and checks a known import without starting a provider call', async () => {
  mock.advance.mockRejectedValue(new Error('private key')); expect(await advancePgSettlementImportAction(job.id)).toMatchObject({ ok: false, uncertain: true });
  mock.read.mockResolvedValue(job); expect(await readPgSettlementImportAction(job.id)).toMatchObject({ ok: true, kind: 'paused', job });
  expect(mock.start).not.toHaveBeenCalled();
});
