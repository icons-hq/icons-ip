'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { createClient } from '@/lib/supabase/client';
import { getSupabaseConfig } from '@/lib/supabase/config';

/**
 * 마이페이지 "성인 인증" 메뉴 노출. 시작 가능 여부는 서버 환경(공개 스위치·canary)이
 * 정하므로 브라우저는 서버 라우트에 묻는다. 로그인 세션이 바뀌면 다시 묻는다.
 */
export function useAdultVerificationMenuAvailable() {
  const [visible, setVisible] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    if (!getSupabaseConfig().isConfigured) return;
    let alive = true;
    let generation = 0;
    const client = createClient();
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      const ticket = ++generation;
      if (!session?.user) {
        setVisible(false);
        return;
      }
      // auth 콜백은 Supabase 잠금 안에서 다른 요청을 기다리면 안 된다.
      queueMicrotask(() => {
        void fetch('/api/identity/adult/menu', { cache: 'no-store', credentials: 'same-origin' })
          .then((response) => (response.ok ? response.json() as Promise<{ visible?: unknown }> : null))
          .then((state) => {
            if (alive && ticket === generation) setVisible(state?.visible === true);
          })
          .catch(() => {
            if (alive && ticket === generation) setVisible(false);
          });
      });
    });
    return () => {
      alive = false;
      generation++;
      data.subscription.unsubscribe();
    };
  }, [pathname]);

  return visible;
}
