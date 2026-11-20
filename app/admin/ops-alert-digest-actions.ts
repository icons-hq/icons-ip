'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import {
  OPS_ALERT_DIGEST_CATEGORIES,
  OPS_ALERT_DIGEST_MAX_DELAY_HOURS,
  OPS_ALERT_DIGEST_MIN_DELAY_HOURS,
  OPS_ALERT_DIGEST_RECIPIENT_LIMIT,
  isOpsAlertDigestDelayHours,
  opsAlertDigestErrorMessage,
  parseOpsAlertDigestSettings,
  parseRecipientList,
  type OpsAlertDigestSettings,
} from '@/lib/admin/ops-alert-digest';
import { SYSTEM_HEALTH_PATH } from '@/lib/admin/system-health';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';

/* 알림이 가는 주소와 범주를 바꾸는 설정이라 계정 주매니저 이상(platform.manage)만 바꾼다. DB RPC가 다시 확인한다. */
const ACCESS = { capability: 'platform.manage' } as const;
const FORBIDDEN = '운영 알림 메일 설정은 계정 주매니저 이상만 바꿀 수 있습니다.';

export type OpsAlertDigestResult = { ok: true; settings: OpsAlertDigestSettings } | { ok: false; error: string };

/**
 * 사용 여부·받는 주소·알릴 범주·답변 지연 기준 시간을 저장한다. operationId는 화면이 한 번 만든 값을 재시도에 그대로 쓴다
 * (응답이 끊겨 다시 눌러도 같은 저장으로 처리된다).
 */
export async function saveOpsAlertDigestAction(input: {
  enabled: boolean; recipients: string; categories: string[]; delayHours: number; expectedRevision: number; operationId?: string;
}): Promise<OpsAlertDigestResult> {
  try {
    if (!await requireAdminActionAccess(SYSTEM_HEALTH_PATH, ACCESS)) return { ok: false, error: FORBIDDEN };
    if (!input || typeof input.enabled !== 'boolean' || typeof input.recipients !== 'string' || !isOpsAlertDigestDelayHours(input.delayHours)
      || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) {
      return { ok: false, error: `받는 주소(최대 ${OPS_ALERT_DIGEST_RECIPIENT_LIMIT}개)와 답변 지연 기준 시간(${OPS_ALERT_DIGEST_MIN_DELAY_HOURS}~${OPS_ALERT_DIGEST_MAX_DELAY_HOURS}시간, 정수)을 확인한 뒤 다시 저장해주세요.` };
    }
    const categories = Array.isArray(input.categories)
      ? OPS_ALERT_DIGEST_CATEGORIES.filter((category) => input.categories.includes(category)) : [];
    if (!categories.length || (input.categories as unknown[]).some((category) => !(OPS_ALERT_DIGEST_CATEGORIES as readonly unknown[]).includes(category))) {
      return { ok: false, error: '알릴 범주를 하나 이상 골라주세요.' };
    }
    const recipients = parseRecipientList(input.recipients, OPS_ALERT_DIGEST_RECIPIENT_LIMIT);
    if (!recipients.ok) return { ok: false, error: recipients.error };
    const operationId = input.operationId && isUuid(input.operationId) ? input.operationId : randomUUID();
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('admin_save_ops_alert_digest', {
      p_enabled: input.enabled,
      p_recipients: recipients.recipients,
      p_categories: categories,
      p_delay_hours: input.delayHours,
      p_expected_revision: input.expectedRevision,
      p_operation_id: operationId,
    });
    if (error) return { ok: false, error: opsAlertDigestErrorMessage(error) };
    const settings = parseOpsAlertDigestSettings(data);
    if (!settings) return { ok: false, error: '저장됐을 수 있지만 결과를 읽지 못했습니다. 새로고침해 설정이 바뀌었는지 확인하고, 바뀌지 않았으면 다시 저장해주세요.' };
    revalidatePath(SYSTEM_HEALTH_PATH);
    return { ok: true, settings };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: '운영 알림 메일 설정을 저장하지 못했습니다. 잠시 후 다시 시도해주세요.' };
  }
}
