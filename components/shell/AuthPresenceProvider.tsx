'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { getSupabaseConfig } from '@/lib/supabase/config';

export type AuthPresence = 'unknown' | 'signed-in' | 'signed-out';

type AuthPresenceClient = Pick<ReturnType<typeof createClient>, 'auth'>;

const AuthPresenceContext = createContext<AuthPresence>('unknown');

export function observeAuthPresence(
  client: AuthPresenceClient,
  onPresence: (presence: AuthPresence) => void,
) {
  let active = true;
  let authEventObserved = false;

  const { data } = client.auth.onAuthStateChange((_event, session) => {
    authEventObserved = true;
    if (active) onPresence(session?.user ? 'signed-in' : 'signed-out');
  });

  void client.auth.getUser().then(({ data: userData }) => {
    if (active && !authEventObserved) {
      onPresence(userData.user ? 'signed-in' : 'signed-out');
    }
  }, () => {
    if (active && !authEventObserved) onPresence('signed-out');
  });

  return () => {
    active = false;
    data.subscription.unsubscribe();
  };
}

export function AuthPresenceProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [presence, setPresence] = useState<AuthPresence>(() =>
    getSupabaseConfig().isConfigured ? 'unknown' : 'signed-out',
  );

  useEffect(() => {
    if (!getSupabaseConfig().isConfigured) return;

    return observeAuthPresence(createClient(), setPresence);
  }, [pathname]);

  return (
    <AuthPresenceContext.Provider value={presence}>
      {children}
    </AuthPresenceContext.Provider>
  );
}

export function useAuthPresence() {
  return useContext(AuthPresenceContext);
}
