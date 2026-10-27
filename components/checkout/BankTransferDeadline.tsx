'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { BANK_TRANSFER_EXPIRED_COPY } from '@/lib/checkout-status-copy';
import { bankTransferDeadlinePassed } from '@/lib/payments/bank-transfer';


/*
 * 화면을 연 뒤 입금 기한이 지나면 계좌 안내를 닫는다. 결제 화면(CheckoutOrder)과 같은 방식으로
 * 마운트 뒤에 시계를 채우고 1초마다 다시 본다. 첫 렌더는 서버가 판정한 값을 그대로 써서
 * 하이드레이션이 갈라지지 않는다.
 */
function useBankTransferDeadlinePassed(expiresAt: string | null, initiallyPassed: boolean): boolean {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const initial = window.setTimeout(() => setNow(Date.now()), 0);
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, []);
  return now === null ? initiallyPassed : bankTransferDeadlinePassed(expiresAt, now);
}

/** 기한 안이면 `children`(입금 안내)을, 지났으면 `expired`(기본: 기한 만료 안내)를 그린다. */
export function BankTransferDeadlineGate({
  expiresAt,
  initiallyPassed,
  children,
  expired,
}: {
  expiresAt: string | null;
  initiallyPassed: boolean;
  children: ReactNode;
  expired?: ReactNode;
}) {
  const passed = useBankTransferDeadlinePassed(expiresAt, initiallyPassed);
  if (!passed) return <>{children}</>;
  if (expired !== undefined) return <>{expired}</>;
  return (
    <div className="checkout-deposit" role="alert">
      <h2>{BANK_TRANSFER_EXPIRED_COPY.title}</h2>
      <p>{BANK_TRANSFER_EXPIRED_COPY.body}</p>
    </div>
  );
}
