import 'server-only';

import { createHash } from 'node:crypto';
import { createServiceClient } from '@/lib/supabase/service';
import { exportFileName, type ExportColumn } from './exports';
import { buildCsvFile, buildXlsxFile } from './exports-file.server';

/*
 * 내보내기 워커의 일 (D-4).
 *
 * 큐에서 하나만 집어 만들고 끝낸다 — 서버리스 함수 실행 시간 안에 확실히 끝나는 단위이고,
 * 남은 잡은 다음 호출이 가져간다. 라우트는 이 함수를 부르기만 한다(크론도 수동 호출도 같은 길).
 */

const PAGE_SIZE = 1000;
const ROW_LIMIT = 100000;

interface ExportJobRow {
  id: string;
  template_id: string;
  requested_by: string;
  created_at: string;
}

interface TemplateRow {
  key: string | null;
  columns: ExportColumn[];
  file_format: string;
}

export interface ExportWorkResult {
  claimed: number;
  job?: string;
  rows?: number;
  bytes?: number;
  encrypted?: boolean;
}

export async function runExportJob(workerId: string): Promise<ExportWorkResult> {
  const supabase = createServiceClient();
  const claimed = await supabase.rpc('claim_export_job', { p_worker: workerId });
  if (claimed.error) throw new Error(claimed.error.message);
  /* 큐가 비면 빈 배열이다. id 까지 확인하는 건 합성 타입 시절의 "전부 null 인 행"에 다시 속지 않기 위해서다. */
  const job = ((claimed.data ?? []) as ExportJobRow[])[0] ?? null;
  if (!job?.id) return { claimed: 0 };

  try {
    const template = await supabase
      .from('export_templates')
      .select('key,columns,file_format')
      .eq('id', job.template_id)
      .maybeSingle<TemplateRow>();
    if (template.error || !template.data) throw new Error(template.error?.message ?? 'template_not_found');

    const rows: Record<string, unknown>[] = [];
    let after: unknown = null;
    for (;;) {
      const page = await supabase.rpc('export_rows_for_job', { p_job_id: job.id, p_after: after, p_limit: PAGE_SIZE });
      if (page.error) throw new Error(page.error.message);
      const batch = (page.data ?? []) as { row_key: unknown; row_data: Record<string, unknown> }[];
      if (batch.length === 0) break;
      for (const entry of batch) rows.push(entry.row_data);
      if (rows.length >= ROW_LIMIT) throw new Error('rows_over_limit');
      after = batch[batch.length - 1].row_key;
      if (batch.length < PAGE_SIZE) break;
    }

    const columns = template.data.columns ?? [];
    let password: string | null = null;
    if (template.data.file_format === 'xlsx') {
      /* 암호는 잡 원장이 아니라 한 번 읽고 지우는 보관함에 있다. 여기서 소비한다. */
      const secret = await supabase.rpc('consume_export_job_secret', { p_job_id: job.id });
      if (secret.error) throw new Error(secret.error.message);
      password = typeof secret.data === 'string' && secret.data.length > 0 ? secret.data : null;
    }

    const file = template.data.file_format === 'xlsx'
      ? await buildXlsxFile(columns, rows, { password, sheetName: template.data.key ?? '내보내기' })
      : buildCsvFile(columns, rows);
    const path = `${job.requested_by}/${job.id}/${exportFileName(template.data.key, job.created_at, template.data.file_format)}`;
    const uploaded = await supabase.storage
      .from('admin-exports')
      /* 버킷 허용 목록은 파라미터 없는 MIME 만 받는다. CSV 의 인코딩은 파일 앞의 BOM 이 알린다. */
      .upload(path, file.bytes, { contentType: file.contentType, upsert: true });
    if (uploaded.error) throw new Error(uploaded.error.message);

    const finished = await supabase.rpc('finish_export_job', {
      p_job_id: job.id,
      p_file_path: path,
      p_row_count: rows.length,
      p_file_bytes: file.bytes.byteLength,
      p_file_sha256: createHash('sha256').update(file.bytes).digest('hex'),
    });
    if (finished.error) throw new Error(finished.error.message);

    return { claimed: 1, job: job.id, rows: rows.length, bytes: file.bytes.byteLength, encrypted: file.encrypted };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown_error';
    await supabase.rpc('fail_export_job', { p_job_id: job.id, p_error: message });
    throw new Error(message);
  }
}

export interface ExportPurgeResult {
  marked: number;
  removed: number;
}

/**
 * 만료 파일 정리. 파일을 먼저 지우고 그다음 포인터를 지운다 —
 * 반대로 하면 지워야 할 객체를 다시 찾을 수 없다.
 */
export async function purgeExpiredExports(): Promise<ExportPurgeResult> {
  const supabase = createServiceClient();
  const expired = await supabase.rpc('expire_stale_export_jobs');
  if (expired.error) throw new Error(expired.error.message);

  const stale = await supabase.rpc('list_expired_export_files', { p_limit: 100 });
  if (stale.error) throw new Error(stale.error.message);
  const rows = (stale.data ?? []) as { job_id: string; file_path: string }[];
  if (rows.length === 0) return { marked: Number(expired.data ?? 0), removed: 0 };

  const removed = await supabase.storage.from('admin-exports').remove(rows.map((row) => row.file_path));
  if (removed.error) throw new Error(removed.error.message);

  const cleared = await supabase.rpc('mark_export_files_removed', { p_job_ids: rows.map((row) => row.job_id) });
  if (cleared.error) throw new Error(cleared.error.message);

  return { marked: Number(expired.data ?? 0), removed: rows.length };
}
