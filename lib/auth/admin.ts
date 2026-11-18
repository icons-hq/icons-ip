import 'server-only';

import { cache } from 'react';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';
import { NO_OPERATOR_ACCESS, parseOperatorAccess, type OperatorAccess } from '@/lib/admin/access';
import { parseOperatorMfa } from '@/lib/admin/mfa';

export type AdminRole = 'user' | 'staff' | 'admin';

export interface CurrentAdminAuthState {
  isConfigured: boolean;
  user: {
    id: string;
    email: string | null;
  } | null;
  role: AdminRole | null;
  isStaff: boolean;
  operatorAccess?: OperatorAccess;
  /**
   * 운영자 2단계 인증 스위치가 켜졌는데 지금 세션이 aal2가 아니다(OPS-006). 이때는 운영자 권한을 쥐여 주지 않는다 —
   * `isStaff`는 false, `operatorAccess`는 권한 없음이라 어드민 API·서버 헬퍼·스태프 표면이 그대로 닫힌다.
   * 운영자 신원은 이 값으로만 알리고, 화면·액션 가드가 2단계 인증 화면으로 보낸다.
   */
  mfaPending?: boolean;
  /** 운영자 2단계 인증 스위치가 켜져 있다(운영자에게만 true). 내 보안 설정이 안내에 쓴다. */
  mfaRequired?: boolean;
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
    return { isConfigured: false, user: null, role: null, isStaff: false, operatorAccess: NO_OPERATOR_ACCESS };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  const user = data.user;

  if (error || !user) {
    return { isConfigured: true, user: null, role: null, isStaff: false, operatorAccess: NO_OPERATOR_ACCESS };
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role,suspended_at')
    .eq('id', user.id)
    .maybeSingle<AdminProfileRow>();
  const role = profile?.role ?? null;
  let operatorAccess = NO_OPERATOR_ACCESS;
  let mfaPending = false;
  let mfaRequired = false;
  if (profile && !profile.suspended_at && (role === 'staff' || role === 'admin')) {
    try {
      const access = await supabase.rpc('admin_current_operator_access');
      if (!access.error) {
        operatorAccess = parseOperatorAccess(access.data) ?? NO_OPERATOR_ACCESS;
        /* aal은 PostgREST가 서명을 검증한 이 요청의 JWT로 DB가 판정한다(살아 있는 세션까지). 앱이 쿠키를 다시 풀지 않는다. */
        const mfa = parseOperatorMfa((access.data as { mfa?: unknown } | null)?.mfa);
        mfaRequired = operatorAccess.mode !== 'none' && mfa.required;
        if (mfaRequired && !mfa.satisfied) {
          operatorAccess = NO_OPERATOR_ACCESS;
          mfaPending = true;
        }
      }
    } catch {
      // An unavailable authority source never restores the old raw-role grant.
    }
  }

  return {
    isConfigured: true,
    user: {
      id: user.id,
      email: user.email ?? null,
    },
    role,
    isStaff: !profile?.suspended_at && operatorAccess.mode !== 'none' && operatorAccess.capabilities.includes('home'),
    operatorAccess,
    ...(mfaPending ? { mfaPending } : {}),
    ...(mfaRequired ? { mfaRequired } : {}),
  };
});
