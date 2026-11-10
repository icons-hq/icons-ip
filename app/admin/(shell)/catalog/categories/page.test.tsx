import { configuredOperatorAccessFixture, legacyOperatorAccessFixture } from '@/lib/admin/access.test-fixtures';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ guard: vi.fn(), workspace: vi.fn(), screen: vi.fn(() => null) }));
vi.mock('@/lib/admin/guard.server', () => ({ requireAdminScreenAccess: mocks.guard }));
vi.mock('@/lib/admin/category.server', () => ({ loadAdminCategoryWorkspace: mocks.workspace }));
vi.mock('@/components/admin/screens/CategoryScreen', () => ({ CategoryScreen: mocks.screen }));

import Page from './page';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.guard.mockResolvedValue({ user: { id: 'staff-1' }, role: 'staff', operatorAccess: legacyOperatorAccessFixture('staff') });
  mocks.workspace.mockResolvedValue({ categories: [], mappings: [], migrations: [], activation: { customerEnabled: false, erpEnabled: false, customerEvidence: null, erpEvidence: null, updatedAt: null } });
});

describe('admin category route', () => {
  it('guards the independent category workspace and passes the legacy type coexistence list', async () => {
    const element = await Page() as { type: unknown; props: Record<string, unknown> };
    expect(mocks.guard).toHaveBeenCalledWith('/admin/catalog/categories');
    expect(mocks.workspace).toHaveBeenCalledOnce();
    expect(element.type).toBe(mocks.screen);
    expect(element.props).toEqual(expect.objectContaining({ legacyTypes: expect.arrayContaining(['키링', '문구']) }));
  });
});

it('configured deputy loads the basic category workspace without platform controls', async () => {
  mocks.guard.mockResolvedValue({ user: { id: 'deputy' }, role: 'staff', operatorAccess: configuredOperatorAccessFixture('deputy') });
  const element = await Page();
  expect(mocks.workspace).toHaveBeenCalledWith(false);
  expect(element.props).toMatchObject({ canManagePlatform: false, legacyTypes: [] });
});
