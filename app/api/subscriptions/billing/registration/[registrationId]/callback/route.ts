import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { existingBillingRegistrationService, subscriptionActor, subscriptionSiteOrigin } from '@/lib/subscriptions/runtime.server';
import { billingNonceCookie, billingNonceCookieOptions, subscriptionRequestOriginMatches, SUBSCRIPTION_RESPONSE_HEADERS } from '@/lib/subscriptions/http.server';
import { billingOpaque } from '@/lib/subscriptions/billing-types.server';
import { isUuid } from '@/lib/uuid';
export const maxDuration = 90;
export async function GET(request: Request, route: { params: Promise<{ registrationId: string }> }) {
  const { registrationId: id } = await route.params;
  const origin = subscriptionSiteOrigin();
  // Provider adds authKey to this URL. Never render the callback or retain its query in a redirect.
  if (!origin) return new Response(null, { status: 503, headers: SUBSCRIPTION_RESPONSE_HEADERS });
  const destination = new URL('/my/subscriptions', origin); let terminal = false;
  if (isUuid(id)) destination.searchParams.set('registration', id);
  try {
    const params = new URL(request.url).searchParams, actor = await subscriptionActor();
    const authKey = params.get('authKey'), customerKey = params.get('customerKey');
    if (!isUuid(id) || !subscriptionRequestOriginMatches(request) || params.getAll('authKey').length !== 1 || params.getAll('customerKey').length !== 1
      || !billingOpaque(authKey, 300) || !isUuid(customerKey) || !actor) throw new Error('registration_callback_invalid');
    const service = await existingBillingRegistrationService(actor, id), nonce = (await cookies()).get(billingNonceCookie(id))?.value;
    if (!service || !nonce) throw new Error('registration_callback_invalid');
    const result = await service.complete(actor, id, nonce, authKey, customerKey);
    destination.searchParams.set('registrationState', result.state); terminal = ['ready', 'declined', 'expired'].includes(result.state);
  } catch { destination.searchParams.set('registrationState', 'check'); }
  const response = NextResponse.redirect(destination, { status: 303, headers: SUBSCRIPTION_RESPONSE_HEADERS });
  if (terminal && isUuid(id)) response.cookies.set(billingNonceCookie(id), '', { ...billingNonceCookieOptions(id), maxAge: 0 });
  return response;
}
