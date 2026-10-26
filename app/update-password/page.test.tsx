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
  access: 'allowed' as 'allowed' | 'recovery_required' | 'no_email_identity',
  props: null as Record<string, unknown> | null,
  bridgeProps: null as Record<string, unknown> | null,
  recoveryRequiredProps: null as Record<string, unknown> | null,
  socialNoticeProps: null as Record<string, unknown> | null,
}));
vi.mock('@/components/screens/SocialAccountPasswordNotice', () => ({
  SocialAccountPasswordNotice: (props: Record<string, unknown>) => {
    mocks.socialNoticeProps = props;
    return null;
  },
}));
vi.mock('@/components/screens/PasswordRecoveryRequired', () => ({
  PasswordRecoveryRequired: (props: Record<string, unknown>) => {
    mocks.recoveryRequiredProps = props;
    return null;
  },
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
  getPasswordUpdateState: async () => ({ access: mocks.access, user: mocks.auth.user }),
}));
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
    mocks.access = 'allowed';
    mocks.props = null;
    mocks.bridgeProps = null;
    mocks.recoveryRequiredProps = null;
    mocks.socialNoticeProps = null;
  });

  it('renders for an authenticated but not-onboarded recovery user', async () => {
    renderToStaticMarkup(await Page({
      searchParams: Promise.resolve({ next: '/community?sort=hot' }),
    }));

    expect(mocks.props).toEqual({ email: 'fan@icons.gg', next: '/community?sort=hot' });
    expect(mocks.recoveryRequiredProps).toBeNull();
  });

  it('shows reset-mail guidance instead of the form to a session without recovery proof', async () => {
    mocks.access = 'recovery_required';

    renderToStaticMarkup(await Page({
      searchParams: Promise.resolve({ next: '/settings' }),
    }));

    expect(mocks.recoveryRequiredProps).toEqual({ email: 'fan@icons.gg', next: '/settings' });
    expect(mocks.props).toBeNull();
  });

  it('shows the SNS sign-in notice instead of the form to a social-only account', async () => {
    mocks.access = 'no_email_identity';

    renderToStaticMarkup(await Page({
      searchParams: Promise.resolve({ next: '/settings' }),
    }));

    expect(mocks.socialNoticeProps).toEqual({ next: '/settings' });
    expect(mocks.props).toBeNull();
    expect(mocks.recoveryRequiredProps).toBeNull();
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

    expect(mocks.props).toEqual({ email: 'fan@icons.gg', next: '/' });
  });
});
