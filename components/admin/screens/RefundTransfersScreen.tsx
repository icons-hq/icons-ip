import Link from 'next/link';
import { ConsoleGrid, ConsoleListCard, ConsolePagination, type ConsoleGridColumn } from '@/components/admin/console';
import { AdminNotice, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { SalesGuide, kstDayDiff } from '@/components/admin/sales/SalesConsole';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { cn } from 'cn';
import { formatKrwExact } from '@/components/admin/format';
import { formatOrderDateTime, orderReferenceLabel } from '@/lib/orders';
import { orderClaimReferenceLabel } from '@/lib/orders/claims';
import { BANK_REFUND_LABELS } from '@/lib/admin/bank-transfer-refund';
import { REFUND_TRANSFERS_PATH, refundTransferDetailHref, refundTransferRecordPlace, refundTransferRowKey, refundTransferTypeLabel, refundTransfersHref, type RefundTransferPage } from '@/lib/admin/refund-transfers';
import { AdminListExportButton } from '@/components/admin/AdminListExportButton';
import { ADMIN_LIST_EXPORT_BUTTON_LABEL, adminListExportHref } from '@/lib/admin/list-export';

/* 환불 송금 대기(무통장 환불의 실제 송금이 남은 요청) — 템플릿 룩(ADR-0028). 목록은 공용 ConsoleGrid다.
 * 목록 RPC는 계좌를 싣지 않는다 — 화면에서 계좌번호 전체 보기와 송금 완료 기록은 요청 상세의 무통장 환불 칸에서만 한다. 그 칸으로 가는 버튼이 어느 화면에서 기록하는지 말한다.
 * 송금에 쓸 계좌는 비밀번호를 건 목록 엑셀로도 받는다(1007-047·048). 내려받을 때 서버가 요청별 계좌 열람을 기록한다.
 * 무통장 주문의 재고 부족 부분 취소(ADR-0032)도 같은 줄 순서로 섞인다 — 그 송금 완료는 주문 상세의 부분 취소 기록에서 적는다. */

/** 취소 확정 뒤 이 날수 이상 지난 요청을 주의로 표시한다. 약관의 환급 기한(3영업일)에 맞춘 눈금이고 처리 판정이 아니다. */
const LONG_WAIT_DAYS = 3;

/* 번호(주문 + 요청) → 유형 → 돈·사람·행동 순서다. 날짜는 그 뒤다. 부분 환불 줄은 요청번호가 없어 번호 칸에 주문번호만 있고 유형이 차수를 말한다. */
const columns: ConsoleGridColumn[] = [
  { key: 'claim', label: '주문 · 요청번호', width: '172px', required: true },
  { key: 'type', label: '유형', width: '128px' },
  { key: 'amount', label: '송금할 금액', width: '110px', align: 'end' },
  { key: 'payer', label: '결제자', width: '112px' },
  { key: 'waiting', label: '대기', width: '80px' },
  { key: 'action', label: '송금 기록', width: '140px', required: true },
  { key: 'confirmed', label: '취소 확정일', width: '144px' },
  { key: 'filed', label: '환불 접수일', width: '144px' },
  { key: 'requester', label: '요청자', width: '92px' },
];

/* 한국 달력으로 센다. 어제 밤에 확정된 요청이 '오늘'로 보이면 하루 묵은 송금을 놓친다. */
const waitingDays = (confirmedAt: string, now: Date) => Math.max(0, kstDayDiff(Date.parse(confirmedAt), now.getTime()));

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
    <SalesGuide title="취소는 확정됐고 은행 송금만 남은 무통장 환불입니다.">
      <p>계좌는 [{ADMIN_LIST_EXPORT_BUTTON_LABEL}]로 한꺼번에 받거나 줄마다 상세에서 봅니다. 받거나 볼 때마다 누가 언제 봤는지 요청별로 기록이 남습니다.</p>
      <p>은행에서 송금한 뒤 상세에서 [{BANK_REFUND_LABELS.complete_transfer}]을 남겨야 이 목록에서 빠집니다. 선물 주문도 결제자에게 보냅니다.</p>
    </SalesGuide>
    {data.rows.length ? <AdminNotice tone="warning" title={<span className="flex flex-wrap items-baseline gap-x-2">{wholeList ? '보낼 돈 합계' : '이 페이지 보낼 돈 합계'}<span className="text-lg tabular-nums" data-refund-transfer-sum="">{formatKrwExact(sum)}</span></span>}>
      {wholeList ? `${data.rows.length.toLocaleString('ko-KR')}건` : `전체 ${data.total.toLocaleString('ko-KR')}건 중 이 페이지 ${data.rows.length.toLocaleString('ko-KR')}건`}
      {longWaiting ? ` · ${LONG_WAIT_DAYS}일 이상 기다린 요청 ${longWaiting.toLocaleString('ko-KR')}건` : ''}
      {unnamed ? ` · 결제자 이름이 없는 ${unnamed.toLocaleString('ko-KR')}건은 송금 전에 상세에서 확인해주세요.` : ''}
    </AdminNotice> : null}
    <ConsoleListCard title="목록" total={data.total}
      actions={<div className="flex flex-wrap items-start gap-2">
        <a className={cn(buttonVariants({ size: 'sm', variant: 'outline' }))} data-slot="button" href={refundTransfersHref(data.page)}>새로고침</a>
        <AdminListExportButton href={adminListExportHref('refund-transfers', REFUND_TRANSFERS_PATH)} total={data.total} />
      </div>}>
    <ConsoleGrid caption="무통장 환불 송금 대기 목록" preferencesKey="sales-refund-transfers" columns={columns}
      emptyLabel="송금 대기 중인 무통장 환불이 없습니다." rows={data.rows.map(row => {
        const processHref = refundTransferDetailHref(row);
        const detailHref = processHref.replace(/#.*$/, '');
        const days = waitingDays(row.confirmedAt, now);
        const waiting = days === 0 ? '오늘' : `${days.toLocaleString('ko-KR')}일째`;
        const partial = row.kind === 'partial_cancellation';
        const orderLabel = orderReferenceLabel(row.orderId, row.orderNumber);
        const claimLabel = row.kind === 'partial_cancellation' ? null : orderClaimReferenceLabel(row.reference);
        const type = refundTransferTypeLabel(row);
        const place = refundTransferRecordPlace(row);
        /* 요청은 [환불 접수 기록]이 남아야 계좌를 보고 송금할 수 있다 — 아직이면 주의로 알린다. 부분 환불 줄은 접수 단계가 따로 없다. */
        const filed = row.filedAt ? formatOrderDateTime(row.filedAt) : partial ? '-' : <AdminStatusBadge key="filed" tone="warning">접수 전</AdminStatusBadge>;
        return { id: refundTransferRowKey(row), href: detailHref,
          cells: [
            <span className="flex flex-col" key="claim"><span className="tabular-nums">{orderLabel}</span>{claimLabel ? <span className="text-xs font-normal text-muted-foreground tabular-nums">요청 {claimLabel}</span> : null}</span>,
            type,
            <span className="font-semibold tabular-nums" key="amount">{formatKrwExact(row.amount)}</span>,
            row.payerName || <AdminStatusBadge key="payer" tone="warning">이름 없음</AdminStatusBadge>,
            days >= LONG_WAIT_DAYS ? <AdminStatusBadge key="waiting" tone="warning">{waiting}</AdminStatusBadge> : <span className="tabular-nums" key="waiting">{waiting}</span>,
            <Link aria-label={claimLabel ? `요청 ${claimLabel} 상세에서 계좌를 보고 송금을 기록` : `주문 ${orderLabel} 상세의 ${type} 기록에서 계좌를 보고 송금을 기록`}
              className={cn(buttonVariants({ size: 'sm', variant: 'soft' }))} data-slot="button" href={processHref} key="action">{place}에서 기록</Link>,
            formatOrderDateTime(row.confirmedAt),
            filed,
            partial ? <span className="text-muted-foreground" key="requester">운영자 처리</span> : row.requesterName || '-',
          ],
        };
      })} />
    <ConsolePagination label="환불 송금 대기 목록 페이지" page={data.page} pageSize={data.pageSize} total={data.total} hrefForPage={refundTransfersHref} />
    </ConsoleListCard>
  </section>;
}
