import Link from 'next/link';
import { ADMIN_VOCABULARY as V, adminGoodsCopy } from '@/lib/admin/vocabulary';
import {
  ConsoleGrid,
  ConsolePagination,
  type ConsoleGridColumn,
  type ConsoleGridRow,
} from '@/components/admin/console';
import {
  ADMIN_CLAIM_REASON_OPTIONS,
  ADMIN_CLAIM_DATE_FIELDS,
  ADMIN_CLAIM_SEARCH_FIELDS,
  adminClaimStageLabel,
  adminClaimStageOptions,
  adminClaimDetailHref,
  adminClaimHref,
  adminClaimReasonText,
  type AdminClaimConsoleData,
} from '@/lib/admin/claims';
import {
  ORDER_CLAIM_REFUND_METHOD_LABELS,
  ORDER_CLAIM_TYPE_LABELS,
  orderClaimReferenceLabel,
  orderClaimSlaState,
  type OrderClaimStage,
} from '@/lib/orders/claims';
import { formatOrderDateTime, orderReferenceLabel } from '@/lib/orders';
import { krw } from '@/lib/format';
import { adminListExportClaimScreenId, adminListExportHref } from '@/lib/admin/list-export';
import { AdminListExportButton } from '@/components/admin/AdminListExportButton';
import { SalesFilterField, SalesFilterPanel, SalesGuide, SalesResultsHeader, SalesSelect, SalesStatusSummary } from '@/components/admin/sales/SalesConsole';
import { REFUND_TRANSFERS_PATH } from '@/lib/admin/refund-transfers';

/* 어드민 클레임 콘솔 목록(#252) — 취소·반품·교환 3화면이 이 컴포넌트를 공유한다.
 *
 * 정렬은 서버가 접수 최신순으로 고정한다. 이 큐에서 순서를 정하는 것은 취향이
 * 아니라 SLA이고, SLA 칸이 그 순서를 눈으로 확인해 준다.
 *
 * "환불 수단" 칸은 결제수단(카드/무통장)이 아니라 refunds.method다. 결제수단은
 * private.payment_provider_evidence에만 있고 staff 읽기 표면이 없다(#250) —
 * 없는 값을 지어내는 대신 실제로 원장에 적힌 것을 보여준다. */

/* 목록에 뜨는 단계 칩. completed·rejected는 종료라 맨 뒤로 민다. */
const CHIP_STAGES: OrderClaimStage[] = [
  'requested',
  'in_review',
  'collecting',
  'collected',
  'on_hold',
  'processing',
  'needs_review',
  'completed',
  'rejected',
];

const COLUMNS: ConsoleGridColumn[] = [
  { key: 'reference', label: V.claimNumber, width: '104px' },
  { key: 'order', label: '주문번호', width: '104px' },
  { key: 'type', label: '유형', width: '70px' },
  { key: 'reason', label: '사유', width: '110px' },
  { key: 'stage', label: '상태', width: '96px' },
  { key: 'buyer', label: '구매자' },
  { key: 'requested', label: '접수일', width: '150px' },
  { key: 'sla', label: '환급 기한', align: 'end', width: '116px' },
  { key: 'refund', label: '환불 수단', width: '110px' },
  { key: 'handler', label: '처리자', width: '104px' },
];

export function ClaimQueueScreen({
  data,
  canViewRefundTransfers = false,
  now = new Date(),
}: {
  data: AdminClaimConsoleData;
  canViewRefundTransfers?: boolean;
  /** SLA 기준 시각. 테스트 주입용. */
  now?: Date;
}) {
  const { claimType, counts, filters, pageSize, rows, total } = data;
  const typeLabel = ORDER_CLAIM_TYPE_LABELS[claimType];
  const currentHref = adminClaimHref(claimType, filters);

  const rowsForGrid: ConsoleGridRow[] = rows.map((row) => {
    const sla = orderClaimSlaState(
      {
        claimType: row.claimType,
        stage: row.stage,
        collectedAt: row.collectedAt,
        completedAt: row.completedAt,
      },
      now,
    );

    return {
      id: row.id,
      href: adminClaimDetailHref(claimType, row.id, filters),
      cells: [
        <span className="mono" key="reference">{orderClaimReferenceLabel(row.reference)}</span>,
        <span className="mono" key="order">{orderReferenceLabel(row.orderId)}</span>,
        <span key="type">{ORDER_CLAIM_TYPE_LABELS[row.claimType]}</span>,
        <span key="reason">{adminGoodsCopy(adminClaimReasonText(row.reasonType, row.staffReasonCode))}</span>,
        <span key="stage">{adminClaimStageLabel(claimType, row.stage)}</span>,
        <span key="buyer">
          @{row.buyerName}
          <br />
          <span className="muted">{krw(row.orderTotal)}</span>
        </span>,
        <time dateTime={row.requestedAt} key="requested">
          {formatOrderDateTime(row.requestedAt)}
        </time>,
        /* SLA는 운영자가 가장 먼저 보는 값이라 톤을 데이터 속성으로 남겨 CSS가 강조한다. */
        <span data-sla-tone={sla.tone} key="sla">{sla.label}</span>,
        row.refundMethod
          ? <span key="refund">{ORDER_CLAIM_REFUND_METHOD_LABELS[row.refundMethod]}</span>
          : <span className="muted" key="refund">미접수</span>,
        row.handlerName
          ? <span key="handler">@{row.handlerName}</span>
          : <span className="muted" key="handler">미배정</span>,
      ],
    };
  });

  return (
    <section className="admin-console admin-sales-console">
      <SalesGuide title={`${typeLabel} 요청과 처리상태를 확인할 수 있습니다.`}>
        {claimType !== 'cancel' ? <p>별도 배송비 청구는 <Link href="/admin/sales/claims/returns/fee-policy">반품·교환 배송비 정책</Link>을 설정한 뒤 각 요청 상세에서 처리합니다.</p> : null}
        {claimType !== 'cancel' ? <p><Link href="/admin/sales/claims/returns/fees">배송비 입금·반환 대기 목록</Link></p> : null}
        {canViewRefundTransfers && claimType !== 'exchange' ? <p>실제 송금이 남은 무통장 환불은 <a href={REFUND_TRANSFERS_PATH}>환불 송금 대기</a>에서 확인합니다.</p> : null}
        <p>주문번호와 요청 내용을 확인한 뒤 상세 화면에서 {typeLabel} 처리를 진행합니다. 회수·결제사 확인이 필요한 단계는 해당 근거를 확인해야 완료할 수 있습니다.</p>
        <p>수취인명과 번호는 입력한 내용이 포함된 요청을 찾습니다. 상품주문번호는 주문 품목, 상품번호는 등록 상품의 식별값입니다. 품목으로 찾아도 처리와 엑셀은 요청 주문 전체를 대상으로 합니다.</p>
      </SalesGuide>
      <SalesStatusSummary label="단계별 건수" items={CHIP_STAGES
        .filter(stage => claimType !== 'cancel' || !['collecting', 'collected'].includes(stage))
        .map(stage => ({ active: filters.stage === stage, count: counts[stage] ?? 0,
          href: adminClaimHref(claimType, filters, { page: 1, stage }), label: adminClaimStageLabel(claimType, stage),
          urgent: stage === 'needs_review' && (counts[stage] ?? 0) > 0 }))} />
      <SalesFilterPanel
        currentHref={currentHref}
        id={`sales-claim-${claimType}`}
        date={{ from: filters.from, to: filters.to, field: filters.dateField ?? 'requested', options: ADMIN_CLAIM_DATE_FIELDS }}
        now={now}
        resetHref={adminClaimHref(claimType, {
          from: null,
          page: 1,
          query: '',
          reasonType: 'all',
          stage: 'open',
          to: null,
        })}
        search={{
          placeholder: `주문번호 · ${V.claimNumber} · 구매자 · 수취인 · 상품번호`,
          value: filters.query,
          field: filters.field ?? 'all',
          options: ADMIN_CLAIM_SEARCH_FIELDS,
        }}
      >
        <SalesFilterField label={`${typeLabel}처리상태`} htmlFor="sales-claim-stage">
          <SalesSelect id="sales-claim-stage" name="stage" value={filters.stage} options={adminClaimStageOptions(claimType)} />
        </SalesFilterField>
        <SalesFilterField label={`${typeLabel}사유`} htmlFor="sales-claim-reason">
          <SalesSelect id="sales-claim-reason" name="reasonType" value={filters.reasonType} options={ADMIN_CLAIM_REASON_OPTIONS} />
        </SalesFilterField>
      </SalesFilterPanel>
      <div className="admin-sales-results">
      <SalesResultsHeader currentHref={currentHref} total={total} pageSize={pageSize} sort={filters.sort ?? 'newest'}>
      <AdminListExportButton
        href={adminListExportHref(adminListExportClaimScreenId(claimType), currentHref)}
        total={total}
      />
      </SalesResultsHeader>

      <ConsoleGrid
        caption={`${typeLabel} 요청 목록`}
        preferencesKey={`sales-claims-${claimType}`}
        columns={COLUMNS}
        emptyLabel={`조건에 맞는 ${typeLabel} 요청이 없습니다.`}
        rows={rowsForGrid}
      />

      <ConsolePagination
        hrefForPage={(page) => adminClaimHref(claimType, filters, { page })}
        label={`${typeLabel} 요청 목록 페이지`}
        page={filters.page}
        pageSize={pageSize}
        total={total}
      />
      </div>
      <p className="admin-sales-note">
        환급 기한은 약관 제16조의 &ldquo;굿즈를 반환받은 날부터 3영업일&rdquo;입니다. 기산점은 입고
        확인 시점이며, 회수가 없는 취소 요청에는 기산점이 없습니다. {V.claimRequest}은 주문 단위 전액으로만
        처리되고, 한 주문의 일부만 환급하는 처리는 제공하지 않습니다.
      </p>
    </section>
  );
}
