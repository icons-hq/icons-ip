import { randomBytes } from 'node:crypto';
import { OVERSEAS_METHOD } from '@/lib/identity/overseas-adult';
import { adultAgeDecision } from '@/lib/age/adult-age';
import {
  downloadEvidence,
  evidenceHeaders,
  purgeOverseasEvidence,
  reviewDigest,
  sameOrigin,
  unpackDocumentEvidence,
} from '@/lib/identity/overseas-evidence.server';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';

export const runtime = 'nodejs';
export const maxDuration = 30;
const respond = (status: number) => new Response(null, { status, headers: evidenceHeaders });

export async function POST(request: Request, context: RouteContext<'/api/admin/overseas-adult/[id]'>) {
  const { id } = await context.params;
  if (!sameOrigin(request) || !isUuid(id)) return respond(403);
  const body = await request.json().catch(() => null);
  const client = await createClient();
  if (body?.action === 'open') {
    if (body.format !== 'document') return respond(409);
    const token = randomBytes(32).toString('base64url');
    const args = { p_id: id, p_digest: reviewDigest(token) };
    const claim = await client.rpc('open_overseas_adult_review', args);
    if (claim.error || !claim.data?.share) return respond(403);
    let bytes: Buffer | undefined;
    try {
      bytes = await downloadEvidence(id, claim.data.share);
      const form = new FormData();
      if (claim.data.method === OVERSEAS_METHOD) {
        const { photo, identity } = unpackDocumentEvidence(bytes);
        form.set('name', identity.name);
        form.set('gender', identity.gender);
        form.set('photo', new Blob([new Uint8Array(photo)], { type: 'image/jpeg' }), 'document.jpg');
      } else if (claim.data.challenge) {
        form.set('legacyCode', claim.data.challenge);
        form.set('photo', new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }), 'photo.jpg');
      } else {
        return respond(410);
      }
      const delivered = await client.rpc('deliver_overseas_adult_review', args);
      if (delivered.error || delivered.data !== true) return respond(410);
      return new Response(form, { headers: {
        ...evidenceHeaders, 'X-Review-Token': token, 'X-Review-Until': claim.data.until,
      } });
    } catch {
      return respond(503);
    } finally {
      bytes?.fill(0);
    }
  }
  if (body?.action === 'check' && typeof body.token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(body.token)) {
    const live = await client.rpc('overseas_adult_review_live', {
      p_id: id,
      p_digest: reviewDigest(body.token),
    });
    return respond(!live.error && live.data === true ? 204 : 410);
  }
  if (
    body?.action !== 'decide' ||
    !['approve', 'reject'].includes(body.decision) ||
    typeof body.token !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(body.token)
  )
    return respond(400);
  const matches = body.decision === 'approve';
  const birth = matches ? body.birth : null;
  if (
    matches &&
    (body.matched !== true ||
      typeof birth !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(birth) ||
      !adultAgeDecision(birth.replaceAll('-', '')))
  )
    return respond(422);
  const decided = await client.rpc('decide_overseas_adult_review', {
    p_id: id,
    p_digest: reviewDigest(body.token),
    p_birth: birth,
    p_matches: matches,
  });
  if (decided.error || decided.data !== true) return respond(409);
  // 결정은 이미 접수됐다. Storage 장애 시 매분 재시도하고 고객에게는 처리 중으로 보인다.
  await purgeOverseasEvidence(id).catch(() => null);
  return respond(202);
}
