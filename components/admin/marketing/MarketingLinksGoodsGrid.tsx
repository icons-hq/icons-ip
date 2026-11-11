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
  /* 선택 개수는 한 번만 보인다 — 일괄 변경 막대가 있으면 선택 해제·마케팅 링크도 그 막대의 같은 줄에 둔다. */
  const selectionActions = <>
    {selectedIds.length ? <Button type="button" onClick={() => setSelectedIds([])} size="sm" variant="ghost">선택 해제</Button> : null}
    <MarketingLinkIssuer source="good" targetIds={selectedIds} size="sm" /><small className="text-xs text-muted-foreground">한 번에 최대 100개</small>
  </>;
  return <ConsoleGrid {...props} selectable={canIssue} selectedIds={selectedIds} onSelectionChange={setSelectedIds}>
    {canIssue && bulkIdentity ? <GoodsBulkToolbar kind="goods" identity={bulkIdentity} selectedIds={selectedIds} onCompleted={() => router.refresh()} selectionActions={selectionActions} />
      : canIssue ? <div className="flex flex-wrap items-center gap-1.5 text-sm"><strong className="mr-1 text-sm font-semibold whitespace-nowrap tabular-nums">{selectedIds.length}개 선택</strong>{selectionActions}</div> : null}
  </ConsoleGrid>;
}
