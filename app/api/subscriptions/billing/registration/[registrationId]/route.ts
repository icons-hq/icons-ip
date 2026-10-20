import { cookies } from 'next/headers';
import { existingBillingRegistrationService, subscriptionActor } from '@/lib/subscriptions/runtime.server';
import { billingNonceCookie, billingNonceCookieOptions, subscriptionJson, subscriptionJsonBody, subscriptionSameOrigin } from '@/lib/subscriptions/http.server';
import { billingRecord } from '@/lib/subscriptions/billing-types.server';
import { isUuid } from '@/lib/uuid';
export const maxDuration = 90;
type Route = { params: Promise<{ registrationId: string }> };
export async function GET(_request: Request, route: Route) {
  const { registrationId: id } = await route.params; if (!isUuid(id)) return subscriptionJson({ error: '등록 요청을 찾을 수 없습니다.' }, 404);
  try {
    const actor = await subscriptionActor(); if (!actor) return subscriptionJson({ error: '로그인한 뒤 다시 확인해주세요.' }, 401);
    const service = await existingBillingRegistrationService(actor, id); if (!service) return subscriptionJson({ error: '등록 요청을 확인할 수 없습니다.' }, 404);
    return subscriptionJson({ registration: await service.read(actor, id) });
  } catch { return subscriptionJson({ error: '등록 상태를 확인하지 못했습니다.' }, 502); }
}
export async function POST(request: Request, route: Route) {
  if (!subscriptionSameOrigin(request)) return subscriptionJson({ error: '허용되지 않은 요청입니다.' }, 403);
  const { registrationId: id } = await route.params, input = await subscriptionJsonBody(request);
  if (!isUuid(id) || !billingRecord(input) || Object.keys(input).join(',') !== 'expectedActorId' || !isUuid(input.expectedActorId)) return subscriptionJson({ error: '등록 요청을 확인해주세요.' }, 400);
  try {
    const actor = await subscriptionActor(); if (!actor) return subscriptionJson({ error: '로그인한 뒤 다시 확인해주세요.' }, 401);
    if (actor.actorId !== input.expectedActorId) return subscriptionJson({ error: '로그인 계정이 바뀌었습니다.' }, 409);
    const service = await existingBillingRegistrationService(actor, id), nonce = (await cookies()).get(billingNonceCookie(id))?.value;
    if (!service || !nonce) return subscriptionJson({ error: '카드를 등록한 브라우저와 로그인 세션에서 다시 확인해주세요.' }, 409);
    const registration = await service.retry(actor, id, nonce), response = subscriptionJson({ registration });
    if (['ready', 'declined', 'expired'].includes(registration.state)) response.cookies.set(billingNonceCookie(id), '', { ...billingNonceCookieOptions(id), maxAge: 0 });
    return response;
  } catch { return subscriptionJson({ error: '등록 결과가 아직 불명확합니다. 같은 요청으로 다시 확인해주세요.', uncertain: true }, 502); }
}
