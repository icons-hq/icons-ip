'use server';

import { revalidatePath } from 'next/cache';
import { adminClaimBasePath } from '@/lib/admin/claims';
import {
  mapReturnIntakeTable,
  parseReturnIntakeConfirmResult,
  parseReturnIntakePreview,
  type ReturnIntakeConfirmResult,
  type ReturnIntakeIssue,
  type ReturnIntakePreviewRow,
  type ReturnIntakeRow,
} from '@/lib/admin/claim-return-intake';
import { readReturnIntakeFile } from '@/lib/admin/claim-return-intake.server';
import { claimReturnPickupError, parseClaimReturnOperations } from '@/lib/admin/claim-return-pickup';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';

/*
 * 반품 자동 회수 접수 재시도(QNA-032)와 반품입고 회신 업로드(QNA-034)의 운영 액션(ADR-0034). 둘 다 DB 스위치가 꺼져 있으면 DB가 거절한다
 * (화면은 꺼져 있으면 그리지 않는다). 권한은 클레임 처리와 같은 sales.manage다. 파일의 연락처는 DB 대조에만 보내고 응답·로그에 남기지 않는다.
 */

export interface ClaimReturnPickupRetryState { message?: string; error?: string }

async function requireSalesManage(): Promise<string | null> {
  return await requireAdminActionAccess('/admin/sales/claims/returns', { capability: 'sales.manage' }) ? null : '관리자 권한이 필요합니다.';
}

function revalidateClaims(claimId?: string) {
  for (const type of ['return', 'exchange'] as const) {
    revalidatePath(adminClaimBasePath(type));
    if (claimId) revalidatePath(`${adminClaimBasePath(type)}/${claimId}`);
  }
  revalidatePath('/orders');
}

/** 자동 수거 실패(접수 실패·취소 실패)를 다시 큐에 넣는다. 다음 크론 회차가 같은 멱등 키로 택배사에 다시 보낸다. */
export async function retryClaimReturnPickupAction(_previous: ClaimReturnPickupRetryState, formData: FormData): Promise<ClaimReturnPickupRetryState> {
  const denied = await requireSalesManage();
  if (denied) return { error: denied };
  const claimId = String(formData.get('claimId') ?? ''), bundleId = String(formData.get('bundleId') ?? '');
  if (!isUuid(claimId) || !isUuid(bundleId)) return { error: '다시 접수할 회수 묶음을 찾지 못했습니다. 새로고침해주세요.' };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_retry_claim_return_pickup', { p_claim_id: claimId, p_bundle_id: bundleId });
  if (error) return { error: claimReturnPickupError(error.message) };
  revalidateClaims(claimId);
  const state = data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>).state : null;
  return { message: state === 'cancel_pending'
    ? '수거 취소를 다시 요청하도록 했습니다. 몇 분 뒤 결과가 보입니다.'
    : state === 'pending' ? '회수 접수를 다시 요청하도록 했습니다. 몇 분 뒤 회수 운송장이 보입니다.' : '이미 다시 요청한 회수 접수입니다. 몇 분 뒤 새로고침해주세요.' };
}

export interface ClaimReturnIntakePreview {
  fileName: string;
  sha256: string;
  headerLine: number;
  rows: ReturnIntakePreviewRow[];
  counts: Record<string, number>;
  issues: ReturnIntakeIssue[];
}

type ReadIntake = { error: string } | { fileName: string; sha256: string; headerLine: number; rows: ReturnIntakeRow[]; issues: ReturnIntakeIssue[] };

async function readIntake(formData: FormData): Promise<ReadIntake> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_claim_return_operations');
  const operations = error ? null : parseClaimReturnOperations(data);
  if (!operations || !operations.intake.enabled) return { error: '반품입고 회신 반영이 꺼져 있습니다. 창고 회신은 클레임 상세의 회수 확인으로 기록해주세요.' };
  const file = formData.get('file');
  if (!(file instanceof File) || !file.size) return { error: '반품입고 회신 파일을 골라주세요.' };
  const password = formData.get('filePassword');
  let read;
  try {
    read = await readReturnIntakeFile(file, typeof password === 'string' ? password : '');
  } catch (failure) {
    return { error: failure instanceof Error ? failure.message : '반품입고 회신 파일을 읽지 못했습니다.' };
  }
  const mapped = mapReturnIntakeTable(read.table, operations.intake.columns, read.lineErrors);
  if ('error' in mapped) return { error: mapped.error };
  if (!mapped.rows.length) return { error: mapped.issues.length ? '읽을 수 있는 줄이 없습니다. 아래 줄의 문제를 고쳐 다시 올려주세요.' : '반품입고 회신에 입고 줄이 없습니다.' };
  return { fileName: read.fileName, sha256: read.sha256, headerLine: mapped.headerLine, rows: mapped.rows, issues: mapped.issues };
}

/** 등록 전 확인: 파일을 읽어 회수 묶음에 맞춰 본다(아무것도 바꾸지 않는다). */
export async function previewClaimReturnIntakeAction(formData: FormData): Promise<{ preview?: ClaimReturnIntakePreview; error?: string }> {
  const denied = await requireSalesManage();
  if (denied) return { error: denied };
  const read = await readIntake(formData);
  if ('error' in read) return { error: read.error };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_preview_claim_return_intake', { p_rows: read.rows });
  const parsed = error ? null : parseReturnIntakePreview(data);
  if (!parsed) return { error: '반품입고 회신을 맞춰 보지 못했습니다. 잠시 후 같은 파일로 다시 확인해주세요.' };
  return { preview: { fileName: read.fileName, sha256: read.sha256, headerLine: read.headerLine, rows: parsed.rows, counts: parsed.counts, issues: read.issues } };
}

export interface ClaimReturnIntakeConfirmState { result?: ReturnIntakeConfirmResult; error?: string }

/**
 * 입고 확정: 같은 파일을 다시 읽어(SHA-256이 미리보기와 같아야 한다) 미리보기에서 맞춘 줄의 회수 묶음을 함께 보낸다. DB가 다시 맞춰 보고
 * 같은 묶음일 때만 회수 확인을 기록한다(실제 입고일 = 파일 날짜, 근거 = 파일 SHA-256·행 번호). 같은 확정 번호의 재전송은 같은 결과다.
 */
export async function confirmClaimReturnIntakeAction(formData: FormData): Promise<ClaimReturnIntakeConfirmState> {
  const denied = await requireSalesManage();
  if (denied) return { error: denied };
  const operationId = String(formData.get('operationId') ?? ''), previewSha = String(formData.get('sha256') ?? '');
  let selection: Map<number, string>;
  try {
    const raw: unknown = JSON.parse(String(formData.get('selection') ?? '[]'));
    if (!Array.isArray(raw) || raw.length > 1000) throw new Error('selection');
    selection = new Map(raw.map((entry: { rowNumber?: unknown; bundleId?: unknown }) => {
      if (!Number.isSafeInteger(entry?.rowNumber) || typeof entry.bundleId !== 'string' || !isUuid(entry.bundleId)) throw new Error('selection');
      return [Number(entry.rowNumber), entry.bundleId] as const;
    }));
  } catch {
    return { error: '확정할 줄을 읽지 못했습니다. 등록 전 확인을 다시 해주세요.' };
  }
  if (!isUuid(operationId) || !/^[0-9a-f]{64}$/u.test(previewSha) || !selection.size) return { error: '확정할 줄이 없습니다. 등록 전 확인을 다시 해주세요.' };
  const read = await readIntake(formData);
  if ('error' in read) return { error: read.error };
  if (read.sha256 !== previewSha) return { error: '확인한 파일과 다른 파일입니다. 등록 전 확인을 다시 해주세요.' };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_confirm_claim_return_intake', {
    p_rows: read.rows.map(row => ({ ...row, bundleId: selection.get(row.rowNumber) ?? null })),
    p_file_sha256: read.sha256,
    p_operation: operationId,
  });
  if (error) {
    return { error: (error.message ?? '').includes('claim_return_intake_conflict')
      ? '같은 확정 번호로 다른 내용이 이미 처리됐습니다. 등록 전 확인을 다시 해주세요.'
      : '입고 확정 결과를 확인하지 못했습니다. 같은 파일로 다시 확정하면 이미 기록된 줄은 그대로 둡니다.' };
  }
  const result = parseReturnIntakeConfirmResult(data);
  if (!result) return { error: '입고 확정 결과를 확인하지 못했습니다. 목록을 새로고침해 입고 상태를 확인해주세요.' };
  revalidateClaims();
  return { result };
}
