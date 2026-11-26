import { getCurrentAuthState } from '@/lib/auth/server';
import { OVERSEAS_METHOD } from '@/lib/identity/overseas-adult';
import { evidenceHeaders, readPhoto, sameOrigin, storeEvidence } from '@/lib/identity/overseas-evidence.server';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';

export const runtime = 'nodejs';
export const maxDuration = 30;
const respond = (status: number) => new Response(null, { status, headers: evidenceHeaders });

export async function POST(request: Request, context: RouteContext<'/api/identity/overseas/[id]/upload'>) {
  const { id } = await context.params;
  if (!sameOrigin(request) || !isUuid(id) || request.headers.get('x-photo-consent') !== OVERSEAS_METHOD)
    return respond(403);
  const auth = await getCurrentAuthState();
  if (!auth.user) return respond(401);
  const client = await createClient();
  const reserve = await client.rpc('reserve_overseas_adult_upload', { p_id: id, p_consent: OVERSEAS_METHOD });
  if (reserve.error || reserve.data !== true) return respond(409);
  let photo: Buffer;
  try {
    photo = await readPhoto(request);
  } catch {
    await client.rpc('cancel_overseas_adult_request', { p_id: id });
    return respond(422);
  }
  try {
    if (await storeEvidence(id, auth.user.id, photo)) return respond(201);
    return respond(503);
  } catch {
    return respond(503);
  } finally {
    photo.fill(0);
  }
}
