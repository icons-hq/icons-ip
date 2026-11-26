import Link from 'next/link';
import { AdminNotice } from '@/components/admin/console/AdminKit';
import { krw } from '@/lib/format';
import { orderPartialCancellationSummary } from '@/lib/orders/partial-cancellation';
import type { AdminClaimPartialReturn } from '@/lib/orders/partial-return';
import { adminOrderSearchHref } from '@/lib/admin/orders';
import { ADMIN_SUPPORT_CODE_LABEL } from '@/lib/admin/payment-cancel-error';
import { ClaimPartialReturnTransfer } from './ClaimPartialReturnTransfer';

const STATE_LABELS: Record<string, string> = {
  processing: '결제사 부분 취소 전 — [환불 완료 확정]을 누르면 결제사에 부분 취소를 요청하고 결과를 확인합니다',
  needs_review: '결제확인필요 — [환불 완료 확정]을 다시 눌러 확인합니다. 그래도 끝나지 않으면 결제 담당이 주문 상세의 부분 환불 기록에서 [결제사 잔액 조회해 해소]를 누릅니다',
  awaiting_transfer: '환불 송금 대기 — 송금한 뒤 주문 상세의 부분 환불 기록에서 [송금 완료 기록]을 누릅니다',
  completed: '환불 완료',
  rejected: '결제사가 부분 취소를 받지 않음(돈은 움직이지 않음)',
};
/* 이름표에 없는 원장 상태는 영문 값을 그대로 내지 않고 이 말로 받는다(화면 규칙 8). */
const UNKNOWN_STATE_LABEL = '확인 필요';

const FEE_REASON_LABELS: Record<string, string> = {
  disabled: '반품배송비 차감이 꺼져 있습니다',
  seller_fault: '하자·오배송(판매자 귀책)이라 차감하지 않습니다',
  requested_before_enabled: '차감을 켜기 전에 접수한 반품이라 차감하지 않습니다',
  carrier_loss: '배송 분실 기록이 있어 차감하지 않습니다',
  claim_fee_invoiced: '같은 요청에 배송비 청구가 있어 차감하지 않습니다',
  fee_exceeds_refund: '반품배송비가 이번 환불액 이상이라 차감하지 않습니다(필요하면 배송비 청구)',
};

/**
 * 클레임 상세의 부분 반품 칸(ADR-0047). 고른 굿즈·수량, 환불 접수 전에는 계산 미리보기(DB가 같은 함수로 접수 때 정한다), 접수 뒤에는
 * 부분 환불 원장의 상태와 금액을 보인다. 주문 전체 클레임이면 그리지 않는다.
 */
export function ClaimPartialReturnPanel({ partialReturn, orderId, claimId }: {
  partialReturn: AdminClaimPartialReturn | null | undefined; orderId: string; claimId?: string;
}) {
  if (partialReturn === undefined) {
    return <AdminNotice tone="warning">부분 반품 정보를 읽지 못했습니다. 환불을 진행하기 전에 화면을 새로고침해주세요.</AdminNotice>;
  }
  if (!partialReturn) return null;
  const live = partialReturn.history.find((record) => record.id === partialReturn.refundId) ?? null;
  const refused = partialReturn.history.filter((record) => record.state === 'rejected');
  const preview = partialReturn.preview;
  return (
    <section aria-label="부분 반품" className="flex flex-col gap-2 text-sm" data-claim-partial-return>
      <h4 className="text-xs font-medium text-muted-foreground">부분 반품 — 고객이 고른 상품만 회수·환불합니다</h4>
      <ul className="flex flex-col gap-1">
        {partialReturn.items.map((item) => (
          <li className="flex items-baseline justify-between gap-3" key={item.orderItemId}>
            <span className="min-w-0 break-words">
              {item.goodName}{item.variantName ? <span className="ml-1.5 text-xs text-muted-foreground">{item.variantName}</span> : null}
              {item.originName ? <span className="ml-1.5 text-xs text-muted-foreground">{item.originName}</span> : null}
            </span>
            <span className="shrink-0 tabular-nums">{item.qty}개 / 주문 {item.orderedQty}개</span>
          </li>
        ))}
      </ul>
      {live ? (
        <p data-partial-return-refund={live.state}>
          <strong>{orderPartialCancellationSummary(live)}</strong>
          <span className="block text-xs text-muted-foreground">{STATE_LABELS[live.state] ?? UNKNOWN_STATE_LABEL}</span>
        </p>
      ) : preview ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1" data-partial-return-preview>
          <dt className="text-muted-foreground">상품 결제 몫</dt><dd className="tabular-nums">{krw(preview.goodsRefundAmount)}</dd>
          {preview.shippingRefundAmount > 0 ? <><dt className="text-muted-foreground">비게 된 배송 묶음 배송비</dt><dd className="tabular-nums">{krw(preview.shippingRefundAmount)}</dd></> : null}
          <dt className="text-muted-foreground">반품배송비</dt>
          <dd>{preview.returnFeeDeduction > 0
            ? `${krw(preview.returnFeeDeduction)} 차감(${preview.returnFeeBasis === 'round_trip' ? '왕복 — 최초 무료배송, 주문당 한 번' : '편도'})`
            : FEE_REASON_LABELS[preview.returnFeeReason ?? ''] ?? '차감 없음'}</dd>
          <dt className="font-medium">환불 예정</dt><dd className="font-medium tabular-nums">{krw(preview.refundAmount)}</dd>
          {preview.storeCreditRestoreAmount > 0 ? <><dt className="text-muted-foreground">적립금 되돌림</dt><dd className="tabular-nums">{krw(preview.storeCreditRestoreAmount)}</dd></> : null}
        </dl>
      ) : partialReturn.previewError ? (
        /* 코드는 문장에 섞지 않고 작은 글로 한 번만 보인다(처리 칸의 결제사 확인 오류와 같은 방식). */
        <AdminNotice tone="warning">
          부분 반품 환불 금액을 계산하지 못했습니다. 결제 수단, 상품별 결제 금액, 품목 상태 가운데 맞지 않는 것이 있습니다. 새로고침해도 같으면 요청번호와 아래 코드를 결제 담당자에게 알려주세요.
          <span className="mt-1 block text-xs text-muted-foreground" data-claim-support-code="">
            {ADMIN_SUPPORT_CODE_LABEL} <code className="font-mono">{partialReturn.previewError}</code>
          </span>
        </AdminNotice>
      ) : null}
      {refused.length && !live ? (
        <AdminNotice tone="warning">
          결제사가 이 결제의 부분 취소를 받지 않았습니다(돈은 움직이지 않았습니다). 전액 환불로 돌리지 마세요 — 결제 담당이 고객에게 환불계좌를 받아
          [계좌 송금 부분 환불로 전환]으로 환불 기한(입고 확인 뒤 3영업일) 안에 송금합니다. 결제사 설정이 바뀌었으면 [환불 접수 완료로 기록]을 다시 눌러 새로 시도할 수 있습니다.
        </AdminNotice>
      ) : null}
      {!live && partialReturn.transferConvertible && claimId && preview ? (
        <ClaimPartialReturnTransfer claimId={claimId} refundAmount={preview.refundAmount} />
      ) : null}
      {live && live.state === 'awaiting_transfer' && partialReturn.history.some((record) => record.state === 'rejected') ? (
        <p className="text-xs text-muted-foreground" data-partial-return-converted="">
          결제사가 부분 취소를 받지 않아 계좌 송금으로 바꾼 환불입니다. 송금한 금액은 결제사에 남은 결제 금액에서 빠지지 않아 결제사 기록과 달라졌으므로, 이후 이 주문의 일부 반품은 받지 않습니다.
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        환불 금액은 [환불 접수 완료로 기록]을 누를 때 정해지고 바뀌지 않습니다. 남은 상품은 주문에 그대로 남고, 남은 상품을 모두 반품하면 주문 전체 반품으로 받습니다.{' '}
        <Link className="underline" href={adminOrderSearchHref(orderId)}>주문 상세의 부분 환불 기록</Link>
      </p>
    </section>
  );
}
