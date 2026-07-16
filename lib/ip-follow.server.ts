import 'server-only';

import { isOnboarded } from '@/lib/auth/onboarding';
import { getProfileForUser } from '@/lib/auth/server';
import type { IpFollowState, IpNotificationPreference } from '@/lib/ip-follow';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';

interface IpFollowRow {
  ip_id: string;
  notify_drops: boolean;
  notify_events: boolean;
}

const guestFollowState: IpFollowState = {
  isFollowed: false,
  notifyDrops: false,
  notifyEvents: false,
};

export async function getIpFollowState(ipId: string): Promise<IpFollowState> {
  if (!getSupabaseConfig().isConfigured) return guestFollowState;

  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData.user;

  if (userError || !user) return guestFollowState;

  const profile = await getProfileForUser(supabase, user.id);
  const onboarded = isOnboarded(profile, user.email);
  if (!onboarded) return guestFollowState;

  const { data, error } = await supabase
    .from('ip_follows')
    .select('ip_id,notify_drops,notify_events')
    .eq('user_id', user.id)
    .eq('ip_id', ipId)
    .maybeSingle<IpFollowRow>();

  if (error) {
    throw new Error(`Failed to load IP follow state: ${error.message}`);
  }

  return {
    isFollowed: Boolean(data),
    notifyDrops: data?.notify_drops === true,
    notifyEvents: data?.notify_events === true,
  };
}

export async function getIpNotificationPreferencesForUser(
  userId: string,
): Promise<IpNotificationPreference[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('ip_follows')
    .select('ip_id,notify_drops,notify_events')
    .eq('user_id', userId);

  if (error) {
    throw new Error('Failed to load IP notification preferences');
  }

  return ((data ?? []) as IpFollowRow[]).map((row) => ({
    ipId: row.ip_id,
    notifyDrops: row.notify_drops,
    notifyEvents: row.notify_events,
  }));
}

export async function getFollowedIpIdsForUser(userId: string): Promise<Set<string>> {
  if (!getSupabaseConfig().isConfigured) return new Set();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('ip_follows')
    .select('ip_id')
    .eq('user_id', userId);

  if (error) {
    throw new Error(`Failed to load followed IPs: ${error.message}`);
  }

  return new Set(((data ?? []) as IpFollowRow[]).map((row) => row.ip_id));
}
