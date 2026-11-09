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
  type OrderClaimType,
} from '@/lib/orders/claims';
import { ADMIN_COUNT_CARD_GRID_CLASS, AdminCountCard, type AdminCountTone } from '@/components/admin/console/AdminCountCard';
import { statusTone } from '@/lib/admin/status-tone';
import { ClaimQueueKitTable, type ClaimKitRow } from './ClaimQueueKitTable';

/*
 * 취소·반품·교환 목록의 admin kit 화면(#252 · ADR-0028). 세 유형이 이 화면 하나를 쓰고, 데이터·URL 계약·
 * 처리 액션은 유형과 무관하게 같다. 유형마다 다른 것은 단계 칩(반품·교환의 수거 단계)·메뉴설명·아래 안내뿐이다.
 * 엑셀 다운로드만 기존 부품이다.
 *
 * "환불 수단" 칸은 결제수단(카드/무통장)이 아니라 refunds.method다. 결제수단은
 * private.payment_provider_evidence에만 있고 staff 읽기 표면이 없다(#250) — 없는 값을 지어내는 대신
 * 실제로 원장에 적힌 것을 보여준다.
 */

/* 목록에 뜨는 단계 칩. completed·rejected는 종료라 맨 뒤로 민다. 취소에는 회수가 없어 수거 단계가 없다. */
/* 단계 → 카드 색은 상태 표(status-tone)를 따른다. 완료·철회는 조용히 둔다. */
const CLAIM_STAGE_CARD_TONE = (stage: OrderClaimStage): AdminCountTone => {
  const tone = statusTone('claim', stage);
  return tone === 'warning' || tone === 'danger' ? tone : 'default';
};

const CHIP_STAGES: Record<OrderClaimType, OrderClaimStage[]> = {
  cancel: ['requested', 'in_review', 'on_hold', 'processing', 'needs_review', 'completed', 'rejected'],
  return: ['requested', 'in_review', 'collecting', 'collected', 'on_hold', 'processing', 'needs_review', 'completed', 'rejected'],
  exchange: ['requested', 'in_review', 'collecting', 'collected', 'on_hold', 'processing', 'needs_review', 'completed', 'rejected'],
};
/* 칩 수에 맞춘 열 수. 넓은 화면에서는 한 줄에 모든 단계가 선다. */

export function ClaimQueueKitScreen({
  canViewRefundTransfers = false,
  data,
  now = new Date(),
}: {
  canViewRefundTransfers?: boolean;
  data: AdminClaimConsoleData;
  /** SLA 기준 시각. 테스트 주입용. */
  now?: Date;
}) {
  const { claimType, counts, filters, pageSize, rows, total } = data;
  const typeLabel = ORDER_CLAIM_TYPE_LABELS[claimType];
  const currentHref = adminClaimHref(claimType, filters);
  const collects = claimType !== 'cancel';

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

  /* 셸이 화면 제목과 바깥 여백을 그린다. 판매관리 섹션 클래스(.admin-sales-console)를 쓰지 않아 그 요소 규칙이
     kit 부품을 덮지 않는다. */
  return (
    <div className="flex min-w-0 flex-col gap-4 text-sm text-foreground" data-admin-kit="claims" data-claim-type={claimType}>
      <details className="group rounded-xl border bg-card px-4 py-3">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-medium">
          {typeLabel} 요청과 처리상태를 확인할 수 있습니다.
          <span className="shrink-0 text-xs text-muted-foreground group-open:hidden">메뉴설명 보기</span>
          <span className="hidden shrink-0 text-xs text-muted-foreground group-open:inline">메뉴설명 접기</span>
        </summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
          {collects ? <li>별도 배송비 청구는 <Link className="underline underline-offset-4" href="/admin/sales/claims/returns/fee-policy">반품·교환 배송비 정책</Link>을 설정한 뒤 각 요청 상세에서 처리합니다. <Link className="underline underline-offset-4" href="/admin/sales/claims/returns/fees">배송비 입금·반환 대기 목록</Link></li> : null}
          {canViewRefundTransfers && claimType !== 'exchange' ? <li>실제 송금이 남은 무통장 환불은 <a className="underline underline-offset-4" href={REFUND_TRANSFERS_PATH}>환불 송금 대기</a>에서 확인합니다.</li> : null}
          <li>요청번호를 누르면 목록 위에 상세가 열리고 그 자리에서 {typeLabel} 처리를 진행합니다.{collects ? ' 회수·결제사 확인이 필요한 단계는 해당 근거를 확인해야 완료할 수 있습니다.' : ''}</li>
          <li>여러 건을 선택하면 아래에 처리 막대가 뜨고 승인·검토중·거부를 한 번에 처리합니다(최대 50건). 결제사 취소가 겹치지 않게 한 건씩 순서대로 처리하고, 건별 결과를 표로 보여 줍니다.{collects ? ' 회수 확인·재출고·환불 확정과 반품·교환 전환은 상세에서 한 건씩 처리합니다.' : ''}</li>
          <li>수취인명과 번호는 입력한 내용이 포함된 요청을 찾습니다. 상품주문번호는 주문 품목, 상품번호는 등록 상품의 식별값입니다. 품목으로 찾아도 처리와 엑셀은 요청 주문 전체를 대상으로 합니다.</li>
        </ul>
      </details>
      <nav aria-label="단계별 건수" className={ADMIN_COUNT_CARD_GRID_CLASS}>
        {CHIP_STAGES[claimType].map((stage) => {
          const count = counts[stage] ?? 0;
          const active = filters.stage === stage;
          return <AdminCountCard active={active} count={count} href={adminClaimHref(claimType, filters, { page: 1, stage })} key={stage} label={adminClaimStageLabel(claimType, stage)} tone={CLAIM_STAGE_CARD_TONE(stage)} />;
        })}
      </nav>
      {/* 건수·검색·표를 판매관리 목록과 같은 카드 한 구역으로 묶는다. */}
      <div className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground" data-sales-results="">
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
      </div>
      {collects ? <p className="text-muted-foreground">
        환급 기한은 약관 제16조의 &ldquo;굿즈를 반환받은 날부터 3영업일&rdquo;입니다. 기산점은 입고
        확인 시점이며, 회수가 없는 취소 요청에는 기산점이 없습니다. {typeLabel} 요청은 주문 단위 전액으로만
        처리되고, 한 주문의 일부만 환급하는 처리는 제공하지 않습니다.
      </p> : <p className="text-muted-foreground">
        {typeLabel} 요청은 주문 단위 전액으로만 처리되고, 한 주문의 일부만 환급하는 처리는 제공하지 않습니다.
      </p>}
    </div>
  );
}
