import 'server-only';

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

export async function getCurrentAdminAuthState(): Promise<CurrentAdminAuthState> {
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
}
