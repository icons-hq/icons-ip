import {
  ConsoleCountChips,
  ConsoleFilterPanel,
  ConsoleGrid,
  ConsolePagination,
  type ConsoleGridColumn,
  type ConsoleGridRow,
} from '@/components/admin/console';
import {
  ADMIN_DISPATCH_DELAY_DAYS,
  ADMIN_DISPATCH_TABS,
  adminDispatchConfirmedDaysLabel,
  adminDispatchElapsedLabel,
  adminDispatchTab,
  adminDispatchHref,
  adminDispatchItemLabel,
  isAdminDispatchDelayed,
  type AdminDispatchConsoleData,
  type AdminDispatchOrderRow,
  type AdminDispatchTabId,
} from '@/lib/admin/dispatch';
import { formatOrderDate, formatOrderDateTime, orderReferenceLabel } from '@/lib/orders';
import { DispatchDelayNoteForm } from './DispatchDelayNoteForm';
import { DispatchOrderGrid } from './DispatchOrderGrid';
import { DispatchShipForm } from './DispatchShipForm';
import { DispatchTrackingImportPanel } from './DispatchTrackingImportPanel';

/* 스마트스토어 신규주문 목록의 컬럼 구성(#250). 폭은 운영자가 가장 오래 보는 값
   순서대로 준다 — 굿즈 요약이 가장 넓고, 경과시간은 좁아도 읽힌다. */
const NEW_COLUMNS: ConsoleGridColumn[] = [
  { key: 'reference', label: '주문번호', width: '110px' },
  { key: 'createdAt', label: '주문일시', width: '150px' },
  { key: 'buyer', label: '구매자', width: '130px' },
  { key: 'items', label: '굿즈' },
  { key: 'qty', label: '수량', align: 'end', width: '70px' },
  /* 이슈는 "결제수단"을 요구하지만 카드·무통장은 staff 읽기 표면에 없다.
     값이 결제사이므로 헤더도 결제사라고 적는다 — 헤더만 결제수단으로 두면
     전 행이 "토스페이먼츠"인 화면을 운영자가 결제수단으로 읽는다.
     실제 수단 구분은 #256이 provider에 bank_transfer를 더하면 살아난다. */
  { key: 'payment', label: '결제사', width: '110px' },
  { key: 'total', label: '결제금액', align: 'end', width: '110px' },
  { key: 'elapsed', label: '경과시간', align: 'end', width: '90px' },
];

/* 발송 대기는 "무엇을 몇 개 보내야 하는가"와 "얼마나 묵었는가"만 본다. 결제사·금액은
   발주확인 전에 대조를 끝낸 값이라 여기서는 자리를 운송장 입력에 내준다(#251). */
const READY_COLUMNS: ConsoleGridColumn[] = [
  { key: 'reference', label: '주문번호', width: '110px' },
  { key: 'buyer', label: '구매자', width: '120px' },
  { key: 'items', label: '굿즈' },
  { key: 'qty', label: '수량', align: 'end', width: '60px' },
  { key: 'confirmedAt', label: '발주확인일', width: '110px' },
  { key: 'confirmedDays', label: '경과일', align: 'end', width: '80px' },
  { key: 'ship', label: '발송처리', width: '320px' },
];

const DELAYED_COLUMNS: ConsoleGridColumn[] = [
  { key: 'reference', label: '주문번호', width: '110px' },
  { key: 'buyer', label: '구매자', width: '120px' },
  { key: 'items', label: '굿즈' },
  { key: 'confirmedAt', label: '발주확인일', width: '110px' },
  { key: 'confirmedDays', label: '경과일', align: 'end', width: '80px' },
  { key: 'delay', label: '지연 메모', width: '300px' },
  { key: 'ship', label: '발송처리', width: '320px' },
];

const COLUMNS_BY_TAB: Record<AdminDispatchTabId, ConsoleGridColumn[]> = {
  new: NEW_COLUMNS,
  ready: READY_COLUMNS,
  delayed: DELAYED_COLUMNS,
};

const EMPTY_LABELS: Record<AdminDispatchTabId, string> = {
  new: '발주확인을 기다리는 신규주문이 없습니다.',
  ready: '발송을 기다리는 주문이 없습니다.',
  delayed: `발주확인 후 ${ADMIN_DISPATCH_DELAY_DAYS}일이 지난 주문이 없습니다.`,
};

const CAPTIONS: Record<AdminDispatchTabId, string> = {
  new: '신규주문 목록',
  ready: '발송 대기 목록',
  delayed: '발송지연 목록',
};

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

/** 발주확인일 셀. 기록이 없으면 날짜를 지어내지 않는다. */
function confirmedAtCell(row: AdminDispatchOrderRow) {
  if (!row.confirmedAt) return <span className="faint" key="confirmedAt">미기록</span>;
  return (
    <time dateTime={row.confirmedAt} key="confirmedAt">{formatOrderDate(row.confirmedAt)}</time>
  );
}

/**
 * 발주확인 후 경과일 셀.
 *
 * 지연 임계값을 넘긴 행은 `data-delayed`로 표시한다. 숫자만으로는 3일과 4일이 같은
 * 무게로 읽히고, 목록이 길어지면 늦은 주문이 그대로 묻힌다.
 */
function confirmedDaysCell(row: AdminDispatchOrderRow, now: Date) {
  const delayed = isAdminDispatchDelayed(row.confirmedAt, now);
  return (
    <span data-delayed={delayed ? 'true' : undefined} key="confirmedDays">
      {adminDispatchConfirmedDaysLabel(row.confirmedAt, now)}
    </span>
  );
}

/**
 * 발주·발송 관리.
 *
 * 탭은 사다리의 한 칸씩이다. 신규주문(`paid`)은 일괄 발주확인, 발송 대기
 * (`confirmed`)는 행 인라인 발송처리와 엑셀 일괄 등록, 발송지연은 같은 `confirmed`를
 * 오래 묵은 것만 남긴 지표 겸 메모 화면이다(#251).
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
  const { carriers, counts, filters, pageSize, rows, total } = data;
  const tab = filters.tab;
  const detailStatus = adminDispatchTab(tab).status;

  const rowsForGrid: ConsoleGridRow[] = rows.map((row) => {
    const reference = orderReferenceLabel(row.id);
    const base = {
      id: row.id,
      href: `/admin/sales/orders?status=${detailStatus}&page=1&order=${row.id}`,
      selectLabel: `주문 ${reference} 선택`,
    };

    if (tab === 'new') {
      return {
        ...base,
        cells: [
          <span className="mono" key="reference">{reference}</span>,
          <time dateTime={row.createdAt} key="createdAt">{formatOrderDateTime(row.createdAt)}</time>,
          <span key="buyer">@{row.buyerName}</span>,
          <span key="items">{adminDispatchItemLabel(row.items)}</span>,
          <span key="qty">{row.items.totalQty.toLocaleString('ko-KR')}개</span>,
          <span key="payment">{paymentProviderLabel(row.paymentProvider)}</span>,
          <span className="mono" key="total">₩{row.total.toLocaleString('ko-KR')}</span>,
          <span key="elapsed">{adminDispatchElapsedLabel(row.createdAt, now)}</span>,
        ],
      };
    }

    const shipCell = (
      <DispatchShipForm
        carriers={carriers}
        key="ship"
        orderId={row.id}
        reference={reference}
      />
    );

    if (tab === 'delayed') {
      return {
        ...base,
        cells: [
          <span className="mono" key="reference">{reference}</span>,
          <span key="buyer">@{row.buyerName}</span>,
          <span key="items">{adminDispatchItemLabel(row.items)}</span>,
          confirmedAtCell(row),
          confirmedDaysCell(row, now),
          <DispatchDelayNoteForm
            key="delay"
            note={row.delayNote}
            orderId={row.id}
            reference={reference}
          />,
          shipCell,
        ],
      };
    }

    return {
      ...base,
      cells: [
        <span className="mono" key="reference">{reference}</span>,
        <span key="buyer">@{row.buyerName}</span>,
        <span key="items">{adminDispatchItemLabel(row.items)}</span>,
        <span key="qty">{row.items.totalQty.toLocaleString('ko-KR')}개</span>,
        confirmedAtCell(row),
        confirmedDaysCell(row, now),
        shipCell,
      ],
    };
  });

  return (
    <section className="admin-console">
      <ConsoleFilterPanel
        action="/admin/sales/dispatch"
        dateRange={{ from: filters.from, label: '주문일', to: filters.to }}
        hiddenFields={{ tab }}
        now={now}
        search={{
          placeholder: '주문번호 · 닉네임 · 이메일',
          value: filters.query,
        }}
      />

      <ConsoleCountChips
        chips={ADMIN_DISPATCH_TABS.map((candidate) => ({
          active: candidate.id === tab,
          count: counts[candidate.id] ?? 0,
          href: adminDispatchHref(filters, { page: 1, tab: candidate.id }),
          label: candidate.label,
          tone: candidate.id === 'delayed' ? 'danger' : candidate.id === 'new' ? 'warning' : 'default',
        }))}
        label="처리 단계별 건수"
      />

      {tab === 'new' ? (
        <DispatchOrderGrid
          caption={CAPTIONS.new}
          columns={NEW_COLUMNS}
          emptyLabel={EMPTY_LABELS.new}
          rows={rowsForGrid}
        />
      ) : (
        <>
          <DispatchTrackingImportPanel carriers={carriers} />
          {/* 행마다 독립된 발송처리 폼이 붙으므로 목록 전체를 감싸는 일괄 폼을 두지
              않는다. 폼 안에 폼은 HTML이 허용하지 않고, 하나로 묶으면 어느 행이
              거절됐는지 운영자가 알 수 없다. */}
          <ConsoleGrid
            caption={CAPTIONS[tab]}
            columns={COLUMNS_BY_TAB[tab]}
            emptyLabel={EMPTY_LABELS[tab]}
            rows={rowsForGrid}
          />
        </>
      )}

      <ConsolePagination
        hrefForPage={(page) => adminDispatchHref(filters, { page })}
        label="발주·발송 페이지"
        page={filters.page}
        pageSize={pageSize}
        total={total}
      />
    </section>
  );
}
