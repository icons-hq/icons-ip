import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminOverviewPage from './page';

const mocks = vi.hoisted(() => ({
  requireAccess: vi.fn(),
  getInsights: vi.fn(),
  getModeration: vi.fn(),
  overviewSection: vi.fn(() => null),
}));

vi.mock('@/lib/admin/guard.server', () => ({ requireAdminScreenAccess: mocks.requireAccess }));
vi.mock('@/lib/admin/insights.server', () => ({ getAdminInsights: mocks.getInsights }));
vi.mock('@/lib/admin/moderation.server', () => ({ getAdminModerationRecords: mocks.getModeration }));
vi.mock('@/components/admin/sections/Overview', () => ({ OverviewSection: mocks.overviewSection }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));

const insights = { revenue: { current: 0, previous: 0 } };
const reports = [{ id: 'report-1' }];

function run(query: Record<string, string | string[] | undefined> = {}) {
  return AdminOverviewPage({ searchParams: Promise.resolve(query) });
}

describe('AdminOverviewPage', () => {
  beforeEach(() => {
    mocks.requireAccess.mockReset();
    mocks.requireAccess.mockResolvedValue({ role: 'staff', user: { id: 'u1', email: null } });
    mocks.getInsights.mockReset();
    mocks.getInsights.mockResolvedValue(insights);
    mocks.getModeration.mockReset();
    mocks.getModeration.mockResolvedValue({ reports });
  });

  it('개요 화면에 필요한 두 로더만 부른다', async () => {
    const screen = await run();

    expect(screen.type).toBe(mocks.overviewSection);
    expect(screen.props).toMatchObject({ insights, reports });
    expect(mocks.requireAccess).toHaveBeenCalledWith('/admin');
  });

  /* 옛 딥링크를 조용히 개요로 떨어뜨리면 북마크가 말없이 엉뚱한 화면을 연다. */
  it.each([
    ['orders', '/admin/sales/orders'],
    ['ticket', '/admin/catalog/ticket-types'],
    ['emails', '/admin/messaging/emails'],
  ])('?section=%s 링크를 %s 로 넘긴다', async (section, href) => {
    await expect(run({ section })).rejects.toThrow(`NEXT_REDIRECT:${href}`);
  });

  it('리다이렉트할 때 나머지 쿼리를 그대로 옮긴다', async () => {
    await expect(run({ section: 'orders', status: 'paid', page: '2' })).rejects.toThrow(
      'NEXT_REDIRECT:/admin/sales/orders?status=paid&page=2',
    );
  });

  /* 리다이렉트가 인증보다 먼저여야 로그인 후 원래 화면으로 돌아간다. */
  it('레거시 리다이렉트는 권한 확인보다 먼저 일어난다', async () => {
    await expect(run({ section: 'orders' })).rejects.toThrow('NEXT_REDIRECT');

    expect(mocks.requireAccess).not.toHaveBeenCalled();
  });

  it('모르는 section 값은 개요를 그대로 연다', async () => {
    const screen = await run({ section: 'nope' });

    expect(screen.type).toBe(mocks.overviewSection);
  });
});
