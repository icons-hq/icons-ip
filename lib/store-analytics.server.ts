import 'server-only';

import { createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getProfileForUser } from '@/lib/auth/server';
import { analyticsChoice, analyticsCookieNames, STORE_ANALYTICS_NOTICE_VERSION, type AnalyticsEvent, type AnalyticsNoticeEvent } from './store-analytics';

const SESSION_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const secure = () => process.env.NODE_ENV === 'production';
const names = () => analyticsCookieNames(secure());
const cookieOptions = () => ({ path: '/', secure: secure(), sameSite: 'lax' as const });

async function eligible() {
  const client = await createClient();
  const { data, error } = await client.auth.getUser();
  if (error && error.name !== 'AuthSessionMissingError') return false;
  if (!data.user) return true;
  const profile = await getProfileForUser(client, data.user.id);
  return profile?.role === 'user' && !profile.suspended_at;
}

async function tokenHash() {
  const raw = (await cookies()).get(names().session)?.value;
  return raw && SESSION_TOKEN.test(raw) ? hash(raw) : null;
}

async function isUsable(token: string | null) {
  if (!token) return false;
  const { data, error } = await createServiceClient().rpc('store_analytics_session_status', { p_token_hash: token });
  if (error) throw new Error('analytics_unavailable');
  return data?.usable === true;
}

export async function storeAnalyticsState() {
  const store = await cookies();
  const choice = analyticsChoice(store.get(names().choice)?.value);
  const token = await tokenHash();
  if (!await eligible()) return { enabled: false, choice, usable: false, needsRevocation: choice === 'declined' && Boolean(token) };
  const { data, error } = await createServiceClient().rpc('get_store_analytics_state');
  if (error) throw new Error('analytics_unavailable');
  const enabled = data?.enabled === true && data.noticeVersion === STORE_ANALYTICS_NOTICE_VERSION;
  return { enabled, choice, usable: enabled && choice === 'accepted' && await isUsable(token), needsRevocation: choice === 'declined' && Boolean(token) };
}

export async function acceptStoreAnalytics() {
  const state = await storeAnalyticsState();
  if (!state.enabled) return { ok: false, status: 409, code: 'disabled' } as const;
  const store = await cookies();
  if (!state.usable) {
    const raw = randomBytes(32).toString('base64url');
    const { error } = await createServiceClient().rpc('start_store_analytics_session', { p_token_hash: hash(raw), p_notice_version: STORE_ANALYTICS_NOTICE_VERSION });
    if (error) return { ok: false, status: error.code === 'P0429' ? 429 : 503, code: 'unavailable' } as const;
    // No event is recorded until the browser returns this HttpOnly cookie.
    store.set(names().session, raw, { ...cookieOptions(), httpOnly: true, maxAge: 24 * 60 * 60 });
  }
  if (state.choice !== 'accepted') store.set(names().choice, `${STORE_ANALYTICS_NOTICE_VERSION}:yes`, { ...cookieOptions(), httpOnly: false, maxAge: 180 * 24 * 60 * 60 });
  return { ok: true, status: 200, code: 'accepted', created: !state.usable } as const;
}

export async function declineStoreAnalytics() {
  const store = await cookies();
  // Even a failed deletion disables later collection and checkout binding.
  store.set(names().choice, `${STORE_ANALYTICS_NOTICE_VERSION}:no`, { ...cookieOptions(), httpOnly: false, maxAge: 180 * 24 * 60 * 60 });
  const token = await tokenHash();
  if (token) {
    const { error } = await createServiceClient().rpc('revoke_store_analytics_session', { p_token_hash: token });
    if (error) return { ok: false, status: 503, code: 'withdrawal_pending' } as const;
  }
  store.set(names().session, '', { ...cookieOptions(), httpOnly: true, maxAge: 0 });
  return { ok: true, status: 200, code: 'declined' } as const;
}

export async function recordStoreAnalytics(event: AnalyticsEvent) {
  if (analyticsChoice((await cookies()).get(names().choice)?.value) !== 'accepted' || !await eligible()) {
    return { ok: false, status: 403, code: 'consent_required' } as const;
  }
  const token = await tokenHash();
  if (!token) return { ok: false, status: 409, code: 'session_expired' } as const;
  const { error } = await createServiceClient().rpc('record_store_analytics_event', {
    p_token_hash: token, p_event_id: event.eventId, p_page_kind: event.pageKind, p_target_id: event.targetId,
    p_channel: event.channel, p_source: event.source, p_medium: event.medium, p_link_token: event.linkToken,
  });
  if (error) return { ok: false, status: error.code === 'P0429' ? 429 : ['analytics_session_unavailable', 'analytics_session_expired'].includes(error.message) ? 409 : 400,
    code: ['analytics_session_unavailable', 'analytics_session_expired'].includes(error.message) ? 'session_expired' : 'not_recorded' } as const;
  return { ok: true, status: 200, code: 'recorded' } as const;
}

/* Global-shell notice impressions/clicks reuse the page-view consent, eligibility and session boundary. A notice
   event never starts a session: without a usable one it is dropped as session_expired and the page-view flow renews. */
export async function recordStoreAnalyticsNotice(event: AnalyticsNoticeEvent) {
  if (analyticsChoice((await cookies()).get(names().choice)?.value) !== 'accepted' || !await eligible()) {
    return { ok: false, status: 403, code: 'consent_required' } as const;
  }
  const token = await tokenHash();
  if (!token) return { ok: false, status: 409, code: 'session_expired' } as const;
  const { error } = await createServiceClient().rpc('record_store_analytics_notice_event', {
    p_token_hash: token, p_event_id: event.eventId, p_curation_id: event.curationId, p_interaction: event.interaction,
  });
  if (error) {
    const expired = ['analytics_session_unavailable', 'analytics_session_expired'].includes(error.message);
    return { ok: false, status: error.code === 'P0429' ? 429 : expired ? 409 : 400, code: expired ? 'session_expired' : 'not_recorded' } as const;
  }
  return { ok: true, status: 200, code: 'recorded' } as const;
}

/** Optional measurement must never prevent or retry the customer's order. */
export async function bindStoreAnalyticsOrder(orderId: string, userId: string): Promise<void> {
  try {
    if (analyticsChoice((await cookies()).get(names().choice)?.value) !== 'accepted') return;
    const token = await tokenHash();
    if (!token) return;
    await createServiceClient().rpc('bind_store_analytics_order', { p_token_hash: token, p_order_id: orderId, p_user_id: userId });
  } catch { /* Buying remains independent of optional measurement. */ }
}
