import { beforeEach, describe, expect, it, vi } from 'vitest';
import Page from './page';
const mocks = vi.hoisted(() => ({ gate: vi.fn(), list: vi.fn(), batch: vi.fn(), release: vi.fn() }));
vi.mock('@/lib/admin/guard.server', () => ({ requireAdminScreenAccess: mocks.gate }));
vi.mock('@/lib/admin/purchase-restrictions.server', () => ({ getPurchaseRestrictions: mocks.list }));
vi.mock('@/lib/admin/purchase-restriction-batches.server', () => ({ loadPurchaseRestrictionBatch: mocks.batch }));
vi.mock('@/lib/admin/purchase-restriction-release.server', () => ({ loadRestrictionRelease: mocks.release }));
vi.mock('@/components/admin/screens/PurchaseRestrictionsScreen', () => ({ PurchaseRestrictionsScreen: () => null }));
beforeEach(() => { vi.clearAllMocks(); mocks.gate.mockResolvedValue({}); mocks.list.mockResolvedValue({ filters: {}, rows: [], total: 0 }); mocks.batch.mockResolvedValue(null); mocks.release.mockResolvedValue(null); });
describe('구매제한 목록과 결과 재열기', () => {
  it('권한 확인 전에는 목록이나 요청 결과를 읽지 않는다', async () => {
    mocks.gate.mockRejectedValue(new Error('forbidden'));
    await expect(Page({ searchParams: Promise.resolve({ batch: '00000000-0000-4000-8000-000000063521' }) })).rejects.toThrow('forbidden');
    expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.batch).not.toHaveBeenCalled();
  });
  it('유효한 요청 ID를 별도로 읽고 없으면 명확한 안내를 표시한다', async () => {
    const id = '00000000-0000-4000-8000-000000063521'; const result = await Page({ searchParams: Promise.resolve({ state: 'released', batch: id }) });
    expect(mocks.batch).toHaveBeenCalledWith(id); expect(result.props.batchMissing).toBe(true);
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ state: 'released' }));
  });
  it('잘못된 요청 ID는 DB에 전달하지 않는다', async () => {
    const result = await Page({ searchParams: Promise.resolve({ batch: 'invalid', releaseBatch: 'invalid' }) });
    expect(mocks.batch).not.toHaveBeenCalled(); expect(result.props.batchMissing).toBe(true);
    expect(mocks.release).not.toHaveBeenCalled(); expect(result.props.releaseMissing).toBe(true);
  });
  it('해제 결과 주소는 현재 권한 확인 뒤 동일 요청으로 재조회한다', async () => {
    const id = '89200000-0000-7000-8000-000000000201'; const receipt = { id, rows: [] };
    mocks.release.mockResolvedValue(receipt);
    const result = await Page({ searchParams: Promise.resolve({ releaseBatch: id }) });
    expect(mocks.release).toHaveBeenCalledWith(id);
    expect(result.props.initialRelease).toBe(receipt); expect(result.props.releaseMissing).toBe(false);
  });
});
