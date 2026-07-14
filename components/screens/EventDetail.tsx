'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { reserveTicketsAction } from '@/app/events/actions';
import type { FandomEvent, Ip } from '@/lib/data';
import { ipAccent } from '@/lib/ip-display';
import type { PublicTicketType } from '@/lib/ticketing.server';

const krw = (value: number) => `${value.toLocaleString('ko-KR')}원`;

const reservationErrors: Record<string, string> = {
  auth_required: '로그인이 만료됐어요. 다시 로그인해주세요.',
  onboarding_required: '프로필 설정을 완료한 뒤 예매해주세요.',
  payment_unavailable: '결제 환경을 확인 중이라 지금은 예매할 수 없어요.',
  invalid_request: '회차와 수량을 다시 확인해주세요.',
  not_bookable: '현재 예매 가능한 회차가 아니에요.',
  sales_not_open: '아직 예매가 시작되지 않았어요.',
  sold_out: '잔여 수량이 변경됐어요. 회차를 다시 확인해주세요.',
  per_user_limit: '이 회차의 1인 예매 가능 수량을 초과했어요.',
  conflict: '예매 요청 정보가 변경됐어요. 다시 시도해주세요.',
  unavailable: '예매 결과를 확인하지 못했어요. 같은 요청으로 다시 확인해주세요.',
};

type AuthState = 'signed-out' | 'onboarding' | 'ready';
type ReservationAttempt = { qty: number; reservationKey: string; ticketTypeId: string };

function disabledReason(event: FandomEvent, session: PublicTicketType, paymentAvailable: boolean) {
  if (event.status !== '예매중') return '현재 예매 가능한 이벤트가 아니에요.';
  if (session.remaining <= 0) return '정원 마감';
  if (session.price <= 0) return '0원 회차는 현재 예매할 수 없어요.';
  if (!paymentAvailable) return '결제 환경을 확인 중이라 지금은 예매할 수 없어요.';
  return null;
}

export function EventDetail({
  authHref,
  authState,
  event,
  ip,
  paymentAvailable,
  sessions,
}: {
  authHref: string;
  authState: AuthState;
  event: FandomEvent;
  ip: Ip | null;
  paymentAvailable: boolean;
  sessions: PublicTicketType[];
}) {
  const router = useRouter();
  const firstBookable = sessions.find((session) => !disabledReason(event, session, paymentAvailable));
  const [selectedId, setSelectedId] = useState(firstBookable?.id ?? '');
  const [qty, setQty] = useState(1);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryLocked, setRetryLocked] = useState(false);
  const attemptRef = useRef<ReservationAttempt | null>(null);
  const selected = useMemo(
    () => sessions.find((session) => session.id === selectedId) ?? null,
    [selectedId, sessions],
  );
  const selectedReason = selected ? disabledReason(event, selected, paymentAvailable) : null;
  const total = (selected?.price ?? 0) * qty;
  const inputsLocked = pending || retryLocked;

  const changeSelection = (id: string) => {
    if (inputsLocked || attemptRef.current) return;
    setSelectedId(id);
    setQty(1);
    setError(null);
    attemptRef.current = null;
  };

  const changeQty = (next: number) => {
    if (!selected || inputsLocked || attemptRef.current) return;
    setQty(Math.min(selected.remaining, Math.max(1, next)));
    setError(null);
    attemptRef.current = null;
  };

  const submit = async (submitEvent: FormEvent<HTMLFormElement>) => {
    submitEvent.preventDefault();
    if (pending || authState !== 'ready' || !selected || selectedReason) return;

    setPending(true);
    setError(null);
    const attempt = attemptRef.current ?? {
      qty,
      reservationKey: crypto.randomUUID(),
      ticketTypeId: selected.id,
    };
    attemptRef.current = attempt;
    setRetryLocked(true);
    try {
      const result = await reserveTicketsAction(attempt);
      if (result.ok) {
        router.push(`/ticket-checkout/${result.orderId}`);
        return;
      }
      setError(reservationErrors[result.error] ?? reservationErrors.unavailable!);
      if (result.error !== 'unavailable') {
        attemptRef.current = null;
        setRetryLocked(false);
      }
    } catch {
      setError(reservationErrors.unavailable!);
    }
    setPending(false);
  };

  const accent = ip ? ipAccent(ip) : event.accent;

  return (
    <main className="event-detail-page">
      <header className="event-detail-hero">
        <div className="wrap event-detail-hero-grid">
          <div className="event-detail-copy">
            <Link className="event-detail-back mono" href="/events">← 팝업 · 이벤트</Link>
            <div className="event-detail-badges">
              {ip && <span style={{ color: accent }}>{ip.title}</span>}
              <span style={{ background: event.accent, color: '#0A0813' }}>{event.mode}</span>
              <span>{event.status}</span>
            </div>
            <h1 className="h-xl">{event.title}</h1>
            <div className="event-detail-meta mono">
              <span>◷ {event.date || '일정 공개 예정'}</span>
              <span>◎ {event.loc || '장소 공개 예정'}</span>
            </div>
            <p>원하는 회차와 수량을 고른 뒤 결제를 진행하세요. 결제 확인이 끝나면 전자티켓이 발급됩니다.</p>
          </div>
          <div className="event-detail-art" style={{ background: event.img, backgroundPosition: 'center', backgroundSize: 'cover' }}>
            <div aria-hidden className="sheen" />
          </div>
        </div>
      </header>

      <form className="wrap event-booking-layout" aria-busy={pending} onSubmit={submit}>
        <section className="event-session-panel card" aria-labelledby="event-session-title">
          <div className="checkout-section-heading">
            <span className="checkout-step mono">01</span>
            <div>
              <h2 id="event-session-title">회차 선택</h2>
              <p>할당 수량에는 결제 대기 중인 예매도 포함됩니다.</p>
            </div>
          </div>

          {sessions.length ? (
            <fieldset className="event-session-list" disabled={inputsLocked}>
              <legend className="sr-only">티켓 회차</legend>
              {sessions.map((session) => {
                const reason = disabledReason(event, session, paymentAvailable);
                const checked = selectedId === session.id;
                return (
                  <label className={`event-session-card${checked ? ' is-selected' : ''}${reason || inputsLocked ? ' is-disabled' : ''}`} key={session.id}>
                    <input
                      checked={checked}
                      disabled={Boolean(reason)}
                      name="ticketTypeId"
                      onChange={() => changeSelection(session.id)}
                      type="radio"
                      value={session.id}
                    />
                    <span className="event-session-main">
                      <strong>{session.name}</strong>
                      <small>{reason ?? `잔여 ${session.remaining}`}</small>
                    </span>
                    <span className="event-session-price">
                      <strong>{krw(session.price)}</strong>
                      <small className="mono">할당 {session.sold}/{session.capacity}</small>
                    </span>
                  </label>
                );
              })}
            </fieldset>
          ) : (
            <div className="checkout-state-panel" role="status">
              <h2>등록된 회차가 아직 없어요</h2>
              <p>운영 회차가 열리면 이 화면에서 잔여 수량과 함께 안내합니다.</p>
            </div>
          )}
        </section>

        <aside className="event-booking-summary card" aria-label="예매 요약">
          <div className="checkout-section-heading checkout-section-heading--compact">
            <span className="checkout-step mono">02</span>
            <h2>예매 확인</h2>
          </div>
          {selected ? (
            <>
              <div className="event-booking-selection">
                <span>{event.title}</span>
                <strong>{selected.name}</strong>
                <small>잔여 {selected.remaining} · 결제 대기 포함</small>
              </div>
              <div className="event-qty-field">
                <label htmlFor="event-ticket-qty">수량</label>
                <div className="event-qty-control">
                  <button aria-label="수량 줄이기" disabled={qty <= 1 || inputsLocked} onClick={() => changeQty(qty - 1)} type="button">−</button>
                  <input
                    disabled={inputsLocked}
                    id="event-ticket-qty"
                    inputMode="numeric"
                    max={selected.remaining}
                    min={1}
                    name="qty"
                    onChange={(qtyEvent) => changeQty(Number(qtyEvent.target.value))}
                    type="number"
                    value={qty}
                  />
                  <button aria-label="수량 늘리기" disabled={qty >= selected.remaining || inputsLocked} onClick={() => changeQty(qty + 1)} type="button">+</button>
                </div>
              </div>
              <dl className="checkout-totals">
                <div><dt>{krw(selected.price)} × {qty}매</dt><dd>{krw(total)}</dd></div>
                <div className="checkout-total"><dt>결제 금액</dt><dd>{krw(total)}</dd></div>
              </dl>
            </>
          ) : (
            <p className="event-booking-empty">예매 가능한 회차가 없습니다.</p>
          )}

          {(selectedReason || (!selected && event.status !== '예매중')) && (
            <p className="checkout-error" role="status">{selectedReason ?? '현재 예매 가능한 이벤트가 아니에요.'}</p>
          )}
          {error && <p aria-live="polite" className="checkout-error" role="alert">{error}</p>}
          {!error && <span aria-live="polite" className="sr-only">{pending ? '예매를 만들고 있습니다.' : ''}</span>}

          {authState === 'ready' ? (
            <button className="btn btn-holo checkout-submit" disabled={pending || !selected || Boolean(selectedReason)}>
              {pending ? '잔여 수량을 확인 중' : retryLocked ? '같은 요청 다시 확인' : '예매하고 결제하기'}
            </button>
          ) : selected && !selectedReason ? (
            <Link className="btn btn-holo checkout-submit" href={authHref}>
              {authState === 'signed-out' ? '로그인하고 예매' : '프로필 설정 후 예매'}
            </Link>
          ) : (
            <button className="btn btn-holo checkout-submit" disabled type="button">예매할 수 없음</button>
          )}
          <p className="money-caption">예약 후 10분 동안 정원이 선점됩니다. 결제 완료는 웹훅 확인 후 안내합니다.</p>
        </aside>
      </form>
    </main>
  );
}
