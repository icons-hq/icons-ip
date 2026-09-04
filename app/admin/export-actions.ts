'use server';

import { createHash } from 'node:crypto';
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
import { IMPORT_KINDS, IMPORT_REPORT_LABELS, parseImportTable, type ImportIssue, type ImportKind } from '@/lib/admin/imports';
import { readUploadedTable } from '@/lib/admin/imports.server';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { createClient } from '@/lib/supabase/server';

/*
 * D-4 내보내기 액션.
 *
 * 파일을 여기서 만들지 않는다 — 요청만 원장에 남기고 워커가 만든다. 그래야 10만 행을 요청한
 * 운영자의 브라우저가 기다리지 않고, 실패해도 다시 세울 자리가 남는다.
 */

/** 업로드 액션의 상태 — 검증 리포트를 화면이 그대로 그린다. */
export interface AdminImportActionState extends AdminCatalogActionState {
  jobId?: string;
  rows?: Record<string, unknown>[];
  issues?: ImportIssue[];
}

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
  ['import_not_found', '업로드를 찾을 수 없습니다.'],
  ['not_validated', '이미 적용된 파일입니다.'],
  ['atomic_has_errors', '오류가 있어 「전부 아니면 전무」로는 적용할 수 없습니다.'],
  ['invalid_rows', '올릴 수 있는 줄 수를 넘었습니다(1,000줄).'],
  ['invalid_file', '파일을 읽지 못했습니다.'],
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

/* ------------------------------------------------------------------------- */
/* 업로드 (D-4b)                                                              */
/* ------------------------------------------------------------------------- */

/**
 * 파일을 읽어 검증만 한다 — 여기서는 아무것도 바뀌지 않는다.
 * 같은 사람이 같은 종류의 같은 파일을 다시 올리면 새 잡을 만들지 않고 이전 리포트를 돌려준다.
 */
export async function registerImportAction(
  _state: AdminImportActionState,
  formData: FormData,
): Promise<AdminImportActionState> {
  const authError = await requireStaff();
  if (authError) return authError;

  const kind = String(formData.get('kind') ?? '') as ImportKind;
  if (!IMPORT_KINDS.some((entry) => entry.value === kind)) return { errors: { kind: '업로드 종류를 골라주세요.' } };
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { errors: { file: '파일을 골라주세요.' } };
  if (file.size > 5 * 1024 * 1024) return { errors: { file: '파일은 5MB 까지 올릴 수 있습니다.' } };

  const buffer = Buffer.from(await file.arrayBuffer());
  const table = await readUploadedTable(buffer, file.name);
  if (!table) return { errors: { file: '파일을 읽지 못했습니다. CSV 또는 엑셀 파일인지 확인해주세요.' } };

  const parsed = parseImportTable(table, kind);
  if (parsed.rows.length === 0) {
    return {
      errors: { file: parsed.issues[0]?.message ?? '적용할 줄이 없습니다.' },
      issues: parsed.issues,
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_register_import', {
    p_kind: kind,
    p_file_name: file.name,
    p_file_sha256: createHash('sha256').update(buffer).digest('hex'),
    p_rows: parsed.rows,
    p_atomic: formData.get('atomic') === 'on',
  });
  if (error) return { errors: { form: rpcMessage(error.message, '파일을 확인하지 못했습니다.') } };

  /* 서버가 붙인 행별 코드(품목 없음·주문 없음 등)를 화면에 그대로 보여준다. */
  const jobId = String(data ?? '');
  const job = await supabase
    .from('import_jobs')
    .select('status,total_rows,ok_rows,failed_rows,report')
    .eq('id', jobId)
    .maybeSingle<{ status: string; total_rows: number; ok_rows: number; failed_rows: number; report: { line: number; code: string }[] }>();
  const serverIssues: ImportIssue[] = (job.data?.report ?? []).map((entry) => ({
    line: entry.line,
    code: entry.code,
    message: IMPORT_REPORT_LABELS[entry.code] ?? entry.code,
  }));

  revalidatePath(ADMIN_EXPORTS_PATH);
  if (job.data?.status === 'applied') {
    return { message: '이미 적용한 파일입니다. 같은 파일은 두 번 적용하지 않습니다.', issues: serverIssues };
  }
  return {
    message: `${job.data?.ok_rows ?? parsed.rows.length}줄이 적용 가능합니다.`
      + (parsed.skipped > 0 ? ` 송장이 빈 ${parsed.skipped}줄은 건너뜁니다.` : '')
      + ((job.data?.failed_rows ?? 0) > 0 ? ` ${job.data?.failed_rows}줄은 오류입니다.` : ''),
    jobId,
    rows: parsed.rows,
    issues: [...parsed.issues, ...serverIssues],
  };
}

/** 검증에서 통과한 줄만 적용한다. 화면이 들고 있던 행을 그대로 다시 보낸다(줄 번호가 기준이다). */
export async function applyImportAction(
  _state: AdminImportActionState,
  formData: FormData,
): Promise<AdminImportActionState> {
  const authError = await requireStaff();
  if (authError) return authError;

  const jobId = String(formData.get('jobId') ?? '').trim();
  if (!isUuid(jobId)) return { errors: { form: '업로드를 찾을 수 없습니다.' } };
  let rows: Record<string, unknown>[] = [];
  try {
    const parsed: unknown = JSON.parse(String(formData.get('rows') ?? '[]'));
    rows = Array.isArray(parsed) ? (parsed as Record<string, unknown>[]) : [];
  } catch {
    return { errors: { form: '올린 내용을 읽지 못했습니다. 파일을 다시 올려주세요.' } };
  }
  if (rows.length === 0) return { errors: { form: '적용할 줄이 없습니다.' } };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_apply_import', { p_job_id: jobId, p_rows: rows });
  if (error) return { errors: { form: rpcMessage(error.message, '적용하지 못했습니다.') } };

  const result = (data ?? {}) as { applied?: number; skipped?: number };
  revalidatePath(ADMIN_EXPORTS_PATH);
  return {
    message: `${(result.applied ?? 0).toLocaleString('ko-KR')}줄을 적용했습니다.${result.skipped ? ` ${result.skipped}줄은 오류라 건너뛰었습니다.` : ''}`,
  };
}
