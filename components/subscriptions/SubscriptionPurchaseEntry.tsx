'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { routes } from '@/lib/routes';
import { parseSubscriptionOffers } from '@/lib/subscriptions/customer';
export function SubscriptionPurchaseEntry({ goodId }: { goodId: string }) {
  const [visible, setVisible] = useState<{ goodId: string; available: boolean } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/subscriptions/offers?goodId=${encodeURIComponent(goodId)}`, { cache: 'no-store', signal: controller.signal })
      .then(response => response.ok ? response.json() : null).then(value => {
        if (!controller.signal.aborted) setVisible({ goodId, available: Boolean(parseSubscriptionOffers(value?.offers)?.some(row => row.goodId === goodId)) });
      }).catch(() => undefined);
    return () => controller.abort();
  }, [goodId]);
  return visible?.goodId === goodId && visible.available ? <Link className="wc-btn wc-btn-outline" href={routes.subscriptionNew(goodId)}>정기배송 신청</Link> : null;
}
