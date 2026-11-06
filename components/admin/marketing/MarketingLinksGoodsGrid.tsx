'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ConsoleGrid, type ConsoleGridProps } from '@/components/admin/console/ConsoleGrid';
import { MarketingLinkIssuer } from './MarketingLinkIssuer';
import { GoodsBulkToolbar } from '../GoodsBulkToolbar';
import { Button } from '@/components/admin/kit/ui/button';
import type { GoodsGroupIdentity } from '@/lib/admin/goods-groups';
/**
 * 상품 목록의 선택·일괄 변경·마케팅 링크. 일괄 변경을 확정해도 선택을 유지한다(R11) — 이어서 다른 변경을 하거나
 * '선택 해제'로 비운다. 새로 읽은 목록에서 사라진 상품(보관 등으로 필터 밖)은 선택에서 뺀다.
 */
export function MarketingLinksGoodsGrid({ canIssue = false, bulkIdentity, ...props }: ConsoleGridProps & { canIssue?: boolean; bulkIdentity?: GoodsGroupIdentity }) {
  const [rawSelectedIds, setSelectedIds] = useState<string[]>([]);
  const router = useRouter();
  const visible = new Set(props.rows.map(row => row.id));
  const selectedIds = rawSelectedIds.filter(id => visible.has(id));
  return <ConsoleGrid {...props} selectable={canIssue} selectedIds={selectedIds} onSelectionChange={setSelectedIds}>
    {canIssue && bulkIdentity ? <GoodsBulkToolbar kind="goods" identity={bulkIdentity} selectedIds={selectedIds} onCompleted={() => router.refresh()} /> : null}
    {canIssue ? <div className="flex flex-wrap items-center gap-3 border-b px-3 py-2.5 text-sm"><span className="tabular-nums">{selectedIds.length}개 선택</span>
      {selectedIds.length ? <Button type="button" onClick={() => setSelectedIds([])} size="sm" variant="ghost">선택 해제</Button> : null}
      <MarketingLinkIssuer source="good" targetIds={selectedIds} /><small className="text-xs text-muted-foreground">한 번에 최대 100개</small></div> : null}
  </ConsoleGrid>;
}
