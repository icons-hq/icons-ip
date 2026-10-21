import { ConsoleGrid, ConsolePagination, type ConsoleGridColumn } from '@/components/admin/console';
import { SalesGuide } from '@/components/admin/sales/SalesConsole';
import { formatKrwExact } from '@/components/admin/format';
import { formatOrderDateTime, orderReferenceLabel } from '@/lib/orders';
import { orderClaimReferenceLabel } from '@/lib/orders/claims';
import { refundTransfersHref, type RefundTransferPage } from '@/lib/admin/refund-transfers';

const columns: ConsoleGridColumn[] = [
  { key: 'claim', label: '요청번호', width: '120px', required: true },
  { key: 'order', label: '주문번호', width: '120px' },
  { key: 'type', label: '유형', width: '100px' },
  { key: 'payer', label: '결제자', width: '140px' },
  { key: 'requester', label: '요청자', width: '140px' },
  { key: 'amount', label: '송금 대기 금액', width: '150px', align: 'end' },
  { key: 'confirmed', label: '취소 확정일', width: '170px' },
  { key: 'filed', label: '환불 접수일', width: '170px' },
];

export function RefundTransfersScreen({ data }: { data: RefundTransferPage }) {
  return <section className="admin-console admin-sales-console" aria-label="환불 송금 대기">
    <SalesGuide title="실제 송금이 남은 무통장 환불을 확인하세요.">
      <p>주문 취소와 재고 복원은 확정됐으며, 결제자에게 환불금을 보내는 단계입니다. 요청 상세에서 환불 접수와 계좌를 확인한 뒤 송금하고, 실제 송금 증빙을 기록하면 이 목록에서 제외됩니다.</p>
      <p>선물의 결제자와 요청자는 다를 수 있습니다. 환불은 결제자 기준으로 처리하며 계좌 원문은 권한이 있는 담당자가 요청 상세에서 열람합니다.</p>
    </SalesGuide>
    <div className="admin-sales-results">
      <div className="admin-sales-results-heading"><h2>송금 대기 <span>(총 <strong>{data.total.toLocaleString('ko-KR')}</strong>건)</span></h2><a className="btn btn-sm btn-ghost" href={refundTransfersHref(data.page)}>새로고침</a></div>
      <ConsoleGrid caption="무통장 환불 송금 대기 목록" preferencesKey="sales-refund-transfers" columns={columns}
        emptyLabel="송금 대기 중인 무통장 환불이 없습니다." rows={data.rows.map(row => ({ id: row.claimId,
          href: `/admin/sales/claims/${row.claimType === 'cancel' ? 'cancels' : 'returns'}/${row.claimId}`,
          cells: [<span className="mono" key="claim">{orderClaimReferenceLabel(row.reference)}</span>,
            <span className="mono" key="order">{orderReferenceLabel(row.orderId, row.orderNumber)}</span>,
            `${row.gift ? '선물 · ' : ''}${row.claimType === 'cancel' ? '취소' : '반품'}`, row.payerName || '이름 미등록', row.requesterName || '이름 미등록',
            formatKrwExact(row.amount), formatOrderDateTime(row.confirmedAt), row.filedAt ? formatOrderDateTime(row.filedAt) : '미접수'],
        }))} />
      <ConsolePagination label="환불 송금 대기 목록 페이지" page={data.page} pageSize={data.pageSize} total={data.total} hrefForPage={refundTransfersHref} />
    </div>
  </section>;
}
