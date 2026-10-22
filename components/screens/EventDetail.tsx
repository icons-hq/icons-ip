'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { useFormStatus } from 'react-dom';
import { reserveTicketsAction } from '@/app/offline-popups/actions';
import { setIpNotificationPreferencesAction } from '@/app/ip/actions';
import { OfflinePopupStateBadge } from '@/components/screens/Events';
import type { FandomEvent, Ip } from '@/lib/data';
import { krw } from '@/lib/format';
import type { IpFollowState } from '@/lib/ip-follow';
import { hrefFor } from '@/lib/routes';
import type { PublicTicketType } from '@/lib/ticketing.server';

/* 오프라인 팝업 상세 (DESIGN §8 오프라인 팝업 · 11 §8 EV-04).
 *
 * 골격은 R-06 §2.3 안내형(아트 → 기간·장소 → 리드 → 현장·예매 안내)이고, 예매 칸은
 * R-04 buybox 문법(선택 → 수량 스테퍼 → 합계 → 잉크 CTA)이다. 데스크톱은 PDP 상단처럼
 * 아트 649 | 정보 446 두 칼럼, 모바일은 한 칼럼으로 쌓는다.
 *
 * 바꾸는 것은 마크업과 스타일뿐이다. 회차 판정(disabledReason·최소 결제 수량), 멱등 예매
 * 시도(reserveTicketsAction + reservationKey 재사용), 결제 진입·로그인 복귀 경로, 알림
 * 설정 폼은 그대로다 — 회차·잔여·예매·검표 계약 동결(DESIGN §8·§11). */

const reservationErrors: Record<string, string> = {
  auth_required: '로그인이 만료됐어요. 다시 로그인해주세요.',
  account_suspended: '정지된 계정은 새 예매를 만들 수 없어요.',
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

function minimumPayableQuantity(session: PublicTicketType) {
  return session.price > 0 ? Math.max(1, Math.ceil(1_000 / session.price)) : 1;
}

function disabledReason(event: FandomEvent, session: PublicTicketType, paymentAvailable: boolean) {
  if (event.status !== '예매중') return '현재 예매 가능한 오프라인 팝업이 아니에요.';
  if (session.remaining <= 0) return '정원 마감';
  if (session.price <= 0) return '0원 회차는 현재 예매할 수 없어요.';
  if (minimumPayableQuantity(session) > session.maxQuantity) {
    if (session.maxQuantity < session.remaining) {
      return '1인 예매 한도로는 결제사 최소 금액을 맞출 수 없어요.';
    }
    return '남은 수량으로는 결제사 최소 금액을 맞출 수 없어요.';
  }
  if (!paymentAvailable) return '결제 환경을 확인 중이라 지금은 예매할 수 없어요.';
  return null;
}

function EventNotificationSubmitButton({ followState }: { followState: IpFollowState }) {
  const { pending } = useFormStatus();
  const label = !followState.isFollowed
    ? '팔로우하고 새 이벤트 알림 받기'
    : followState.notifyEvents
      ? '이 IP 이벤트 알림 끄기'
      : '이 IP 이벤트 알림 받기';
  return (
    <button className="wc-btn wc-offline-alert__submit" disabled={pending} type="submit">
      {pending ? '저장 중' : label}
    </button>
  );
}

function EventNotificationAction({
  event,
  followState,
  ip,
  notificationError,
  notificationSaved,
}: {
  event: FandomEvent;
  followState: IpFollowState;
  ip: Ip;
  notificationError: boolean;
  notificationSaved: boolean;
}) {
  return (
    <section
      aria-labelledby="event-notification-heading"
      className="wc-offline-detail__panel wc-offline-alert"
    >
      <div className="wc-offline-detail__panel-body">
        <h2 className="wc-offline-detail__panel-title" id="event-notification-heading">이 IP의 새 이벤트 소식을 받아보세요</h2>
        <p className="wc-offline-detail__panel-text">{ip.title}에서 새로운 팝업·이벤트가 공개되면 알림함에서 알려드려요.</p>
        {notificationError && (
          <p className="wc-offline-detail__error" role="alert">알림 설정을 저장하지 못했습니다. 잠시 후 다시 시도해주세요.</p>
        )}
        {notificationSaved && !notificationError && (
          <p aria-live="polite" className="wc-offline-alert__success" role="status">
            이벤트 알림 설정을 저장했습니다.
          </p>
        )}
      </div>
      <form action={setIpNotificationPreferencesAction} className="wc-offline-alert__form">
        <input type="hidden" name="ipId" value={ip.id} />
        <input type="hidden" name="next" value={`/offline-popups/${event.id}`} />
        {!followState.isFollowed && <input type="hidden" name="autoFollow" value="1" />}
        <input type="hidden" name="notifyEvents" value={followState.notifyEvents ? '0' : '1'} />
        <EventNotificationSubmitButton followState={followState} />
      </form>
    </section>
  );
}

export function EventDetail({
  authHref,
  authState,
  event,
  ip,
  notificationError,
  notificationSaved,
  notificationState,
  paymentAvailable,
  sessions,
}: {
  authHref: string;
  authState: AuthState;
  event: FandomEvent;
  ip: Ip | null;
  notificationError: boolean;
  notificationSaved: boolean;
  notificationState: IpFollowState | null;
  paymentAvailable: boolean;
  sessions: PublicTicketType[];
}) {
  const router = useRouter();
  const firstBookable = sessions.find((session) => !disabledReason(event, session, paymentAvailable));
  const [selectedId, setSelectedId] = useState(firstBookable?.id ?? '');
  const [qty, setQty] = useState(firstBookable ? minimumPayableQuantity(firstBookable) : 1);
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
    const nextSession = sessions.find((session) => session.id === id);
    setSelectedId(id);
    setQty(nextSession ? minimumPayableQuantity(nextSession) : 1);
    setError(null);
    attemptRef.current = null;
  };

  const changeQty = (next: number) => {
    if (!selected || inputsLocked || attemptRef.current) return;
    setQty(Math.min(selected.maxQuantity, Math.max(minimumPayableQuantity(selected), next)));
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

  return (
    <main className="wc-root wc-offline-detail">
      <div className="wc-container">
        <Link className="wc-offline-detail__back" href="/offline-popups">
          <svg aria-hidden fill="none" height="13" viewBox="0 0 8 13" width="8">
            <path d="M6.5 1 1.5 6.5 6.5 12" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.4" />
          </svg>
          오프라인 팝업
        </Link>

        <div className="wc-offline-detail__top">
          <div
            aria-hidden
            className="wc-offline-detail__art"
            style={{ background: event.img, backgroundPosition: 'center', backgroundSize: 'cover' }}
          />

          <div className="wc-offline-detail__info">
            <header className="wc-offline-detail__head">
              <p className="wc-offline-detail__badges">
                {/* IP 관으로 가는 길은 이 화면에 남긴다 — 목록의 피처드 블록("이 세계 더 보기")을
                    걷어 낸 뒤 오프라인 팝업에서 IP 로 넘어가는 유일한 링크다. */}
                {ip ? <Link className="wc-offline-detail__ip" href={hrefFor('ip', ip)}>{ip.title}</Link> : null}
                <span className="wc-offline-detail__kind">{event.mode}</span>
                <OfflinePopupStateBadge status={event.status} />
              </p>
              <h1 className="wc-offline-detail__title">{event.title}</h1>
              <dl className="wc-offline-detail__facts">
                <div>
                  <dt>기간</dt>
                  <dd>{event.date || '일정 공개 예정'}</dd>
                </div>
                <div>
                  <dt>장소</dt>
                  <dd>{event.loc || '장소 공개 예정'}</dd>
                </div>
              </dl>
              <p className="wc-offline-detail__lead">원하는 회차와 수량을 고른 뒤 결제를 진행하세요. 결제 확인이 끝나면 전자티켓이 발급됩니다.</p>
            </header>

            <form aria-busy={pending} className="wc-offline-buybox" onSubmit={submit}>
              <section aria-labelledby="event-session-title" className="wc-offline-buybox__sessions">
                <h2 className="wc-offline-buybox__heading" id="event-session-title">회차 선택</h2>
                <p className="wc-offline-buybox__note">할당 수량에는 결제 대기 중인 예매도 포함됩니다.</p>

                {sessions.length ? (
                  <fieldset className="wc-offline-sessions" disabled={inputsLocked}>
                    <legend className="wc-sr-only">티켓 회차</legend>
                    {sessions.map((session) => {
                      const reason = disabledReason(event, session, paymentAvailable);
                      const checked = selectedId === session.id;
                      return (
                        <label className={`wc-offline-session${checked ? ' is-selected' : ''}${reason || inputsLocked ? ' is-disabled' : ''}`} key={session.id}>
                          <input
                            checked={checked}
                            disabled={Boolean(reason)}
                            name="ticketTypeId"
                            onChange={() => changeSelection(session.id)}
                            type="radio"
                            value={session.id}
                          />
                          <span className="wc-offline-session__main">
                            <strong>{session.name}</strong>
                            <small>{reason ?? `잔여 ${session.remaining}`}</small>
                          </span>
                          <span className="wc-offline-session__price">
                            <strong>{krw(session.price)}</strong>
                            <small>할당 {session.sold}/{session.capacity}</small>
                          </span>
                        </label>
                      );
                    })}
                  </fieldset>
                ) : (
                  <div className="wc-offline-buybox__state" role="status">
                    <h3>등록된 회차가 아직 없어요</h3>
                    <p>운영 회차가 열리면 이 화면에서 잔여 수량과 함께 안내합니다.</p>
                  </div>
                )}
              </section>

              <section aria-label="예매 요약" className="wc-offline-buybox__summary">
                {selected ? (
                  <>
                    <p className="wc-offline-buybox__selection">
                      <span>{event.title}</span>
                      <strong>{selected.name}</strong>
                      <small>잔여 {selected.remaining} · 결제 대기 포함</small>
                    </p>
                    {/* 수량 스테퍼 92×32(R-04 §3.6). 최소 결제 수량·1인 한도 판정은 그대로다. */}
                    <div className="wc-offline-buybox__qty">
                      <label htmlFor="event-ticket-qty">수량</label>
                      <div className="wc-stepper">
                        <button aria-label="수량 줄이기" className="wc-stepper__btn" disabled={qty <= minimumPayableQuantity(selected) || inputsLocked} onClick={() => changeQty(qty - 1)} type="button">−</button>
                        <input
                          className="wc-stepper__input"
                          disabled={inputsLocked}
                          id="event-ticket-qty"
                          inputMode="numeric"
                          max={selected.maxQuantity}
                          min={minimumPayableQuantity(selected)}
                          name="qty"
                          onChange={(qtyEvent) => changeQty(Number(qtyEvent.target.value))}
                          type="number"
                          value={qty}
                        />
                        <button aria-label="수량 늘리기" className="wc-stepper__btn" disabled={qty >= selected.maxQuantity || inputsLocked} onClick={() => changeQty(qty + 1)} type="button">+</button>
                      </div>
                    </div>
                    <dl className="wc-offline-buybox__totals">
                      <div><dt>{krw(selected.price)} × {qty}매</dt><dd>{krw(total)}</dd></div>
                      <div className="wc-offline-buybox__total"><dt>결제 금액</dt><dd>{krw(total)}</dd></div>
                    </dl>
                  </>
                ) : (
                  <p className="wc-offline-buybox__none">예매 가능한 회차가 없습니다.</p>
                )}

                {(selectedReason || (!selected && event.status !== '예매중')) && (
                  <p className="wc-offline-buybox__reason" role="status">{selectedReason ?? '현재 예매 가능한 오프라인 팝업이 아니에요.'}</p>
                )}
                {error && <p aria-live="polite" className="wc-offline-detail__error" role="alert">{error}</p>}
                {!error && <span aria-live="polite" className="wc-sr-only">{pending ? '예매를 만들고 있습니다.' : ''}</span>}

                {authState === 'ready' ? (
                  <button className="wc-btn primary wc-offline-buybox__cta" disabled={pending || !selected || Boolean(selectedReason)}>
                    {pending ? '잔여 수량을 확인 중' : retryLocked ? '같은 요청 다시 확인' : '예매하고 결제하기'}
                  </button>
                ) : selected && !selectedReason ? (
                  <Link className="wc-btn primary wc-offline-buybox__cta" href={authHref}>
                    {authState === 'signed-out' ? '로그인하고 예매' : '프로필 설정 후 예매'}
                  </Link>
                ) : (
                  <button className="wc-btn primary wc-offline-buybox__cta" disabled type="button">예매할 수 없음</button>
                )}
                <p className="wc-offline-buybox__caption">예약 후 10분 동안 정원이 선점됩니다. 결제사 승인 결과를 서버에서 확인한 뒤 완료를 안내합니다.</p>
              </section>
            </form>
          </div>
        </div>

        {event.status === '예정' && ip && notificationState && (
          <EventNotificationAction
            event={event}
            followState={notificationState}
            ip={ip}
            notificationError={notificationError}
            notificationSaved={notificationSaved}
          />
        )}

        <section aria-labelledby="event-ticket-guide-heading" className="wc-offline-detail__panel">
          <div className="wc-offline-detail__panel-body">
            <h2 className="wc-offline-detail__panel-title" id="event-ticket-guide-heading">전자티켓 이용 안내</h2>
            <p className="wc-offline-detail__panel-text">결제 확인 후 내 티켓에서 QR을 확인하고, 현장에서는 티켓을 한 장씩 제시해주세요.</p>
          </div>
          <Link className="wc-btn wc-offline-detail__panel-cta" href="/tickets">내 티켓 확인</Link>
        </section>
      </div>
    </main>
  );
}
