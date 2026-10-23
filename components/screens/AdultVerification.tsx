'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { beginAdultVerificationAction, type BeginAdultVerificationResult } from '@/app/my/adult-verification/actions';
import { MypageShell } from '@/components/wc/MypageShell';
import { ADULT_VERIFICATION_RESULT_COPY } from '@/lib/identity/adult-verification-copy';
import {
  ADULT_VERIFICATION_CHANNEL,
  ADULT_VERIFICATION_MESSAGE_TYPE,
  ADULT_VERIFICATION_PATH,
  ADULT_VERIFICATION_RESULT_STATUSES,
  type AdultVerificationResultStatus,
} from '@/lib/identity/adult-verification-routes';
import { formatAdultVerificationDate, type AdultVerificationStatus } from '@/lib/identity/adult-verification-status';

/*
 * 마이 › 성인 인증.
 *
 * 인증 시작은 서버 액션이 KCP 거래등록을 마친 뒤 돌려준 인증창 주소로 form을 제출하는
 * 것뿐이다. 데스크톱(정밀 포인터·넓은 화면)은 KCP 권장대로 팝업, 그 밖은 페이지 전환이다.
 * 팝업 차단 브라우저는 클릭 안에서 연 창이 null이 되므로 페이지 전환으로 내려간다.
 *
 * 팝업이 끝나면 결과 화면이 이 창에 같은 origin 메시지(그리고 BroadcastChannel)로 알린다.
 * 그 메시지는 안내 문구와 이동에만 쓰고, 인증 상태는 서버에서 다시 읽는다(router.refresh).
 */

const POPUP_NAME = 'icons_kcp_cert';
const POPUP_WIDTH = 410;
const POPUP_HEIGHT = 500;

const START_ERRORS: Record<Extract<BeginAdultVerificationResult, { ok: false }>['error'], string> = {
  login_required: '로그인이 필요해요. 다시 로그인한 뒤 시도해 주세요.',
  onboarding_required: '회원 정보 입력을 마친 뒤 인증할 수 있어요.',
  unavailable: '지금은 성인 인증을 시작할 수 없어요. 잠시 뒤 다시 시도해 주세요.',
  rate_limited: '인증 시도가 많아 잠시 제한됐어요. 시간이 지난 뒤 다시 시도해 주세요.',
  blocked: '지금 이 계정으로는 성인 인증을 할 수 없어요. 1:1 문의로 알려 주세요.',
};

function prefersPopup() {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(min-width: 768px) and (hover: hover) and (pointer: fine)').matches;
}

function openCertPopup() {
  const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - POPUP_WIDTH) / 2));
  const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - POPUP_HEIGHT) / 2));
  return window.open(
    'about:blank',
    POPUP_NAME,
    `width=${POPUP_WIDTH},height=${POPUP_HEIGHT},left=${left},top=${top},scrollbars=yes,resizable=yes`,
  );
}

/** KCP 인증창 호출. 전용 form을 만들어 한 번 제출하고 바로 걷는다. */
function submitCertWindow(start: Extract<BeginAdultVerificationResult, { ok: true }>, target: string) {
  const form = document.createElement('form');
  form.method = 'post';
  form.action = start.callUrl;
  form.target = target;
  form.acceptCharset = 'UTF-8';
  for (const [name, value] of [['reg_cert_key', start.registrationKey], ['kcp_page_submit_yn', start.pageSubmit]] as const) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
  form.remove();
}

function isResultStatus(value: unknown): value is AdultVerificationResultStatus {
  return typeof value === 'string' && (ADULT_VERIFICATION_RESULT_STATUSES as readonly string[]).includes(value);
}

function StatusPanel({ status }: { status: AdultVerificationStatus }) {
  if (status.status === 'verified') {
    return (
      <section aria-label="성인 인증 상태" className="wc-adult-status wc-adult-status--verified">
        <p className="wc-adult-status__badge">인증 완료</p>
        <h2 className="wc-adult-status__title">성인 인증이 완료된 계정이에요</h2>
        <p className="wc-adult-status__body">
          {formatAdultVerificationDate(status.expiresAt)}까지 19금 굿즈를 보고 구매할 수 있어요.
        </p>
      </section>
    );
  }
  if (status.status === 'expired') {
    return (
      <section aria-label="성인 인증 상태" className="wc-adult-status">
        <h2 className="wc-adult-status__title">성인 인증 기간이 지났어요</h2>
        <p className="wc-adult-status__body">
          {formatAdultVerificationDate(status.expiresAt)}에 인증 기간이 끝났어요. 다시 인증하면 1년 동안 유지돼요.
        </p>
      </section>
    );
  }
  if (status.status === 'revoked' && status.reason !== 'superseded') {
    const body = status.reason === 'subject_moved'
      ? '같은 명의로 다른 계정에서 성인 인증을 해서 이 계정의 인증이 해제됐어요. 한 사람의 명의는 한 계정에서만 인증 상태로 유지돼요.'
      : status.reason === 'underage_result'
        ? '최근 본인확인 결과에 따라 이 계정의 성인 인증이 해제됐어요.'
        : '운영 정책에 따라 이 계정의 성인 인증이 해제됐어요. 자세한 내용은 1:1 문의로 알려 주세요.';
    return (
      <section aria-label="성인 인증 상태" className="wc-adult-status">
        <h2 className="wc-adult-status__title">성인 인증이 해제됐어요</h2>
        <p className="wc-adult-status__body">{body}</p>
      </section>
    );
  }
  return (
    <section aria-label="성인 인증 상태" className="wc-adult-status">
      <h2 className="wc-adult-status__title">성인 인증이 필요해요</h2>
      <p className="wc-adult-status__body">
        19금 굿즈는 휴대폰 본인확인으로 성인 인증을 마친 회원만 보고 구매할 수 있어요.
      </p>
    </section>
  );
}

export function AdultVerification({
  eligibleBirthYear,
  enabled,
  next,
  status,
}: {
  eligibleBirthYear: number;
  enabled: boolean;
  next: string;
  status: AdultVerificationStatus;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);
  const popupRef = useRef<Window | null>(null);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    const stopPolling = () => {
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
      pollRef.current = null;
    };

    const onResult = (data: unknown) => {
      if (!data || typeof data !== 'object') return;
      const message = data as { type?: unknown; status?: unknown };
      if (message.type !== ADULT_VERIFICATION_MESSAGE_TYPE || !isResultStatus(message.status)) return;
      stopPolling();
      popupRef.current = null;
      setBusy(false);
      if (message.status === 'verified' && next !== ADULT_VERIFICATION_PATH) {
        router.push(next);
        return;
      }
      const copy = ADULT_VERIFICATION_RESULT_COPY[message.status];
      setNotice({ tone: message.status === 'verified' ? 'info' : 'error', text: `${copy.title}. ${copy.description}` });
      router.refresh();
    };

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      onResult(event.data);
    };
    window.addEventListener('message', onMessage);

    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel === 'function') {
      channel = new BroadcastChannel(ADULT_VERIFICATION_CHANNEL);
      channel.onmessage = (event) => onResult(event.data);
    }

    return () => {
      window.removeEventListener('message', onMessage);
      channel?.close();
      stopPolling();
    };
  }, [next, router]);

  async function start() {
    if (busy || !enabled) return;
    setNotice(null);
    setBusy(true);

    // 팝업은 클릭 처리 안에서 열어야 차단되지 않는다. 열지 못하면 페이지 전환으로 간다.
    const popup = prefersPopup() ? openCertPopup() : null;
    const presentation = popup ? 'popup' : 'page';

    let result: BeginAdultVerificationResult;
    try {
      result = await beginAdultVerificationAction({ presentation, next });
    } catch {
      result = { ok: false, error: 'unavailable' };
    }

    if (!result.ok) {
      popup?.close();
      setBusy(false);
      setNotice({ tone: 'error', text: START_ERRORS[result.error] });
      return;
    }

    if (popup && !popup.closed) {
      popupRef.current = popup;
      submitCertWindow(result, POPUP_NAME);
      popup.focus();
      // 사용자가 결과 없이 창을 닫으면 대기 상태를 푼다. 결과는 메시지로 따로 온다.
      pollRef.current = window.setInterval(() => {
        if (popupRef.current?.closed) {
          if (pollRef.current !== null) window.clearInterval(pollRef.current);
          pollRef.current = null;
          popupRef.current = null;
          setBusy(false);
          router.refresh();
        }
      }, 800);
      return;
    }

    submitCertWindow(result, '_self');
  }

  const verified = status.status === 'verified';

  return (
    <MypageShell active={ADULT_VERIFICATION_PATH}>
      <h1 className="wc-mypage__heading">성인 인증</h1>
      <StatusPanel status={status} />
      {notice ? (
        <p className={`wc-adult-notice wc-adult-notice--${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>
          {notice.text}
        </p>
      ) : null}
      <div className="wc-adult-actions">
        {enabled ? (
          <button
            aria-busy={busy}
            className={`wc-btn ${verified ? '' : 'primary'}`.trim()}
            disabled={busy}
            onClick={() => { void start(); }}
            type="button"
          >
            {busy ? '본인확인 창을 여는 중…' : verified ? '다시 인증하기' : '휴대폰 본인확인으로 인증하기'}
          </button>
        ) : (
          <p className="wc-adult-actions__closed">성인 인증은 준비 중이에요. 열리면 이 화면에서 인증할 수 있어요.</p>
        )}
      </div>
      <div className="wc-coin-guide wc-adult-guide">
        <p>성인 인증 안내</p>
        <ul>
          <li>휴대폰 본인확인은 NHN KCP를 통해 본인 명의 휴대폰으로 진행해요.</li>
          <li>
            청소년 보호법에 따라 만 19세가 되는 해의 1월 1일부터 인증할 수 있어요. 올해는 {eligibleBirthYear}년 이전에
            태어난 분({eligibleBirthYear}년생 포함)이 인증할 수 있어요.
          </li>
          <li>인증은 1년 동안 유지되고, 기간이 지나면 다시 인증해야 해요.</li>
          <li>한 사람의 명의는 한 계정에서만 인증 상태로 유지돼요. 다른 계정에서 같은 명의로 인증하면 이전 계정의 인증은 해제돼요.</li>
          <li>이름·생년월일·휴대폰번호 같은 본인확인 정보는 저장하지 않아요. 인증 여부와 유효기간, 중복 확인용 암호화 값만 보관해요.</li>
        </ul>
      </div>
    </MypageShell>
  );
}
