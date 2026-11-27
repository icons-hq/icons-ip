import { configuredOperatorAccessFixture, legacyOperatorAccessFixture } from '@/lib/admin/access.test-fixtures';
import { beforeEach, expect, it, vi } from 'vitest';
import Page from './page';

const mocks = vi.hoisted(() => ({ guard: vi.fn(), carriers: vi.fn(), history: vi.fn(), uses: vi.fn() }));
vi.mock('@/lib/admin/guard.server', () => ({ requireAdminScreenAccess: mocks.guard }));
vi.mock('@/lib/admin/store-settings.server', () => ({ loadAdminShippingCarriers: mocks.carriers, loadAdminStoreSettingsHistory: mocks.history }));
vi.mock('@/lib/admin/carrier-origin-uses.server', () => ({ loadCarrierUsesView: mocks.uses }));
vi.mock('@/components/admin/screens/StoreSettingsScreen', () => ({ ShippingCarriersScreen: () => null }));

const USES = { hanjin: [{ name: '김포', active: true, href: '/admin/settings/origins?origin=gimpo' }] };
const auth = (role: 'admin' | 'staff', operatorAccess = legacyOperatorAccessFixture(role)) => ({ role, user: { id: '91000000-0000-4000-8000-000000000001' }, operatorAccess });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.guard.mockResolvedValue(auth('admin'));
  mocks.carriers.mockResolvedValue([{ code: 'hanjin' }]);
  mocks.history.mockResolvedValue([{ id: 'a', target: 'shipping_carriers:hanjin' }, { id: 'b', target: 'store_settings:business' }]);
  mocks.uses.mockResolvedValue(USES);
});

it('화면 권한을 확인하기 전에는 아무것도 읽지 않는다', async () => {
  mocks.guard.mockRejectedValue(new Error('denied'));
  await expect(Page()).rejects.toThrow('denied');
  expect(mocks.guard).toHaveBeenCalledWith('/admin/settings/carriers');
  for (const read of [mocks.carriers, mocks.history, mocks.uses]) expect(read).not.toHaveBeenCalled();
});

it('저장할 수 있는 사람에게는 택배사를 쓰는 출고지를 읽어 넘기고, 택배사 변경 이력만 보인다 (C-1)', async () => {
  const screen = await Page();
  expect(screen.props.canEdit).toBe(true);
  expect(screen.props.uses).toBe(USES);
  expect(screen.props.history).toEqual([{ id: 'a', target: 'shipping_carriers:hanjin' }]);
  expect(mocks.uses).toHaveBeenCalledOnce();
});

it('쓰는 출고지를 읽지 못하면 null을 그대로 넘겨 화면이 끄지 못하게 한다 — 쓰는 곳이 없다고 바꾸지 않는다', async () => {
  mocks.uses.mockResolvedValue(null);
  expect((await Page()).props.uses).toBeNull();
});

it('저장할 수 없는 사람에게는 읽지 않고(undefined) 넘기지도 않는다', async () => {
  mocks.guard.mockResolvedValue(auth('staff'));
  const screen = await Page();
  expect(screen.props.canEdit).toBe(false);
  expect(screen.props.uses).toBeUndefined();
  expect(mocks.uses).not.toHaveBeenCalled();
});

it('이력은 매니저 관리 권한이 있는 사람에게만 읽는다', async () => {
  mocks.guard.mockResolvedValue(auth('staff', configuredOperatorAccessFixture('logistics')));
  const screen = await Page();
  expect(mocks.history).not.toHaveBeenCalled();
  expect(screen.props.history).toEqual([]);
  expect(screen.props.canEdit).toBe(false);
});
