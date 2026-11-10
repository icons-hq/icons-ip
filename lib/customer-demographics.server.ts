import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { DEMOGRAPHIC_NOTICE_VERSION, parseDemographicState, type DemographicGender, type DemographicIdentity } from './customer-demographics';

export async function customerDemographicState() {
  const client = await createClient();
  const auth = await client.auth.getUser();
  if (!auth.data.user) return null;
  if (auth.error) throw new Error('customer_demographic_unavailable');
  const { data, error } = await client.rpc('customer_demographic_state');
  if (error) throw new Error('customer_demographic_unavailable');
  if (data === null) return null;
  const state = parseDemographicState(data);
  if (!state || state.actorId !== auth.data.user.id) throw new Error('customer_demographic_invalid_state');
  return state;
}
export async function updateCustomerDemographicChoice(choice: 'accepted' | 'declined', gender: DemographicGender | null, identity: DemographicIdentity) {
  const { data, error } = await (await createClient()).rpc('set_customer_demographic_consent', {
    p_choice: choice, p_gender: gender, p_expected_revision: identity.revision,
    p_expected_actor: identity.actorId, p_expected_session: identity.sessionId, p_notice_version: DEMOGRAPHIC_NOTICE_VERSION,
  });
  if (error) return { ok: false as const, status: error.code === 'PT409' ? 409 : error.code === '42501' ? 403 : 503 };
  const state = parseDemographicState(data);
  return state && state.actorId === identity.actorId && state.sessionId === identity.sessionId && state.choice === choice && state.gender === gender
    ? { ok: true as const, status: 200, state } : { ok: false as const, status: 503 };
}
