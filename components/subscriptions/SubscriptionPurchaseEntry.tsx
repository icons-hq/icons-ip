'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { routes } from '@/lib/routes';
import { parseSubscriptionOffers } from '@/lib/subscriptions/customer';

/**
 * 이 굿즈에 정기배송 신청을 열지 — 응답 전·실패는 false.
 * 구매 패널이 다시 마운트돼도 같은 질문을 반복하지 않도록 굿즈 상세가 한 번 부르고 결과를 내려 준다.
 */
export function useSubscriptionPurchaseAvailable(goodId: string, enabled = true): boolean {
  const [visible, setVisible] = useState<{ goodId: string; available: boolean } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void fetch(`/api/subscriptions/offers?goodId=${encodeURIComponent(goodId)}`, { cache: 'no-store', signal: controller.signal })
      .then(response => response.ok ? response.json() : null).then(value => {
        if (!controller.signal.aborted) setVisible({ goodId, available: Boolean(parseSubscriptionOffers(value?.offers)?.some(row => row.goodId === goodId)) });
      }).catch(() => undefined);
    return () => controller.abort();
  }, [enabled, goodId]);
  return visible?.goodId === goodId && visible.available;
}

/** `available`을 받으면 그 값으로만 그리고, 없으면 스스로 묻는다. */
export function SubscriptionPurchaseEntry({ available, goodId }: { available?: boolean; goodId: string }) {
  const fetched = useSubscriptionPurchaseAvailable(goodId, available === undefined);
  return (available ?? fetched) ? <Link className="wc-btn wc-btn-outline" href={routes.subscriptionNew(goodId)}>정기배송 신청</Link> : null;
}
