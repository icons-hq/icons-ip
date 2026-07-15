import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Page from './page';

const mocks = vi.hoisted(() => ({
  auth: {
    isConfigured: true,
    user: { id: 'user-1', email: 'fan@icons.gg' } as { id: string; email: string | null } | null,
    profile: null,
    isStaff: false,
  },
  props: null as Record<string, unknown> | null,
  bridgeProps: null as Record<string, unknown> | null,
}));
vi.mock('@/components/screens/RecoverySessionBridge', () => ({
  RecoverySessionBridge: (props: Record<string, unknown>) => {
    mocks.bridgeProps = props;
    return null;
  },
}));

vi.mock('@/components/screens/UpdatePassword', () => ({
  UpdatePassword: (props: Record<string, unknown>) => {
    mocks.props = props;
    return null;
  },
}));
vi.mock('@/lib/auth/server', () => ({
  getCurrentAuthState: async () => mocks.auth,
}));
vi.mock('@/lib/auth/onboarding', async () => await import('../../lib/auth/onboarding'));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));

describe('/update-password page', () => {
  beforeEach(() => {
    mocks.auth = {
      isConfigured: true,
      user: { id: 'user-1', email: 'fan@icons.gg' },
      profile: null,
      isStaff: false,
    };
    mocks.props = null;
    mocks.bridgeProps = null;
  });

  it('renders for an authenticated but not-onboarded recovery user', async () => {
    renderToStaticMarkup(await Page({
      searchParams: Promise.resolve({ next: '/community?sort=hot' }),
    }));

    expect(mocks.props).toEqual({ next: '/community?sort=hot' });
  });

  it('redirects unauthenticated users to reset-specific re-request UX', async () => {
    mocks.auth.user = null;

    await expect(Page({
      searchParams: Promise.resolve({ next: '/orders' }),
    })).rejects.toThrow(
      'NEXT_REDIRECT:/login?mode=reset&reset_error=session_not_found&next=%2Forders',
    );
  });

  it('renders a one-time browser bridge after a successful callback races the session cookie', async () => {
    mocks.auth.user = null;

    renderToStaticMarkup(await Page({
      searchParams: Promise.resolve({
        next: '/community?sort=hot',
        session_ready: '1',
      }),
    }));

    expect(mocks.bridgeProps).toEqual({ next: '/community?sort=hot' });
    expect(mocks.props).toBeNull();
  });

  it('removes the one-time ready marker once the recovery session is visible to SSR', async () => {
    await expect(Page({
      searchParams: Promise.resolve({
        next: '/orders',
        session_ready: '1',
      }),
    })).rejects.toThrow('NEXT_REDIRECT:/update-password?next=%2Forders');
  });

  it('normalizes unsafe next values before rendering', async () => {
    renderToStaticMarkup(await Page({
      searchParams: Promise.resolve({ next: 'https://evil.example/steal' }),
    }));

    expect(mocks.props).toEqual({ next: '/' });
  });
});
