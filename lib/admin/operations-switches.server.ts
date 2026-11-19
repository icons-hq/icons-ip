import 'server-only';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { createClient } from '@/lib/supabase/server';
import { canAccessAdminScreen } from './access';
import { adminScreenForPath } from './navigation';
import { OPERATIONS_SWITCHES_PATH, parseOperationsSwitches, type OperationsSwitchesState } from './operations-switches';

/** 읽지 못하면 null — 화면이 안내하고 저장을 막는다(값을 모른 채 덮어쓰지 않는다). */
export async function loadAdminOperationsSwitches(): Promise<OperationsSwitchesState | null> {
  try {
    const { data, error } = await (await createClient()).rpc('admin_get_operations_switches');
    return error ? null : parseOperationsSwitches(data);
  } catch { return null; }
}

/** 지연 안내·일정 변경 화면의 '메일 설정이 꺼져 있음' 안내에 스위치 화면 링크를 달지 정한다(권한 있는 사람에게만). */
export async function canOpenOperationsSwitches(): Promise<boolean> {
  try {
    const auth = await getCurrentAdminAuthState();
    return Boolean(auth.isConfigured && auth.user && !auth.mfaPending && auth.isStaff
      && canAccessAdminScreen(auth, adminScreenForPath(OPERATIONS_SWITCHES_PATH), { adminOnly: true, intent: 'write' }));
  } catch { return false; }
}
