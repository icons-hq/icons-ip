import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminPage from './page';

const mocks = vi.hoisted(() => ({
  admin: vi.fn(() => null),
  curations: vi.fn(async () => [{ id: 'curation-1' }]),
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
vi.mock('@/lib/admin/curations.server', () => ({ getAdminCurations: mocks.curations }));
vi.mock('@/lib/admin/insights.server', () => ({ getAdminInsights: vi.fn(async () => ({})) }));
vi.mock('@/lib/admin/moderation.server', () => ({ getAdminModerationRecords: vi.fn(async () => ({ reports: [] })) }));
vi.mock('@/lib/admin/members.server', () => ({
  getAdminMemberSummaries: vi.fn(async () => [{
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    nickname: '팬',
    maskedEmail: 'f***@icons.gg',
    role: 'user',
    createdAt: '2026-07-01T00:00:00.000Z',
    suspendedAt: null,
  }]),
}));
vi.mock('@/lib/admin/notifications.server', () => ({
  getAdminNotificationConsoleData: vi.fn(async () => ({ audiences: [], history: [] })),
}));
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
    mocks.curations.mockClear();
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
    mocks.randomUuid
      .mockReturnValueOnce('dddddddd-dddd-4ddd-8ddd-dddddddddddd')
      .mockReturnValueOnce('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')
      .mockReturnValueOnce('ffffffff-ffff-4fff-8fff-ffffffffffff');
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

  it('공지 발송 section을 파싱하고 콘솔 데이터와 독립 operation ID를 전달한다', async () => {
    const screen = await AdminPage({ searchParams: Promise.resolve({ section: 'notifications' }) });

    expect(screen.type).toBe(mocks.admin);
    expect(screen.props).toMatchObject({
      initialSection: 'notifications',
      notificationConsole: { audiences: [], history: [] },
      notificationOperationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    });
  });

  it('회원 section을 파싱하고 staff에게 마스킹 목록을 전달한다', async () => {
    const screen = await AdminPage({ searchParams: Promise.resolve({ section: 'members' }) });

    expect(screen.props).toMatchObject({
      initialSection: 'members',
      members: [expect.objectContaining({ maskedEmail: 'f***@icons.gg' })],
    });
  });

  it('promised searchParams의 큐레이션 section과 운영 초기값을 전달한다', async () => {
    const screen = await AdminPage({ searchParams: Promise.resolve({ section: 'curations' }) });

    expect(mocks.curations).toHaveBeenCalledOnce();
    expect(screen.props).toMatchObject({
      curations: [{ id: 'curation-1' }],
      curationDraftActiveFrom: '2026-07-15T03:04:05.000Z',
      curationDraftId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      curationOperationId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      initialSection: 'curations',
    });
  });
});
