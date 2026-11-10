'use client';

import { useEffect, useRef, useState } from 'react';

// 나이스페이 웹표준 결제창 JS(결제창 호출하기 1절). npm SDK가 없어 문서의 주소를 그대로 싣는다.
export const NICEPAY_PGWEB_SCRIPT_URL = 'https://pg-web.nicepay.co.kr/v3/common/js/nicepay-pgweb.js';

const NICEPAY_PAYLOAD_KEYS = new Set([
  'provider',
  'GoodsName',
  'Amt',
  'MID',
  'EdiDate',
  'Moid',
  'SignData',
  'PayMethod',
  'ReturnURL',
  'ReqReserved',
  'CharSet',
]);

// 결제 폼에 hidden input으로 싣는 순서. provider는 우리 분기용이라 폼에 넣지 않는다.
const FORM_FIELDS = [
  'GoodsName',
  'Amt',
  'MID',
  'EdiDate',
  'Moid',
  'SignData',
  'PayMethod',
  'ReturnURL',
  'ReqReserved',
  'CharSet',
] as const;

type NicepayFormField = (typeof FORM_FIELDS)[number];
export type NicepayCheckoutPayload = Readonly<Record<NicepayFormField, string>>;

interface NicepayWindow extends Window {
  goPay?: (form: HTMLFormElement) => void;
  nicepaySubmit?: () => void;
  nicepayClose?: () => void;
}

function isSafeReturnUrl(value: string) {
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || (
      url.protocol === 'http:'
      && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
    ))
      && url.pathname === '/api/payments/goods/confirm/nicepay'
      && !url.search
      && !url.hash;
  } catch {
    return false;
  }
}

function isValidEdiDate(value: string) {
  if (!/^\d{14}$/.test(value)) return false;
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  return month >= 1 && month <= 12
    && day >= 1 && day <= 31
    && Number(value.slice(8, 10)) <= 23
    && Number(value.slice(10, 12)) <= 59
    && Number(value.slice(12, 14)) <= 59;
}

/**
 * 서버 어댑터(lib/payments/nicepay-gateway.server.ts)가 만든 평평한 payload만 통과시킨다.
 * 직렬화를 거친 값이라 신뢰하지 않는다 — 키 집합과 형식이 정확히 맞아야 결제창을 연다.
 */
export function parseNicepayPayload(payload: unknown): NicepayCheckoutPayload | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;
  const candidate = payload as Record<string, unknown>;
  if (Object.keys(candidate).some((key) => !NICEPAY_PAYLOAD_KEYS.has(key))) return null;
  if (candidate.provider !== 'nicepay') return null;
  if (FORM_FIELDS.some((field) => typeof candidate[field] !== 'string')) return null;
  const value = candidate as Record<NicepayFormField, string>;

  if (!/^[\p{L}\p{N} ]{1,20}$/u.test(value.GoodsName)) return null;
  if (!/^[1-9][0-9]{3,11}$/.test(value.Amt)) return null;
  if (!/^[A-Za-z0-9]{10}$/.test(value.MID)) return null;
  if (!isValidEdiDate(value.EdiDate)) return null;
  if (!/^O[0-9a-f]{32}$/i.test(value.Moid)) return null;
  if (!/^[0-9a-f]{64}$/.test(value.SignData)) return null;
  if (value.PayMethod !== 'CARD') return null;
  if (!isSafeReturnUrl(value.ReturnURL)) return null;
  if (!/^[A-Za-z0-9_-]{16,255}$/.test(value.ReqReserved)) return null;
  if (value.CharSet !== 'utf-8') return null;

  const parsed = {} as Record<NicepayFormField, string>;
  for (const field of FORM_FIELDS) parsed[field] = value[field];
  return parsed;
}

let scriptLoad: Promise<void> | null = null;

/** 결제창 JS를 한 번만 싣는다. 실패하면 다음 클릭에서 다시 시도한다. */
export function loadNicepayScript(): Promise<void> {
  const nicepayWindow = window as NicepayWindow;
  if (typeof nicepayWindow.goPay === 'function') return Promise.resolve();
  if (scriptLoad) return scriptLoad;
  scriptLoad = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = NICEPAY_PGWEB_SCRIPT_URL;
    script.async = true;
    script.onload = () => {
      if (typeof nicepayWindow.goPay === 'function') resolve();
      else reject(new Error('nicepay_script_invalid'));
    };
    script.onerror = () => reject(new Error('nicepay_script_failed'));
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    scriptLoad = null;
    throw error;
  });
  return scriptLoad;
}

interface NicepayClientCheckoutProps {
  readonly payload: unknown;
}

/**
 * 나이스페이 웹표준 결제창. 결제 폼(accept-charset=euc-kr, 문서의 인코딩 규정)을 goPay()에
 * 넘긴다. PC는 레이어 결제창이 인증 뒤 nicepaySubmit()을 불러 이 폼을 confirm 라우트로
 * submit하고, 모바일은 나이스페이가 ReturnURL로 인증 결과를 POST한다. 함수 이름
 * nicepaySubmit·nicepayClose는 결제창 JS가 부르는 고정 이름이라 바꿀 수 없다.
 */
export function NicepayClientCheckout({ payload }: NicepayClientCheckoutProps) {
  const [status, setStatus] = useState<'idle' | 'starting' | 'failed'>('idle');
  const formRef = useRef<HTMLFormElement>(null);
  const parsed = parseNicepayPayload(payload);

  useEffect(() => () => {
    const nicepayWindow = window as NicepayWindow;
    delete nicepayWindow.nicepaySubmit;
    delete nicepayWindow.nicepayClose;
  }, []);

  if (!parsed) {
    return (
      <p className="checkout-error" role="alert">
        결제 준비 정보를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.
      </p>
    );
  }

  async function handleClick() {
    const form = formRef.current;
    if (!form) return;
    setStatus('starting');
    try {
      await loadNicepayScript();
      const nicepayWindow = window as NicepayWindow;
      nicepayWindow.nicepaySubmit = () => form.submit();
      nicepayWindow.nicepayClose = () => setStatus('idle');
      nicepayWindow.goPay?.(form);
    } catch {
      setStatus('failed');
    }
  }

  return (
    <div>
      <form
        acceptCharset="euc-kr"
        action={parsed.ReturnURL}
        method="post"
        name="payForm"
        ref={formRef}
      >
        {FORM_FIELDS.map((field) => (
          <input key={field} name={field} type="hidden" value={parsed[field]} />
        ))}
      </form>
      <button
        className="btn btn-holo checkout-submit"
        disabled={status === 'starting'}
        onClick={handleClick}
        type="button"
      >
        {status === 'starting' ? '결제창 여는 중…' : '결제하기'}
      </button>
      {status === 'failed' ? (
        <p className="checkout-error" role="alert">
          결제창을 열지 못했습니다. 잠시 후 다시 시도해주세요.
        </p>
      ) : null}
    </div>
  );
}
