'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { AdminCatalogActionState } from '@/app/admin/actions';
import {
  ADMIN_EXPORTS_PATH,
  isUuid,
  normalizeExportFilters,
  normalizeExportTemplateForm,
  toExportRpcFilters,
  type ExportColumn,
} from '@/lib/admin/exports';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { createClient } from '@/lib/supabase/server';

/*
 * D-4 내보내기 액션.
 *
 * 파일을 여기서 만들지 않는다 — 요청만 원장에 남기고 워커가 만든다. 그래야 10만 행을 요청한
 * 운영자의 브라우저가 기다리지 않고, 실패해도 다시 세울 자리가 남는다.
 */

const RPC_MESSAGES: [string, string][] = [
  ['secure_export_required', '개인정보가 포함된 양식입니다. 내보내기 권한을 받은 뒤 다시 시도해주세요.'],
  ['reason_required', '개인정보 양식은 사유를 적어야 합니다.'],
  ['daily_quota_exceeded', '오늘 개인정보 양식 요청 한도(20건)를 넘었습니다.'],
  ['template_not_found', '양식을 찾을 수 없습니다.'],
  ['job_not_found', '요청을 찾을 수 없습니다.'],
  ['job_not_done', '아직 파일이 만들어지지 않았습니다.'],
  ['job_expired', '보관 기간(7일)이 지난 파일입니다. 다시 요청해주세요.'],
  ['not_cancelable', '이미 끝난 요청은 취소할 수 없습니다.'],
  ['system_template_readonly', '시스템 양식은 고칠 수 없습니다. 복제해서 쓰세요.'],
  ['invalid_columns', '열 구성을 확인해주세요. 개인정보 열은 정렬 기준이 될 수 없습니다.'],
  ['invalid_template_name', '양식 이름을 확인해주세요.'],
  ['admin_required', '권한을 주고 거두는 일은 관리자만 할 수 있습니다.'],
  ['forbidden', '권한이 없습니다.'],
  ['auth_required', '로그인이 필요합니다.'],
];

function rpcMessage(message: string, fallback: string) {
  const hit = RPC_MESSAGES.find(([code]) => message.includes(code));
  return hit ? hit[1] : fallback;
}

async function requireStaff(): Promise<AdminCatalogActionState | null> {
  const auth = await getCurrentAdminAuthState();
  if (!auth.isConfigured || !auth.user) redirect('/login?next=%2Fadmin');
  if (!auth.isStaff) return { errors: { form: '관리자 권한이 필요합니다.' } };
  return null;
}

export async function requestExportAction(
  _state: AdminCatalogActionState,
  formData: FormData,
): Promise<AdminCatalogActionState> {
  const authError = await requireStaff();
  if (authError) return authError;

  const templateId = String(formData.get('templateId') ?? '').trim();
  const clientKey = String(formData.get('clientKey') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim();
  if (!isUuid(templateId)) return { errors: { templateId: '양식을 골라주세요.' } };
  if (!isUuid(clientKey)) return { errors: { form: '유효한 요청이 아닙니다. 화면을 새로고침한 뒤 다시 시도해주세요.' } };

  const filters = normalizeExportFilters(formData);
  if (!filters.ok) return { errors: filters.errors };

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_request_export', {
    p_client_key: clientKey,
    p_template_id: templateId,
    p_filters: toExportRpcFilters(filters.value),
    p_reason: reason || null,
  });
  if (error) return { errors: { form: rpcMessage(error.message, '내보내기를 요청하지 못했습니다.') } };

  revalidatePath(ADMIN_EXPORTS_PATH);
  return { message: '내보내기를 요청했습니다. 파일이 만들어지면 목록에서 받을 수 있습니다.' };
}

export async function cancelExportAction(
  _state: AdminCatalogActionState,
  formData: FormData,
): Promise<AdminCatalogActionState> {
  const authError = await requireStaff();
  if (authError) return authError;

  const jobId = String(formData.get('jobId') ?? '').trim();
  if (!isUuid(jobId)) return { errors: { form: '요청을 찾을 수 없습니다.' } };

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_cancel_export', { p_job_id: jobId });
  if (error) return { errors: { form: rpcMessage(error.message, '요청을 취소하지 못했습니다.') } };

  revalidatePath(ADMIN_EXPORTS_PATH);
  return { message: '요청을 취소했습니다.' };
}

/**
 * 다운로드 발급. 서명 URL 은 10분만 살고, 발급 자체가 기록으로 남는다(고시 §8).
 * 브라우저 다운로드는 액션이 돌려준 URL 로 화면이 연다.
 */
export async function issueExportDownloadAction(
  _state: AdminCatalogActionState & { url?: string },
  formData: FormData,
): Promise<AdminCatalogActionState & { url?: string }> {
  const authError = await requireStaff();
  if (authError) return authError;

  const jobId = String(formData.get('jobId') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim();
  if (!isUuid(jobId)) return { errors: { form: '요청을 찾을 수 없습니다.' } };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_issue_export_download', {
    p_job_id: jobId,
    p_reason: reason || null,
    p_url_ttl_seconds: 600,
  });
  if (error) return { errors: { form: rpcMessage(error.message, '다운로드 링크를 만들지 못했습니다.') } };

  const issued = ((data ?? []) as { file_path: string; file_name: string }[])[0];
  if (!issued) return { errors: { form: '다운로드 링크를 만들지 못했습니다.' } };

  const signed = await supabase.storage
    .from('admin-exports')
    .createSignedUrl(issued.file_path, 600, { download: issued.file_name });
  if (signed.error || !signed.data) {
    return { errors: { form: '파일 보관함에서 링크를 만들지 못했습니다. 잠시 뒤 다시 시도해주세요.' } };
  }

  revalidatePath(ADMIN_EXPORTS_PATH);
  return { message: `${issued.file_name} 링크를 만들었습니다. 10분 안에 받아주세요.`, url: signed.data.signedUrl };
}

export async function upsertExportTemplateAction(
  _state: AdminCatalogActionState,
  formData: FormData,
): Promise<AdminCatalogActionState> {
  const authError = await requireStaff();
  if (authError) return authError;

  const catalogRaw = String(formData.get('columnCatalog') ?? '');
  let catalog: ExportColumn[] = [];
  try {
    const parsed: unknown = JSON.parse(catalogRaw || '[]');
    catalog = Array.isArray(parsed) ? (parsed as ExportColumn[]) : [];
  } catch {
    return { errors: { form: '열 목록을 읽지 못했습니다. 화면을 새로고침한 뒤 다시 시도해주세요.' } };
  }

  const result = normalizeExportTemplateForm(formData, catalog);
  if (!result.ok) return { errors: result.errors };
  const value = result.value;

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_upsert_export_template', {
    p_id: value.id,
    p_name: value.name,
    p_target: value.target,
    p_columns: value.columns,
    p_sort: [],
    p_default_filters: {},
    p_security_level: value.securityLevel,
    p_file_format: value.fileFormat,
    p_description: value.description,
  });
  if (error) return { errors: { form: rpcMessage(error.message, '양식을 저장하지 못했습니다.') } };

  revalidatePath(ADMIN_EXPORTS_PATH);
  return { message: `양식 ${value.name}을(를) 저장했습니다.` };
}

export async function setAdminPermissionAction(
  _state: AdminCatalogActionState,
  formData: FormData,
): Promise<AdminCatalogActionState> {
  const authError = await requireStaff();
  if (authError) return authError;

  const userId = String(formData.get('userId') ?? '').trim();
  const granted = String(formData.get('granted') ?? '') === 'true';
  if (!isUuid(userId)) return { errors: { userId: '대상을 찾을 수 없습니다.' } };

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_set_admin_permission', {
    target_user_id: userId,
    target_permission: 'secure_export',
    target_granted: granted,
  });
  if (error) return { errors: { form: rpcMessage(error.message, '권한을 바꾸지 못했습니다.') } };

  revalidatePath(ADMIN_EXPORTS_PATH);
  return { message: granted ? '개인정보 내보내기 권한을 주었습니다.' : '권한을 거뒀습니다.' };
}
