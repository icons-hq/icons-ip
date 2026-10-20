'use client';
import Link from 'next/link';
import { MypageShell } from '@/components/wc/MypageShell';
import { SubscriptionCards } from '@/components/subscriptions/SubscriptionCards';
import { subscriptionDate, SubscriptionRequestFeedback } from '@/components/subscriptions/SubscriptionParts';
import { useSubscriptionRequest } from '@/components/subscriptions/useSubscriptionRequest';
import type { GoodsSubscription, SubscriptionCard } from '@/lib/subscriptions/customer';
import { SUBSCRIPTION_PLAN_LABELS, SUBSCRIPTION_REASON_LABELS } from '@/lib/subscriptions/model';
import { krw } from '@/lib/format';
import { routes } from '@/lib/routes';
export function SubscriptionList({ actorId, plans, cards, canEnroll, registrationId, unavailable, total, nextCursor, older }: { actorId: string; plans: readonly GoodsSubscription[];
  cards: readonly SubscriptionCard[]; canEnroll: boolean; registrationId?: string; unavailable?: boolean; total: number; nextCursor: { updatedAt: string; id: string } | null; older: boolean }) {
  const request = useSubscriptionRequest(actorId);
  return <MypageShell active={routes.subscriptions()}><div className="wc-subscriptions"><header><h1>정기구매</h1><p>예정된 결제와 배송 주기, 결제카드를 확인하고 관리하세요.</p>
    {canEnroll && !request.blocked && <Link className="wc-btn wc-btn-primary" href={routes.subscriptionNew()}>정기배송 신청</Link>}</header>
    <SubscriptionRequestFeedback {...request} />
    {!request.blocked && <>{unavailable ? <section className="wc-subscriptions__card" role="alert"><h2>신청 내역을 불러오지 못했습니다</h2><p>새로고침해 현재 내역을 다시 확인해주세요.</p></section>
      : plans.length === 0 ? <section className="wc-subscriptions__card"><h2>신청한 정기구매가 없습니다</h2><p>정기배송을 제공하는 굿즈에서 신청할 수 있어요.</p></section>
        : <ul className="wc-subscriptions__list">{plans.map(plan => <li key={plan.id}><article className="wc-subscriptions__card"><div className="wc-subscriptions__row"><h2>{SUBSCRIPTION_PLAN_LABELS[plan.state]}</h2><small>{plan.schedule.interval}{plan.schedule.unit === 'week' ? '주' : '개월'} 주기</small></div>
          <dl><div><dt>다음 결제일</dt><dd>{subscriptionDate(plan.nextRunAt)}</dd></div><div><dt>이후 회차 온라인 결제금액</dt><dd>{krw(plan.renewalDisplay.totals.onlineTotal)}</dd></div>
            {plan.renewalDisplay.totals.collectShippingTotal > 0 && <div><dt>수령 시 별도 착불 배송비</dt><dd>{krw(plan.renewalDisplay.totals.collectShippingTotal)}</dd></div>}</dl>
          {plan.pauseReason && <p>{SUBSCRIPTION_REASON_LABELS[plan.pauseReason]}</p>}
          <Link href={routes.subscription(plan.id)}>{plan.state === 'draft' ? '신청 내용 확인하고 계속하기' : '일정과 회차 보기'}</Link></article></li>)}</ul>}
      {!unavailable && <nav aria-label="정기구매 페이지" className="wc-subscriptions__row"><span>전체 {total}건</span>{older && <Link href={routes.subscriptions()}>최신 신청 보기</Link>}
        {nextCursor && <Link href={`${routes.subscriptions()}?${new URLSearchParams({ beforeAt: nextCursor.updatedAt, beforeId: nextCursor.id })}`}>이전 신청 더 보기</Link>}</nav>}
      {!unavailable && <SubscriptionCards actorId={actorId} cards={cards} canRegister={canEnroll} registrationId={registrationId} />}
    </>}
  </div></MypageShell>;
}
