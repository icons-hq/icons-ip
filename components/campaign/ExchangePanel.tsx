'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import {
  exchangeCoinsAction,
  type ParticipationActionState,
} from '@/app/events/participation-actions';
import { WcButton } from '@/components/wc/WcButton';
import type { ExchangeOfferView } from '@/lib/campaigns.server';

/* 코인 → 카드팩 교환 패널 (R-06 §2.2 선물 교환소 자리 · S8 #330).
 *
 * 어휘 규율: 이 화면은 '가챠·뽑기·충전'을 쓰지 않는다(CONTEXT.md · DESIGN §12).
 * 발급 대상은 뽑기권이고 UI 표기는 "카드팩"이다.
 *
 * operationId 는 서버 렌더가 심은 멱등 키다. 폼을 두 번 제출해도 RPC 가 같은 키를
 * 보고 already_exchanged 로 답하므로 코인이 두 번 빠지지 않는다.
 *
 * 잔액 부족은 버튼을 잠그되 이유를 함께 적는다 — 비활성 버튼만 남기면 왜 못 누르는지
 * 화면에 없다(DESIGN §9 disabled 규칙). 실제 차감 판정은 서버가 다시 한다. */

const EMPTY_STATE: ParticipationActionState = {};

export interface ExchangePanelProps {
  balance: number;
  loginHref: string;
  /** 못 찾았거나 내려간 상품이면 null — 블록 자리는 남기고 안내만 바꾼다. */
  offer: ExchangeOfferView | null;
  operationId: string;
  next: string;
  signedIn: boolean;
}

export function ExchangePanel({
  balance,
  loginHref,
  next,
  offer,
  operationId,
  signedIn,
}: ExchangePanelProps) {
  const [state, formAction, pending] = useActionState(exchangeCoinsAction, EMPTY_STATE);

  if (!offer) {
    return (
      <div className="wc-campaign-panel">
        <p className="wc-campaign-panel__lede">지금은 교환할 수 없어요.</p>
        <p className="wc-campaign-panel__note">교환 상품이 준비되면 다시 안내해 드릴게요.</p>
      </div>
    );
  }

  const summary = (
    <>
      <p className="wc-campaign-exchange__label">{offer.label}</p>
      <p className="wc-campaign-exchange__cost">
        코인 <strong>{offer.coinCost.toLocaleString('ko-KR')}</strong>개 · 카드팩 {offer.ticketCount}개
      </p>
    </>
  );

  if (!signedIn) {
    return (
      <div className="wc-campaign-panel">
        {summary}
        <div className="wc-campaign-panel__cta">
          <WcButton href={loginHref} variant="primary">로그인하고 교환하기</WcButton>
        </div>
      </div>
    );
  }

  const short = balance < offer.coinCost;

  return (
    <form action={formAction} className="wc-campaign-panel">
      <input name="next" type="hidden" value={next} />
      <input name="offerId" type="hidden" value={offer.id} />
      <input name="operationId" type="hidden" value={operationId} />
      {summary}
      <p className="wc-campaign-panel__balance">
        보유 코인 <strong>{balance.toLocaleString('ko-KR')}</strong>개
      </p>
      <div className="wc-campaign-panel__cta">
        <WcButton disabled={pending || short} type="submit" variant="primary">
          {pending ? '교환 중' : '카드팩 교환하기'}
        </WcButton>
      </div>
      {short ? <p className="wc-campaign-panel__note">코인이 부족해요.</p> : null}
      <p
        aria-live="polite"
        className={`wc-campaign-panel__feedback${state.status === 'error' ? ' is-error' : ''}`}
        role="status"
      >
        {state.message ?? ''}
      </p>
      {state.status === 'success' ? (
        <Link className="wc-campaign-panel__link" href="/packs">카드팩 보관함 열기</Link>
      ) : null}
    </form>
  );
}
