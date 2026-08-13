import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Page from './page';

const mocks = vi.hoisted(() => ({
  accountDeletion: vi.fn(),
  auth: vi.fn(),
  connection: vi.fn(),
  panel: vi.fn<(props: Record<string, unknown>) => null>(() => null),
}));

vi.mock('@/components/account/AccountDeletionPanel', () => ({
  AccountDeletionPanel: mocks.panel,
}));
vi.mock('@/lib/account-deletion.server', () => ({
  getAccountDeletionPresentation: mocks.accountDeletion,
}));
vi.mock('@/lib/auth/server', () => ({ getCurrentAuthState: mocks.auth }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => { throw new Error(`NEXT_REDIRECT:${path}`); },
}));
vi.mock('next/server', () => ({ connection: mocks.connection }));

describe('/settings/delete-account', () => {
  beforeEach(() => {
    mocks.accountDeletion.mockReset();
    mocks.auth.mockReset();
    mocks.connection.mockReset();
    mocks.connection.mockResolvedValue(undefined);
    mocks.panel.mockClear();
    mocks.auth.mockResolvedValue({
      isConfigured: true,
      user: { id: '00000000-0000-4000-8000-000000001371', email: 'pending@example.test' },
      profile: null,
      isStaff: false,
    });
    mocks.accountDeletion.mockResolvedValue({
      preview: { available: false, eligible: false, blockers: [
        { code: 'not_available', count: 1, path: '/settings' },
      ] },
      status: { status: 'not_requested', phase: 'none', nextAction: '/settings', blockers: [] },
    });
  });

  it('requires auth but does not require completed onboarding', async () => {
    renderToStaticMarkup(await Page());

    expect(mocks.connection).toHaveBeenCalledOnce();
    expect(mocks.accountDeletion).toHaveBeenCalledOnce();
    expect(mocks.panel).toHaveBeenCalledWith(expect.objectContaining({
      presentation: expect.objectContaining({
        status: expect.objectContaining({ status: 'not_requested' }),
      }),
      requestKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
    }), undefined);
  });

  it('preserves the dedicated return path for logged-out users', async () => {
    mocks.auth.mockResolvedValue({
      isConfigured: true, user: null, profile: null, isStaff: false,
    });

    await expect(Page()).rejects.toThrow(
      'NEXT_REDIRECT:/login?next=%2Fsettings%2Fdelete-account',
    );
    expect(mocks.accountDeletion).not.toHaveBeenCalled();
  });
});
