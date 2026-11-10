'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { isUuid } from '@/lib/uuid';
import type { SubscriptionCard, SubscriptionResult } from '@/lib/subscriptions/customer';
import { revokeSubscriptionCardAction } from '@/app/my/subscriptions/actions';
import { useSubscriptionRequest } from './useSubscriptionRequest';
import { SubscriptionRequestFeedback } from './SubscriptionParts';
type Registration = { id: string; state: string; fake?: boolean; customerKey?: string; clientKey?: string | null; successUrl?: string; failUrl?: string };
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
async function registrationPost(url: string, body: object): Promise<SubscriptionResult<Registration>> {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', cache: 'no-store', body: JSON.stringify(body) });
  const data: unknown = await response.json();
  if (!response.ok || !record(data) || !record(data.registration)) return { ok: false, uncertain: record(data) && data.uncertain === true,
    error: record(data) && typeof data.error === 'string' ? data.error : '카드 등록 요청을 확인하지 못했습니다.' };
  const result = data.registration;
  if (!isUuid(result.id) || !['prepared', 'processing', 'ready', 'declined', 'unknown', 'needs_review', 'expired'].includes(result.state as string)) throw new Error('invalid_registration');
  return { ok: true, value: result as unknown as Registration };
}
export function SubscriptionCards({ actorId, cards, canRegister, registrationId }: { actorId: string; cards: readonly SubscriptionCard[]; canRegister: boolean; registrationId?: string }) {
  const request = useSubscriptionRequest(actorId), router = useRouter();
  const [opening, setOpening] = useState(false), [message, setMessage] = useState(''), [registration, setRegistration] = useState<Registration | null>(null);
  useEffect(() => {
    if (!registrationId || !isUuid(registrationId)) return;
    const controller = new AbortController();
    void fetch(`/api/subscriptions/billing/registration/${registrationId}`, { cache: 'no-store', signal: controller.signal })
      .then(response => response.ok ? response.json() : null).then(value => {
        if (!controller.signal.aborted && value?.registration?.id === registrationId) setRegistration(value.registration as Registration);
      }).catch(() => undefined);
    return () => controller.abort();
  }, [registrationId, actorId]);
  async function openRegistration(value: Registration) {
    if (!request.isCurrent()) return;
    setRegistration(value);
    if (value.state === 'ready') { router.refresh(); return; }
    if (value.state !== 'prepared' || !isUuid(value.customerKey) || !value.successUrl || !value.failUrl) { setMessage('등록 상태를 아래에서 다시 확인해주세요.'); return; }
    const success = new URL(value.successUrl), failure = new URL(value.failUrl);
    if (success.origin !== location.origin || failure.origin !== location.origin
      || success.pathname !== `/api/subscriptions/billing/registration/${value.id}/callback` || failure.pathname !== success.pathname) throw new Error('invalid_callback');
    setOpening(true);
    if (value.fake) {
      if (!['localhost', '127.0.0.1'].includes(location.hostname) || location.protocol !== 'http:') throw new Error('invalid_fake_registration');
      success.searchParams.set('authKey', `fake_auth_${value.id.replaceAll('-', '')}`); success.searchParams.set('customerKey', value.customerKey);
      if (request.isCurrent()) location.assign(success.href); return;
    }
    if (!value.clientKey || !/^(test|live)_ck_[A-Za-z0-9]+$/.test(value.clientKey)) throw new Error('invalid_billing_client_key');
    const { loadTossPayments } = await import('@tosspayments/tosspayments-sdk');
    const toss = await loadTossPayments(value.clientKey); if (!request.isCurrent()) return;
    await toss.payment({ customerKey: value.customerKey }).requestBillingAuth({ method: 'CARD', windowTarget: 'self', successUrl: success.href, failUrl: failure.href });
  }
  return <section className="wc-subscriptions__card"><h2>결제카드</h2><p>카드 등록만으로 결제되지 않아요. 신청 내용을 확인하고 동의한 뒤 첫 결제가 진행됩니다.</p>
    {!request.blocked && <>
      {cards.length === 0 ? <p>등록한 결제카드가 없습니다.</p> : <ul className="wc-subscriptions__cards">{cards.map(card => <li key={card.id}>
        <div><strong>{card.number}</strong><p>{card.state === 'active' ? `연결된 정기구매 ${card.activePlanCount ?? 0}건` : card.state === 'revoking' ? '카드 삭제 확인 중' : '카드 상태 확인 필요'}</p></div>
        <button type="button" disabled={request.locked || (card.activePlanCount ?? 0) > 0 || card.state === 'revoking'} onClick={() => {
          if (!window.confirm('이 카드를 정기결제에서 삭제할까요? 이미 결제한 주문의 환불은 주문 내역에서 별도로 요청할 수 있어요.')) return;
          const input = { expectedActorId: actorId, operationId: crypto.randomUUID(), credentialId: card.id, expectedRevision: card.revision };
          request.run(() => revokeSubscriptionCardAction(input), value => { setMessage(value.state === 'revoked' ? '카드 삭제를 확인했습니다.' : '카드 삭제 결과를 확인하고 있습니다.'); router.refresh(); });
        }}>{card.state === 'needs_review' ? '삭제 다시 요청' : '카드 삭제'}</button>
      </li>)}</ul>}
      {canRegister && <button type="button" disabled={request.locked || opening} onClick={() => {
        const input = { expectedActorId: actorId, operationId: crypto.randomUUID() };
        request.run(() => registrationPost('/api/subscriptions/billing/registration', input), value => {
          void openRegistration(value).catch(() => { if (request.isCurrent()) { setOpening(false); setMessage('카드 등록창을 열지 못했습니다. 현재 등록 상태를 확인한 뒤 다시 시도해주세요.'); } });
        });
      }}>새 카드 등록</button>}
      {registration && <div role="status"><p>{registration.state === 'ready' ? '카드 등록을 확인했습니다.' : registration.state === 'declined' || registration.state === 'expired'
        ? '카드 등록이 완료되지 않았습니다. 새 등록을 진행해주세요.' : '카드 등록 결과를 확인하고 있습니다.'}</p>
        {['processing', 'unknown', 'needs_review'].includes(registration.state) && <button type="button" disabled={request.locked} onClick={() => {
          request.run(() => registrationPost(`/api/subscriptions/billing/registration/${registration.id}`, { expectedActorId: actorId }), value => { setRegistration(value); router.refresh(); });
        }}>등록 결과 다시 확인</button>}
      </div>}
      {message && <p role="status">{message}</p>}
    </>}
    <SubscriptionRequestFeedback {...request} />
  </section>;
}
