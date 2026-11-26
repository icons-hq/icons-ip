import 'server-only';
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { createServiceClient } from '@/lib/supabase/service';
import { documentIdentity, OVERSEAS_UPLOAD_LIMIT, type DocumentIdentity } from './overseas-adult';

const BUCKET = 'overseas-adult-evidence';
export const evidenceHeaders = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  Vary: 'Cookie',
  'X-Robots-Tag': 'noindex, noarchive',
};
export function sameOrigin(request: Request) {
  return request.headers.get('origin') === new URL(request.url).origin;
}
export const reviewDigest = (token: string) => createHash('sha256').update(token).digest('hex');

export async function readPhoto(request: Request) {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > OVERSEAS_UPLOAD_LIMIT || !request.body) throw new Error('invalid_photo');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > OVERSEAS_UPLOAD_LIMIT) { await reader.cancel(); throw new Error('invalid_photo'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const decoder = sharp(Buffer.concat(chunks), { limitInputPixels: 16_000_000, failOn: 'warning' });
  const meta = await decoder.metadata();
  if (
    !['jpeg', 'png', 'webp'].includes(meta.format ?? '') ||
    (meta.pages ?? 1) !== 1 ||
    Math.min(meta.width ?? 0, meta.height ?? 0) < 320
  )
    throw new Error('invalid_photo');
  // 재인코딩할 때 원본 이름·메타데이터·추가 프레임을 넘기지 않는다.
  const photo = await decoder
    .rotate()
    .resize({ width: 2200, height: 2200, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#fff' })
    .jpeg({ quality: 85 })
    .toBuffer();
  if (photo.length + 60 > OVERSEAS_UPLOAD_LIMIT) {
    photo.fill(0);
    throw new Error('document_too_large');
  }
  return photo;
}

// 구버전 신청은 제출 당시의 암호화 형식으로 한 번만 열람한다.
export function unpackDocumentEvidence(data: Buffer): { identity: DocumentIdentity; photo: Buffer } {
  const length = data.readUInt32BE(0);
  if (!length || length > 1024 || 4 + length >= data.length) throw new Error('invalid_document');
  const fields = JSON.parse(data.toString('utf8', 4, 4 + length));
  const identity = documentIdentity(fields?.name, fields?.gender);
  if (!identity) throw new Error('invalid_document');
  return { identity, photo: data.subarray(4 + length) };
}
export function encryptPhoto(id: string, photo: Buffer) {
  const share = randomBytes(32);
  const salt = randomBytes(32);
  const iv = randomBytes(12);
  const key = Buffer.from(hkdfSync('sha256', share, salt, id, 32));
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(id));
  const ciphertext = Buffer.concat([cipher.update(photo), cipher.final()]);
  return { share: share.toString('hex'), object: Buffer.concat([salt, iv, cipher.getAuthTag(), ciphertext]) };
}
export function decryptPhoto(id: string, share: string, object: Buffer) {
  if (!/^[a-f0-9]{64}$/.test(share) || object.length <= 60) throw new Error('invalid_photo');
  const key = Buffer.from(hkdfSync('sha256', Buffer.from(share, 'hex'), object.subarray(0, 32), id, 32));
  const cipher = createDecipheriv('aes-256-gcm', key, object.subarray(32, 44));
  cipher.setAAD(Buffer.from(id));
  cipher.setAuthTag(object.subarray(44, 60));
  return Buffer.concat([cipher.update(object.subarray(60)), cipher.final()]);
}
export async function storeEvidence(id: string, user: string, photo: Buffer) {
  const service = createServiceClient();
  const { object, share } = encryptPhoto(id, photo);
  const bucket = service.storage.from(BUCKET);
  const upload = await bucket.upload(id, object, {
    upsert: false,
    cacheControl: '0',
    contentType: 'application/octet-stream',
  });
  if (upload.error) return false;
  const submitted = await service.rpc('service_submit_overseas_adult_upload', {
    p_id: id,
    p_user: user,
    p_share: share,
  });
  // 응답 유실은 커밋됐을 수 있다. 정리는 항상 DB의 파기 상태를 거쳐 만료 작업이 회수한다.
  return !submitted.error && submitted.data === true;
}
export async function downloadEvidence(id: string, share: string) {
  const result = await createServiceClient().storage.from(BUCKET).download(id);
  if (result.error || !result.data) throw new Error('evidence_unavailable');
  return decryptPhoto(id, share, Buffer.from(await result.data.arrayBuffer()));
}
export async function purgeOverseasEvidence(id?: string) {
  const service = createServiceClient();
  const batch = await service.rpc('service_overseas_adult_cleanup', { p_id: id ?? null });
  if (batch.error || !Array.isArray(batch.data)) throw new Error('cleanup_queue_unavailable');
  const bucket = service.storage.from(BUCKET);
  const results = await Promise.allSettled(
    (batch.data as string[]).map(async (requestId) => {
      const removed = await bucket.remove([requestId]);
      if (removed.error) return false;
      const finish = await service.rpc('service_finish_overseas_adult_cleanup', { p_id: requestId });
      return !finish.error && finish.data === true;
    }),
  );
  return {
    processed: results.length,
    failed: results.filter((result) => result.status !== 'fulfilled' || !result.value).length,
  };
}
