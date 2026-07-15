import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminPage from './page';

const mocks = vi.hoisted(() => ({
  admin: vi.fn(() => null),
  randomUuid: vi.fn(),
}));

vi.mock('node:crypto', () => ({ randomUUID: mocks.randomUuid }));
vi.mock('@/components/admin/Admin', () => ({ Admin: mocks.admin }));
vi.mock('@/lib/admin/catalog.server', () => ({
  getAdminCatalogRecords: vi.fn(async () => ({
    ips: [],
    goods: [],
    cards: [],
    cardPools: [],
    rewardPolicies: [],
    games: [],
    events: [],
    ticketTypes: [],
  })),
}));
vi.mock('@/lib/admin/insights.server', () => ({ getAdminInsights: vi.fn(async () => ({})) }));
vi.mock('@/lib/admin/moderation.server', () => ({ getAdminModerationRecords: vi.fn(async () => ({ reports: [] })) }));
vi.mock('@/lib/admin/orders', () => ({ normalizeAdminOrderFilters: vi.fn(() => ({})) }));
vi.mock('@/lib/admin/orders.server', () => ({ getAdminOrderRecords: vi.fn(async () => ({})) }));
vi.mock('@/lib/admin/roles.server', () => ({ getAdminProfileRecords: vi.fn(async () => []) }));
vi.mock('@/lib/auth/admin', () => ({
  getCurrentAdminAuthState: vi.fn(async () => ({
    isConfigured: true,
    user: { id: '11111111-1111-4111-8111-111111111111', email: 'staff@icons.gg' },
    role: 'staff',
    isStaff: true,
  })),
}));
vi.mock('@/lib/catalog', () => ({ getCatalogSnapshot: vi.fn(async () => ({ verticals: [], ips: [] })) }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

describe('AdminPage reward-policy route', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T03:04:05.000Z'));
    mocks.admin.mockClear();
    mocks.randomUuid.mockReset();
    mocks.randomUuid
      .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
      .mockReturnValueOnce('22222222-2222-4222-8222-222222222222')
      .mockReturnValueOnce('33333333-3333-4333-8333-333333333333')
      .mockReturnValueOnce('44444444-4444-4444-8444-444444444444')
      .mockReturnValueOnce('55555555-5555-4555-8555-555555555555')
      .mockReturnValueOnce('66666666-6666-4666-8666-666666666666')
      .mockReturnValueOnce('77777777-7777-4777-8777-777777777777')
      .mockReturnValueOnce('88888888-8888-4888-8888-888888888888')
      .mockReturnValueOnce('99999999-9999-4999-8999-999999999999')
      .mockReturnValueOnce('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('parses the policy section and provides fresh draft identifiers and time', async () => {
    const screen = await AdminPage({ searchParams: Promise.resolve({ section: 'policy' }) });

    expect(screen.type).toBe(mocks.admin);
    expect(screen.props).toMatchObject({
      initialSection: 'policy',
      policyDraftActiveFrom: '2026-07-15T03:04:05.000Z',
      policyDraftId: '11111111-1111-4111-8111-111111111111',
      policyOperationId: '22222222-2222-4222-8222-222222222222',
    });
  });

  it('parses the game section and provides independent save and end operation IDs', async () => {
    const screen = await AdminPage({ searchParams: Promise.resolve({ section: 'game' }) });

    expect(screen.type).toBe(mocks.admin);
    expect(screen.props).toMatchObject({
      initialSection: 'game',
      gameEndOperationId: '99999999-9999-4999-8999-999999999999',
      gameOperationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });
  });
});
