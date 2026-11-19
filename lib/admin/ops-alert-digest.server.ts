import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { parseOpsAlertDigestSettings, type OpsAlertDigestSettings } from './ops-alert-digest';

/** 운영 알림 메일 설정·최근 발송 기록(platform.manage). 읽지 못하면 null — 화면이 설정 칸 대신 안내를 보인다. */
export async function loadOpsAlertDigest(): Promise<OpsAlertDigestSettings | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('admin_get_ops_alert_digest');
    return error ? null : parseOpsAlertDigestSettings(data);
  } catch {
    return null;
  }
}
