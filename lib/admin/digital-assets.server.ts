import 'server-only';
import { createServiceClient } from '@/lib/supabase/service';
import { DIGITAL_BUCKET, DIGITAL_FILE_MAX_BYTES, DIGITAL_MIME_EXTENSIONS, parseDigitalFile, type DigitalFile } from '@/lib/goods-fulfillment';
import { isUuid } from '@/lib/uuid';
import { transactionRecord } from '@/lib/goods-transaction-values';
import { inspectDigitalFile } from './digital-file-inspection.server';
export type DigitalAssetResult = { ok: true; file: DigitalFile } | { ok: false; error: string; uncertain?: boolean };
const unknown = (): DigitalAssetResult => ({ ok: false, error: '파일 확인 결과를 알 수 없습니다. 같은 업로드 결과를 다시 확인해주세요.', uncertain: true });
function privateAsset(v: unknown, actor: string, id: string) {
 if (!transactionRecord(v) || v.id !== id || !['pending', 'verified'].includes(String(v.state)) || typeof v.mimeType !== 'string'
  || !Object.hasOwn(DIGITAL_MIME_EXTENSIONS, v.mimeType) || v.path !== `${actor}/${id}.${DIGITAL_MIME_EXTENSIONS[v.mimeType]}`) return null;
 const file = parseDigitalFile({ id, name: v.name, mimeType: v.mimeType, size: v.size });
 return file ? { file, path: v.path as string, state: v.state, sha256: v.sha256 } : null;
}
export async function prepareDigitalAsset(actor: string, session: string, id: string, name: string, mimeType: string, size: number) {
 const { data, error } = await createServiceClient().rpc('service_prepare_digital_asset', { p_actor: actor, p_session: session, p_id: id, p_name: name, p_mime: mimeType, p_size: size });
 const asset = error ? null : privateAsset(data, actor, id); return asset?.state === 'pending' ? { id, path: asset.path } : null;
}
export async function verifyDigitalAsset(actor: string, session: string, id: string): Promise<DigitalAssetResult> {
 const service = createServiceClient();
 try {
  const read = await service.rpc('service_read_digital_asset', { p_actor: actor, p_session: session, p_id: id });
  const asset = read.error ? null : privateAsset(read.data, actor, id);
  if (!asset) return { ok: false, error: '파일 업로드의 계정·세션·유효 기간을 확인해주세요.' };
  if (asset.state === 'verified') return typeof asset.sha256 === 'string' && /^[a-f0-9]{64}$/.test(asset.sha256) ? { ok: true, file: asset.file } : unknown();
  const bucket = service.storage.from(DIGITAL_BUCKET), info = await bucket.info(asset.path);
  if (info.error || info.data?.size !== asset.file.size || info.data.contentType !== asset.file.mimeType || asset.file.size > DIGITAL_FILE_MAX_BYTES) return { ok: false, error: '업로드 파일의 크기·형식이 일치하지 않습니다.' };
  const downloaded = await bucket.download(asset.path);
  if (downloaded.error || downloaded.data?.size !== asset.file.size) return unknown();
  const sha256 = inspectDigitalFile(new Uint8Array(await downloaded.data.arrayBuffer()), asset.file.mimeType);
  if (!sha256) return { ok: false, error: '파일 내용이 선택한 형식과 일치하지 않습니다. 지원하는 원본 파일을 선택해주세요.' };
  const saved = await service.rpc('service_verify_digital_asset', { p_actor: actor, p_session: session, p_id: id, p_sha256: sha256 });
  const file = saved.error ? null : parseDigitalFile(saved.data);
  return file?.id === id ? { ok: true, file } : unknown();
 } catch { return unknown(); }
}
export async function retireDigitalAsset(actor: string, id: string) {
 if (!isUuid(actor) || !isUuid(id)) return;
 await createServiceClient().rpc('service_retire_digital_asset', { p_actor: actor, p_id: id });
}
export async function cleanupDigitalAssets(limit = 10): Promise<{ candidates: number; completed: number } | null> {
 const service = createServiceClient();
 try {
  const { data, error } = await service.rpc('service_claim_digital_cleanup', { p_limit: Math.max(1, Math.min(50, Math.trunc(limit))) });
  if (error || !Array.isArray(data)) return null;
  let completed = 0;
  for (const row of data) {
   if (!transactionRecord(row) || !isUuid(row.id) || typeof row.path !== 'string' || !/^[a-f0-9-]{36}\/[a-f0-9-]{36}\.(pdf|zip|png|jpg|mp3|mp4|txt)$/.test(row.path) || row.path.split('/')[1].split('.')[0] !== row.id) return null;
   const removed = await service.storage.from(DIGITAL_BUCKET).remove([row.path]);
   if (!removed.error) { const result = await service.rpc('service_complete_digital_cleanup', { p_id: row.id }); if (!result.error) completed++; }
  }
  return { candidates: data.length, completed };
 } catch { return null; }
}
