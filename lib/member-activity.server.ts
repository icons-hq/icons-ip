import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { MEMBER_ACTIVITY_NOTICE_VERSION, parseMemberActivityState, type MemberActivityEvent, type MemberActivityIdentity } from './member-activity';

export async function memberActivityState() {
  const client = await createClient(); const auth = await client.auth.getUser();
  if (!auth.data.user) return null;
  if (auth.error) throw new Error('member_activity_unavailable');
  const { data, error } = await client.rpc('member_activity_state');
  if (error) throw new Error('member_activity_unavailable');
  if (data === null) return null;
  const result = parseMemberActivityState(data);
  if (!result || result.actorId !== auth.data.user.id) throw new Error('member_activity_invalid_state');
  return result;
}
export async function updateMemberActivityChoice(choice: 'accepted' | 'declined', identity: MemberActivityIdentity) {
  const client = await createClient();
  const { data, error } = await client.rpc('set_member_activity_consent', { p_choice: choice, p_expected_revision: identity.revision,
    p_expected_actor: identity.actorId, p_expected_session: identity.sessionId, p_notice_version: MEMBER_ACTIVITY_NOTICE_VERSION });
  if (error) return { ok: false as const, status: error.code === 'PT409' ? 409 : error.code === '42501' ? 403 : 503 };
  const state = parseMemberActivityState(data);
  return state && state.actorId === identity.actorId && state.sessionId === identity.sessionId && state.choice === choice
    ? { ok: true as const, status: 200, state } : { ok: false as const, status: 503 };
}
export async function recordMemberActivity(event: MemberActivityEvent, identity: MemberActivityIdentity) {
  const client = await createClient();
  const { data, error } = await client.rpc('record_member_activity_event', { p_event_id: event.eventId, p_kind: event.kind, p_page_kind: event.pageKind,
    p_target_id: event.targetId, p_asset_id: event.assetId, p_expected_revision: identity.revision, p_expected_actor: identity.actorId, p_expected_session: identity.sessionId });
  return !error && data?.recorded === true ? { ok: true, status: 200 } : { ok: false, status: error?.code === 'P0429' ? 429 : error?.code === '42501' ? 403 : 400 };
}
