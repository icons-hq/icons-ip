'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  normalizeAdminNotificationForm,
  type AdminNotificationActionState,
} from '@/lib/admin/notifications';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { createClient } from '@/lib/supabase/server';

interface SendNotificationRow {
  recipient_count: number | string;
  sent_at: string;
}

const SEND_FAILED = '공지를 발송하지 못했습니다. 대상과 최신 수신자 수를 확인해주세요.';
const SEND_RESULT_MISSING = '공지를 발송하지 못했습니다. 최신 발송 이력을 확인해주세요.';

function loginPath() {
  return `/login?next=${encodeURIComponent('/admin')}`;
}

async function requireStaffAction(): Promise<AdminNotificationActionState | null> {
  const auth = await getCurrentAdminAuthState();
  if (!auth.isConfigured || !auth.user) redirect(loginPath());
  if (!auth.isStaff) return { errors: { form: '관리자 권한이 필요합니다.' } };
  return null;
}

function actualRecipientCount(data: unknown) {
  if (!Array.isArray(data) || data.length < 1) return null;
  const row = data[0] as Partial<SendNotificationRow>;
  const count = typeof row.recipient_count === 'number'
    ? row.recipient_count
    : Number(row.recipient_count);
  return Number.isSafeInteger(count) && count > 0 ? count : null;
}

export async function sendAdminNotificationAction(
  _state: AdminNotificationActionState,
  formData: FormData,
): Promise<AdminNotificationActionState> {
  const authError = await requireStaffAction();
  if (authError) return authError;

  const normalized = normalizeAdminNotificationForm(formData);
  if (!normalized.ok) return { errors: normalized.errors };

  const value = normalized.value;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_send_notification', {
    target_body: value.body,
    target_ip_id: value.ipId,
    target_operation_id: value.operationId,
    target_scope: value.scope,
    target_title: value.title,
  });

  if (error) return { errors: { form: SEND_FAILED } };

  const recipientCount = actualRecipientCount(data);
  if (recipientCount === null) return { errors: { form: SEND_RESULT_MISSING } };

  revalidatePath('/admin');
  revalidatePath('/notifications');

  return {
    message: `${recipientCount.toLocaleString('ko-KR')}명에게 인앱 공지를 발송했습니다.`,
    recipientCount,
    nextOperationId: randomUUID(),
  };
}
