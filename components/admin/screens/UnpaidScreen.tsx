import Link from 'next/link';
import { AdminListExportButton } from '@/components/admin/AdminListExportButton';
import { BankDepositQueue } from '@/components/admin/BankDepositQueue';
import { UnpaidActionsPanel } from '@/components/admin/UnpaidActionsPanel';
import {
  ConsoleGrid,
  ConsolePagination,
  type ConsoleGridColumn,
  type ConsoleGridRow,
} from '@/components/admin/console';
import { adminListExportHref } from '@/lib/admin/list-export';
import { adminUnpaidAttemptStateLabel, adminUnpaidHref, type AdminUnpaidConsoleData } from '@/lib/admin/unpaid';
import { ADMIN_VOCABULARY } from '@/lib/admin/vocabulary';
import { SALES_SORT_OPTIONS } from '@/lib/admin/sales-list';
import { SalesFilterField, SalesFilterPanel, SalesGuide, SalesResultsHeader, SalesSelect } from '@/components/admin/sales/SalesConsole';
import { AdminNotice, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { statusTone } from '@/lib/admin/status-tone';
import { krw } from '@/lib/format';
import { formatOrderDateTime } from '@/lib/orders';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import {
  bankTransferDeadlineImminent,
  bankTransferDeadlineLabel,
  bankTransferDeadlinePassed,
  bankTransferDepositNameWithCode,
} from '@/lib/payments/bank-transfer';

const COLUMNS: ConsoleGridColumn[] = [
  { key: 'code', label: '입금확인코드', width: '102px' },
  { key: 'buyer', label: '구매자', width: '100px' },
  /* 안내한 입금자명을 그대로 실어 둔다 — 통장 화면과 이 열을 나란히 두고 눈으로
     맞추는 것이 수동 대조의 실제 동작이다. */
  { key: 'depositName', label: '안내된 입금자명', width: '136px' },
  /* 품목은 폭을 비워 남는 자리를 모두 받고 한 줄로 자른다(전체는 title) — 품목 수에 따라 줄 높이가 튀면 입금 대조하며 훑기 어렵다. */
  { key: 'items', label: '품목' },
  { key: 'deadline', label: '남은 기한 / 주문일시', width: '184px' },
  { key: 'state', label: '상태', width: '108px' },
  { key: 'total', label: '입금액', align: 'end', width: '100px' },
  { key: 'action', label: '처리', width: '96px', required: true },
];

/**
 * 미입금 확인 콘솔 — 수동 대조 (#256).
 *
 * 뱅크다류 자동 매칭 제안은 #257이 이 화면 옆에 붙인다. 여기까지가 오픈
 * 게이트다: 외부 계약이 늦어져도 사람이 계좌 앱을 보고 확정할 수 있어야 한다.
 *
 * 목록에 주소·연락처를 싣지 않는다. 입금 대조에 필요한 것은 입금자명 코드와
 * 금액뿐이고, 나머지는 주문 통합검색이 이미 보여준다.
 */
export function UnpaidScreen({
  data,
  now = new Date(),
}: {
  data: AdminUnpaidConsoleData;
  /** 임박 판정 기준 시각. 테스트 주입용. */
  now?: Date;
}) {
  const { deposits, filters, pageSize, rows, total } = data;
  const selected = rows.find((row) => row.id === filters.selectedOrderId) ?? null;
  const currentHref = adminUnpaidHref(filters);

  const gridRows: ConsoleGridRow[] = rows.map((row) => {
    const deadline = `${bankTransferDeadlineLabel(row.expiresAt, now.getTime())}${row.extendedAt ? ' · 연장됨' : ''}`;
    /* 끝났거나 임박한 기한만 강조한다 — 모든 행이 주의색이면 신호가 죽는다. */
    const deadlineTone = row.expiresAt && bankTransferDeadlinePassed(row.expiresAt, now.getTime()) ? 'danger' as const
      : bankTransferDeadlineImminent(row.expiresAt, now.getTime()) ? 'warning' as const : null;
    const actionHref = `${adminUnpaidHref({ ...filters, selectedOrderId: row.id })}#unpaid-actions`;
    /* 기한이 끝났거나 결제 확인이 필요한 줄은 그냥 눌러 끝낼 일이 아니다 — 입금을 대조할 줄(연한 파랑)과 모양을 나눈다. */
    const needsCare = deadlineTone === 'danger' || statusTone('unpaid', row.attemptState ?? 'missing') === 'danger';
    return {
      id: row.id,
      href: actionHref,
      cells: [
        <span className="font-medium tabular-nums" key="code">{row.depositCode}</span>,
        <span className="block max-w-19 truncate" key="buyer" title={row.buyerName}>{row.buyerName}</span>,
        <span className="tabular-nums" key="depositName">
          {bankTransferDepositNameWithCode(row.recipientName, row.depositCode)}
        </span>,
        <span className="line-clamp-1 min-w-48 break-all" key="items" title={row.itemSummary || undefined}>{row.itemSummary || '품목 정보 없음'}</span>,
        <span className="flex flex-col items-start gap-0.5" key="deadline">
          {deadlineTone ? <AdminStatusBadge tone={deadlineTone}>{deadline}</AdminStatusBadge> : <span className="whitespace-nowrap">{deadline}</span>}
          <small className="text-xs text-muted-foreground tabular-nums">{formatOrderDateTime(row.createdAt)}</small>
        </span>,
        <AdminStatusBadge key="state" tone={statusTone('unpaid', row.attemptState ?? 'missing')}>{adminUnpaidAttemptStateLabel(row.attemptState)}</AdminStatusBadge>,
        <span className="tabular-nums" key="total">{krw(row.total)}</span>,
        <Link aria-label={`${needsCare ? '확인·처리' : '입금 확인'} · 입금확인코드 ${row.depositCode} 입금 확인·기한 연장·취소 처리 열기`} className={buttonVariants({ size: 'sm', variant: 'soft' })} data-slot="button" href={actionHref} key="action">{needsCare ? '확인·처리' : '입금 확인'}</Link>,
      ],
    };
  });

  return (
    <div className="flex min-w-0 flex-col gap-4 text-sm" data-admin-unpaid="">
      <SalesGuide title="미결제 무통장 주문의 입금 여부를 확인할 수 있습니다.">
        <p>입금확인코드·안내된 입금자명·금액을 실제 입금 내역과 대조한 뒤 입금 확인을 처리합니다. 기한 연장과 취소는 주문을 선택해 처리합니다.</p>
      </SalesGuide>
      <SalesFilterPanel currentHref={currentHref} id="sales-unpaid" search={{ value: filters.query, name: 'q', placeholder: '입금확인코드 · 주문번호 · 구매자' }}>
        <SalesFilterField label="결제상태" htmlFor="sales-unpaid-state"><SalesSelect id="sales-unpaid-state" name="state" value={filters.state ?? ''}
          options={[{value:'',label:'전체'},{value:'prepared',label:'입금 대기'},{value:'confirming',label:'확정 처리중'},{value:'needs_review',label:'결제 확인 필요'},{value:'unknown',label:'결제 확인 필요(결과 미확인)'},{value:'missing',label:'결제 기록 없음'}]} /></SalesFilterField>
      </SalesFilterPanel>
      <div className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground" data-sales-results="">
      <SalesResultsHeader currentHref={currentHref} total={total} pageSize={pageSize} sort={filters.sort ?? 'oldest'}
        sortOptions={SALES_SORT_OPTIONS.map(option => option.value === 'oldest' ? {...option,label:'입금기한 임박순'} : option.value === 'newest' ? {...option,label:'입금기한 여유순'} : option)}>
        <AdminListExportButton href={adminListExportHref('unpaid', currentHref)} total={total} />
      </SalesResultsHeader>
      <ConsoleGrid
        caption="미결제 무통장 주문 목록"
        preferencesKey="sales-unpaid"
        columns={COLUMNS}
        emptyLabel="입금을 기다리는 무통장 주문이 없습니다."
        rows={gridRows}
      />

      <ConsolePagination
        hrefForPage={(page: number) => adminUnpaidHref({ ...filters, page })}
        label={`${ADMIN_VOCABULARY.unpaidOrders} 페이지`}
        page={filters.page}
        pageSize={pageSize}
        total={total}
      />
      </div>

      {selected ? (
        <UnpaidActionsPanel order={selected} />
      ) : (
        <p className="text-muted-foreground">
          목록에서 주문을 고르면 입금 확인·기한 연장·즉시 취소를 처리할 수 있습니다.
        </p>
      )}

      <BankDepositQueue deposits={deposits} />

      {filters.selectedOrderId && !selected && (
        <AdminNotice role="status" tone="warning">
          고른 주문이 목록에 없습니다. 이미 처리됐을 수 있어요.{' '}
          <Link className="font-medium underline underline-offset-4" href={adminUnpaidHref({ ...filters, selectedOrderId: null })}>목록으로</Link>
        </AdminNotice>
      )}
    </div>
  );
}
