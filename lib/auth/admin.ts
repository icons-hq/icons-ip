import 'server-only';

import { cache } from 'react';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';

export type AdminRole = 'user' | 'staff' | 'admin';

export interface CurrentAdminAuthState {
  isConfigured: boolean;
  user: {
    id: string;
    email: string | null;
  } | null;
  role: AdminRole | null;
  isStaff: boolean;
}

interface AdminProfileRow {
  role: AdminRole;
  suspended_at: string | null;
}

/*
 * 요청 하나 안에서 결과를 재사용한다. 어드민 셸은 layout 과 page 가 각각
 * 권한을 확인하므로 cache 가 없으면 화면마다 auth.getUser() + profiles select 가
 * 두 벌씩 나간다. 같은 요청 안에서 세션이 바뀌지 않으므로 안전하다.
 */
export const getCurrentAdminAuthState = cache(async (): Promise<CurrentAdminAuthState> => {
  if (!getSupabaseConfig().isConfigured) {
    return { isConfigured: false, user: null, role: null, isStaff: false };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  const user = data.user;

  if (error || !user) {
    return { isConfigured: true, user: null, role: null, isStaff: false };
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role,suspended_at')
    .eq('id', user.id)
    .maybeSingle<AdminProfileRow>();
  const role = profile?.role ?? null;

  return {
    isConfigured: true,
    user: {
      id: user.id,
      email: user.email ?? null,
    },
    role,
    isStaff: !profile?.suspended_at && (role === 'staff' || role === 'admin'),
  };
});
