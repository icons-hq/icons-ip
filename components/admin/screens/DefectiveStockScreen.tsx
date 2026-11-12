import Link from 'next/link';
import { AdminNotice, AdminPageHeader, AdminSectionCard, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/admin/kit/ui/table';
import { adminClaimDetailHref } from '@/lib/admin/claims';
import type { DefectiveStockList } from '@/lib/admin/defective-stock';
import { orderClaimReferenceLabel } from '@/lib/orders/claims';
import { formatOrderDateTime } from '@/lib/orders';

const count = (value: number) => value.toLocaleString('ko-KR');
const optionLabel = (name: string, code: string) => `${name}${code ? ` (${code})` : ''}`;

/**
 * 불량 재고(QNA-035). 반품 환불을 확정할 때 '불량'으로 고른 품목의 옵션별 수량과 근거 반품 요청이다.
 * 판매 재고(재고수량)에는 들어 있지 않고 이 목록으로만 센다. 불량품의 이후 처리(폐기·반송 등)와 ERP 불량 재고 대조는
 * 이 화면에서 하지 않는다 — 수량 기록까지만 한다.
 */
export function DefectiveStockScreen({ list }: { list: DefectiveStockList }) {
  const total = list.variants.reduce((sum, row) => sum + row.qty, 0);
  return <div className="flex min-w-0 flex-col gap-4" data-admin-screen="defective-stock">
    <AdminPageHeader title="불량 재고" description="반품 환불을 확정할 때 불량으로 고른 품목의 옵션별 수량입니다. 판매 재고에는 들어 있지 않습니다." />
    {list.pending.length > 0 ? <AdminNotice role="status" title="불량 기록 필요" tone="warning">
      {list.pending.map((row, index) => <span key={row.claimId}>{index > 0 ? ' · ' : ''}<Link className="underline underline-offset-4" href={adminClaimDetailHref('return', row.claimId)}>반품 {orderClaimReferenceLabel(row.claimReference)}</Link> {count(row.qty)}개</span>)}
      {' '}— 환불(재고)은 확정됐지만 불량 기록이 끝나지 않았습니다. 반품 처리 권한이 있는 담당자가 반품 상세에서 [불량 기록 다시 시도]를 눌러야 합니다.
    </AdminNotice> : null}
    <AdminSectionCard id="defective-stock-variants" title="옵션별 불량 수량" summary={`옵션 ${count(list.variants.length)}개 · 합계 ${count(total)}개`}>
      {list.variants.length === 0 ? <p className="text-muted-foreground">아직 기록된 불량 재고가 없습니다. 반품 환불을 확정할 때 품목을 불량으로 고르면 여기에 쌓입니다.</p>
        : <div className="min-w-0 overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[640px] text-sm" data-slot="table">
            <caption className="sr-only">옵션별 불량 수량</caption>
            <TableHeader><TableRow>
              <TableHead scope="col">상품</TableHead><TableHead scope="col">옵션</TableHead>
              <TableHead className="text-right" scope="col">불량 수량</TableHead><TableHead className="text-right" scope="col">기록</TableHead>
              <TableHead scope="col">마지막 기록</TableHead>
            </TableRow></TableHeader>
            <TableBody>{list.variants.map((row) => <TableRow key={row.variantId}>
              <TableCell className="whitespace-normal wrap-anywhere">{row.goodName}</TableCell>
              <TableCell className="whitespace-normal wrap-anywhere">{optionLabel(row.variantName, row.variantCode)}</TableCell>
              <TableCell className="text-right tabular-nums"><AdminStatusBadge tone="warning">{count(row.qty)}개</AdminStatusBadge></TableCell>
              <TableCell className="text-right tabular-nums">{count(row.entries)}건</TableCell>
              <TableCell className="whitespace-nowrap tabular-nums">{row.lastRecordedAt ? formatOrderDateTime(row.lastRecordedAt) : '-'}</TableCell>
            </TableRow>)}</TableBody>
          </table>
        </div>}
    </AdminSectionCard>
    <AdminSectionCard id="defective-stock-entries" title="최근 기록" summary="근거 반품 요청과 기록한 담당자입니다.">
      {list.entries.length === 0 ? <p className="text-muted-foreground">기록이 없습니다.</p>
        : <div className="min-w-0 overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[760px] text-sm" data-slot="table">
            <caption className="sr-only">불량 재고 최근 기록</caption>
            <TableHeader><TableRow>
              <TableHead scope="col">기록 시각</TableHead><TableHead scope="col">상품·옵션</TableHead>
              <TableHead className="text-right" scope="col">수량</TableHead><TableHead scope="col">근거 반품 요청</TableHead><TableHead scope="col">처리자</TableHead>
            </TableRow></TableHeader>
            <TableBody>{list.entries.map((row) => <TableRow key={row.id}>
              <TableCell className="whitespace-nowrap tabular-nums">{formatOrderDateTime(row.recordedAt)}</TableCell>
              <TableCell className="whitespace-normal wrap-anywhere">{row.goodName} · {optionLabel(row.variantName, row.variantCode)}</TableCell>
              <TableCell className="text-right tabular-nums">{count(row.qty)}개</TableCell>
              <TableCell><Link className="underline underline-offset-4" href={adminClaimDetailHref('return', row.claimId)}>{orderClaimReferenceLabel(row.claimReference)}</Link></TableCell>
              <TableCell>{row.recordedByName || '-'}</TableCell>
            </TableRow>)}</TableBody>
          </table>
        </div>}
    </AdminSectionCard>
  </div>;
}
