import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import Page from './page';

const mocks = vi.hoisted(() => ({
  auth: {
    isConfigured: true,
    user: null as { id: string; email: string | null } | null,
    profile: null,
    isStaff: false,
  },
  loginProps: null as Record<string, unknown> | null,
}));

vi.mock('@/components/screens/Login', () => ({
  Login: (props: Record<string, unknown>) => {
    mocks.loginProps = props;
    return null;
  },
}));
vi.mock('@/lib/auth/onboarding', async () => await import('../../lib/auth/onboarding'));
vi.mock('@/lib/auth/server', () => ({
  getCurrentAuthState: async () => mocks.auth,
}));
vi.mock('@/lib/catalog', () => ({
  getCatalogSnapshot: async () => ({ cards: [] }),
}));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));

describe('/login page', () => {
  beforeEach(() => {
    mocks.auth = {
      isConfigured: true,
      user: null,
      profile: null,
      isStaff: false,
    };
    mocks.loginProps = null;
  });

  it('parses reset mode, reset-specific errors, and a safe next path', async () => {
    renderToStaticMarkup(await Page({
      searchParams: Promise.resolve({
        mode: 'reset',
        reset_error: 'pkce_code_verifier_not_found',
        next: '/community?sort=hot',
      }),
    }));

    expect(mocks.loginProps).toMatchObject({
      initialMode: 'reset',
      initialError: expect.stringContaining('재설정 메일을 요청한 브라우저'),
      next: '/community?sort=hot',
    });
  });

  it('exposes the completed reset notice without changing signin mode', async () => {
    renderToStaticMarkup(await Page({
      searchParams: Promise.resolve({ password_reset: 'success', next: '/orders' }),
    }));

    expect(mocks.loginProps).toMatchObject({
      initialMode: 'signin',
      initialMessage: '비밀번호를 변경했습니다. 새 비밀번호로 로그인해주세요.',
      next: '/orders',
    });
  });

  it('keeps existing signup parsing and normalizes unsafe next values', async () => {
    renderToStaticMarkup(await Page({
      searchParams: Promise.resolve({
        mode: 'signup',
        auth_error: 'otp_expired',
        next: 'https://evil.example/steal',
      }),
    }));

    expect(mocks.loginProps).toMatchObject({
      initialMode: 'signup',
      initialError: expect.stringContaining('만료'),
      next: '/',
    });
  });
});
