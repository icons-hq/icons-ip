'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

interface PaymentConfirmationProps {
  amount: number | null;
  destinationPath: string | null;
  fallbackHref: string;
  fallbackLabel: string;
  orderId: string | null;
  paymentKey: string | null;
  paymentType: string | null;
  resumePath: string;
  subject: '주문' | '예매';
}

export function PaymentConfirmation(props: PaymentConfirmationProps) {
  const router = useRouter();
  const started = useRef(false);
  const invalidResult = !props.paymentKey || !props.orderId || !props.amount || props.paymentType !== 'NORMAL';
  const [error, setError] = useState<string | null>(() => (
    invalidResult ? `결제 결과 정보가 올바르지 않아요. ${props.subject} 화면에서 상태를 다시 확인해주세요.` : null
  ));
  const [authRequired, setAuthRequired] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    if (invalidResult) return;

    const confirm = async () => {
      try {
        const response = await fetch('/api/payments/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            paymentKey: props.paymentKey,
            orderId: props.orderId,
            amount: props.amount,
            paymentType: props.paymentType,
          }),
        });
        if (!response.ok) {
          setAuthRequired(response.status === 401);
          setError(response.status === 401
            ? `로그인이 만료됐어요. 다시 로그인한 뒤 ${props.subject} 상태를 확인해주세요.`
            : '결제 승인 결과를 확인하지 못했어요. 잠시 후 다시 시도해주세요.');
          return;
        }
        if (props.destinationPath) router.replace(props.destinationPath);
        else setError(`${props.subject} 식별자를 확인하지 못했어요. 고객센터에 문의해주세요.`);
      } catch {
        setError('네트워크 연결을 확인한 뒤 다시 시도해주세요.');
      }
    };

    void confirm();
  }, [
    invalidResult,
    props.amount,
    props.destinationPath,
    props.orderId,
    props.paymentKey,
    props.paymentType,
    props.subject,
    retryKey,
    router,
  ]);

  const retry = () => {
    started.current = false;
    setAuthRequired(false);
    setError(null);
    setRetryKey((value) => value + 1);
  };

  return (
    <main className="wc-root wc-receipt checkout-page checkout-result-page">
      <div className="wrap checkout-result card" role="status">
        <span className="checkout-result-mark" aria-hidden>{error ? '!' : '···'}</span>
        <h1>{error ? '결제 확인을 이어가야 해요' : '결제를 확인하고 있어요'}</h1>
        <p>{error ?? '승인 결과를 서버에서 검증하고 있습니다. 잠시만 기다려주세요.'}</p>
        {error && authRequired && (
          <Link className="btn btn-holo" href={`/login?next=${encodeURIComponent(props.resumePath)}`}>
            다시 로그인하고 결제 확인
          </Link>
        )}
        {error && !invalidResult && !authRequired && <button className="btn btn-holo" type="button" onClick={retry}>다시 확인</button>}
        {error && props.destinationPath && (
          <Link className="btn btn-ghost" href={props.destinationPath}>{props.subject} 화면으로</Link>
        )}
        {error && !props.destinationPath && (
          <Link className="btn btn-ghost" href={props.fallbackHref}>{props.fallbackLabel}</Link>
        )}
      </div>
    </main>
  );
}
