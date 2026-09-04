import { createHash, timingSafeEqual } from 'node:crypto';
import { createServiceClient } from '@/lib/supabase/service';
import { CSV_BOM, exportFileName, renderCsv, type ExportColumn } from '@/lib/admin/exports';

/*
 * D-4 내보내기 워커 (설계서 v2 §1-7).
 *
 * 큐에서 잡 하나를 집어 파일을 만들고 보관함에 올린다. 한 번에 하나만 처리하고 바로 끝낸다 —
 * 서버리스 함수의 실행 시간 안에 확실히 끝나는 단위이고, 남은 잡은 다음 호출이 가져간다.
 * 워커가 죽으면 `requeue-stale-exports` 크론이 10분 뒤 큐로 되돌린다.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

const PAGE_SIZE = 1000;
const ROW_LIMIT = 100000;

const NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Content-Type': 'application/json',
};

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get('authorization');
  if (!secret || !authorization?.startsWith('Bearer ')) return false;
  const expected = Buffer.from(secret);
  const actual = Buffer.from(authorization.slice('Bearer '.length));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function response(body: Record<string, unknown>, status: number) {
  return Response.json(body, { headers: NO_STORE_HEADERS, status });
}

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

export async function POST(request: Request) {
  if (!authorized(request)) return response({ ok: false }, 401);

  const supabase = createServiceClient();
  const claimed = await supabase.rpc('claim_export_job', { p_worker: `worker-${process.pid}` });
  if (claimed.error) return response({ ok: false, error: claimed.error.message }, 503);
  const job = claimed.data as ExportJobRow | null;
  if (!job) return response({ ok: true, claimed: 0 }, 200);

  try {
    const template = await supabase
      .from('export_templates')
      .select('key,columns,file_format')
      .eq('id', job.template_id)
      .maybeSingle<TemplateRow>();
    if (template.error || !template.data) throw new Error(template.error?.message ?? 'template_not_found');
    if (template.data.file_format !== 'csv') {
      /* xlsx(암호 포함)는 다음 슬라이스다. 조용히 csv 로 바꿔 내보내지 않고 실패로 남긴다. */
      throw new Error('unsupported_file_format');
    }

    const rows: Record<string, unknown>[] = [];
    let after: unknown = null;
    for (;;) {
      const page = await supabase.rpc('export_rows_for_job', {
        p_job_id: job.id,
        p_after: after,
        p_limit: PAGE_SIZE,
      });
      if (page.error) throw new Error(page.error.message);
      const batch = (page.data ?? []) as { row_key: unknown; row_data: Record<string, unknown> }[];
      if (batch.length === 0) break;
      for (const entry of batch) rows.push(entry.row_data);
      if (rows.length >= ROW_LIMIT) throw new Error('rows_over_limit');
      after = batch[batch.length - 1].row_key;
      if (batch.length < PAGE_SIZE) break;
    }

    const body = CSV_BOM + renderCsv(template.data.columns ?? [], rows);
    const bytes = Buffer.from(body, 'utf8');
    const path = `${job.requested_by}/${job.id}/${exportFileName(template.data.key, job.created_at, 'csv')}`;
    const uploaded = await supabase.storage
      .from('admin-exports')
      /* 버킷 허용 목록은 파라미터 없는 MIME 만 받는다. 인코딩은 파일 앞의 BOM 이 알린다. */
      .upload(path, bytes, { contentType: 'text/csv', upsert: true });
    if (uploaded.error) throw new Error(uploaded.error.message);

    const finished = await supabase.rpc('finish_export_job', {
      p_job_id: job.id,
      p_file_path: path,
      p_row_count: rows.length,
      p_file_bytes: bytes.byteLength,
      p_file_sha256: createHash('sha256').update(bytes).digest('hex'),
    });
    if (finished.error) throw new Error(finished.error.message);

    return response({ ok: true, claimed: 1, job: job.id, rows: rows.length, bytes: bytes.byteLength }, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown_error';
    await supabase.rpc('fail_export_job', { p_job_id: job.id, p_error: message });
    return response({ ok: false, job: job.id, error: message }, 503);
  }
}
