import {
  ConsoleCountChips,
  ConsoleFilterPanel,
  ConsoleGrid,
  ConsolePagination,
  type ConsoleGridColumn,
  type ConsoleGridRow,
} from '@/components/admin/console';
import {
  ADMIN_CLAIM_REASON_OPTIONS,
  ADMIN_CLAIM_STAGE_OPTIONS,
  adminClaimBasePath,
  adminClaimDetailHref,
  adminClaimHref,
  type AdminClaimConsoleData,
} from '@/lib/admin/claims';
import {
  ORDER_CLAIM_REFUND_METHOD_LABELS,
  ORDER_CLAIM_STAGE_LABELS,
  ORDER_CLAIM_TYPE_LABELS,
  orderClaimReferenceLabel,
  orderClaimSlaState,
  type OrderClaimStage,
} from '@/lib/orders/claims';
import {
  formatOrderDateTime,
  ORDER_WITHDRAWAL_REASON_LABELS,
  orderReferenceLabel,
} from '@/lib/orders';
import { krw } from '@/lib/format';

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

const CHIP_TONES: Record<OrderClaimStage, 'default' | 'info' | 'success' | 'warning' | 'danger'> = {
  requested: 'warning',
  in_review: 'info',
  collecting: 'info',
  collected: 'warning',
  on_hold: 'danger',
  processing: 'info',
  needs_review: 'danger',
  completed: 'success',
  rejected: 'default',
};

const COLUMNS: ConsoleGridColumn[] = [
  { key: 'reference', label: '클레임번호', width: '104px' },
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
  now = new Date(),
}: {
  data: AdminClaimConsoleData;
  /** SLA 기준 시각. 테스트 주입용. */
  now?: Date;
}) {
  const { claimType, counts, filters, pageSize, rows, total } = data;
  const typeLabel = ORDER_CLAIM_TYPE_LABELS[claimType];

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
        <span key="reason">{ORDER_WITHDRAWAL_REASON_LABELS[row.reasonType]}</span>,
        <span key="stage">{ORDER_CLAIM_STAGE_LABELS[row.stage]}</span>,
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
    <section className="admin-console">
      <ConsoleFilterPanel
        action={adminClaimBasePath(claimType)}
        dateRange={{
          from: filters.from,
          label: '접수일',
          presetHref: (range) => adminClaimHref(claimType, filters, {
            from: range.from,
            page: 1,
            to: range.to,
          }),
          to: filters.to,
        }}
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
          placeholder: '주문번호 · 클레임번호 · 구매자',
          value: filters.query,
        }}
        statusFilter={{
          label: '클레임 상태',
          name: 'stage',
          options: ADMIN_CLAIM_STAGE_OPTIONS,
          value: filters.stage,
        }}
      >
        <div className="admin-console-filter-field">
          <label className="admin-console-filter-label" htmlFor="admin-claim-reason">사유</label>
          <select defaultValue={filters.reasonType} id="admin-claim-reason" name="reasonType">
            {ADMIN_CLAIM_REASON_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
      </ConsoleFilterPanel>

      <ConsoleCountChips
        chips={CHIP_STAGES.map((stage) => ({
          active: filters.stage === stage,
          count: counts[stage] ?? 0,
          href: adminClaimHref(claimType, filters, { page: 1, stage }),
          label: ORDER_CLAIM_STAGE_LABELS[stage],
          tone: CHIP_TONES[stage],
        }))}
        label="단계별 건수"
      />

      <ConsoleGrid
        caption={`${typeLabel} 클레임 목록`}
        columns={COLUMNS}
        emptyLabel={`조건에 맞는 ${typeLabel} 클레임이 없습니다.`}
        rows={rowsForGrid}
      />

      <ConsolePagination
        hrefForPage={(page) => adminClaimHref(claimType, filters, { page })}
        label={`${typeLabel} 클레임 목록 페이지`}
        page={filters.page}
        pageSize={pageSize}
        total={total}
      />

      <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
        환급 기한은 약관 제16조의 &ldquo;굿즈를 반환받은 날부터 3영업일&rdquo;입니다. 기산점은 입고
        확인 시점이며, 회수가 없는 취소 클레임에는 기산점이 없습니다. 클레임은 주문 단위 전액으로만
        처리되고, 한 주문의 일부만 환급하는 처리는 제공하지 않습니다.
      </p>
    </section>
  );
}
