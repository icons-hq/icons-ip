import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminCheckInPage, { metadata } from './page';

const mocks = vi.hoisted(() => ({
  adminState: {
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
  getAuth: vi.fn(),
  ticketCheckIn: vi.fn(() => null),
}));

vi.mock('@/lib/auth/admin', () => ({
  getCurrentAdminAuthState: mocks.getAuth,
}));
vi.mock('@/components/admin/check-in/TicketCheckIn', () => ({
  TicketCheckIn: mocks.ticketCheckIn,
}));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

describe('AdminCheckInPage', () => {
  beforeEach(() => {
    mocks.adminState = {
      isConfigured: true,
      user: { id: '11111111-1111-4111-8111-111111111111', email: 'staff@icons.gg' },
      role: 'staff',
      isStaff: true,
    };
    mocks.getAuth.mockReset();
    mocks.getAuth.mockImplementation(async () => mocks.adminState);
    mocks.ticketCheckIn.mockClear();
  });

  it('검색 비노출 metadata를 선언한다', () => {
    expect(metadata).toMatchObject({
      title: '티켓 검표 — ICONS',
      robots: { index: false, follow: false },
    });
  });

  it.each([
    ['not configured', false],
    ['unauthenticated', true],
  ])('%s 상태는 encoded check-in next 경로로 보낸다', async (_label, isConfigured) => {
    mocks.adminState = {
      isConfigured,
      user: null,
      role: null,
      isStaff: false,
    };

    await expect(AdminCheckInPage()).rejects.toThrow(
      'NEXT_REDIRECT:/login?next=%2Fadmin%2Fcheck-in',
    );
  });

  it('일반 사용자는 검표 화면 존재를 숨긴다', async () => {
    mocks.adminState = {
      isConfigured: true,
      user: { id: '33333333-3333-4333-8333-333333333333', email: 'fan@icons.gg' },
      role: 'user',
      isStaff: false,
    };

    await expect(AdminCheckInPage()).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it.each(['staff', 'admin'] as const)('%s만 독립 검표 화면을 렌더링한다', async (role) => {
    mocks.adminState = {
      isConfigured: true,
      user: { id: '11111111-1111-4111-8111-111111111111', email: 'staff@icons.gg' },
      role,
      isStaff: true,
    };

    const screen = await AdminCheckInPage();

    expect(screen.type).toBe(mocks.ticketCheckIn);
    expect(screen.props).toEqual({});
  });
});
