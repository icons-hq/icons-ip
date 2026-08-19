import Link from 'next/link';
import { BankDepositQueue } from '@/components/admin/BankDepositQueue';
import { UnpaidActionsPanel } from '@/components/admin/UnpaidActionsPanel';
import {
  ConsoleFilterPanel,
  ConsoleGrid,
  ConsolePagination,
  type ConsoleGridColumn,
  type ConsoleGridRow,
} from '@/components/admin/console';
import { adminUnpaidHref, type AdminUnpaidConsoleData } from '@/lib/admin/unpaid';
import { krw } from '@/lib/format';
import { formatOrderDateTime } from '@/lib/orders';
import {
  bankTransferDeadlineImminent,
  bankTransferDeadlineLabel,
  bankTransferDepositName,
} from '@/lib/payments/bank-transfer';

const COLUMNS: ConsoleGridColumn[] = [
  { key: 'code', label: '주문코드', width: '110px' },
  { key: 'buyer', label: '구매자', width: '130px' },
  /* 안내한 입금자명을 그대로 실어 둔다 — 통장 화면과 이 열을 나란히 두고 눈으로
     맞추는 것이 수동 대조의 실제 동작이다. */
  { key: 'depositName', label: '안내된 입금자명', width: '160px' },
  { key: 'items', label: '품목' },
  { key: 'createdAt', label: '주문일시', width: '150px' },
  { key: 'deadline', label: '남은 기한', width: '140px' },
  { key: 'state', label: '상태', width: '110px' },
  { key: 'total', label: '입금액', align: 'end', width: '110px' },
];

/**
 * attempt 상태를 운영자 문구로. `prepared`가 정상적인 입금 대기이고, 그 밖의
 * 값은 확정이 중간에 멈춘 것이라 눈에 띄어야 한다.
 */
const ATTEMPT_STATE_LABELS: Record<string, string> = {
  prepared: '입금 대기',
  confirming: '확정 처리중',
  needs_review: '정합화 필요',
  unknown: '정합화 필요',
};

function attemptStateLabel(state: string | null) {
  if (!state) return '원장 없음';
  return ATTEMPT_STATE_LABELS[state] ?? state;
}

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

  const gridRows: ConsoleGridRow[] = rows.map((row) => {
    const imminent = bankTransferDeadlineImminent(row.expiresAt, now.getTime());
    return {
      id: row.id,
      href: adminUnpaidHref({ ...filters, selectedOrderId: row.id }),
      cells: [
        <span className="mono" key="code">{row.depositCode}</span>,
        row.buyerName,
        <span className="mono" key="depositName">
          {bankTransferDepositName(row.recipientName, row.id)}
        </span>,
        row.itemSummary || '품목 정보 없음',
        formatOrderDateTime(row.createdAt),
        <span className={imminent ? 'admin-badge admin-badge--warn' : undefined} key="deadline">
          {bankTransferDeadlineLabel(row.expiresAt, now.getTime())}
          {row.extendedAt ? ' · 연장됨' : ''}
        </span>,
        <span
          className={row.attemptState === 'prepared' ? undefined : 'admin-badge admin-badge--warn'}
          key="state"
        >
          {attemptStateLabel(row.attemptState)}
        </span>,
        <span className="mono" key="total">{krw(row.total)}</span>,
      ],
    };
  });

  return (
    <div className="admin-console">
      <ConsoleFilterPanel
        action="/admin/sales/unpaid"
        search={{
          value: filters.query,
          name: 'q',
          placeholder: '주문코드 · 주문 id · 구매자',
        }}
        submitLabel="검색"
      />

      <ConsoleGrid
        caption="미입금 무통장 주문 목록"
        columns={COLUMNS}
        emptyLabel="입금을 기다리는 무통장 주문이 없습니다."
        rows={gridRows}
      />

      <ConsolePagination
        hrefForPage={(page: number) => adminUnpaidHref({ ...filters, page })}
        label="미입금 확인 페이지"
        page={filters.page}
        pageSize={pageSize}
        total={total}
      />

      {selected ? (
        <UnpaidActionsPanel order={selected} />
      ) : (
        <p className="admin-note">
          목록에서 주문을 고르면 입금 확인·기한 연장·즉시 취소를 처리할 수 있습니다.
        </p>
      )}

      <BankDepositQueue deposits={deposits} />

      {filters.selectedOrderId && !selected && (
        <p className="admin-note" role="status">
          고른 주문이 목록에 없습니다. 이미 처리됐을 수 있어요.{' '}
          <Link href={adminUnpaidHref({ ...filters, selectedOrderId: null })}>목록으로</Link>
        </p>
      )}
    </div>
  );
}
