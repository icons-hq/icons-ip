import Link from 'next/link';
import { ConsoleGrid, ConsoleListCard, ConsolePagination, type ConsoleGridColumn } from '@/components/admin/console';
import { AdminNotice, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { SalesGuide } from '@/components/admin/sales/SalesConsole';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { cn } from 'cn';
import { formatKrwExact } from '@/components/admin/format';
import { formatOrderDateTime, orderReferenceLabel } from '@/lib/orders';
import { orderClaimReferenceLabel } from '@/lib/orders/claims';
import { refundTransfersHref, type RefundTransferPage } from '@/lib/admin/refund-transfers';

/* 환불 송금 대기(무통장 환불의 실제 송금이 남은 요청) — 템플릿 룩(ADR-0028). 목록은 공용 ConsoleGrid다.
 * 목록 RPC는 계좌를 싣지 않는다 — 계좌 원문 열람과 송금 완료 기록은 요청 상세의 무통장 환불 칸에서만 한다. 그 칸으로 바로 가는 버튼을 첫 화면에 둔다. */

/** 취소 확정 뒤 이 날수 이상 지난 요청을 주의로 표시한다. 약관의 환급 기한(3영업일)에 맞춘 눈금이고 처리 판정이 아니다. */
const LONG_WAIT_DAYS = 3;

/* 1440 화면에서 돈·사람·행동이 먼저 들어오게 나눈다. 번호·날짜는 그 뒤다. */
const columns: ConsoleGridColumn[] = [
  { key: 'claim', label: '요청번호', width: '88px', required: true },
  { key: 'amount', label: '송금 대기 금액', width: '110px', align: 'end' },
  { key: 'payer', label: '결제자', width: '112px' },
  { key: 'waiting', label: '대기', width: '80px' },
  { key: 'action', label: '처리', width: '94px', required: true },
  { key: 'type', label: '유형', width: '60px' },
  { key: 'order', label: '주문번호', width: '164px' },
  { key: 'confirmed', label: '취소 확정일', width: '144px' },
  { key: 'filed', label: '환불 접수일', width: '144px' },
  { key: 'requester', label: '요청자', width: '92px' },
];

const waitingDays = (confirmedAt: string, now: Date) => Math.max(0, Math.floor((now.getTime() - Date.parse(confirmedAt)) / 86_400_000));

export function RefundTransfersScreen({ data, now = new Date() }: {
  data: RefundTransferPage;
  /** 대기 일수 기준 시각. 테스트 주입용. */
  now?: Date;
}) {
  const sum = data.rows.reduce((total, row) => total + row.amount, 0);
  const longWaiting = data.rows.filter(row => waitingDays(row.confirmedAt, now) >= LONG_WAIT_DAYS).length;
  const unnamed = data.rows.filter(row => !row.payerName).length;
  const wholeList = data.total <= data.rows.length;
  return <section className="flex min-w-0 flex-col gap-4 text-sm text-foreground" aria-label="환불 송금 대기" data-admin-kit="refund-transfers">
    <SalesGuide title="실제 송금이 남은 무통장 환불을 확인하세요.">
      <p>주문 취소와 재고 복원은 확정됐으며, 결제자에게 환불금을 보내는 단계입니다. 요청 상세에서 환불 접수와 계좌를 확인한 뒤 송금하고, 실제 송금 증빙을 기록하면 이 목록에서 제외됩니다.</p>
      <p>선물의 결제자와 요청자는 다를 수 있습니다. 환불은 결제자 기준으로 처리하며 계좌 원문은 권한이 있는 담당자가 요청 상세에서 열람합니다.</p>
    </SalesGuide>
    {data.rows.length ? <AdminNotice tone="warning" title={<span className="flex flex-wrap items-baseline gap-x-2">{wholeList ? '보낼 돈 합계' : '이 페이지 보낼 돈 합계'}<span className="text-lg tabular-nums" data-refund-transfer-sum="">{formatKrwExact(sum)}</span></span>}>
      {wholeList ? `${data.rows.length.toLocaleString('ko-KR')}건` : `전체 ${data.total.toLocaleString('ko-KR')}건 중 이 페이지 ${data.rows.length.toLocaleString('ko-KR')}건`}
      {longWaiting ? ` · ${LONG_WAIT_DAYS}일 이상 기다린 요청 ${longWaiting.toLocaleString('ko-KR')}건` : ''}
      {unnamed ? ` · 결제자 이름 미등록 ${unnamed.toLocaleString('ko-KR')}건은 송금 전에 확인해주세요.` : ''}
    </AdminNotice> : null}
    <ConsoleListCard title="목록" total={data.total}
      actions={<a className={cn(buttonVariants({ size: 'sm', variant: 'outline' }))} data-slot="button" href={refundTransfersHref(data.page)}>새로고침</a>}>
    <ConsoleGrid caption="무통장 환불 송금 대기 목록" preferencesKey="sales-refund-transfers" columns={columns}
      emptyLabel="송금 대기 중인 무통장 환불이 없습니다." rows={data.rows.map(row => {
        const detailHref = `/admin/sales/claims/${row.claimType === 'cancel' ? 'cancels' : 'returns'}/${row.claimId}`;
        const days = waitingDays(row.confirmedAt, now);
        const waiting = days === 0 ? '오늘' : `${days.toLocaleString('ko-KR')}일째`;
        return { id: row.claimId, href: detailHref,
          cells: [<span className="tabular-nums" key="claim">{orderClaimReferenceLabel(row.reference)}</span>,
            <span className="font-semibold tabular-nums" key="amount">{formatKrwExact(row.amount)}</span>,
            row.payerName || <AdminStatusBadge key="payer" tone="warning">이름 미등록</AdminStatusBadge>,
            days >= LONG_WAIT_DAYS ? <AdminStatusBadge key="waiting" tone="warning">{waiting}</AdminStatusBadge> : <span className="tabular-nums" key="waiting">{waiting}</span>,
            <Link aria-label={`요청 ${orderClaimReferenceLabel(row.reference)} 계좌 확인·송금 기록 열기`} className={cn(buttonVariants({ size: 'sm', variant: 'soft' }))} data-slot="button" href={`${detailHref}#claim-process`} key="action">송금 처리</Link>,
            `${row.gift ? '선물 · ' : ''}${row.claimType === 'cancel' ? '취소' : '반품'}`,
            <span className="tabular-nums" key="order">{orderReferenceLabel(row.orderId, row.orderNumber)}</span>,
            formatOrderDateTime(row.confirmedAt), row.filedAt ? formatOrderDateTime(row.filedAt) : <AdminStatusBadge key="filed" tone="warning">미접수</AdminStatusBadge>,
            row.requesterName || <span className="text-muted-foreground" key="requester">이름 미등록</span>],
        };
      })} />
    <ConsolePagination label="환불 송금 대기 목록 페이지" page={data.page} pageSize={data.pageSize} total={data.total} hrefForPage={refundTransfersHref} />
    </ConsoleListCard>
  </section>;
}
