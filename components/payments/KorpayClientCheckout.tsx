'use client';

import KorpaySdk, { type PaymentData } from '@korpay/sdk';
import { useState } from 'react';

export const KORPAY_SDK_BASE_URL = 'https://payments.korpay.com/v1';

const KORPAY_PAYLOAD_KEYS = new Set([
  'merchantId',
  'productName',
  'orderNumber',
  'amount',
  'payMethod',
  'returnUrl',
  'ediDate',
  'hashKey',
  'reserved',
  'language',
]);

interface KorpayLaunchCallbacks {
  readonly onStarted?: () => void;
  readonly onFailed?: () => void;
  readonly onClosed?: () => void;
}

interface KorpayClientCheckoutProps {
  readonly payload: unknown;
}

function isSafeReturnUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || (
      url.protocol === 'http:'
      && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
    );
  } catch {
    return false;
  }
}

function isValidEdiDate(value: string) {
  if (!/^\d{14}$/.test(value)) return false;

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const hour = Number(value.slice(8, 10));
  const minute = Number(value.slice(10, 12));
  const second = Number(value.slice(12, 14));
  const finalDayOfMonth = month >= 1 && month <= 12
    ? new Date(Date.UTC(year, month, 0)).getUTCDate()
    : 0;

  return year >= 2000
    && month >= 1
    && month <= 12
    && day >= 1
    && day <= finalDayOfMonth
    && hour <= 23
    && minute <= 59
    && second <= 59;
}

function parseKorpayPayload(payload: unknown): PaymentData | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;

  try {
    const candidate = payload as Record<string, unknown>;
    if (Object.keys(candidate).some((key) => !KORPAY_PAYLOAD_KEYS.has(key))) return null;

    const {
      merchantId,
      productName,
      orderNumber,
      amount,
      payMethod,
      returnUrl,
      ediDate,
      hashKey,
      reserved,
      language,
    } = candidate;

    if (typeof merchantId !== 'string' || !/^[A-Za-z0-9]{10}$/.test(merchantId)) return null;
    if (
      typeof productName !== 'string'
      || !/^[\p{L}\p{N}\s_()[\],.&+\/-]{1,50}$/u.test(productName)
    ) return null;
    if (typeof orderNumber !== 'string' || !/^[A-Za-z0-9]{1,40}$/.test(orderNumber)) return null;
    if (!Number.isSafeInteger(amount) || (amount as number) < 1_000 || (amount as number) > 999_999_999_999) return null;
    if (payMethod !== 'card') return null;
    if (typeof returnUrl !== 'string' || !isSafeReturnUrl(returnUrl)) return null;
    if (typeof ediDate !== 'string' || !isValidEdiDate(ediDate)) return null;
    if (typeof hashKey !== 'string' || !/^[a-f0-9]{64}$/.test(hashKey)) return null;
    if (typeof reserved !== 'string' || !/^[A-Za-z0-9_-]{16,255}$/.test(reserved)) return null;
    if (language !== undefined && language !== 'ko' && language !== 'en') return null;

    return {
      merchantId,
      productName,
      orderNumber,
      amount: amount as number,
      payMethod,
      returnUrl,
      ediDate,
      hashKey,
      reserved,
      ...(language === undefined ? {} : { language }),
    };
  } catch {
    return null;
  }
}

/**
 * Starts the browser SDK only after reducing an untrusted serialized value to
 * the exact flat payload produced by the server-side Korpay adapter.
 */
export function launchKorpayPayment(
  payload: unknown,
  callbacks: KorpayLaunchCallbacks = {},
) {
  const parsedPayload = parseKorpayPayload(payload);
  if (!parsedPayload) {
    callbacks.onFailed?.();
    return false;
  }

  try {
    KorpaySdk.payment(KORPAY_SDK_BASE_URL, parsedPayload, {
      onStart: callbacks.onStarted,
      onError: () => callbacks.onFailed?.(),
      onClose: callbacks.onClosed,
    });
    return true;
  } catch {
    callbacks.onFailed?.();
    return false;
  }
}

export function KorpayClientCheckout({ payload }: KorpayClientCheckoutProps) {
  const [status, setStatus] = useState<'idle' | 'starting' | 'failed'>('idle');
  const payloadIsValid = parseKorpayPayload(payload) !== null;

  if (!payloadIsValid) {
    return (
      <p className="checkout-error" role="alert">
        결제 준비 정보를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.
      </p>
    );
  }

  function handleClick() {
    setStatus('starting');
    launchKorpayPayment(payload, {
      onStarted: () => setStatus('starting'),
      onFailed: () => setStatus('failed'),
      onClosed: () => setStatus('idle'),
    });
  }

  return (
    <div>
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
