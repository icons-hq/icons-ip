import { createHash } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { isSameOriginRequest } from '@/lib/http/same-origin.server';
import { inquiryDraftSessionId } from '@/lib/admin/inquiry-drafts';
import { DIGITAL_BUCKET, DIGITAL_MIME_EXTENSIONS, parseDigitalFile } from '@/lib/goods-fulfillment';
import { transactionExactKeys, transactionRecord } from '@/lib/goods-transaction-values';
import { isUuid } from '@/lib/uuid';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const headers = { 'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Vary': 'Cookie' };
const failure = (status: number) => Response.json({ error: '파일을 받을 수 없습니다. 로그인과 주문 상태를 확인한 뒤 다시 시도해주세요.' }, { status, headers });
export async function POST(request: Request) {
 if (!isSameOriginRequest(request)) return failure(403);
 const size = Number(request.headers.get('content-length') ?? 0); if (!Number.isFinite(size) || size > 1024) return failure(400);
 try {
  const raw = await request.text(); if (raw.length > 1024) return failure(400);
  const body: unknown = JSON.parse(raw);
  if (!transactionRecord(body) || !transactionExactKeys(body, ['itemId', 'assetId', 'operationId']) || !isUuid(body.itemId) || !isUuid(body.assetId) || !isUuid(body.operationId)) return failure(400);
  const client = await createClient(); const { data: authenticated } = await client.auth.getUser(); if (!authenticated.user) return failure(401);
  const { data: current } = await client.auth.getSession(); const sessionId = current.session ? inquiryDraftSessionId(current.session.access_token) : null;
  if (!sessionId || current.session?.user.id !== authenticated.user.id) return failure(401);
  const service = createServiceClient(); const args = { p_actor: authenticated.user.id, p_session: sessionId, p_item: body.itemId, p_asset: body.assetId };
  const info = await service.rpc('service_get_digital_download_info', args);
  const value = info.data;
  if (info.error || !transactionRecord(value) || value.itemId !== body.itemId || value.assetId !== body.assetId || !isUuid(value.orderId)
   || typeof value.path !== 'string' || !/^[a-f0-9-]{36}\/[a-f0-9-]{36}\.(pdf|zip|png|jpg|mp3|mp4|txt)$/.test(value.path)
   || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)) return failure(403);
  const file = parseDigitalFile({ id: value.assetId, name: value.name, mimeType: value.mimeType, size: value.size });
  if (!file || value.path.split('/')[1] !== `${file.id}.${DIGITAL_MIME_EXTENSIONS[file.mimeType]}`) return failure(503);
  const downloaded = await service.storage.from(DIGITAL_BUCKET).download(value.path);
  if (downloaded.error || downloaded.data?.size !== file.size) return failure(503);
  const bytes = await downloaded.data.arrayBuffer();
  if (createHash('sha256').update(new Uint8Array(bytes)).digest('hex') !== value.sha256) return failure(503);
  // Recheck payment, refund, session, and purchased files after the private read.
  const recorded = await service.rpc('service_record_digital_download', { ...args, p_operation: body.operationId, p_sha256: value.sha256 });
  if (recorded.error || !transactionRecord(recorded.data) || recorded.data.operationId !== body.operationId || recorded.data.itemId !== body.itemId || recorded.data.assetId !== body.assetId) return failure(409);
  const encoded = encodeURIComponent(file.name).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return new Response(new Blob([bytes], { type: file.mimeType }).stream(), { headers: { ...headers, 'Content-Type': file.mimeType,
   'Content-Disposition': `attachment; filename="download.${DIGITAL_MIME_EXTENSIONS[file.mimeType]}"; filename*=UTF-8''${encoded}` } });
 } catch { return failure(503); }
}
