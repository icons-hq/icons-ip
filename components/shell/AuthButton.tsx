'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { signOutAction } from '@/app/login/actions';
import { nextPathWithSearch } from '@/lib/auth/onboarding';
import { createClient } from '@/lib/supabase/client';
import { getSupabaseConfig } from '@/lib/supabase/config';

export function AuthButton() {
  const router = useRouter();
  const pathname = usePathname();
  const [isSignedIn, setIsSignedIn] = useState(false);

  useEffect(() => {
    if (!getSupabaseConfig().isConfigured) return;

    const supabase = createClient();
    let mounted = true;

    supabase.auth.getUser().then(({ data }) => {
      if (mounted) setIsSignedIn(Boolean(data.user));
    });

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (mounted) setIsSignedIn(Boolean(session?.user));
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, [pathname]);

  const loginHref = () =>
    `/login?next=${encodeURIComponent(
      nextPathWithSearch(window.location.pathname, new URLSearchParams(window.location.search)),
    )}`;

  if (isSignedIn) {
    return (
      <form action={signOutAction}>
        <button className="btn btn-ghost btn-sm">로그아웃</button>
      </form>
    );
  }

  return (
    <>
      <button className="btn btn-ghost btn-sm" onClick={() => router.push(loginHref())}>
        로그인
      </button>
      <button className="btn btn-holo btn-sm" onClick={() => router.push(loginHref())}>
        시작하기
      </button>
    </>
  );
}
