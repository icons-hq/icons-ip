import { beforeEach, expect, it, vi } from 'vitest';
import Page from './page';
const mocks = vi.hoisted(() => ({ gate: vi.fn(), load: vi.fn() }));
vi.mock('@/lib/admin/guard.server', () => ({ requireAdminScreenAccess: mocks.gate }));
vi.mock('@/lib/admin/refund-transfers.server', () => ({ loadRefundTransfers: mocks.load }));
vi.mock('next/navigation', () => ({ redirect: (href: string) => { throw new Error(`redirect:${href}`); } }));
beforeEach(() => { mocks.gate.mockReset().mockResolvedValue({}); mocks.load.mockReset().mockResolvedValue({ rows: [], total: 0, pageSize: 50, page: 1 }); });
it('checks current sales authority and legacy admin-only access before loading', async () => {
  mocks.gate.mockRejectedValue(new Error('denied'));
  await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow('denied');
  expect(mocks.load).not.toHaveBeenCalled();
  expect(mocks.gate).toHaveBeenCalledWith('/admin/sales/claims/refund-transfers', { capability: 'sales.manage', adminOnly: true });
});
it('reloads the actual last page when completed refunds shorten the queue', async () => {
  mocks.load.mockResolvedValue({ rows: [], total: 50, pageSize: 50, page: 2 });
  await expect(Page({ searchParams: Promise.resolve({ page: '2' }) })).rejects.toThrow('redirect:/admin/sales/claims/refund-transfers');
});
