import {
  ConsoleCountChips,
  ConsoleFilterPanel,
  ConsoleGrid,
  ConsolePagination,
  type ConsoleGridColumn,
  type ConsoleGridRow,
} from '@/components/admin/console';
import {
  ADMIN_SHIPPING_TABS,
  adminShippingHref,
  adminShippingTab,
  adminShippingTransitLabel,
  isAdminShippingStale,
  type AdminShippingConsoleData,
  type AdminShippingOrderRow,
} from '@/lib/admin/shipping';
import { formatOrderDateTime, orderReferenceLabel } from '@/lib/orders';
import { ShippingCompleteForm } from './ShippingCompleteForm';

const TRANSIT_COLUMNS: ConsoleGridColumn[] = [
  { key: 'reference', label: '주문번호', width: '110px' },
  { key: 'buyer', label: '구매자', width: '130px' },
  { key: 'shippedAt', label: '발송일시', width: '150px' },
  { key: 'transit', label: '경과일', align: 'end', width: '80px' },
  { key: 'shipment', label: '운송장' },
  { key: 'total', label: '결제금액', align: 'end', width: '110px' },
  { key: 'action', label: '처리', width: '150px' },
];

const DELIVERED_COLUMNS: ConsoleGridColumn[] = [
  { key: 'reference', label: '주문번호', width: '110px' },
  { key: 'buyer', label: '구매자', width: '130px' },
  { key: 'shippedAt', label: '발송일시', width: '150px' },
  { key: 'deliveredAt', label: '배송완료', width: '150px' },
  { key: 'shipment', label: '운송장' },
  { key: 'total', label: '결제금액', align: 'end', width: '110px' },
];

/**
 * 운송장 셀.
 *
 * 조회 URL은 레지스트리 템플릿에서 온다(#251) — 화면이 택배사별 URL을 조립하지
 * 않으므로 택배사가 늘어도 여기는 그대로다.
 *
 * 레지스트리에 없는 코드로 저장된 주문은 링크를 만들 수 없다. 그때는 빈 칸이 아니라
 * "확인 필요"를 적는다 — 빈 칸은 "운송장 미등록"으로 읽히고, 실제로는 등록됐지만
 * 조회할 수 없는 상태라 대응이 다르다.
 */
function shipmentCell(row: AdminShippingOrderRow) {
  if (!row.shipment) {
    return <span className="faint" key="shipment">운송장 확인 필요</span>;
  }
  return (
    <span key="shipment">
      {row.shipment.carrierLabel}{' '}
      <a
        className="mono"
        href={row.shipment.trackingUrl}
        rel="noreferrer noopener"
        target="_blank"
      >
        {row.shipment.trackingNumber}
      </a>
    </span>
  );
}

/**
 * 배송현황 관리.
 *
 * 발주·발송 콘솔이 "아직 안 나간 주문"이라면 여기는 "나간 뒤"다. 배송중 탭에서만
 * 배송완료를 누를 수 있고, 배송완료 탭은 조회 전용이다 — `delivered`를 되돌리는
 * 전이는 사다리에 없다(#250).
 *
 * 여기 운송장은 창고 WMS가 발행한 값을 옮겨 적은 **운영 기록**이다(#177). 어긋나면
 * WMS가 기준이고, 조회 링크가 사실을 확정한다.
 */
export function ShippingScreen({
  data,
  now = new Date(),
}: {
  data: AdminShippingConsoleData;
  /** 경과일 기준 시각. 테스트 주입용. */
  now?: Date;
}) {
  const { counts, filters, pageSize, rows, total } = data;
  const tab = filters.tab;
  const detailStatus = adminShippingTab(tab).status;

  const rowsForGrid: ConsoleGridRow[] = rows.map((row) => {
    const reference = orderReferenceLabel(row.id);
    const shippedAtCell = row.shippedAt
      ? <time dateTime={row.shippedAt} key="shippedAt">{formatOrderDateTime(row.shippedAt)}</time>
      : <span className="faint" key="shippedAt">미기록</span>;

    const cells = tab === 'transit'
      ? [
        <span className="mono" key="reference">{reference}</span>,
        <span key="buyer">@{row.buyerName}</span>,
        shippedAtCell,
        <span
          data-stale={isAdminShippingStale(row.shippedAt, now) ? 'true' : undefined}
          key="transit"
        >
          {adminShippingTransitLabel(row.shippedAt, now)}
        </span>,
        shipmentCell(row),
        <span className="mono" key="total">₩{row.total.toLocaleString('ko-KR')}</span>,
        <ShippingCompleteForm key="action" orderId={row.id} reference={reference} />,
      ]
      : [
        <span className="mono" key="reference">{reference}</span>,
        <span key="buyer">@{row.buyerName}</span>,
        shippedAtCell,
        row.deliveredAt
          ? (
            <time dateTime={row.deliveredAt} key="deliveredAt">
              {formatOrderDateTime(row.deliveredAt)}
            </time>
          )
          : <span className="faint" key="deliveredAt">미기록</span>,
        shipmentCell(row),
        <span className="mono" key="total">₩{row.total.toLocaleString('ko-KR')}</span>,
      ];

    return {
      id: row.id,
      href: `/admin/sales/orders?status=${detailStatus}&page=1&order=${row.id}`,
      cells,
    };
  });

  return (
    <section className="admin-console">
      <ConsoleFilterPanel
        action="/admin/sales/shipping"
        dateRange={{ from: filters.from, label: '주문일', to: filters.to }}
        hiddenFields={{ tab }}
        now={now}
        search={{
          placeholder: '주문번호 · 닉네임 · 이메일',
          value: filters.query,
        }}
      />

      <ConsoleCountChips
        chips={ADMIN_SHIPPING_TABS.map((candidate) => ({
          active: candidate.id === tab,
          count: counts[candidate.id] ?? 0,
          href: adminShippingHref(filters, { page: 1, tab: candidate.id }),
          label: candidate.label,
          tone: candidate.id === 'transit' ? 'info' : 'success',
        }))}
        label="배송 단계별 건수"
      />

      <ConsoleGrid
        caption={tab === 'transit' ? '배송중 목록' : '배송완료 목록'}
        columns={tab === 'transit' ? TRANSIT_COLUMNS : DELIVERED_COLUMNS}
        emptyLabel={tab === 'transit'
          ? '배송중인 주문이 없습니다.'
          : '배송완료된 주문이 없습니다.'}
        rows={rowsForGrid}
      />

      <ConsolePagination
        hrefForPage={(page) => adminShippingHref(filters, { page })}
        label="배송현황 페이지"
        page={filters.page}
        pageSize={pageSize}
        total={total}
      />
    </section>
  );
}
