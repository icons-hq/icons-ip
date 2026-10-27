'use client';

import { useRouter } from 'next/navigation';
import type { GoodsGroupIdentity } from '@/lib/admin/goods-groups';
import { GoodsBulkToolbar } from './GoodsBulkToolbar';

/* IP 필터가 걸린 상품 목록에서 그 IP의 전체 상품(100개 초과 포함)에 즉시할인을 한 번에 건다(A10). */
export function GoodsIpBulkDiscount({ ipId, ipTitle, identity }: { ipId: string; ipTitle: string; identity: GoodsGroupIdentity }) {
  const router = useRouter();
  return <GoodsBulkToolbar kind="ip" selectedIds={[ipId]} ipTitle={ipTitle} identity={identity} onCompleted={() => router.refresh()} />;
}
