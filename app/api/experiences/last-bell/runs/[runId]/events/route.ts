import {
  digestLastBellGuestRunToken,
  normalizeLastBellRunId,
  parseLastBellRpcError,
  parseLastBellRuntimeEventInput,
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
import { LastBellRpcFailure, recordVerifiedLastBellEvent } from '@/lib/experiences/last-bell/service.server';
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

  const payload = await readLastBellJson(request);
  const event = parseLastBellRuntimeEventInput(payload);
  if (!event) return lastBellError(400, 'invalid_request');

  try {
    const identity = await getLastBellWriteIdentity();
    if (isLastBellWriteFailure(identity)) return lastBellError(identity.error.status, identity.error.code);
    const { userId } = identity;
    const guestTokenDigest = userId
      ? null
      : digestLastBellGuestRunToken(getLastBellGuestDigestInput(request) ?? undefined);
    if (!userId && !guestTokenDigest) return lastBellError(401, 'guest_cookie_required');

    const result = await recordVerifiedLastBellEvent(createServiceClient(), {
      runId,
      userId,
      guestTokenDigest,
      event,
    });
    return lastBellJson(result);
  } catch (error) {
    if (error instanceof LastBellRpcFailure) {
      const mapped = parseLastBellRpcError(error.rpcMessage);
      return lastBellError(mapped.status, mapped.code);
    }
    return lastBellError(502, 'last_bell_unavailable');
  }
}
