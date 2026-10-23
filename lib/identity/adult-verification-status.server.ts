import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { parseAdultVerificationStatus, type AdultVerificationStatus } from './adult-verification-status';

/** 로그인 세션으로 내 성인 인증 상태를 읽는다. 조회 실패는 none으로 접는다(fail closed). */
export async function loadMyAdultVerification(): Promise<AdultVerificationStatus> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('get_my_adult_verification');
    if (error) return { status: 'none' };
    return parseAdultVerificationStatus(data);
  } catch {
    return { status: 'none' };
  }
}
