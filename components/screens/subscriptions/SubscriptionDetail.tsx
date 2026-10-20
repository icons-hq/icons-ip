'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MypageShell } from '@/components/wc/MypageShell';
import { GoodsTransactionSummary } from '@/components/checkout/GoodsTransactionSummary';
import { SubscriptionCards } from '@/components/subscriptions/SubscriptionCards';
import { SubscriptionAddressFields, SubscriptionScheduleFields, SubscriptionRequestFeedback, subscriptionDate, nextKstDate, kstToday } from '@/components/subscriptions/SubscriptionParts';
import { useSubscriptionRequest, useSubscriptionUnsaved } from '@/components/subscriptions/useSubscriptionRequest';
import { changeGoodsSubscriptionStateAction, confirmGoodsSubscriptionAction, confirmGoodsSubscriptionChangeAction, prepareGoodsSubscriptionAction,
  prepareGoodsSubscriptionChangeAction, readGoodsSubscriptionAction } from '@/app/my/subscriptions/actions';
import { SUBSCRIPTION_PLAN_LABELS, SUBSCRIPTION_CYCLE_LABELS, SUBSCRIPTION_REASON_LABELS } from '@/lib/subscriptions/model';
import type { GoodsSubscription, SubscriptionCard, SubscriptionChangeCommand, SubscriptionProposal, SubscriptionCyclePage } from '@/lib/subscriptions/customer';
import type { SubscriptionSchedule } from '@/lib/subscriptions/schedule';
import type { CheckoutAddress } from '@/lib/checkout';
import { krw } from '@/lib/format';
import { routes } from '@/lib/routes';
const CHANGE_LABELS: Record<SubscriptionChangeCommand, string> = { resume: '다시 시작', change_schedule: '주기·다음 결제일 변경', change_destination: '배송지·배송 방법 변경', replace_card: '결제카드 변경', accept_terms: '변경된 금액·조건 확인' };
export function SubscriptionDetail({ actorId, initialPlan, cards, canRegister, names = {}, history, older }: { actorId: string; initialPlan: GoodsSubscription;
  cards: readonly SubscriptionCard[]; canRegister: boolean; names?: Record<string, string>; history: SubscriptionCyclePage; older: boolean }) {
  const [plan, setPlan] = useState(initialPlan), [consent, setConsent] = useState(false), [cardId, setCardId] = useState(initialPlan.card?.id ?? cards.find(card => card.state === 'active')?.id ?? '');
  const [command, setCommand] = useState<SubscriptionChangeCommand>(initialPlan.state === 'active' ? 'change_schedule' : initialPlan.state === 'needs_confirmation' ? 'accept_terms' : 'resume');
  const [schedule, setSchedule] = useState<SubscriptionSchedule>({ ...initialPlan.schedule, anchorDate: nextKstDate() });
  const [address, setAddress] = useState<CheckoutAddress>(initialPlan.address!), [deliveryChoices, setDeliveryChoices] = useState(initialPlan.deliveryChoices ?? {});
  const [proposal, setProposal] = useState<SubscriptionProposal | null>(null), [changeConsent, setChangeConsent] = useState(false), [draftDirty, setDraftDirty] = useState(false);
  const [message, setMessage] = useState(''), [expired, setExpired] = useState(() => Date.parse(initialPlan.draftExpiresAt) <= Date.now());
  const lost = useCallback(() => { setAddress({ recipientName: '', phone: '', postalCode: '', address1: '' }); setProposal(null); setConsent(false); setChangeConsent(false); }, []);
  const request = useSubscriptionRequest(actorId, lost), router = useRouter();
  const pendingCycle = plan.cycles?.some(cycle => ['dispatching', 'unknown', 'needs_review'].includes(cycle.state)) ?? false;
  const canChange = ['active', 'paused', 'needs_confirmation'].includes(plan.state) && !pendingCycle;
  useSubscriptionUnsaved(!request.blocked && (draftDirty || proposal !== null || request.pending || Boolean(request.failure?.uncertain)));
  useEffect(() => { const timer = setTimeout(() => setExpired(true), Math.max(0, Date.parse(plan.draftExpiresAt) - Date.now())); return () => clearTimeout(timer); }, [plan.draftExpiresAt]);
  function accept(value: GoodsSubscription) { setPlan(value); setConsent(false); setChangeConsent(false); setProposal(null); setDraftDirty(false); setMessage('현재 저장된 상태를 확인했습니다.'); router.replace(routes.subscription(value.id)); router.refresh(); }
  return <MypageShell active={routes.subscriptions()}><div className="wc-subscriptions"><header><Link href={routes.subscriptions()}>정기구매 내역</Link><h1>정기배송 상세</h1>
    <p>{SUBSCRIPTION_PLAN_LABELS[plan.state]}</p></header><SubscriptionRequestFeedback {...request} />
    {!request.blocked && <>
      {message && <p role="status">{message}</p>}
      <section className="wc-subscriptions__card"><h2>신청 내용</h2><ul>{plan.selection.map((line, index) => <li key={`${line.variantId}-${index}`}>{names[line.goodId] ?? '정기배송 굿즈'} · {line.qty}개
        {Object.values(line.inputValues).length > 0 && <span> · 직접 입력: {Object.values(line.inputValues).join(' / ')}</span>}</li>)}</ul>
        <dl><div><dt>배송 주기</dt><dd>{plan.schedule.interval}{plan.schedule.unit === 'week' ? '주' : '개월'}{plan.schedule.monthEnd ? ' · 말일 기준' : ''}</dd></div>
          <div><dt>다음 결제일 · 한국시간</dt><dd>{subscriptionDate(plan.nextRunAt)}</dd></div><div><dt>결제카드</dt><dd>{plan.card?.number ?? '선택 전'}</dd></div></dl>
        <p>{plan.address?.recipientName} · {plan.address?.phone}<br />[{plan.address?.postalCode}] {plan.address?.address1} {plan.address?.address2}</p>
        {plan.pauseReason && <p role="status">{SUBSCRIPTION_REASON_LABELS[plan.pauseReason]}</p>}
        <div className="wc-subscriptions__amounts"><section><h3>첫 회차</h3><GoodsTransactionSummary display={plan.firstDisplay} names={names} /></section>
          <section><h3>이후 회차 기준</h3><GoodsTransactionSummary display={plan.renewalDisplay} names={names} /><p>쿠폰·적립금은 이후 회차에 자동 적용되지 않아요.</p></section></div>
        <p>금액, 주기 또는 배송 조건이 바뀌면 다시 확인받은 뒤 결제합니다. 예정일이 24시간 넘게 지나면 정지하며, 밀린 회차를 한꺼번에 결제하지 않아요.</p>
        <button type="button" disabled={request.pending || Boolean(request.failure?.uncertain)} onClick={() => request.recover(() => readGoodsSubscriptionAction(actorId, plan.id), accept)}>최신 상태 확인</button>
      </section>
      {plan.state === 'draft' && <section className="wc-subscriptions__card"><h2>신청 확정</h2>
        {expired ? <><p>금액 확인 시간이 지났습니다. 현재 가격과 혜택을 다시 확인해주세요.</p><button type="button" disabled={request.locked} onClick={() => {
          const input = { expectedActorId: actorId, operationId: crypto.randomUUID(), selection: plan.selection, address: plan.address!, schedule: { ...plan.schedule, anchorDate: kstToday() },
            deliveryChoices: plan.deliveryChoices ?? {}, userCouponId: plan.firstDisplay.userCouponId, storeCreditAmount: plan.firstDisplay.totals.storeCreditTotal };
          request.run(() => prepareGoodsSubscriptionAction(input), value => { setDraftDirty(false); router.replace(routes.subscription(value.id)); });
        }}>금액 다시 확인</button></> : <><label>첫 결제와 정기결제에 사용할 카드<select disabled={request.locked} value={cardId} onChange={event => setCardId(event.target.value)}>
          <option value="">카드 선택</option>{cards.filter(card => card.state === 'active').map(card => <option key={card.id} value={card.id}>{card.number}</option>)}</select></label>
          <label className="wc-subscriptions__check"><input type="checkbox" checked={consent} disabled={request.locked} onChange={event => setConsent(event.target.checked)} />
            <span>첫 회차 온라인 결제금액 {krw(plan.firstDisplay.totals.onlineTotal)}, 이후 회차 기준 {krw(plan.renewalDisplay.totals.onlineTotal)}와 별도 착불 배송비, 주기·배송지·중지 기준을 확인하고 자동결제에 동의합니다.</span></label>
          <p>첫 결제가 완료돼야 정기배송이 시작됩니다. 카드 등록만으로는 신청이 확정되지 않습니다.</p>
          <button type="button" disabled={request.locked || !consent || !cardId} onClick={() => {
            if (!plan.firstQuoteId) return;
            const input = { expectedActorId: actorId, operationId: crypto.randomUUID(), planId: plan.id, cycleId: plan.firstCycleId,
              expectedRevision: plan.revision, quoteId: plan.firstQuoteId, termsId: plan.termsId, credentialId: cardId, consent: true };
            request.run(() => confirmGoodsSubscriptionAction(input), accept);
          }}>동의하고 첫 회차 결제</button></>}
      </section>}
      {canChange && <section className="wc-subscriptions__card"><h2>일정·배송지·카드 변경</h2>
        <form onSubmit={event => {
          event.preventDefault(); const input = { expectedActorId: actorId, operationId: crypto.randomUUID(), planId: plan.id, expectedRevision: plan.revision, command,
            payload: command === 'change_destination' ? { schedule, address, deliveryChoices } : { schedule } };
          request.run(() => prepareGoodsSubscriptionChangeAction(input), value => { setProposal(value); setChangeConsent(false); });
        }}><fieldset disabled={request.locked || proposal !== null}><label>변경할 내용<select value={command} onChange={event => { setCommand(event.target.value as SubscriptionChangeCommand); setDraftDirty(true); }}>
          {Object.entries(CHANGE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <SubscriptionScheduleFields value={schedule} future onChange={value => { setSchedule(value); setDraftDirty(true); }} />
          {command === 'change_destination' && <><SubscriptionAddressFields value={address} prefix="subscription-change" onChange={value => { setAddress(value); setDraftDirty(true); }} />
            {Array.from(new Set(plan.selection.map(line => line.goodId))).map(goodId => <label key={goodId}>{names[goodId] ?? '굿즈'} 배송비 결제<select value={deliveryChoices[goodId] ?? 'prepaid'}
              onChange={event => { setDeliveryChoices(previous => ({ ...previous, [goodId]: event.target.value as 'prepaid' | 'collect' })); setDraftDirty(true); }}><option value="prepaid">선불</option><option value="collect">착불</option></select></label>)}</>}
          <button type="submit">변경 후 금액·일정 확인</button>
        </fieldset></form>
        {proposal && <section className="wc-subscriptions__card"><h3>변경 후 확인</h3><dl><div><dt>이전 온라인 금액 → 변경 후</dt><dd>{krw(plan.renewalDisplay.totals.onlineTotal)} → {krw(proposal.display.totals.onlineTotal)}</dd></div>
          <div><dt>이전 착불 배송비 → 변경 후</dt><dd>{krw(plan.renewalDisplay.totals.collectShippingTotal)} → {krw(proposal.display.totals.collectShippingTotal)}</dd></div>
          <div><dt>다음 일정</dt><dd>{proposal.schedule.anchorDate} {proposal.schedule.time} · {proposal.schedule.monthEnd ? '말일 기준' : '선택일 기준'}</dd></div></dl>
          <GoodsTransactionSummary display={proposal.display} names={names} /><p>{proposal.address.address1} {proposal.address.address2}</p>
          <label>정기결제 카드<select disabled={request.locked} value={cardId} onChange={event => setCardId(event.target.value)}><option value="">카드 선택</option>
            {cards.filter(card => card.state === 'active').map(card => <option key={card.id} value={card.id}>{card.number}</option>)}</select></label>
          <label className="wc-subscriptions__check"><input type="checkbox" checked={changeConsent} disabled={request.locked} onChange={event => setChangeConsent(event.target.checked)} />변경된 금액·착불 배송비·일정·배송지와 카드 자동결제에 동의합니다.</label>
          <div className="wc-subscriptions__row"><button type="button" disabled={request.locked || !changeConsent || !cardId} onClick={() => {
            const input = { expectedActorId: actorId, operationId: crypto.randomUUID(), planId: plan.id, expectedRevision: proposal.expectedRevision,
              proposalId: proposal.id, termsId: proposal.termsId, quoteId: proposal.quoteId, credentialId: cardId, consent: true };
            request.run(() => confirmGoodsSubscriptionChangeAction(input), accept);
          }}>동의하고 변경 저장</button><button type="button" disabled={request.locked} onClick={() => { setProposal(null); setChangeConsent(false); }}>입력 수정</button></div>
        </section>}
      </section>}
      {plan.state !== 'draft' && plan.state !== 'canceled' && <section className="wc-subscriptions__card"><h2>일시정지·해지</h2>
        <p>결제가 시작되기 전 회차부터 중지합니다. 이미 결제가 시작된 회차는 결과를 계속 확인하며, 해당 주문의 취소는 주문 내역에서 별도로 요청할 수 있어요.</p>
        {pendingCycle && <p role="status">현재 회차 결제 결과를 확인 중입니다. 해지해도 이 회차의 환불이 자동 완료되지는 않습니다.</p>}
        <div className="wc-subscriptions__row">{(['pause', 'cancel'] as const).filter(value => value === 'cancel' || plan.state !== 'paused').map(value => <button type="button" key={value} disabled={request.locked}
          onClick={() => {
            if (!window.confirm(value === 'cancel' ? '정기구매를 해지할까요? 이미 생성된 주문은 주문 내역에서 따로 확인해주세요.' : '정기구매를 일시정지할까요?')) return;
            const input = { expectedActorId: actorId, operationId: crypto.randomUUID(), planId: plan.id, expectedRevision: plan.revision, command: value };
            request.run(() => changeGoodsSubscriptionStateAction(input), accept);
          }}>{value === 'cancel' ? '정기구매 해지' : '일시정지'}</button>)}</div>
      </section>}
      <section className="wc-subscriptions__card"><h2>회차 내역</h2><div className="wc-subscriptions__table"><table><thead><tr><th>회차</th><th>예정일</th><th>상태</th><th>온라인 금액</th><th>주문</th></tr></thead><tbody>
        {history.rows.map(cycle => <tr key={cycle.id}><td>{cycle.number}</td><td>{subscriptionDate(cycle.scheduledAt)}</td><td>{SUBSCRIPTION_CYCLE_LABELS[cycle.state]}{cycle.orderStatus === 'canceled' ? ' · 주문 취소' : ''}</td>
          <td>{cycle.amount === null ? '—' : krw(cycle.amount)}</td><td>{cycle.orderId ? <Link href={`/orders/${cycle.orderId}`}>주문 상세</Link> : '—'}</td></tr>)}
      </tbody></table></div><nav aria-label="회차 페이지" className="wc-subscriptions__row"><span>전체 {history.total}회차</span>
        {older && <Link href={routes.subscription(plan.id)}>최근 회차 보기</Link>}{history.hasMore && <Link href={`${routes.subscription(plan.id)}?before=${history.nextBeforeNumber}`}>이전 회차 더 보기</Link>}</nav></section>
      <SubscriptionCards actorId={actorId} cards={cards} canRegister={canRegister} />
    </>}
  </div></MypageShell>;
}
