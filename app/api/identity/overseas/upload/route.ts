import { getCurrentAuthState } from '@/lib/auth/server';
import { OVERSEAS_METHOD } from '@/lib/identity/overseas-adult';
import { evidenceHeaders, readPhoto, sameOrigin, storeEvidence } from '@/lib/identity/overseas-evidence.server';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';

export const runtime = 'nodejs';
export const maxDuration = 30;
const respond = (status: number) => new Response(null, { status, headers: evidenceHeaders });

export async function POST(request: Request) {
  const submission = request.headers.get('x-submission-id');
  if (!sameOrigin(request) || request.headers.get('x-photo-consent') !== OVERSEAS_METHOD) return respond(403);
  const numbers = request.headers.get('x-document-number-consent');
  if (!isUuid(submission) || (numbers !== 'allow' && numbers !== 'not-present')) return respond(400);
  const { user } = await getCurrentAuthState();
  if (!user) return respond(401);
  const client = await createClient();
  const current = await client.rpc('my_overseas_adult_request');
  if (current.error) return respond(503);
  if (!current.data?.open || current.data.domesticVerified || current.data.request?.validUntil) return respond(409);
  let evidence: Buffer;
  try {
    evidence = await readPhoto(request);
  } catch {
    return respond(422);
  }
  try {
    const reserved = await client.rpc('reserve_overseas_adult_photo', {
      p_submission_key: submission, p_consent: OVERSEAS_METHOD, p_number_consent: numbers === 'allow',
    });
    if (reserved.error?.message === 'overseas_request_limit') return respond(429);
    if (reserved.error) return respond(reserved.error.code === '42501' ? 403 : 503);
    if (reserved.data?.status === 'received') return respond(200);
    if (reserved.data?.status !== 'reserved' || !isUuid(reserved.data.id)) return respond(409);
    return respond(await storeEvidence(reserved.data.id, user.id, evidence) ? 201 : 503);
  } catch {
    return respond(503);
  } finally {
    evidence.fill(0);
  }
}
