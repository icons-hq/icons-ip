'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { ADULT_VERIFICATION_RESULT_COPY } from '@/lib/identity/adult-verification-copy';
import {
  ADULT_VERIFICATION_CHANNEL,
  ADULT_VERIFICATION_COMPLETE_PATH,
  ADULT_VERIFICATION_MESSAGE_TYPE,
  adultVerificationHref,
  type AdultVerificationResultStatus,
} from '@/lib/identity/adult-verification-routes';

/*
 * 성인 인증 결과. 페이지 전환으로 온 경우 결과와 다음 행동을 보여 주고, 팝업이 끝난 결과면
 * 원래 창에 알리고 스스로 닫는다. 이 화면의 status는 안내용이다 — 인증 상태의 진실원은
 * 서버의 성인 인증 증거이고, 'verified'는 페이지가 서버에서 다시 확인한 뒤에만 온다.
 *
 * 팝업으로 다루는 것은 이 창을 연 원래 창(window.opener)이 있을 때뿐이다. 주소만 따라 들어온
 * 창은 다른 탭에 알리지 않고 일반 결과 화면으로 남는다. 확인 중·로그인 필요·장애는 이 창에서
 * 다시 확인해야 하므로 팝업이어도 닫지 않는다.
 */

const POPUP_FINAL_STATUSES: ReadonlySet<AdultVerificationResultStatus> = new Set([
  'verified', 'underage', 'failed', 'expired', 'invalid',
]);

function ResultActions({ next, status }: { next: string; status: AdultVerificationResultStatus }) {
  if (status === 'verified') {
    return <Link className="wc-btn primary" href={next}>계속하기</Link>;
  }
  if (status === 'underage') {
    return <Link className="wc-btn" href="/">홈으로</Link>;
  }
  // 확정 경로는 라우트 핸들러라 클라이언트 이동이 아니라 문서 이동으로 간다.
  if (status === 'login_required') {
    return (
      <a className="wc-btn primary" href={`/login?next=${encodeURIComponent(ADULT_VERIFICATION_COMPLETE_PATH)}`}>
        로그인하고 결과 확인하기
      </a>
    );
  }
  if (status === 'pending') {
    return <a className="wc-btn primary" href={ADULT_VERIFICATION_COMPLETE_PATH}>다시 확인하기</a>;
  }
  if (status === 'error') {
    return (
      <>
        <a className="wc-btn primary" href={ADULT_VERIFICATION_COMPLETE_PATH}>다시 확인하기</a>
        <Link className="wc-btn" href={adultVerificationHref(next)}>처음부터 다시 인증하기</Link>
      </>
    );
  }
  return <Link className="wc-btn primary" href={adultVerificationHref(next)}>다시 인증하기</Link>;
}

export function AdultVerificationResult({
  mode,
  next,
  status,
}: {
  mode: 'popup' | 'page';
  next: string;
  status: AdultVerificationResultStatus;
}) {
  const closesPopup = mode === 'popup' && POPUP_FINAL_STATUSES.has(status);
  const [closing, setClosing] = useState(closesPopup);

  useEffect(() => {
    if (!closesPopup) return;
    // 원래 창이 없으면 팝업이 아니다 — 알리지도 닫지도 않고 결과 화면으로 남는다.
    if (!window.opener) {
      const timer = window.setTimeout(() => setClosing(false), 0);
      return () => window.clearTimeout(timer);
    }
    const message = { type: ADULT_VERIFICATION_MESSAGE_TYPE, status };
    try {
      if (!window.opener.closed) window.opener.postMessage(message, window.location.origin);
    } catch {
      // 원래 창과의 연결이 끊긴 경우 — BroadcastChannel이 대신 알린다.
    }
    try {
      if (typeof BroadcastChannel === 'function') {
        const channel = new BroadcastChannel(ADULT_VERIFICATION_CHANNEL);
        channel.postMessage(message);
        channel.close();
      }
    } catch {
      // 알림을 못 보내도 원래 창은 팝업이 닫힌 것을 보고 상태를 다시 읽는다.
    }
    const timer = window.setTimeout(() => {
      window.close();
      setClosing(false);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [closesPopup, status]);

  const copy = ADULT_VERIFICATION_RESULT_COPY[status];

  return (
    <main className="wc-root wc-adult-result">
      <div className="wc-container">
        <section aria-live="polite" className="wc-adult-result__panel">
          <h1 className="wc-adult-result__title">{copy.title}</h1>
          <p className="wc-adult-result__body">{closing ? '원래 화면으로 돌아가는 중이에요.' : copy.description}</p>
          {closing ? null : (
            <div className="wc-adult-result__actions">
              <ResultActions next={next} status={status} />
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
