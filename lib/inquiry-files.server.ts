import 'server-only';
import { createHash } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { inquiryDraftSessionId } from '@/lib/admin/inquiry-drafts';
import { transactionRecord } from '@/lib/goods-transaction-values';
import { isUuid } from '@/lib/uuid';
import { INQUIRY_FILES_BUCKET, INQUIRY_FILE_MIME_EXTENSIONS, parseInquiryFile, type InquiryFile } from './inquiry-files';
import { inspectInquiryFile } from './inquiry-file-inspection.server';

export async function inquiryFileSession() {
  const client = await createClient();
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) return null;
  const { data: current } = await client.auth.getSession();
  const sessionId = current.session ? inquiryDraftSessionId(current.session.access_token) : null;
  return sessionId && current.session?.user.id === auth.user.id ? { actor: auth.user.id, sessionId, client } : null;
}
function privateFile(value: unknown, actor: string, id: string) {
  const file = parseInquiryFile(value);
  if (!file || file.id !== id || !transactionRecord(value) || value.path !== `${actor}/${id}.${INQUIRY_FILE_MIME_EXTENSIONS[file.mimeType]}`
    || !['pending', 'verified'].includes(String(value.state))) return null;
  return { file, path: value.path as string, state: value.state, sha256: value.sha256 };
}
export type InquiryFileResult = { ok: true; file: InquiryFile } | { ok: false; error: string; uncertain?: boolean };
const unknown = (): InquiryFileResult => ({ ok: false, uncertain: true, error: '파일 확인 결과를 알 수 없습니다. 같은 파일의 확인을 다시 시도해주세요.' });
export async function prepareInquiryFile(actor: string, sessionId: string, file: InquiryFile, library: boolean) {
  const { data, error } = await createServiceClient().rpc('service_prepare_inquiry_file', { p_actor: actor, p_session: sessionId, p_id: file.id,
    p_name: file.name, p_mime: file.mimeType, p_size: file.size, p_library: library });
  const parsed = error ? null : privateFile(data, actor, file.id);
  return parsed ? { id: file.id, path: parsed.path, verified: parsed.state === 'verified' } : null;
}
export async function verifyInquiryFile(actor: string, sessionId: string, id: string): Promise<InquiryFileResult> {
  try {
    const service = createServiceClient();
    const read = await service.rpc('service_read_inquiry_file', { p_actor: actor, p_session: sessionId, p_id: id });
    const asset = read.error ? null : privateFile(read.data, actor, id);
    if (!asset) return { ok: false, error: '현재 권한과 파일 업로드의 유효 기간을 확인해주세요.' };
    if (asset.state === 'verified') return typeof asset.sha256 === 'string' && /^[a-f0-9]{64}$/.test(asset.sha256) ? { ok: true, file: asset.file } : unknown();
    const bucket = service.storage.from(INQUIRY_FILES_BUCKET), info = await bucket.info(asset.path);
    if (info.error || info.data?.size !== asset.file.size || info.data.contentType !== asset.file.mimeType) return { ok: false, error: '파일 업로드가 완료되지 않았거나 크기·형식이 다릅니다. 다시 시도해주세요.' };
    const downloaded = await bucket.download(asset.path);
    if (downloaded.error || downloaded.data?.size !== asset.file.size) return unknown();
    const sha256 = await inspectInquiryFile(new Uint8Array(await downloaded.data.arrayBuffer()), asset.file.mimeType);
    if (!sha256) return { ok: false, error: '파일 내용이 지원하는 원본 형식과 일치하지 않습니다. 파일을 다시 선택해주세요.' };
    const saved = await service.rpc('service_verify_inquiry_file', { p_actor: actor, p_session: sessionId, p_id: id, p_sha256: sha256 });
    const file = !saved.error ? parseInquiryFile(saved.data) : null;
    return file?.id === id ? { ok: true, file } : unknown();
  } catch { return unknown(); }
}
export async function cleanupInquiryFiles() {
  try {
    const service = createServiceClient();
    const { data, error } = await service.rpc('service_claim_inquiry_file_cleanup', { p_limit: 5 });
    if (error || !Array.isArray(data)) return;
    for (const row of data) {
      if (!transactionRecord(row) || !isUuid(row.id) || typeof row.path !== 'string' || !/^[a-f0-9-]{36}\/[a-f0-9-]{36}\.(jpg|png|webp|gif|mp4|pdf|txt|xls|xlsx|ppt|doc|docx|hwp)$/.test(row.path)
        || row.path.split('/')[1].split('.')[0] !== row.id) return;
      const removed = await service.storage.from(INQUIRY_FILES_BUCKET).remove([row.path]);
      if (!removed.error) await service.rpc('service_complete_inquiry_file_cleanup', { p_id: row.id });
    }
  } catch { /* Next upload or library removal retries bounded orphan cleanup. */ }
}
export async function loadInquiryMessageFiles(client: Awaited<ReturnType<typeof createClient>>, inquiryId: string) {
  const { data, error } = await client.rpc('inquiry_message_files', { p_inquiry_id: inquiryId });
  if (error || !transactionRecord(data)) throw new Error('inquiry_files_unavailable');
  const result = new Map<string, InquiryFile[]>();
  for (const [messageId, value] of Object.entries(data)) {
    if (!isUuid(messageId) || !Array.isArray(value)) throw new Error('invalid_inquiry_files');
    const files = value.map(parseInquiryFile);
    if (files.some(file => !file)) throw new Error('invalid_inquiry_files');
    result.set(messageId, files as InquiryFile[]);
  }
  return result;
}
export async function downloadInquiryFile(actor: string, sessionId: string, fileId: string, messageId: string | null) {
  const service = createServiceClient();
  const args = { p_actor: actor, p_session: sessionId, p_file: fileId, p_message: messageId };
  const first = await service.rpc('service_inquiry_file_download', args);
  const file = first.error ? null : parseInquiryFile(first.data);
  const value = first.data;
  if (!file || file.id !== fileId || !transactionRecord(value) || typeof value.path !== 'string' || !/^[a-f0-9-]{36}\/[a-f0-9-]{36}\.(jpg|png|webp|gif|mp4|pdf|txt|xls|xlsx|ppt|doc|docx|hwp)$/.test(value.path)
    || value.path.split('/')[1] !== `${file.id}.${INQUIRY_FILE_MIME_EXTENSIONS[file.mimeType]}` || typeof value.sha256 !== 'string') return null;
  const result = await service.storage.from(INQUIRY_FILES_BUCKET).download(value.path);
  if (result.error || result.data?.size !== file.size) throw new Error('inquiry_file_missing');
  const bytes = await result.data.arrayBuffer();
  if (createHash('sha256').update(new Uint8Array(bytes)).digest('hex') !== value.sha256) throw new Error('inquiry_file_changed');
  const final = await service.rpc('service_inquiry_file_download', args);
  if (final.error || !transactionRecord(final.data) || final.data.sha256 !== value.sha256) return null;
  return { file, bytes };
}
