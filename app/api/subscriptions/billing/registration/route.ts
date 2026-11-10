import { subscriptionActor, newBillingRegistrationService } from '@/lib/subscriptions/runtime.server';
import { billingNonceCookie, billingNonceCookieOptions, subscriptionJson, subscriptionJsonBody, subscriptionSameOrigin } from '@/lib/subscriptions/http.server';
import { billingRecord } from '@/lib/subscriptions/billing-types.server';
import { isUuid } from '@/lib/uuid';
export const maxDuration = 90;
export async function POST(request: Request) {
  if (!subscriptionSameOrigin(request)) return subscriptionJson({ error: '허용되지 않은 요청입니다.' }, 403);
  const input = await subscriptionJsonBody(request);
  if (!billingRecord(input) || Object.keys(input).sort().join(',') !== 'expectedActorId,operationId'
    || !isUuid(input.expectedActorId) || !isUuid(input.operationId)) return subscriptionJson({ error: '카드 등록 요청을 확인해주세요.' }, 400);
  try {
    const actor = await subscriptionActor(); if (!actor) return subscriptionJson({ error: '로그인한 뒤 다시 확인해주세요.' }, 401);
    if (actor.actorId !== input.expectedActorId) return subscriptionJson({ error: '로그인 계정이 바뀌었습니다. 화면을 다시 열어주세요.' }, 409);
    const service = await newBillingRegistrationService(actor.actorId); if (!service) return subscriptionJson({ error: '현재 카드 등록을 이용할 수 없습니다.' }, 503);
    const prepared = await service.prepare(actor, input.operationId);
    const response = subscriptionJson({ registration: prepared.registration });
    response.cookies.set(billingNonceCookie(input.operationId), prepared.nonce, billingNonceCookieOptions(input.operationId));
    return response;
  } catch { return subscriptionJson({ error: '등록 요청을 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.', uncertain: true }, 502); }
}
