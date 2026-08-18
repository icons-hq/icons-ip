import {
  ConsoleCountChips,
  ConsoleFilterPanel,
  ConsolePagination,
  type ConsoleGridColumn,
  type ConsoleGridRow,
} from '@/components/admin/console';
import {
  ADMIN_DISPATCH_TABS,
  adminDispatchElapsedLabel,
  adminDispatchHref,
  adminDispatchItemLabel,
  type AdminDispatchConsoleData,
} from '@/lib/admin/dispatch';
import { formatOrderDateTime, orderReferenceLabel } from '@/lib/orders';
import { DispatchOrderGrid } from './DispatchOrderGrid';

/* 스마트스토어 신규주문 목록의 컬럼 구성(#250). 폭은 운영자가 가장 오래 보는 값
   순서대로 준다 — 굿즈 요약이 가장 넓고, 경과시간은 좁아도 읽힌다. */
const COLUMNS: ConsoleGridColumn[] = [
  { key: 'reference', label: '주문번호', width: '110px' },
  { key: 'createdAt', label: '주문일시', width: '150px' },
  { key: 'buyer', label: '구매자', width: '130px' },
  { key: 'items', label: '굿즈' },
  { key: 'qty', label: '수량', align: 'end', width: '70px' },
  { key: 'payment', label: '결제수단', width: '110px' },
  { key: 'total', label: '결제금액', align: 'end', width: '110px' },
  { key: 'elapsed', label: '경과시간', align: 'end', width: '90px' },
];

/**
 * 결제사 표기.
 *
 * 카드·무통장 같은 실제 결제수단은 `private.payment_provider_evidence`에만 있고 staff
 * 읽기 표면에는 없다. 없는 값을 "카드"로 지어내는 대신 확인 가능한 결제사만 적는다 —
 * 무통장 주문이 카드로 보이면 입금 확인 없이 발주확인을 누르게 된다.
 */
const PAYMENT_PROVIDER_LABELS: Record<string, string> = {
  toss: '토스페이먼츠',
  korpay: 'Korpay',
};

function paymentProviderLabel(provider: string | null) {
  if (!provider) return '확인 필요';
  return PAYMENT_PROVIDER_LABELS[provider] ?? provider;
}

/**
 * 발주·발송 관리 — 신규주문 탭.
 *
 * 탭은 사다리의 한 칸씩이고 지금 열린 칸은 신규주문(`paid`)뿐이다. 발송 대기
 * (`confirmed`)와 발송처리 UI는 #251이 같은 탭 구조 위에 얹는다.
 *
 * 금액은 `formatKrw`의 만 단위 축약을 쓰지 않는다. 발주확인 직전에 운영자가 보는
 * 숫자는 결제 원장과 대조하는 값이라 ₩3만으로 접히면 대조가 불가능하다.
 */
export function DispatchScreen({
  data,
  now = new Date(),
}: {
  data: AdminDispatchConsoleData;
  /** 경과시간 기준 시각. 테스트 주입용. */
  now?: Date;
}) {
  const { counts, filters, pageSize, rows, total } = data;

  const rowsForGrid: ConsoleGridRow[] = rows.map((row) => ({
    id: row.id,
    href: `/admin/sales/orders?status=paid&page=1&order=${row.id}`,
    selectLabel: `주문 ${orderReferenceLabel(row.id)} 선택`,
    cells: [
      <span className="mono" key="reference">{orderReferenceLabel(row.id)}</span>,
      <time dateTime={row.createdAt} key="createdAt">{formatOrderDateTime(row.createdAt)}</time>,
      <span key="buyer">@{row.buyerName}</span>,
      <span key="items">{adminDispatchItemLabel(row.items)}</span>,
      <span key="qty">{row.items.totalQty.toLocaleString('ko-KR')}개</span>,
      <span key="payment">{paymentProviderLabel(row.paymentProvider)}</span>,
      <span className="mono" key="total">₩{row.total.toLocaleString('ko-KR')}</span>,
      <span key="elapsed">{adminDispatchElapsedLabel(row.createdAt, now)}</span>,
    ],
  }));

  return (
    <section className="admin-console">
      <ConsoleFilterPanel
        action="/admin/sales/dispatch"
        dateRange={{ from: filters.from, label: '주문일', to: filters.to }}
        hiddenFields={{ tab: filters.tab }}
        now={now}
        search={{
          placeholder: '주문번호 · 닉네임 · 이메일',
          value: filters.query,
        }}
      />

      <ConsoleCountChips
        chips={ADMIN_DISPATCH_TABS.map((tab) => ({
          active: tab.id === filters.tab,
          count: counts[tab.id] ?? 0,
          href: adminDispatchHref(filters, { page: 1, tab: tab.id }),
          label: tab.label,
          tone: tab.id === 'new' ? 'warning' : 'default',
        }))}
        label="처리 단계별 건수"
      />

      <DispatchOrderGrid
        caption="신규주문 목록"
        columns={COLUMNS}
        emptyLabel="발주확인을 기다리는 신규주문이 없습니다."
        rows={rowsForGrid}
      />

      <ConsolePagination
        hrefForPage={(page) => adminDispatchHref(filters, { page })}
        label="신규주문 페이지"
        page={filters.page}
        pageSize={pageSize}
        total={total}
      />
    </section>
  );
}
