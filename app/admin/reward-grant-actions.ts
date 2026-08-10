'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  mapAdminDrawTicketGrantError,
  normalizeAdminDrawTicketGrantForm,
} from '@/lib/admin/draw-ticket-grants';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { createClient } from '@/lib/supabase/server';

/* 수동 뽑기권 발급 서버 액션(#185).
 * 카탈로그 액션(app/admin/actions.ts)과 분리해 둔다 — 리워드 발급은 카탈로그 upsert와
 * 다른 감사 계약을 따르고, 두 표면이 한 파일에 섞이면 변경 이유가 뭉개진다. */

export interface AdminDrawTicketGrantActionState {
  errors?: Record<string, string>;
  message?: string;
  nextOperationId?: string;
}

function loginPath() {
  return `/login?next=${encodeURIComponent('/admin')}`;
}

async function requireStaffAction(): Promise<AdminDrawTicketGrantActionState | null> {
  const auth = await getCurrentAdminAuthState();
  if (!auth.isConfigured || !auth.user) redirect(loginPath());
  if (!auth.isStaff) return { errors: { form: '관리자 권한이 필요합니다.' } };
  return null;
}

export async function grantAdminDrawTicketsAction(
  _state: AdminDrawTicketGrantActionState,
  formData: FormData,
): Promise<AdminDrawTicketGrantActionState> {
  const authError = await requireStaffAction();
  if (authError) return authError;

  const normalized = normalizeAdminDrawTicketGrantForm(formData);
  if (!normalized.ok) return { errors: normalized.errors };

  const value = normalized.value;
  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_grant_draw_tickets', {
    target_operation_id: value.operationId,
    target_profile_id: value.profileId,
    target_pool_id: value.poolId,
    target_quantity: value.quantity,
    target_reason: value.reason,
  });

  if (error) return { errors: { form: mapAdminDrawTicketGrantError(error.message) } };

  revalidatePath('/admin');
  revalidatePath('/packs');

  return {
    message: `카드팩 ${value.quantity.toLocaleString('ko-KR')}개를 발급했습니다.`,
    nextOperationId: randomUUID(),
  };
}
