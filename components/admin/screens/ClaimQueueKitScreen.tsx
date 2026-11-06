import { AdminListExportButton } from '@/components/admin/AdminListExportButton';
import Link from 'next/link';
import { adminClaimBulkSelectable } from '@/lib/admin/claim-bulk';
import {
  ADMIN_CLAIM_DATE_FIELDS,
  ADMIN_CLAIM_SEARCH_FIELDS,
  adminClaimHref,
  adminClaimPreviewHref,
  adminClaimReasonText,
  adminClaimStageLabel,
  type AdminClaimConsoleData,
} from '@/lib/admin/claims';
import { adminListExportClaimScreenId, adminListExportHref } from '@/lib/admin/list-export';
import { REFUND_TRANSFERS_PATH } from '@/lib/admin/refund-transfers';
import { adminGoodsCopy } from '@/lib/admin/vocabulary';
import { krw } from '@/lib/format';
import { formatOrderDateTime, orderReferenceLabel } from '@/lib/orders';
import {
  ORDER_CLAIM_REFUND_METHOD_LABELS,
  ORDER_CLAIM_TYPE_LABELS,
  orderClaimReferenceLabel,
  orderClaimSlaState,
  type OrderClaimStage,
} from '@/lib/orders/claims';
import { ClaimQueueKitTable, type ClaimKitRow } from './ClaimQueueKitTable';

/*
 * 취소관리 목록의 admin kit 화면(ADR-0028). 데이터·URL 계약·처리 액션은 ClaimQueueScreen과 같고,
 * 화면 전체를 kit 부품과 템플릿 룩(ADR-0028)으로 그린다. 엑셀 다운로드만 기존 부품이다.
 */

const CHIP_STAGES: OrderClaimStage[] = ['requested', 'in_review', 'on_hold', 'processing', 'needs_review', 'completed', 'rejected'];

export function ClaimQueueKitScreen({
  canViewRefundTransfers = false,
  data,
  now = new Date(),
}: {
  canViewRefundTransfers?: boolean;
  data: AdminClaimConsoleData;
  now?: Date;
}) {
  const { claimType, counts, filters, pageSize, rows, total } = data;
  const typeLabel = ORDER_CLAIM_TYPE_LABELS[claimType];
  const currentHref = adminClaimHref(claimType, filters);

  const kitRows: ClaimKitRow[] = rows.map((row) => {
    const sla = orderClaimSlaState({ claimType: row.claimType, stage: row.stage, collectedAt: row.collectedAt, completedAt: row.completedAt }, now);
    return {
      id: row.id,
      selectable: adminClaimBulkSelectable(claimType, row.stage),
      reference: orderClaimReferenceLabel(row.reference),
      previewHref: adminClaimPreviewHref(claimType, row.id, filters),
      order: orderReferenceLabel(row.orderId, row.orderNumber),
      type: ORDER_CLAIM_TYPE_LABELS[row.claimType],
      reason: adminGoodsCopy(adminClaimReasonText(row.reasonType, row.staffReasonCode)),
      stage: adminClaimStageLabel(claimType, row.stage),
      buyer: row.buyerName,
      amount: row.orderTotal,
      amountLabel: krw(row.orderTotal),
      requestedAt: row.requestedAt,
      requestedLabel: formatOrderDateTime(row.requestedAt),
      slaLabel: sla.label,
      slaTone: sla.tone,
      refund: row.refundMethod ? ORDER_CLAIM_REFUND_METHOD_LABELS[row.refundMethod] : null,
      handler: row.handlerName,
    };
  });

  /* 화면 전체가 kit 섬(.admin-kit-island)이다. 판매관리 섹션 클래스(.admin-sales-console)를 쓰지 않아
     그 요소 규칙(input·button …)이 kit 부품을 덮지 않는다. 엑셀 다운로드만 기존 부품이다. */
  return (
    <div className="admin-kit-island flex flex-col gap-4 rounded-xl border bg-background p-4 text-sm text-foreground" data-admin-kit="claims">
      <details className="group rounded-lg border bg-muted/40 px-4 py-3" open>
        <summary className="flex cursor-pointer list-none items-center justify-between font-medium">
          {typeLabel} 요청과 처리상태를 확인할 수 있습니다.
          <span className="text-xs text-muted-foreground group-open:hidden">메뉴설명 보기</span>
          <span className="hidden text-xs text-muted-foreground group-open:inline">메뉴설명 접기</span>
        </summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
          {canViewRefundTransfers ? <li>실제 송금이 남은 무통장 환불은 <a className="underline underline-offset-4" href={REFUND_TRANSFERS_PATH}>환불 송금 대기</a>에서 확인합니다.</li> : null}
          <li>요청번호를 누르면 목록 위에 상세가 열리고 그 자리에서 {typeLabel} 처리를 진행합니다.</li>
          <li>여러 건을 선택하면 아래에 처리 막대가 뜨고 승인·검토중·거부를 한 번에 처리합니다(최대 50건). 결제사 취소가 겹치지 않게 한 건씩 순서대로 처리하고, 건별 결과를 표로 보여 줍니다.</li>
        </ul>
      </details>
      <nav aria-label="단계별 건수" className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
        {CHIP_STAGES.map((stage) => {
          const count = counts[stage] ?? 0;
          const active = filters.stage === stage;
          const urgent = stage === 'needs_review' && count > 0;
          return <Link
            aria-current={active ? 'true' : undefined}
            aria-label={`${adminClaimStageLabel(claimType, stage)} ${count}건`}
            className="flex flex-col gap-1 rounded-lg border bg-card px-3 py-2.5 transition-colors hover:bg-accent aria-[current=true]:border-primary aria-[current=true]:ring-1 aria-[current=true]:ring-primary"
            href={adminClaimHref(claimType, filters, { page: 1, stage })}
            key={stage}
          >
            <span className="text-xs text-muted-foreground">{adminClaimStageLabel(claimType, stage)}</span>
            <span className={`text-xl font-semibold tabular-nums${urgent ? ' text-destructive' : ''}`}>{count.toLocaleString('ko-KR')}<span className="ml-0.5 text-xs font-normal text-muted-foreground">건</span></span>
          </Link>;
        })}
      </nav>
      <div className="flex items-center justify-between gap-2">
        <p className="shrink-0 whitespace-nowrap">총 <strong className="tabular-nums">{total.toLocaleString('ko-KR')}</strong>건</p>
        <AdminListExportButton href={adminListExportHref(adminListExportClaimScreenId(claimType), currentHref)} total={total} />
      </div>
      <ClaimQueueKitTable
        claimType={claimType}
        dateFieldOptions={ADMIN_CLAIM_DATE_FIELDS}
        filters={filters}
        key={claimType}
        pageSize={pageSize}
        rows={kitRows}
        searchFieldOptions={ADMIN_CLAIM_SEARCH_FIELDS}
        total={total}
      />
      <p className="text-muted-foreground">
        {typeLabel} 요청은 주문 단위 전액으로만 처리되고, 한 주문의 일부만 환급하는 처리는 제공하지 않습니다.
      </p>
    </div>
  );
}
