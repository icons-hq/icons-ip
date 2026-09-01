'use client';

import {
  ANONYMOUS,
  loadTossPayments,
  type TossPaymentsSDK,
} from '@tosspayments/tosspayments-sdk';
import { useEffect, useMemo, useRef, useState } from 'react';

export const TOSS_PAYMENT_METHODS_ID = 'toss-payment-methods';
export const TOSS_AGREEMENT_ID = 'toss-agreement';
export const TOSS_PAYMENT_METHODS_SELECTOR = `#${TOSS_PAYMENT_METHODS_ID}`;
export const TOSS_AGREEMENT_SELECTOR = `#${TOSS_AGREEMENT_ID}`;

/** 서버 어댑터(toss-gateway.server.ts prepare)가 만드는 평면 레코드의 키 집합. */
const TOSS_PAYLOAD_KEYS = new Set([
  'provider',
  'clientKey',
  'customerKey',
  'orderId',
  'orderName',
  'amount',
  'currency',
  'successUrl',
  'failUrl',
]);

// toss-config.mjs의 클라이언트 키 정규식과 같은 축이다. gsk(시크릿) 키는 형식이
// 달라 여기서 자동으로 걸러진다 — 브라우저에 시크릿 키가 실리는 경로를 막는다.
const TOSS_CLIENT_KEY = /^(test|live)_gck_[A-Za-z0-9]{8,128}$/;
// toss-gateway.server.ts의 PROVIDER_ORDER_ID와 같은 형식(굿즈 O·티켓 T 접두).
const TOSS_ORDER_ID = /^[OT][0-9a-f]{32}$/i;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export interface TossCheckoutPayload {
  readonly provider: 'toss';
  readonly clientKey: string;
  readonly customerKey: 'ANONYMOUS';
  readonly orderId: string;
  readonly orderName: string;
  readonly amount: number;
  readonly currency: 'KRW';
  readonly successUrl: string;
  readonly failUrl: string;
}

export interface TossWidgetController {
  /** Redirect 방식 결제 요청. 성공하면 successUrl로 이탈한다. */
  requestPayment(): Promise<void>;
  /** 쿠폰 등으로 금액이 바뀌면 setAmount를 다시 불러 위젯 금액을 맞춘다. */
  updateAmount(value: number): Promise<void>;
  /** 결제 UI·약관 UI를 모두 제거한다. 한 페이지에 결제 UI 2개는 불가. */
  destroy(): Promise<void>;
  /** 필수 약관 동의 상태 구독. 등록 즉시 현재 상태로 한 번 호출한다. */
  onAgreementChange(callback: (agreedRequiredTerms: boolean) => void): void;
}

export interface TossWidgetDeps {
  readonly loadTossPayments?: (clientKey: string) => Promise<TossPaymentsSDK>;
}

function isSafeRedirectUrl(value: string) {
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

/**
 * 신뢰할 수 없는 직렬화 값을 서버 어댑터가 만드는 정확한 평면 payload로 좁힌다.
 * 허용 키 밖의 값이 하나라도 있으면 통째로 버린다 — provider 원문이 클라이언트
 * SDK로 새는 경로를 만들지 않는다.
 */
export function parseTossCheckoutPayload(payload: unknown): TossCheckoutPayload | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;

  try {
    const candidate = payload as Record<string, unknown>;
    if (Object.keys(candidate).some((key) => !TOSS_PAYLOAD_KEYS.has(key))) return null;

    const {
      provider,
      clientKey,
      customerKey,
      orderId,
      orderName,
      amount,
      currency,
      successUrl,
      failUrl,
    } = candidate;

    if (provider !== 'toss') return null;
    if (typeof clientKey !== 'string' || !TOSS_CLIENT_KEY.test(clientKey)) return null;
    if (customerKey !== 'ANONYMOUS') return null;
    if (typeof orderId !== 'string' || !TOSS_ORDER_ID.test(orderId)) return null;
    if (
      typeof orderName !== 'string'
      || orderName.length < 1
      || orderName.length > 100
      || CONTROL_CHARACTERS.test(orderName)
    ) return null;
    if (!Number.isSafeInteger(amount)) return null;
    if ((amount as number) < 100 || (amount as number) > 999_999_999_999) return null;
    if (currency !== 'KRW') return null;
    if (typeof successUrl !== 'string' || !isSafeRedirectUrl(successUrl)) return null;
    if (typeof failUrl !== 'string' || !isSafeRedirectUrl(failUrl)) return null;

    return {
      provider,
      clientKey,
      customerKey,
      orderId,
      orderName,
      amount: amount as number,
      currency,
      successUrl,
      failUrl,
    };
  } catch {
    return null;
  }
}

/**
 * 주문서형 위젯을 문서가 정한 순서대로 띄운다. setAmount는 renderPaymentMethods
 * 전에 반드시 끝나야 하고(NotSetupAmountError), 결제 요청은 모바일에서 Promise
 * 방식을 못 쓰므로 successUrl/failUrl을 실은 Redirect 방식으로만 보낸다.
 */
export async function mountTossPaymentWidgets(
  payload: TossCheckoutPayload,
  deps: TossWidgetDeps = {},
): Promise<TossWidgetController> {
  const load = deps.loadTossPayments ?? loadTossPayments;
  const tossPayments = await load(payload.clientKey);
  // 내부 사용자 식별자를 provider에 보내지 않는다 — 비회원 결제 계약.
  const widgets = tossPayments.widgets({ customerKey: ANONYMOUS });

  await widgets.setAmount({ currency: payload.currency, value: payload.amount });

  const [paymentMethodWidget, agreementWidget] = await Promise.all([
    widgets.renderPaymentMethods({ selector: TOSS_PAYMENT_METHODS_SELECTOR }),
    widgets.renderAgreement({ selector: TOSS_AGREEMENT_SELECTOR }),
  ]);

  // 2026-09-01 문서 테스트 키 실측: 필수 약관은 기본 동의(체크) 상태로 렌더되고
  // agreementStatusChange는 초기 상태를 통지하지 않는다(변경 시에만 발화). 초기
  // false로 잠그면 버튼이 영구히 잠기므로 동의 상태로 시작하고, 사용자가 체크를
  // 풀면 이벤트 값으로 잠근다.
  let agreedRequiredTerms = true;
  let subscriber: ((agreed: boolean) => void) | null = null;
  agreementWidget.on('agreementStatusChange', (status) => {
    agreedRequiredTerms = status.agreedRequiredTerms === true;
    subscriber?.(agreedRequiredTerms);
  });

  return {
    async requestPayment() {
      await widgets.requestPayment({
        orderId: payload.orderId,
        orderName: payload.orderName,
        successUrl: payload.successUrl,
        failUrl: payload.failUrl,
      });
    },
    async updateAmount(value: number) {
      await widgets.setAmount({ currency: payload.currency, value });
    },
    async destroy() {
      subscriber = null;
      // 한쪽 destroy가 실패해도 나머지를 반드시 정리한다.
      await Promise.allSettled([paymentMethodWidget.destroy(), agreementWidget.destroy()]);
    },
    onAgreementChange(callback) {
      subscriber = callback;
      callback(agreedRequiredTerms);
    },
  };
}

interface TossWidgetCheckoutProps {
  readonly payload: unknown;
}

export function TossWidgetCheckout({ payload }: TossWidgetCheckoutProps) {
  const parsed = useMemo(() => parseTossCheckoutPayload(payload), [payload]);
  const clientKey = parsed?.clientKey ?? null;
  const orderId = parsed?.orderId ?? null;
  const orderName = parsed?.orderName ?? null;
  const currency = parsed?.currency ?? null;
  const successUrl = parsed?.successUrl ?? null;
  const failUrl = parsed?.failUrl ?? null;
  const amount = parsed?.amount ?? 0;

  // 위젯을 다시 띄워야 하는 축(금액 제외). 마운트 결과를 이 키와 함께 들고 있어
  // payload가 바뀌면 effect에서 상태를 되돌리지 않고도 '불러오는 중'으로 돌아간다.
  const mountKey = `${clientKey}|${orderId}|${orderName}|${currency}|${successUrl}|${failUrl}`;

  const controllerRef = useRef<TossWidgetController | null>(null);
  // 마운트 effect는 금액을 deps에 넣지 않는다(금액 변경은 재렌더가 아니라
  // setAmount로 갱신한다). 최초 setAmount에 쓸 값만 ref로 넘긴다.
  const amountRef = useRef(amount);
  const [mounted, setMounted] = useState<{
    readonly key: string;
    readonly state: 'ready' | 'failed';
    readonly agreed: boolean;
  } | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [requestFailed, setRequestFailed] = useState(false);

  const current = mounted !== null && mounted.key === mountKey ? mounted : null;
  const mountState = current?.state ?? 'loading';
  const agreedRequiredTerms = current?.agreed ?? false;

  useEffect(() => {
    if (
      clientKey === null
      || orderId === null
      || orderName === null
      || currency === null
      || successUrl === null
      || failUrl === null
    ) return;

    let canceled = false;
    let controller: TossWidgetController | null = null;

    mountTossPaymentWidgets({
      provider: 'toss',
      clientKey,
      customerKey: 'ANONYMOUS',
      orderId,
      orderName,
      amount: amountRef.current,
      currency,
      successUrl,
      failUrl,
    })
      .then((mountedController) => {
        controller = mountedController;
        if (canceled) {
          void mountedController.destroy();
          return;
        }
        controllerRef.current = mountedController;
        // onAgreementChange가 등록 즉시 현재 상태(기본 동의)를 1회 통지하므로
        // ready 직후의 agreed 초기값은 컨트롤러가 결정한다.
        setMounted({ key: mountKey, state: 'ready', agreed: true });
        mountedController.onAgreementChange((agreed) => {
          if (!canceled) setMounted({ key: mountKey, state: 'ready', agreed });
        });
      })
      .catch(() => {
        if (!canceled) setMounted({ key: mountKey, state: 'failed', agreed: false });
      });

    return () => {
      canceled = true;
      controllerRef.current = null;
      void controller?.destroy();
    };
  }, [mountKey, clientKey, orderId, orderName, currency, successUrl, failUrl]);

  useEffect(() => {
    amountRef.current = amount;
    const controller = controllerRef.current;
    if (!controller) return;
    // 쿠폰 등으로 금액이 바뀌면 위젯 금액도 같이 옮긴다. 실패하면 화면 금액과
    // 위젯 금액이 어긋난 채 결제되지 않도록 결제 자체를 막는다.
    void controller.updateAmount(amount).catch(() => {
      setMounted({ key: mountKey, state: 'failed', agreed: false });
    });
  }, [amount, mountKey]);

  if (!parsed) {
    return (
      <p className="checkout-error" role="alert">
        결제 준비 정보를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.
      </p>
    );
  }

  function handleClick() {
    const controller = controllerRef.current;
    if (!controller) return;
    setRequesting(true);
    setRequestFailed(false);
    // Redirect 방식이라 성공하면 이 페이지를 떠난다. reject는 사용자가 결제창을
    // 닫았거나 요청이 실패한 경우뿐이므로 버튼을 다시 열어준다.
    void controller.requestPayment().catch(() => {
      setRequesting(false);
      setRequestFailed(true);
    });
  }

  return (
    <div>
      <div id={TOSS_PAYMENT_METHODS_ID} />
      <div id={TOSS_AGREEMENT_ID} />
      {mountState === 'loading' ? (
        <p role="status">결제 위젯을 불러오는 중입니다.</p>
      ) : null}
      {mountState === 'failed' ? (
        <p className="checkout-error" role="alert">
          결제 화면을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.
        </p>
      ) : null}
      <button
        className="btn btn-holo checkout-submit"
        disabled={mountState !== 'ready' || requesting || !agreedRequiredTerms}
        onClick={handleClick}
        type="button"
      >
        {requesting ? '결제창 여는 중…' : '결제하기'}
      </button>
      {mountState === 'ready' && !agreedRequiredTerms ? (
        <p role="status">필수 약관에 동의하면 결제할 수 있습니다.</p>
      ) : null}
      {requestFailed ? (
        <p className="checkout-error" role="alert">
          결제창을 열지 못했습니다. 잠시 후 다시 시도해주세요.
        </p>
      ) : null}
    </div>
  );
}
