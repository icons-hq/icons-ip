import {
  createLastBellGuestRunToken,
  digestLastBellGuestRunToken,
  lastBellGuestCookieOptions,
  parseLastBellRpcError,
  parseLastBellRunStartInput,
} from '@/lib/experiences/last-bell/contract';
import {
  getLastBellGuestDigestInput,
  getLastBellWriteIdentity,
  isLastBellWriteFailure,
  isSameOriginLastBellMutation,
  lastBellError,
  lastBellJson,
  readLastBellJson,
} from '@/lib/experiences/last-bell/route.server';
import { isLastBellVerifiedExperienceEnabled } from '@/lib/campaigns/aouad/game-entry';
import { LastBellRpcFailure, startVerifiedLastBellRun } from '@/lib/experiences/last-bell/service.server';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { createServiceClient, getServiceRoleConfig } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!isLastBellVerifiedExperienceEnabled()) return lastBellError(404, 'not_found');
  if (!isSameOriginLastBellMutation(request)) return lastBellError(403, 'forbidden');
  if (!getSupabaseConfig().isConfigured || !getServiceRoleConfig().isConfigured) {
    return lastBellError(503, 'not_configured');
  }

  const payload = await readLastBellJson(request);
  const start = parseLastBellRunStartInput(payload);
  if (!start) return lastBellError(400, 'invalid_request');

  try {
    const identity = await getLastBellWriteIdentity();
    if (isLastBellWriteFailure(identity)) return lastBellError(identity.error.status, identity.error.code);
    const { userId } = identity;
    const existingGuestToken = userId ? null : getLastBellGuestDigestInput(request);
    const guestToken = userId ? null : existingGuestToken ?? createLastBellGuestRunToken();
    const guestTokenDigest = userId ? null : digestLastBellGuestRunToken(guestToken ?? undefined);
    if (!userId && !guestTokenDigest) return lastBellError(400, 'invalid_guest_cookie');

    const result = await startVerifiedLastBellRun(createServiceClient(), {
      userId,
      guestTokenDigest,
      start,
    });
    const response = lastBellJson(result);
    if (!userId && !existingGuestToken && guestToken) {
      response.cookies.set('__Host-icons-last-bell-run', guestToken, lastBellGuestCookieOptions);
    }
    return response;
  } catch (error) {
    if (error instanceof LastBellRpcFailure) {
      const mapped = parseLastBellRpcError(error.rpcMessage);
      return lastBellError(mapped.status, mapped.code);
    }
    return lastBellError(502, 'last_bell_unavailable');
  }
}
