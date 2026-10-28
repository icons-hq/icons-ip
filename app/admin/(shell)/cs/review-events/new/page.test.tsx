import { configuredOperatorAccessFixture, legacyOperatorAccessFixture } from '@/lib/admin/access.test-fixtures';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Page from './page';

const mocks = vi.hoisted(() => ({
  auth: {} as Record<string, unknown>,
  policy: vi.fn(async () => ({ enabled: false, maxBalance: null, validityDays: null })),
}));
vi.mock('@/lib/admin/guard.server', () => ({ requireAdminScreenAccess: vi.fn(async () => mocks.auth) }));
vi.mock('@/lib/admin/review-events.server', () => ({ loadReviewEventCreditPolicy: mocks.policy }));
vi.mock('@/components/admin/screens/ReviewEventEditorScreen', () => ({ ReviewEventEditorScreen: () => null }));

describe('review event create page (R6)', () => {
  beforeEach(() => {
    mocks.auth = { isConfigured: true, isStaff: true, role: 'admin', user: { id: 'u1' }, operatorAccess: legacyOperatorAccessFixture('admin') };
  });

  it('passes the store credit policy read with cs.manage and the settings link for admins', async () => {
    const element = await Page() as ReactElement<{ creditPolicy: unknown; policyHref: string | null; workspace: unknown }>;
    expect(mocks.policy).toHaveBeenCalledTimes(1);
    expect(element.props.creditPolicy).toEqual({ enabled: false, maxBalance: null, validityDays: null });
    expect(element.props.policyHref).toBe('/admin/settings/store-credits');
    expect(element.props.workspace).toBeNull();
  });

  it('hides the settings link from cs operators who cannot open the policy screen', async () => {
    mocks.auth = { isConfigured: true, isStaff: true, role: 'staff', user: { id: 'u2' }, operatorAccess: configuredOperatorAccessFixture('deputy') };
    const element = await Page() as ReactElement<{ policyHref: string | null }>;
    expect(element.props.policyHref).toBeNull();
  });
});
