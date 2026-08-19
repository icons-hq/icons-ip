import {
  ConsoleFilterPanel,
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
import { formatOrderDateTime, orderReferenceLabel } from '@/lib/orders';

const COLUMNS: ConsoleGridColumn[] = [
  { key: 'reference', label: '주문번호', width: '110px' },
  { key: 'buyer', label: '구매자', width: '140px' },
  { key: 'deliveredAt', label: '배송완료', width: '160px' },
  { key: 'doneAt', label: '확정일', width: '160px' },
  { key: 'claim', label: '하자 클레임' },
  { key: 'total', label: '결제금액', align: 'end', width: '110px' },
];

/**
 * 거래확정 내역 — 조회 전용.
 *
 * 확정일과 함께 하자 클레임 잔여 기한을 나란히 둔다. `done`은 변심 청약철회 창이
 * 닫혔다는 뜻일 뿐 클레임이 끝났다는 뜻이 아니고(#250), 그 구분이 화면에 없으면
 * 운영자가 "확정된 주문"이라는 이유로 정당한 반품 문의를 되돌려 보낸다.
 *
 * 행 선택과 일괄 액션을 붙이지 않는다. 확정 이후 되돌리는 조작은 이 화면의 범위가
 * 아니라 클레임 경로가 맡는다 — 선택 체크박스를 두면 여기서 무언가 처리할 수 있다는
 * 신호가 된다.
 */
export function SettledScreen({
  data,
  now = new Date(),
}: {
  data: AdminSettledConsoleData;
  /** 잔여 기한 기준 시각. 테스트 주입용. */
  now?: Date;
}) {
  const { filters, pageSize, rows, total } = data;

  const rowsForGrid: ConsoleGridRow[] = rows.map((row) => {
    const claim = adminDefectClaimWindow(row.deliveredAt, now);

    return {
      id: row.id,
      href: `/admin/sales/orders?status=done&page=1&order=${row.id}`,
      cells: [
        <span className="mono" key="reference">{orderReferenceLabel(row.id)}</span>,
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
    <section className="admin-console">
      <ConsoleFilterPanel
        action="/admin/sales/settled"
        dateRange={{ from: filters.from, label: '주문일', to: filters.to }}
        now={now}
        search={{
          placeholder: '주문번호 · 닉네임 · 이메일',
          value: filters.query,
        }}
      />

      <p className="muted">
        거래확정은 배송완료 8일 뒤 자동으로 처리됩니다. 확정 이후에도 상품 하자·오배송
        클레임은 공급받은 날부터 3개월 이내에 접수할 수 있습니다.
      </p>

      <ConsoleGrid
        caption="거래확정 주문 목록"
        columns={COLUMNS}
        emptyLabel="거래확정된 주문이 없습니다."
        rows={rowsForGrid}
      />

      <ConsolePagination
        hrefForPage={(page) => adminSettledHref(filters, { page })}
        label="거래확정 내역 페이지"
        page={filters.page}
        pageSize={pageSize}
        total={total}
      />
    </section>
  );
}
