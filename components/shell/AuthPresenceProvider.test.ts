import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const mocks = vi.hoisted(() => ({ configured: true }));

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/supabase/config', () => ({
  getSupabaseConfig: () => ({ isConfigured: mocks.configured }),
}));

import {
  AuthPresenceProvider,
  observeAuthPresence,
  type AuthPresence,
  useAuthPresence,
} from './AuthPresenceProvider';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

describe('observeAuthPresence', () => {
  it('does not let a stale initial lookup overwrite a newer auth event', async () => {
    const lookup = deferred<{ data: { user: { id: string } | null } }>();
    const unsubscribe = vi.fn();
    let authChange: ((event: string, session: { user: { id: string } } | null) => void) | undefined;
    const client = {
      auth: {
        getUser: () => lookup.promise,
        onAuthStateChange: (callback: typeof authChange) => {
          authChange = callback;
          return { data: { subscription: { unsubscribe } } };
        },
      },
    };
    const observed: AuthPresence[] = [];

    const cleanup = observeAuthPresence(client as never, (presence) => observed.push(presence));
    authChange?.('SIGNED_IN', { user: { id: 'latest-user' } });
    lookup.resolve({ data: { user: null } });
    await lookup.promise;
    await Promise.resolve();

    expect(observed).toEqual(['signed-in']);

    cleanup();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('uses the initial lookup when no auth event has been observed', async () => {
    const observed: AuthPresence[] = [];
    const client = {
      auth: {
        getUser: async () => ({ data: { user: null } }),
        onAuthStateChange: () => ({
          data: { subscription: { unsubscribe: vi.fn() } },
        }),
      },
    };

    const cleanup = observeAuthPresence(client as never, (presence) => observed.push(presence));
    await Promise.resolve();
    await Promise.resolve();

    expect(observed).toEqual(['signed-out']);
    cleanup();
  });

  it('ignores pending lookups and auth events after cleanup', async () => {
    const lookup = deferred<{ data: { user: { id: string } | null } }>();
    const observed: AuthPresence[] = [];
    let authChange: ((event: string, session: { user: { id: string } } | null) => void) | undefined;
    const client = {
      auth: {
        getUser: () => lookup.promise,
        onAuthStateChange: (callback: typeof authChange) => {
          authChange = callback;
          return { data: { subscription: { unsubscribe: vi.fn() } } };
        },
      },
    };

    const cleanup = observeAuthPresence(client as never, (presence) => observed.push(presence));
    cleanup();
    lookup.resolve({ data: { user: { id: 'stale-user' } } });
    authChange?.('SIGNED_IN', { user: { id: 'stale-user' } });
    await lookup.promise;
    await Promise.resolve();

    expect(observed).toEqual([]);
  });
});

function PresenceProbe() {
  return createElement('span', null, useAuthPresence());
}

describe('AuthPresenceProvider', () => {
  it('starts unresolved when Supabase is configured', () => {
    mocks.configured = true;

    expect(renderToStaticMarkup(createElement(
      AuthPresenceProvider,
      null,
      createElement(PresenceProbe),
    ))).toContain('>unknown</span>');
  });

  it('starts signed out when Supabase is not configured', () => {
    mocks.configured = false;

    expect(renderToStaticMarkup(createElement(
      AuthPresenceProvider,
      null,
      createElement(PresenceProbe),
    ))).toContain('>signed-out</span>');
  });
});
