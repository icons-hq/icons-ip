import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { parseOperatorMfaPolicy, type OperatorMfaPolicy } from './mfa';

/** 읽지 못하면 null — 화면이 안내하고 스위치·초기화를 막는다(값을 모른 채 바꾸지 않는다). */
export async function loadOperatorMfaPolicy(): Promise<OperatorMfaPolicy | null> {
  try {
    const { data, error } = await (await createClient()).rpc('admin_get_operator_mfa_policy');
    return error ? null : parseOperatorMfaPolicy(data);
  } catch { return null; }
}
