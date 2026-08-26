import { getCurrentAuthState } from '@/lib/auth/server';
import { isLastBellVerifiedExperienceEnabled } from '@/lib/campaigns/aouad/game-entry';
import { lastBellError, lastBellJson } from '@/lib/experiences/last-bell/route.server';
import { LastBellRpcFailure, listVerifiedLastBellInventory } from '@/lib/experiences/last-bell/service.server';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { createServiceClient, getServiceRoleConfig } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!isLastBellVerifiedExperienceEnabled()) return lastBellError(404, 'not_found');
  if (!getSupabaseConfig().isConfigured || !getServiceRoleConfig().isConfigured) {
    return lastBellError(503, 'not_configured');
  }

  try {
    const auth = await getCurrentAuthState();
    if (!auth.user) return lastBellError(401, 'auth_required');
    const items = await listVerifiedLastBellInventory(createServiceClient(), auth.user.id);
    return lastBellJson({ items });
  } catch (error) {
    if (error instanceof LastBellRpcFailure) return lastBellError(502, 'last_bell_unavailable');
    return lastBellError(502, 'last_bell_unavailable');
  }
}
