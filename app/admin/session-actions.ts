'use server';

import { redirect } from 'next/navigation';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';

/*
 * 어드민 로그아웃 (현업 슬라이스 5 · 「로그아웃이 홈으로 튄다」).
 *
 * 스토어의 `signOutAction` 은 `/` 로 보낸다. 어드민에서 그러면 운영자가 다시 들어오는
 * 길을 스스로 찾아야 한다 — 그래서 여기서는 **어드민 로그인 화면**으로 돌려보낸다.
 * 로그아웃 자체는 같은 계약(로컬 세션만 종료)이다.
 */
export async function signOutAdminAction() {
  const { isConfigured } = getSupabaseConfig();
  if (isConfigured) {
    const supabase = await createClient();
    await supabase.auth.signOut({ scope: 'local' });
  }

  redirect(`/login?next=${encodeURIComponent('/admin')}`);
}
