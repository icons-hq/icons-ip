import { describe, expect, it, vi } from 'vitest';

import {
  LOCAL_TEST_ACCOUNT,
  ensureLocalTestAccount,
  localApplicationEnvironment,
  localCommand,
  parseSupabaseStatus,
  requireLoopbackSupabaseUrl,
  runLocalSupabaseCommand,
} from './local-supabase-runtime.mjs';

function authClients({ users = [] } = {}) {
  const listUsers = vi.fn().mockResolvedValue({ data: { users }, error: null });
  const createUser = vi.fn().mockResolvedValue({
    data: { user: { id: 'new-user', email: LOCAL_TEST_ACCOUNT.email } },
    error: null,
  });
  const updateUserById = vi.fn().mockResolvedValue({
    data: { user: { id: 'existing-user', email: LOCAL_TEST_ACCOUNT.email } },
    error: null,
  });
  const upsert = vi.fn().mockResolvedValue({ error: null });
  const signInWithPassword = vi.fn().mockResolvedValue({ data: { session: { access_token: 'token' } }, error: null });
  const signOut = vi.fn().mockResolvedValue({ error: null });
  const admin = {
    auth: { admin: { createUser, listUsers, updateUserById } },
    from: vi.fn(() => ({ upsert })),
  };
  const publicClient = { auth: { signInWithPassword, signOut } };
  const clientFactory = vi.fn((_url, key) => key === 'service-role-key' ? admin : publicClient);
  return {
    admin,
    clientFactory,
    createUser,
    listUsers,
    publicClient,
    signInWithPassword,
    signOut,
    updateUserById,
    upsert,
  };
}

const environment = {
  url: 'http://127.0.0.1:54321',
  publishableKey: 'publishable-key',
  serviceRoleKey: 'service-role-key',
};

describe('local Supabase boundary', () => {
  it('parses quoted CLI values and only accepts loopback URLs', () => {
    expect(parseSupabaseStatus('API_URL="http://127.0.0.1:54321"\nPUBLISHABLE_KEY="pk"\n')).toEqual({
      API_URL: 'http://127.0.0.1:54321',
      PUBLISHABLE_KEY: 'pk',
    });
    expect(requireLoopbackSupabaseUrl('http://localhost:54321/')).toBe('http://localhost:54321');
    expect(() => requireLoopbackSupabaseUrl('https://project.supabase.co')).toThrow(
      'Refusing to bootstrap a test account outside local Supabase',
    );
  });

  it('injects local public and server-only values without replacing unrelated environment', () => {
    expect(localApplicationEnvironment({ KEEP: 'yes' }, environment)).toEqual({
      KEEP: 'yes',
      NEXT_PUBLIC_SUPABASE_URL: environment.url,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: environment.publishableKey,
      SUPABASE_SERVICE_ROLE_KEY: environment.serviceRoleKey,
      ICONS_CATALOG_SOURCE: 'supabase',
    });
  });
});

describe('local fixed test account', () => {
  it('creates, onboards, and verifies a missing account', async () => {
    const clients = authClients();
    const result = await ensureLocalTestAccount(
      environment,
      clients.clientFactory,
      () => new Date('2026-08-28T00:00:00.000Z'),
    );

    expect(result).toEqual({ created: true, userId: 'new-user' });
    expect(clients.createUser).toHaveBeenCalledWith({
      email: LOCAL_TEST_ACCOUNT.email,
      password: LOCAL_TEST_ACCOUNT.password,
      email_confirm: true,
    });
    expect(clients.updateUserById).not.toHaveBeenCalled();
    expect(clients.upsert).toHaveBeenCalledWith(expect.objectContaining({
      id: 'new-user',
      role: 'user',
      onboarded_at: '2026-08-28T00:00:00.000Z',
    }), { onConflict: 'id' });
    expect(clients.signInWithPassword).toHaveBeenCalledWith({
      email: LOCAL_TEST_ACCOUNT.email,
      password: LOCAL_TEST_ACCOUNT.password,
    });
    expect(clients.signOut).toHaveBeenCalledOnce();
  });

  it('restores the password and confirmation state of an existing account', async () => {
    const clients = authClients({ users: [{ id: 'existing-user', email: 'TEST@test.com' }] });
    const result = await ensureLocalTestAccount(environment, clients.clientFactory);

    expect(result).toEqual({ created: false, userId: 'existing-user' });
    expect(clients.createUser).not.toHaveBeenCalled();
    expect(clients.updateUserById).toHaveBeenCalledWith('existing-user', {
      password: LOCAL_TEST_ACCOUNT.password,
      email_confirm: true,
    });
  });
});

describe('local command wrapper', () => {
  it('restores the account before starting Next with matching local values', async () => {
    const ensureAccount = vi.fn().mockResolvedValue({ created: false, userId: 'user-id' });
    const run = vi.fn().mockReturnValue({ status: 0, signal: null });

    await runLocalSupabaseCommand({
      mode: 'start',
      args: ['-H', '127.0.0.1', '-p', '3000'],
      ambientEnvironment: { KEEP: 'yes' },
      readEnvironment: () => environment,
      ensureAccount,
      run,
    });

    expect(ensureAccount).toHaveBeenCalledWith(environment);
    expect(run).toHaveBeenCalledWith(
      localCommand('start', ['-H', '127.0.0.1', '-p', '3000']).command,
      ['run', 'start', '--', '-H', '127.0.0.1', '-p', '3000'],
      {
        env: localApplicationEnvironment({ KEEP: 'yes' }, environment),
        stdio: 'inherit',
      },
    );
  });

  it('rejects unsupported modes before launching a process', () => {
    expect(() => localCommand('deploy')).toThrow('Unsupported local server mode');
  });
});
