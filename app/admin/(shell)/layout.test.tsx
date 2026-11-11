import { legacyOperatorAccessFixture } from '@/lib/admin/access.test-fixtures';
import { isValidElement, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import AdminShellLayout from './layout';

const mocks = vi.hoisted(() => ({ count: vi.fn(async () => 9), cookies: new Map<string, string>() }));

vi.mock('@/lib/admin/inquiries.server', () => ({ getAdminOpenInquiryCount: mocks.count }));
vi.mock('@/lib/auth/admin', () => ({
  getCurrentAdminAuthState: vi.fn(async () => ({
    isConfigured: true,
    user: { id: '11111111-1111-4111-8111-111111111111', email: 'staff@icons.gg' },
    role: 'staff',
    isStaff: true,
    operatorAccess: legacyOperatorAccessFixture(),
  })),
}));
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND'); } }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (name: string) => (mocks.cookies.has(name) ? { value: mocks.cookies.get(name) } : undefined) }) }));

describe('AdminShellLayout', () => {
  /* R1(D1①): 미답변 배지는 셸 공통 영역에서 빠졌다. 상품 등록·주문 화면에는 보이지 않고,
     layout이 화면마다 집계를 부르지도 않는다. */
  it('셸 공통 미답변 배지를 넘기지 않고 집계도 부르지 않는다', async () => {
    const element = await AdminShellLayout({ children: <p>본문</p> }) as ReactElement<Record<string, unknown>>;
    expect(isValidElement(element)).toBe(true);
    expect(element.props.badges).toBeUndefined();
    expect(mocks.count).not.toHaveBeenCalled();
  });

  it('이 계정의 메뉴 쿠키를 읽어 셸에 넘겨 첫 HTML부터 같은 모양으로 그린다', async () => {
    mocks.cookies.clear();
    mocks.cookies.set('sidebar_state', 'false');
    mocks.cookies.set('icons_admin_nav_11111111-1111-4111-8111-111111111111', JSON.stringify({ open: ['sales'], favorites: ['orders'], current: 'sales' }));
    const element = await AdminShellLayout({ children: <p>본문</p> }) as ReactElement<Record<string, unknown>>;
    expect(element.props.sidebarDefaultOpen).toBe(false);
    expect(element.props.initialNavigation).toEqual({ openGroupIds: ['sales'], favoriteScreenIds: ['orders'], currentGroupId: 'sales' });
  });

  /* 공용 PC에서 다른 운영자의 메뉴 설정을 읽지 않는다. */
  it('다른 계정의 쿠키는 읽지 않는다', async () => {
    mocks.cookies.clear();
    mocks.cookies.set('icons_admin_nav_someone-else', JSON.stringify({ open: ['sales'], favorites: [], current: 'sales' }));
    const element = await AdminShellLayout({ children: <p>본문</p> }) as ReactElement<Record<string, unknown>>;
    expect(element.props.sidebarDefaultOpen).toBe(true);
    expect(element.props.initialNavigation).toBeNull();
  });
});
