import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signInWithEmailAction } from './actions';

const mocks = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  getProfileForUser: vi.fn(),
}));

vi.mock('@/lib/auth/onboarding', async () => await import('../../lib/auth/onboarding'));
vi.mock('@/lib/auth/recovery.server', async () => await import('../../lib/auth/recovery.server'));
vi.mock('@/lib/supabase/config', () => ({
  getSupabaseConfig: () => ({ isConfigured: true }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({ auth: { signInWithPassword: mocks.signInWithPassword } }),
}));
vi.mock('@/lib/auth/server', () => ({ getProfileForUser: mocks.getProfileForUser }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined, set: vi.fn() }),
  headers: async () => ({ get: () => null }),
}));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));

function formData() {
  const data = new FormData();
  data.set('email', 'fan@icons.gg');
  data.set('password', 'password1234');
  data.set('next', '/orders');
  return data;
}

describe('signInWithEmailAction', () => {
  beforeEach(() => {
    mocks.signInWithPassword.mockReset();
    mocks.getProfileForUser.mockReset();
    mocks.signInWithPassword.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'fan@icons.gg' } },
      error: null,
    });
  });

  it('redirects a suspended account before onboarding or next', async () => {
    mocks.getProfileForUser.mockResolvedValue({
      email: 'fan@icons.gg',
      nickname: 'fan',
      birth_date: '2000-01-01',
      consents: { terms: true, privacy: true },
      onboarded_at: '2026-07-01T00:00:00.000Z',
      suspended_at: '2026-07-17T00:00:00.000Z',
    });

    await expect(signInWithEmailAction({}, formData())).rejects.toThrow(
      'NEXT_REDIRECT:/account-suspended',
    );
  });
});
