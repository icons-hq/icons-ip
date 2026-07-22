'use client';

import {
  loadTossPayments,
  type TossPaymentsWidgets,
  type WidgetAgreementWidget,
  type WidgetPaymentMethodWidget,
} from '@tosspayments/tosspayments-sdk';
import { useEffect, useRef, useState } from 'react';
import { buildTossOrderId } from '@/lib/payments/toss';

export type TossCallbackBasePath = '/checkout' | '/ticket-checkout';

type TossPaymentRoute =
  | { callbackBasePath: '/checkout'; purpose: 'order' }
  | { callbackBasePath: '/ticket-checkout'; purpose: 'ticket' };

type TossWidgetPaymentRequestInput = TossPaymentRoute & {
  customerEmail: string | null;
  customerName: string;
  orderId: string;
  orderName: string;
  origin: string;
};

export function buildTossWidgetPaymentRequest({
  callbackBasePath,
  customerEmail,
  customerName,
  orderId,
  orderName,
  origin,
  purpose,
}: TossWidgetPaymentRequestInput) {
  const encodedReference = encodeURIComponent(orderId);

  return {
    orderId: buildTossOrderId(purpose, orderId),
    orderName,
    customerEmail,
    customerName,
    successUrl: `${origin}${callbackBasePath}/success?ref=${encodedReference}`,
    failUrl: `${origin}${callbackBasePath}/fail?ref=${encodedReference}`,
  };
}

export function resolveTossPaymentMethodVariantKey(value: string | null | undefined) {
  const variantKey = value?.trim();
  return variantKey && /^[A-Za-z0-9_-]{1,20}$/.test(variantKey) ? variantKey : 'DEFAULT';
}

type TossPaymentWidgetProps = TossPaymentRoute & {
  clientKey: string;
  customerKey: string;
  customerEmail: string | null;
  customerName: string;
  orderId: string;
  orderName: string;
  total: number;
};

export function TossPaymentWidget(props: TossPaymentWidgetProps) {
  const {
  clientKey,
  customerKey,
  customerEmail,
  customerName,
  orderId,
  orderName,
  total,
  } = props;
  const widgetsRef = useRef<TossPaymentsWidgets | null>(null);
  const paymentMethodsRef = useRef<WidgetPaymentMethodWidget | null>(null);
  const [ready, setReady] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [unsupportedMethod, setUnsupportedMethod] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let paymentMethods: WidgetPaymentMethodWidget | null = null;
    let agreement: WidgetAgreementWidget | null = null;

    const render = async () => {
      try {
        const tossPayments = await loadTossPayments(clientKey);
        if (disposed) return;
        const widgets = tossPayments.widgets({ customerKey });
        await widgets.setAmount({ currency: 'KRW', value: total });
        if (disposed) return;

        [paymentMethods, agreement] = await Promise.all([
          widgets.renderPaymentMethods({
            selector: '#toss-payment-methods',
            variantKey: resolveTossPaymentMethodVariantKey(
              process.env.NEXT_PUBLIC_TOSS_PAYMENT_METHOD_VARIANT_KEY,
            ),
          }),
          widgets.renderAgreement({ selector: '#toss-agreement', variantKey: 'AGREEMENT' }),
        ]);
        if (disposed) return;

        paymentMethods.on('paymentMethodSelect', (method) => {
          setUnsupportedMethod(method.code === 'VIRTUAL_ACCOUNT');
        });
        agreement.on('agreementStatusChange', (status) => {
          setAgreed(status.agreedRequiredTerms);
        });
        widgetsRef.current = widgets;
        paymentMethodsRef.current = paymentMethods;
        setReady(true);
      } catch {
        if (!disposed) setError('결제수단을 불러오지 못했어요. 잠시 후 새로고침해주세요.');
      }
    };

    void render();
    return () => {
      disposed = true;
      widgetsRef.current = null;
      paymentMethodsRef.current = null;
      void paymentMethods?.destroy();
      void agreement?.destroy();
    };
  }, [clientKey, customerKey, total]);

  const requestPayment = async () => {
    if (!widgetsRef.current || !agreed || unsupportedMethod || requesting) return;
    setRequesting(true);
    setError(null);
    try {
      const selectedMethod = await paymentMethodsRef.current?.getSelectedPaymentMethod();
      if (selectedMethod?.code === 'VIRTUAL_ACCOUNT') {
        setUnsupportedMethod(true);
        setRequesting(false);
        return;
      }
      await widgetsRef.current.setAmount({ currency: 'KRW', value: total });
      const paymentRoute: TossPaymentRoute = props.purpose === 'ticket'
        ? { callbackBasePath: props.callbackBasePath, purpose: props.purpose }
        : { callbackBasePath: props.callbackBasePath, purpose: props.purpose };
      await widgetsRef.current.requestPayment(buildTossWidgetPaymentRequest({
        ...paymentRoute,
        customerEmail,
        customerName,
        orderId,
        orderName,
        origin: window.location.origin,
      }));
    } catch {
      setError('결제 요청을 시작하지 못했어요. 결제수단과 약관을 확인해주세요.');
      setRequesting(false);
    }
  };

  return (
    <section className="toss-widget" aria-busy={!ready && !error}>
      <div id="toss-payment-methods" className="toss-widget-slot" />
      <div id="toss-agreement" className="toss-widget-slot" />
      {unsupportedMethod && (
        <p className="checkout-error" role="alert">가상계좌는 현재 지원하지 않아요. 다른 결제수단을 선택해주세요.</p>
      )}
      {error && <p className="checkout-error" role="alert">{error}</p>}
      <button
        className="btn btn-holo checkout-submit"
        type="button"
        disabled={!ready || !agreed || unsupportedMethod || requesting}
        onClick={() => void requestPayment()}
      >
        {requesting ? '결제창으로 이동 중' : `${total.toLocaleString('ko-KR')}원 결제하기`}
      </button>
      <p className="money-caption">
        승인 후 웹훅 확인이 끝날 때까지 {props.purpose === 'ticket' ? '예매는' : '주문은'} ‘결제 확인 중’으로 표시됩니다.
      </p>
    </section>
  );
}
