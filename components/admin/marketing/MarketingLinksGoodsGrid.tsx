'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ConsoleGrid, type ConsoleGridProps } from '@/components/admin/console/ConsoleGrid';
import { MarketingLinkIssuer } from './MarketingLinkIssuer';
import { GoodsBulkToolbar } from '../GoodsBulkToolbar';
import type { GoodsGroupIdentity } from '@/lib/admin/goods-groups';
export function MarketingLinksGoodsGrid({ canIssue = false, bulkIdentity, ...props }: ConsoleGridProps & { canIssue?: boolean; bulkIdentity?: GoodsGroupIdentity }) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const router = useRouter();
  return <ConsoleGrid {...props} selectable={canIssue} selectedIds={selectedIds} onSelectionChange={setSelectedIds}>
    {canIssue && bulkIdentity ? <GoodsBulkToolbar kind="goods" identity={bulkIdentity} selectedIds={selectedIds} onCompleted={() => { setSelectedIds([]); router.refresh(); }} /> : null}
    {canIssue ? <div className="admin-marketing-links__selection"><span>{selectedIds.length}개 선택</span><MarketingLinkIssuer source="good" targetIds={selectedIds} /><small>한 번에 최대 100개</small></div> : null}
  </ConsoleGrid>;
}
