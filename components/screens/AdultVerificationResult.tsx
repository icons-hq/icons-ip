'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { ADULT_VERIFICATION_RESULT_COPY } from '@/lib/identity/adult-verification-copy';
import {
  ADULT_VERIFICATION_CHANNEL,
  ADULT_VERIFICATION_MESSAGE_TYPE,
  adultVerificationHref,
  type AdultVerificationResultStatus,
} from '@/lib/identity/adult-verification-routes';

/*
 * 성인 인증 결과. 페이지 전환으로 온 경우 결과와 다음 행동을 보여 주고, 팝업이면 원래
 * 창에 결과를 알리고 스스로 닫는다. 창을 닫지 못하면(스크립트가 연 창이 아닌 경우) 같은
 * 결과 화면을 그대로 보여 준다. 이 화면의 status는 안내용이다 — 인증 상태의 진실원은
 * 서버의 성인 인증 증거다.
 */

function ResultActions({ next, status }: { next: string; status: AdultVerificationResultStatus }) {
  if (status === 'verified') {
    return <Link className="wc-btn primary" href={next}>계속하기</Link>;
  }
  if (status === 'underage') {
    return <Link className="wc-btn" href="/">홈으로</Link>;
  }
  if (status === 'login_required') {
    return <Link className="wc-btn primary" href={`/login?next=${encodeURIComponent(adultVerificationHref(next))}`}>로그인하기</Link>;
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
  const [closing, setClosing] = useState(mode === 'popup');

  useEffect(() => {
    if (mode !== 'popup') return;
    const message = { type: ADULT_VERIFICATION_MESSAGE_TYPE, status };
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(message, window.location.origin);
      }
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
  }, [mode, status]);

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
