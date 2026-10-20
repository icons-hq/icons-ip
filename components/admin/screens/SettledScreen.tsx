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
  type AdminSettledConsoleData,
} from '@/lib/admin/settled';
import { adminOrderDetailHrefFromBack } from '@/lib/admin/orders';
import { formatOrderDateTime, orderReferenceLabel } from '@/lib/orders';
import { ADMIN_VOCABULARY } from '@/lib/admin/vocabulary';
import { SettledExportForm } from './SettledExportForm';
import { SALES_DATE_FIELDS, SALES_ORDER_SEARCH_FIELDS } from '@/lib/admin/sales-list';
import { SalesFilterPanel, SalesGuide, SalesResultsHeader } from '@/components/admin/sales/SalesConsole';

const COLUMNS: ConsoleGridColumn[] = [
  { key: 'reference', label: '주문번호', width: '110px' },
  { key: 'buyer', label: '구매자', width: '140px' },
  { key: 'deliveredAt', label: '배송완료', width: '160px' },
  { key: 'doneAt', label: '확정일', width: '160px' },
  { key: 'claim', label: '하자 요청' },
  { key: 'total', label: '결제금액', align: 'end', width: '110px' },
];

/** 구매확정 이력과 배송일 기준의 별도 반품·교환 자격을 조회한다. */
export function SettledScreen({
  data,
  exportRequestId,
  exportReceiptId,
  now = new Date(),
}: {
  data: AdminSettledConsoleData;
  exportRequestId?: string;
  exportReceiptId?: string;
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
        <Link
          aria-label={`주문 ${orderReferenceLabel(row.id)} 상세 열기 (새 탭)`}
          className="admin-console-grid-link"
          href={adminOrderDetailHrefFromBack(row.id, adminSettledHref(filters))}
          key="reference"
          rel="noopener noreferrer"
          target="_blank"
        >
          <span className="mono">{orderReferenceLabel(row.id)}</span>
        </Link>,
        <span key="buyer">@{row.buyerName}</span>,
        row.deliveredAt
          ? (
            <time dateTime={row.deliveredAt} key="deliveredAt">
              {formatOrderDateTime(row.deliveredAt)}
            </time>
          )
          : <span className="faint" key="deliveredAt">미기록</span>,
        row.doneAt
          ? <time dateTime={row.doneAt} key="doneAt">{formatOrderDateTime(row.doneAt)}</time>
          : <span className="faint" key="doneAt">미기록</span>,
        <span data-claim-open={claim.open ? 'true' : 'false'} key="claim">
          {adminDefectClaimLabel(claim)}
        </span>,
        <span className="mono" key="total">₩{row.total.toLocaleString('ko-KR')}</span>,
      ],
    };
  });

  return (
    <section className="admin-console admin-sales-console wc-admin-kit">
      <SalesGuide title="거래확정된 주문과 결제 내역을 조회할 수 있습니다.">
        <p>거래확정 주문의 품목·결제 근거를 엑셀로 보존할 수 있습니다. PG의 판매대금 지급 내역은 포함하지 않습니다.</p>
        <Link href="/admin/sales/settled/policy">구매확정 정책 설정</Link>
      </SalesGuide>
      <SalesFilterPanel
        currentHref={currentHref}
        id="sales-settled"
        date={{ from: filters.from, to: filters.to, field: filters.dateField ?? 'ordered', options: SALES_DATE_FIELDS }}
        now={now}
        search={{
          placeholder: '주문번호 · 구매자 · 수취인 · 운송장',
          value: filters.query,
          field: filters.field ?? 'all',
          options: SALES_ORDER_SEARCH_FIELDS,
        }}
      />

      <div className="admin-sales-results">
      <SalesResultsHeader currentHref={currentHref} total={total} pageSize={pageSize} sort={filters.sort ?? 'newest'}>
        {exportRequestId ? <SettledExportForm key={`settled-export:${currentHref}`} filters={filters} requestId={exportRequestId} initialReceiptId={exportReceiptId} /> : null}
      </SalesResultsHeader>
      <p className="admin-sales-note">
        <span data-admin-tooltip={ADMIN_VOCABULARY.settledHint} title={ADMIN_VOCABULARY.settledHint} tabIndex={0}>{ADMIN_VOCABULARY.settled}</span>은 구매자 직접 확정 또는 설정된 자동 정책으로 처리됩니다. 자동 확정은 기본 꺼짐입니다. 확정 이후에도 반품·교환은 배송일과 사유별 신청 기한을 적용합니다.
      </p>

      <ConsoleGrid
        caption={`${ADMIN_VOCABULARY.settled} 주문 목록`}
        preferencesKey="sales-settled"
        columns={COLUMNS}
        emptyLabel={`${ADMIN_VOCABULARY.settled}된 주문이 없습니다.`}
        rows={rowsForGrid}
      />

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
