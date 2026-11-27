import Link from 'next/link';
import {
  ConsoleGrid,
  ConsolePagination,
  type ConsoleGridColumn,
  type ConsoleGridRow,
} from '@/components/admin/console';
import {
  adminDefectClaimLabel,
  adminDefectClaimWindow,
  adminSettledHref,
  type AdminSettledAutoConfirmation,
  type AdminSettledConsoleData,
} from '@/lib/admin/settled';
import { adminOrderDetailHrefFromBack } from '@/lib/admin/orders';
import { adminOrderPreviewHref } from '@/lib/admin/order-preview';
import { OrderPreviewLink, OrderPreviewNewTabLink } from './OrderPreview';
import { formatOrderDateTime, orderReferenceLabel } from '@/lib/orders';
import { ADMIN_VOCABULARY } from '@/lib/admin/vocabulary';
import { PURCHASE_CONFIRMATION_POLICY_PATH } from '@/lib/purchase-confirmation';
import { AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { SettledExportForm } from './SettledExportForm';
import { SALES_DATE_FIELDS, SALES_ORDER_SEARCH_FIELDS } from '@/lib/admin/sales-list';
import { SalesFilterPanel, SalesGuide, SalesResultsHeader } from '@/components/admin/sales/SalesConsole';

const COLUMNS: ConsoleGridColumn[] = [
  { key: 'reference', label: '주문번호', width: '190px' },
  { key: 'buyer', label: '구매자', width: '180px' },
  { key: 'deliveredAt', label: '배송완료일', width: '160px' },
  { key: 'doneAt', label: '거래확정일', width: '160px' },
  { key: 'claim', label: '하자 반품·교환 기한', minWidth: '140px' },
  { key: 'total', label: '결제금액', align: 'end', width: '110px' },
];
/* 남은 기한이 이 날수 이하인 건만 색을 입힌다 — 전 행이 같은 색이면 볼 필요 적은 정보가 화면에서 제일 튄다. */
const DEFECT_CLAIM_IMMINENT_DAYS = 7;

/**
 * 지금 자동 거래확정이 켜져 있는지 보이고 정책 화면으로 간다(자동 발주확인 상태 버튼과 같은 모양).
 * 안내문이 "기본 꺼짐"이라고 말하는 대신 실제 상태를 읽어 보인다.
 */
function AutoConfirmationStatus({ value }: { value: AdminSettledAutoConfirmation }) {
  const state = value ? value.enabled ? 'on' : 'off' : 'unknown';
  return <Link className={`${buttonVariants({ variant: 'outline' })} shrink-0`} data-slot="button" data-settled-auto={state} href={PURCHASE_CONFIRMATION_POLICY_PATH}>
    {`자동 ${ADMIN_VOCABULARY.settled}`}
    <AdminStatusBadge tone={state === 'on' ? 'success' : state === 'off' ? 'neutral' : 'danger'}>{state === 'on' ? '켜짐' : state === 'off' ? '꺼짐' : '불러오지 못함'}</AdminStatusBadge>
    <span className="text-xs font-normal text-muted-foreground">{value?.enabled && value.afterDays ? `배송완료 ${value.afterDays.toLocaleString('ko-KR')}일 뒤 · 설정` : '설정'}</span>
  </Link>;
}

/** 거래확정된 주문과, 배송완료일 기준으로 따로 남는 하자 반품·교환 기한을 조회한다. */
export function SettledScreen({
  data,
  exportRequestId,
  exportReceiptId,
  autoConfirmation,
  now = new Date(),
}: {
  data: AdminSettledConsoleData;
  exportRequestId?: string;
  exportReceiptId?: string;
  /** 자동 거래확정 상태. 주지 않으면 상태 버튼을 그리지 않고, `null`이면 읽지 못했다고 보인다. */
  autoConfirmation?: AdminSettledAutoConfirmation;
  /** 잔여 기한 기준 시각. 테스트 주입용. */
  now?: Date;
}) {
  const { filters, pageSize, rows, total } = data;
  const currentHref = adminSettledHref(filters);

  const rowsForGrid: ConsoleGridRow[] = rows.map((row) => {
    const claim = adminDefectClaimWindow(row.deliveredAt, now);

    return {
      id: row.id,
      cells: [
        /* S36-075: 주문번호는 같은 목록 위 상세 팝업을 연다(닫으면 목록·스크롤 그대로). 새 탭 열기는 옆 보조 링크다. */
        <span className="inline-flex items-center gap-1" key="reference">
          <OrderPreviewLink href={adminOrderPreviewHref(currentHref, row.id)} label={`주문 ${orderReferenceLabel(row.id, row.orderNumber)} 상세 팝업 열기`}>
            <span className="tabular-nums">{orderReferenceLabel(row.id, row.orderNumber)}</span>
          </OrderPreviewLink>
          <OrderPreviewNewTabLink href={adminOrderDetailHrefFromBack(row.id, adminSettledHref(filters))} label={`주문 ${orderReferenceLabel(row.id, row.orderNumber)} 상세 열기 (새 탭)`} />
        </span>,
        <span className="block max-w-39 truncate" key="buyer" title={row.buyerName}>{row.buyerName}</span>,
        row.deliveredAt
          ? (
            <time className="tabular-nums" dateTime={row.deliveredAt} key="deliveredAt">
              {formatOrderDateTime(row.deliveredAt)}
            </time>
          )
          : <span className="text-muted-foreground" key="deliveredAt">없음</span>,
        row.doneAt
          ? <time className="tabular-nums" dateTime={row.doneAt} key="doneAt">{formatOrderDateTime(row.doneAt)}</time>
          : <span className="text-muted-foreground" key="doneAt">없음</span>,
        claim.daysRemaining === null || (claim.open && claim.daysRemaining <= DEFECT_CLAIM_IMMINENT_DAYS)
          ? <AdminStatusBadge data-claim-open={claim.open ? 'true' : 'false'} key="claim" tone="warning">{adminDefectClaimLabel(claim)}</AdminStatusBadge>
          : <span className="text-muted-foreground tabular-nums" data-claim-open={claim.open ? 'true' : 'false'} key="claim">{adminDefectClaimLabel(claim)}</span>,
        <span className="tabular-nums" key="total">₩{row.total.toLocaleString('ko-KR')}</span>,
      ],
    };
  });

  return (
    <section className="flex min-w-0 flex-col gap-4 text-sm" data-admin-settled="">
      {/* 자동 거래확정이 켜져 있는지는 안내문이 아니라 상태 버튼이 말한다. 누르면 정책 화면이다. */}
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1 basis-72">
          <SalesGuide title="거래확정된 주문을 조회하고 엑셀로 받습니다.">
            <p><span className="font-medium text-foreground underline decoration-dotted underline-offset-4" data-admin-tooltip={ADMIN_VOCABULARY.settledHint} title={ADMIN_VOCABULARY.settledHint} tabIndex={0}>{ADMIN_VOCABULARY.settled}</span> 뒤에도 반품·교환은 배송완료일과 사유별 신청 기한 안에 받습니다. 엑셀에는 결제사가 판매대금을 지급한 내역이 없습니다.</p>
          </SalesGuide>
        </div>
        {autoConfirmation !== undefined ? <AutoConfirmationStatus value={autoConfirmation} /> : null}
      </div>
      <SalesFilterPanel
        currentHref={currentHref}
        id="sales-settled"
        date={{ from: filters.from, to: filters.to, field: filters.dateField ?? 'ordered', options: SALES_DATE_FIELDS }}
        now={now}
        search={{
          placeholder: '주문번호 · 구매자 · 수령인 · 운송장',
          value: filters.query,
          field: filters.field ?? 'all',
          options: SALES_ORDER_SEARCH_FIELDS,
        }}
      />

      <div className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground" data-sales-results="">
      {/* 목록 머리를 표 도구줄에 올려 조회항목 설정이 혼자 한 줄을 차지하지 않게 한다. */}
      <ConsoleGrid
        caption={`${ADMIN_VOCABULARY.settled} 주문 목록`}
        preferencesKey="sales-settled"
        columns={COLUMNS}
        emptyLabel={`${ADMIN_VOCABULARY.settled}된 주문이 없습니다.`}
        rows={rowsForGrid}
      >
        <SalesResultsHeader currentHref={currentHref} total={total} pageSize={pageSize} sort={filters.sort ?? 'newest'}>
          {exportRequestId ? <SettledExportForm key={`settled-export:${currentHref}`} filters={filters} requestId={exportRequestId} initialReceiptId={exportReceiptId} /> : null}
        </SalesResultsHeader>
      </ConsoleGrid>

      <ConsolePagination
        hrefForPage={(page) => adminSettledHref(filters, { page })}
        label={`${ADMIN_VOCABULARY.settled} 내역 페이지`}
        page={filters.page}
        pageSize={pageSize}
        total={total}
      />
      </div>
    </section>
  );
}
