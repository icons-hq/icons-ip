import {
  LAST_BELL_RUN_COOKIE,
  digestLastBellGuestRunToken,
  lastBellGuestCookieDeleteOptions,
  normalizeLastBellRunId,
  parseLastBellRpcError,
} from '@/lib/experiences/last-bell/contract';
import {
  getLastBellGuestDigestInput,
  getLastBellWriteIdentity,
  isLastBellWriteFailure,
  isSameOriginLastBellMutation,
  lastBellError,
  lastBellJson,
} from '@/lib/experiences/last-bell/route.server';
import { isLastBellVerifiedExperienceEnabled } from '@/lib/campaigns/aouad/game-entry';
import { claimVerifiedLastBellRun, LastBellRpcFailure } from '@/lib/experiences/last-bell/service.server';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { createServiceClient, getServiceRoleConfig } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  context: { params: Promise<{ runId: string }> },
) {
  if (!isLastBellVerifiedExperienceEnabled()) return lastBellError(404, 'not_found');
  if (!isSameOriginLastBellMutation(request)) return lastBellError(403, 'forbidden');
  if (!getSupabaseConfig().isConfigured || !getServiceRoleConfig().isConfigured) {
    return lastBellError(503, 'not_configured');
  }

  const { runId: rawRunId } = await context.params;
  const runId = normalizeLastBellRunId(rawRunId);
  if (!runId) return lastBellError(404, 'run_not_found');

  try {
    const identity = await getLastBellWriteIdentity(true);
    if (isLastBellWriteFailure(identity)) return lastBellError(identity.error.status, identity.error.code);
    const { userId } = identity;
    if (!userId) return lastBellError(401, 'auth_required');
    const guestTokenDigest = digestLastBellGuestRunToken(getLastBellGuestDigestInput(request) ?? undefined);
    if (!guestTokenDigest) return lastBellError(409, 'guest_cookie_required');

    const result = await claimVerifiedLastBellRun(createServiceClient(), {
      runId,
      userId,
      guestTokenDigest,
    });
    const response = lastBellJson(result);
    response.cookies.set(LAST_BELL_RUN_COOKIE, '', lastBellGuestCookieDeleteOptions);
    return response;
  } catch (error) {
    if (error instanceof LastBellRpcFailure) {
      const mapped = parseLastBellRpcError(error.rpcMessage);
      return lastBellError(mapped.status, mapped.code);
    }
    return lastBellError(502, 'last_bell_unavailable');
  }
}
