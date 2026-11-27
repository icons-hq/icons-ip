import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ access: vi.fn(), mode: vi.fn() }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: mocks.access }));
vi.mock('@/lib/checkout-transaction.server', () => ({ loadGoodsTransactionRuntimeMode: mocks.mode }));
import { readGoodsTransactionRuntimeAction } from './goods-transaction-runtime-actions';

beforeEach(() => { vi.clearAllMocks(); mocks.access.mockResolvedValue({ user: { id: 'staff' } }); });

it.each([['transaction', true], ['legacy', false], ['unavailable', null]] as const)('주문 설정 %s를 켜짐·꺼짐·모름으로 돌려준다', async (mode, expected) => {
  mocks.mode.mockResolvedValue(mode);
  expect(await readGoodsTransactionRuntimeAction()).toBe(expected);
  expect(mocks.access).toHaveBeenCalledWith('/admin/settings/origins', { capability: 'catalog.read' });
});

it('배송정보 관리를 볼 수 없는 계정에는 설정을 읽어 주지 않는다', async () => {
  mocks.access.mockResolvedValue(null);
  expect(await readGoodsTransactionRuntimeAction()).toBeNull();
  expect(mocks.mode).not.toHaveBeenCalled();
});
