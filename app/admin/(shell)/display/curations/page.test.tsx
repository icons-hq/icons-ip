import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminDisplayCurationsPage from './page';

const mocks = vi.hoisted(() => ({
  authState: {
    isConfigured: true,
    user: { id: '11111111-1111-4111-8111-111111111111', email: 'staff@icons.gg' },
    role: 'staff',
    isStaff: true,
  } as {
    isConfigured: boolean;
    user: { id: string; email: string | null } | null;
    role: 'user' | 'staff' | 'admin' | null;
    isStaff: boolean;
  },
  curationScreen: vi.fn(() => null),
  curations: vi.fn(async () => [{ id: 'curation-1' }]),
  catalogRecords: vi.fn(async () => ({
    events: [{ id: 'e100', title: '성수 팝업', archivedAt: null }],
    goods: [{ id: 'g13', name: '홍실 아크릴 블록', archivedAt: null }],
    ips: [{ id: 'ip-1', title: '홍실', archivedAt: '2026-07-01T00:00:00.000Z' }],
  })),
  notifications: vi.fn(async () => ({ audiences: [], history: [] })),
  orders: vi.fn(async () => ({})),
  randomUuid: vi.fn(),
}));

vi.mock('node:crypto', () => ({ randomUUID: mocks.randomUuid }));
vi.mock('@/components/admin/screens/CurationScreen', () => ({ CurationScreen: mocks.curationScreen }));
vi.mock('@/lib/admin/curations.server', () => ({ getAdminCurations: mocks.curations }));
vi.mock('@/lib/admin/catalog.server', () => ({ getAdminCatalogRecords: mocks.catalogRecords }));
vi.mock('@/lib/admin/notifications.server', () => ({ getAdminNotificationConsoleData: mocks.notifications }));
vi.mock('@/lib/admin/orders.server', () => ({ getAdminOrderRecords: mocks.orders }));
vi.mock('@/lib/auth/admin', () => ({
  getCurrentAdminAuthState: vi.fn(async () => mocks.authState),
}));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

describe('AdminDisplayCurationsPage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T03:04:05.000Z'));
    mocks.authState = {
      isConfigured: true,
      user: { id: '11111111-1111-4111-8111-111111111111', email: 'staff@icons.gg' },
      role: 'staff',
      isStaff: true,
    };
    mocks.curationScreen.mockClear();
    mocks.curations.mockClear();
    mocks.catalogRecords.mockClear();
    mocks.notifications.mockClear();
    mocks.orders.mockClear();
    mocks.randomUuid.mockReset();
    mocks.randomUuid
      .mockReturnValueOnce('22222222-2222-4222-8222-222222222222')
      .mockReturnValueOnce('33333333-3333-4333-8333-333333333333');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('일반 사용자에게는 큐레이션을 읽기 전에 화면을 감춘다', async () => {
    mocks.authState = {
      isConfigured: true,
      user: { id: '44444444-4444-4444-8444-444444444444', email: 'fan@icons.gg' },
      role: 'user',
      isStaff: false,
    };

    await expect(AdminDisplayCurationsPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.curations).not.toHaveBeenCalled();
    expect(mocks.catalogRecords).not.toHaveBeenCalled();
  });

  it('큐레이션과 이동 대상 목록에 새 초안 식별자와 시각을 함께 내려보낸다', async () => {
    const screen = await AdminDisplayCurationsPage();

    expect(screen.type).toBe(mocks.curationScreen);
    expect(screen.props).toMatchObject({
      records: [{ id: 'curation-1' }],
      draftActiveFrom: '2026-07-15T03:04:05.000Z',
      draftId: '22222222-2222-4222-8222-222222222222',
      operationId: '33333333-3333-4333-8333-333333333333',
    });
  });

  /* 굿즈 레코드의 표시 이름은 name 이라 그대로 넘기면 대상 목록이 빈 제목이 된다. */
  it('굿즈 이름을 대상 목록의 title로 맞추고 보관 여부를 유지한다', async () => {
    const screen = await AdminDisplayCurationsPage();

    expect(screen.props).toMatchObject({
      eventOptions: [{ id: 'e100', title: '성수 팝업', archivedAt: null }],
      goodOptions: [{ id: 'g13', title: '홍실 아크릴 블록', archivedAt: null }],
      ipOptions: [{ id: 'ip-1', title: '홍실', archivedAt: '2026-07-01T00:00:00.000Z' }],
    });
  });

  it('쓰는 카탈로그 종류만 요청하고 다른 화면의 로더는 부르지 않는다', async () => {
    await AdminDisplayCurationsPage();

    expect(mocks.catalogRecords).toHaveBeenCalledWith({ include: ['events', 'goods', 'ips'] });
    expect(mocks.notifications).not.toHaveBeenCalled();
    expect(mocks.orders).not.toHaveBeenCalled();
  });
});
