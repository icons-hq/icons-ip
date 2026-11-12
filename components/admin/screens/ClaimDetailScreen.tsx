import { ClaimCollectionPlan } from '@/components/orders/ClaimCollectionPlan';
import { ClaimFeePanel } from '@/components/orders/ClaimFeePanel';

import { GoodsCustomInputsSummary } from '@/components/shop/GoodsCustomInputs';
import { ShipmentDetails } from '@/components/shop/ShipmentDetails';
import type { ReactNode } from 'react';
import { Clock } from 'lucide-react';
import { AdminNotice, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { LARGE_STATUS_BADGE_CLASS } from '@/components/admin/sales/OrderStatusBadge';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { cn } from 'cn';
import { Card, CardContent, CardHeader } from '@/components/admin/kit/ui/card';
import { ADMIN_VOCABULARY as V } from '@/lib/admin/vocabulary';
import { adminClaimReasonText } from '@/lib/admin/claims';
import Link from 'next/link';
import type { AdminClaimDetail } from '@/lib/admin/claims.server';
import { adminClaimStageLabel } from '@/lib/admin/claims';
import { ADMIN_WITHDRAWAL_RETURN_SHIPPING_LABELS, adminOrderSearchHref } from '@/lib/admin/orders';
import { krw } from '@/lib/format';
import { statusTone } from '@/lib/admin/status-tone';
import {
  formatOrderDateTime,
  orderReferenceLabel,
  paymentStatusLabel,
  refundStatusLabel,
} from '@/lib/orders';
import {
  isOpenOrderClaimStage,
  ORDER_CLAIM_REFUND_METHOD_LABELS,
  ORDER_CLAIM_TYPE_LABELS,
  orderClaimReferenceLabel,
  orderClaimSlaState,
} from '@/lib/orders/claims';
import type { ShippingCarrierRegistry } from '@/lib/orders/shipment';
import { ClaimWithdrawal } from '@/components/orders/ClaimWithdrawal';
import { ClaimTypeConversion } from '@/components/admin/ClaimTypeConversion';
import { ClaimReasonChange } from '@/components/admin/ClaimReasonChange';
import { ClaimActionPanel } from './ClaimActionPanel';
import { ClaimPreviewFullScreenLink } from './ClaimPreviewDialog';
import { ClaimOperationalFeePanel } from './ClaimOperationalFeePanel';
import { ClaimReshipmentDelivery } from './ClaimReshipmentDelivery';
import { SellerClaimIntakeEvidence } from './SellerClaimIntakeEvidence';
import { ClaimExchangeSteps, ClaimProgressSummary } from './ClaimProgressSummary';
import { ClaimContactOperations } from '@/components/admin/ClaimContactOperations';
import { adminPaymentCancelErrorLabel } from '@/lib/admin/payment-cancel-error';
import { ClaimContactHistory } from '@/components/claim-contact/ClaimContactHistory';
import { adminClaimPendingReshipments, adminClaimRemainingReshipments } from '@/lib/admin/claim-reshipments';

/* 어드민 클레임 상세(#252) — 템플릿 룩 kit Card(ADR-0028).
 *
 * 왼쪽이 주문 맥락, 오른쪽이 처리다(처리 박스가 오른쪽 맨 위). 운영자가 승인 버튼을 누르기 전에 확인해야 하는
 * 것 — 품목·금액·결제사·뽑기권 발급/사용 여부·환불계좌 — 이 전부 이 화면에 있어야
 * 한다. 뽑기권을 보여주는 이유는 취소·반품 완료가 미개봉 카드팩을 회수하기
 * 때문이다(약관 제17조): 이미 개봉된 카드팩은 회수되지 않으므로, 개봉 이력이 있는
 * 주문의 취소는 사람이 한 번 더 봐야 한다.
 *
 * 타임라인은 감사 로그를 그대로 읽는다. 별도 이력 테이블을 만들면 감사와 화면이
 * 갈라지고, 갈라지면 어느 쪽이 사실인지 알 수 없다.
 *
 * 회수 계획·배송비 청구·요청 철회(components/orders)는 고객 화면과 같이 쓰는 부품이라 모양을 그대로 두고
 * kit Card로 감싸기만 한다. */

const TIMELINE_LABELS: Record<string, string> = {
  'admin.order.claim_intake_created': '판매자 대리 접수',
  'order.claim_withdrawn': '고객 요청 철회',
  'order.claim_refund_account_confirmed': '고객 환불계좌 등록',
  'admin.order.bank_refund_confirm_cancellation': '무통장 취소 확정 · 송금대기',
  'admin.order.bank_refund_file_transfer': '계좌 송금 접수',
  'admin.order.bank_refund_complete_transfer': '실제 송금 완료 확인',
  'admin.order.bank_refund_account_viewed': '송금 목적 환불계좌 열람',
  'order.claim_auto_approved': '자동 승인 (발주확인 전 취소)',
  /* 결제 가능 시간이 지난 결제 준비 건을 결제 없이 닫은 취소. 주문 상세 타임라인과 같은 이름이다. */
  'order.prepared_goods_cancellation_completed': '결제 준비 건 취소 완료 (구매자 취소)',
  'system.order.prepared_goods_cancellation_completed': '결제 준비 건 취소 완료 (자동)',
  'system.order.unpaid_cart_order_closed': '결제 대기 주문 자동 취소 (재주문·장바구니 복귀)',
  'system.order.cart_hold_detached': '장바구니 보류 해제 (결제 확인 필요 주문)',
  'admin.order.prepared_goods_cancellation_completed': '결제 준비 건 취소 완료',
  'admin.order.claim_in_review': '검토중으로 변경',
  'admin.order.claim_approved': '승인',
  'admin.order.claim_rejected': '거부',
  'admin.order.claim_held': '보류',
  'admin.order.claim_resumed': '보류 해제',
  'admin.order.claim_collected': '수거·입고',
  'admin.order.claim_origin_collected': '출고지 회수 확인',
  'admin.order.claim_contact_changed': '회수·재배송 주소 정정',
  'admin.order.claim_collection_corrected': '회수 방법·송장 정정',
  'admin.order.claim_fee_issue': '반품·교환 배송비 청구',
  'order.claim_fee_report_payment': '배송비 고객 입금 알림',
  'admin.order.claim_fee_confirm_payment': '배송비 실제 입금 확인',
  'admin.order.claim_fee_waive': '배송비 청구 면제',
  'admin.order.claim_fee_cancel': '배송비 청구 취소',
  'admin.order.claim_fee_refund': '배송비 실제 반환 완료',
  'admin.order.claim_refund_filed': '환불 접수',
  'admin.order.claim_refund_completed': '환불 완료',
  'admin.order.claim_reshipped': '교환 재출고',
  'admin.order.claim_reshipment_delivered': '교환품 배송완료 확인',
  'admin.order.claim_evidence_uploaded': '회수 생략 근거 사진 등록',
  'admin.order.claim_collection_waived': '회수 생략 결정',
  'admin.order.claim_collection_reopened': '회수 생략 무효로 수거중 복귀',
  'admin.order.claim_type_changed': '반품·교환 유형 전환',
  'admin.order.claim_reason_changed': '교환 사유 정정',
  'admin.order.cancellation_approved': '청약철회 승인 (레거시 경로)',
  'admin.order.cancellation_rejected': '청약철회 거절 (레거시 경로)',
  'admin.order.cancellation_completed': '결제 취소 확인 · 주문 취소 완료',
  'system.order.cancellation_completed': '결제 취소 확인 · 주문 취소 완료 (자동)',
  'admin.order.cancellation_needs_review': '결제 취소 확인 필요',
  'system.order.cancellation_needs_review': '결제 취소 확인 필요 (자동)',
  'admin.order.cancellation_reconcile_started': '결제 취소 다시 확인',
  'admin.order.staff_cancellation_started': '운영자 전액 취소 시작',
};

const PAYMENT_PROVIDER_LABELS: Record<string, string> = {
  bank_transfer: '무통장 입금',
  toss: '토스페이먼츠',
  korpay: 'Korpay',
};

const ORDER_STATUS_LABELS: Record<string, string> = {
  pending: '결제 대기',
  paid: '신규주문',
  confirmed: '발주확인',
  shipping: '배송중',
  delivered: '배송완료',
  done: '거래확정',
  canceled: '취소',
};

/* 환급 기한이 실제로 계산된 때만 머리에 적는다. 버튼으로 오해받지 않게 알약이 아니라 시계 아이콘 + 글자이고, 임박·초과만 의미색을 입는다. */
const SLA_TEXT_CLASS = 'inline-flex items-center gap-1 tabular-nums text-muted-foreground data-[sla-tone=warning]:font-semibold data-[sla-tone=warning]:text-warning data-[sla-tone=danger]:font-semibold data-[sla-tone=danger]:text-destructive';
/* 구역 바로가기 — 셸의 콘솔 전환과 같은 모양의 구분 선택. */
const SECTION_LINK_CLASS = 'inline-flex h-7 items-center rounded-md px-3 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:bg-background hover:text-foreground';
const OUTLINE_SM = `${cn(buttonVariants({ size: 'sm', variant: 'outline' }))} w-fit`;
const ROW_INLINE = 'flex flex-wrap items-center gap-2';

/* 배송 건(출고지)별 재출고(TKT-166)는 감사 기록에 출고지와 회수 생략 여부가 함께 있다. 같은 이름의 줄이 여러 개여도 어느 출고지인지 보이게 한다. */
function timelineLabel(entry: AdminClaimDetail['timeline'][number]) {
  const label = TIMELINE_LABELS[entry.action] ?? entry.action;
  if (entry.action !== 'admin.order.claim_reshipped' && entry.action !== 'admin.order.claim_reshipment_delivered'
    && entry.action !== 'admin.order.claim_collection_waived') return label;
  const origin = typeof entry.diff?.originName === 'string' && entry.diff.originName ? ` · ${entry.diff.originName}` : '';
  return `${label}${origin}${entry.diff?.collectionWaived === true ? ' (회수 생략)' : ''}`;
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(5.5rem,8rem)_minmax(0,1fr)] gap-3 border-b py-2 last:border-b-0" data-claim-summary-row="">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words">{value}</span>
    </div>
  );
}

function CardHeading({ children }: { children: string }) {
  return <CardHeader><h3 className="text-base leading-snug font-medium text-foreground">{children}</h3></CardHeader>;
}

export function ClaimDetailScreen({
  actorId,
  backHref,
  carriers,
  cancellationForm,
  detail,
  detailHref,
  embedded = false,
  now = new Date(),
}: {
  actorId?: string;
  backHref: string;
  carriers: ShippingCarrierRegistry;
  /** 코페이 취소 접수 양식. 카드 결제가 아니면 null이다. */
  cancellationForm: string | null;
  detail: AdminClaimDetail;
  /** 팝업(embedded)에서 같은 요청을 전체 화면 상세로 여는 주소. */
  detailHref?: string;
  /**
   * 목록 위 팝업으로 그린다(R8). 대화상자가 제목과 닫기를 맡으므로 뒤로가기 링크와 h2를
   * 빼고, 처리 패널·유형 전환은 상세 화면과 같은 것을 그대로 쓴다.
   */
  embedded?: boolean;
  now?: Date;
}) {
  const { cardPacks, claim, order, payment, refund, refundAccount, timeline } = detail;
  const typeLabel = ORDER_CLAIM_TYPE_LABELS[claim.claimType];
  const sla = orderClaimSlaState(
    {
      claimType: claim.claimType,
      stage: claim.stage,
      collectedAt: claim.collectedAt,
      completedAt: claim.completedAt,
    },
    now,
  );

  /* 아직 끝나지 않은 요청만 처리 박스를 강조한다 — 종결된 요청에서 눈을 끌 이유가 없다. */
  const awaitsOperator = isOpenOrderClaimStage(claim.stage);

  const collectionContactBody = actorId && claim.claimType !== 'cancel' ? <>
    <ClaimCollectionPlan actorId={actorId} claimId={claim.id} operator carriers={carriers} />
    {/* 재출고는 배송 건(출고지)마다 최종 주소를 확인하고 등록한다. 회수 확인 전 배송 건은 하자·오배송 교환일 때만 회수 없이 보낼 수 있다. */}
    <ClaimContactOperations actorId={actorId} orderId={claim.orderId} claimId={claim.id}
      reshipTargets={claim.collectionPolicy !== null ? adminClaimPendingReshipments(claim) : []}
      remainingTargets={adminClaimRemainingReshipments(claim)}
      carriers={carriers} reshipItems={order?.items ?? []} />
    <ClaimContactHistory actorId={actorId} orderId={claim.orderId} claimId={claim.id} operator />
  </> : null;
  /* 반품은 이 내용이 단계 칸 안에 들어간다. 카드 안의 카드로 겹치지 않게 구분선으로만 나눈다(강조 테두리는 지금 단계 한 겹이다). */
  const collectionContact = claim.claimType === 'return'
    ? collectionContactBody ? <div className="flex min-w-0 flex-col gap-4 border-t pt-4">{collectionContactBody}</div> : null
    : collectionContactBody ? <Card><CardContent className="flex min-w-0 flex-col gap-4">{collectionContactBody}</CardContent></Card> : null;
  /* 교환에서 가장 먼저 보는 정보다. 바꿀 옵션을 따로 받는 칸은 없어 고객이 남긴 요청 글과 지금 주문의 상품·옵션을 처리 칸 맨 위에 함께 보인다. */
  const exchangeRequest = claim.claimType === 'exchange' ? <section aria-label="교환 요청 내용" className="flex min-w-0 flex-col gap-1.5 rounded-lg border bg-muted/40 p-3" data-claim-exchange-request="">
    <h4 className="text-xs font-medium text-muted-foreground">고객이 남긴 교환 요청</h4>
    <p className="font-medium break-words whitespace-pre-wrap">{claim.reason}</p>
    <p className="text-muted-foreground">접수 사유 {adminClaimReasonText(claim.reasonType, claim.staffReasonCode)}{claim.reasonType !== 'staff' ? ` · ${ADMIN_WITHDRAWAL_RETURN_SHIPPING_LABELS[claim.reasonType]}` : ''}</p>
    {order?.items.length ? <ul className="flex flex-col gap-0.5 text-muted-foreground">
      {order.items.map(item => <li className="break-words" key={item.id}>지금 주문 · {item.name}{item.variantName ? ` · ${item.variantName}` : ''} × {item.qty}</li>)}
    </ul> : null}
  </section> : null;
  const refundSummaryBody = <>
      <div>
        <Row
          label="카드팩 발급"
          value={cardPacks.issued === 0
            ? '없음'
            : `${cardPacks.issued}개 (개봉 ${cardPacks.consumed} · 회수 ${cardPacks.revoked})`}
        />
        {claim.claimType === 'exchange' ? (
          <p className="mt-1.5 text-xs text-muted-foreground">
            교환은 카드팩을 회수하지 않습니다.
          </p>
        ) : cardPacks.consumed > 0 ? (
          <AdminNotice className="mt-1.5" tone="warning">
            이미 개봉된 카드팩 {cardPacks.consumed}개는 회수되지 않습니다(약관 제17조).
            승인 전에 확인해주세요.
          </AdminNotice>
        ) : null}
      </div>

      {refund ? (
        <div className="border-t pt-1">
          <Row label="환불 기록" value={<span className={ROW_INLINE}><AdminStatusBadge tone={statusTone('refund', refund.status)}>{refundStatusLabel(refund.status)}</AdminStatusBadge><span className="tabular-nums">{krw(refund.amount)}</span></span>} />
          <Row
            label="환불 수단"
            value={refund.method ? ORDER_CLAIM_REFUND_METHOD_LABELS[refund.method] : '미접수'}
          />
          <Row
            label="접수 · 완료"
            value={`${refund.filedAt ? formatOrderDateTime(refund.filedAt) : '-'} · ${refund.completedAt ? formatOrderDateTime(refund.completedAt) : '-'}`}
          />
          {refund.settlementNote ? (
            <Row label="상계 메모" value={refund.settlementNote} />
          ) : null}
          {refund.handlerName ? <Row label="처리자" value={`@${refund.handlerName}`} /> : null}
        </div>
      ) : (
        <p className="border-t pt-3 text-muted-foreground">
          {claim.claimType === 'exchange'
            ? '교환에는 환불 기록이 없습니다.'
            : '아직 환불 기록이 열리지 않았습니다.'}
        </p>
      )}

      {refundAccount ? (
        <div className="border-t pt-1">
          <Row label="환불계좌" value={refundAccount.maskedAccount} />
          <Row label="예금주" value={refundAccount.maskedHolder} />
          <p className="mt-1.5 text-xs text-muted-foreground">
            {refundAccount.purgedAt
              ? '원문은 파기됐습니다. 송금이 필요하면 구매자에게 다시 요청하세요.'
              : '기본 화면에는 마스킹된 계좌만 표시합니다. 무통장 환불 담당자는 아래 처리에서 열람 기록을 남긴 뒤 원문을 확인할 수 있습니다. 요청 종결 또는 교환 전환 후 30일이 지나면 원문을 파기합니다.'}
          </p>
        </div>
      ) : null}
  </>;
  const refundSummary = claim.claimType === 'return'
    ? <section aria-label="카드팩 · 환불" className="flex min-w-0 scroll-mt-16 flex-col gap-3 border-t pt-4 outline-none" id="claim-refund" tabIndex={-1}><h4 className="font-medium">카드팩 · 환불</h4>{refundSummaryBody}</section>
    : <Card id="claim-refund" tabIndex={-1} className="scroll-mt-16 outline-none"><CardHeading>카드팩 · 환불</CardHeading><CardContent className="flex flex-col gap-3">{refundSummaryBody}</CardContent></Card>;

  return (
    <section className="flex min-w-0 flex-col gap-4 text-sm text-foreground" data-admin-kit="claim-detail">
      {/* 지금 할 일(처리 칸)이 첫 화면에 오도록 머리는 한 줄로 모은다. 넓은 화면에서는 처리 칸이 바로 보여 처리하기 버튼을 두지 않는다. */}
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {embedded ? null : <>
          <Link className={OUTLINE_SM} data-slot="button" href={backHref}>← 목록으로</Link>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            {typeLabel} {orderClaimReferenceLabel(claim.reference)}
          </h2>
        </>}
        <AdminStatusBadge className={LARGE_STATUS_BADGE_CLASS} tone={statusTone('claim', claim.stage)}>{adminClaimStageLabel(claim.claimType, claim.stage)}</AdminStatusBadge>
        <p className="text-muted-foreground">
          {adminClaimReasonText(claim.reasonType, claim.staffReasonCode)}
          {' · 접수 '}
          <time dateTime={claim.requestedAt}>{formatOrderDateTime(claim.requestedAt)}</time>
        </p>
        {sla.tone !== 'muted' ? <span className={SLA_TEXT_CLASS} data-sla-tone={sla.tone}><Clock aria-hidden="true" className="size-3.5" />환급 기한 {sla.label}</span> : null}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {awaitsOperator ? <Link className={`${buttonVariants({ variant: 'soft' })} lg:hidden`} data-slot="button" href="#claim-process">처리하기</Link> : null}
          {embedded && detailHref ? <ClaimPreviewFullScreenLink href={detailHref} /> : null}
          <nav aria-label="클레임 상세 항목" className="inline-flex w-fit max-w-full flex-wrap gap-0.5 rounded-lg bg-muted p-0.5">
            <Link className={SECTION_LINK_CLASS} href="#claim-order">주문정보</Link>
            <Link className={SECTION_LINK_CLASS} href="#claim-request">요청·처리이력</Link>
            <Link className={SECTION_LINK_CLASS} href="#claim-process">{typeLabel} 처리</Link>
          </nav>
        </div>
      </header>
      <ClaimProgressSummary claim={claim} refund={refund} />

      <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card id="claim-order" className="scroll-mt-16">
            <CardHeading>주문 요약</CardHeading>
            <CardContent className="flex min-w-0 flex-col gap-3">
              {order ? (
                <>
                  <div>
                    <Row
                      label="주문번호"
                      value={<span className={ROW_INLINE}><span className="tabular-nums">{orderReferenceLabel(order.id, order.orderNumber)}</span><AdminStatusBadge tone={statusTone('order', order.status)}>{ORDER_STATUS_LABELS[order.status] ?? order.status}</AdminStatusBadge></span>}
                    />
                    <Row label="구매자" value={`${order.buyerName ?? '-'} (${order.buyerEmail ?? '이메일 없음'})`} />
                    {detail.gift ? <><Row label="선물 요청자" value={`${detail.gift.requesterName} · ${detail.gift.requesterRole === 'recipient' ? '선물 받는 분' : '구매자'}`} /><AdminNotice className="my-2" tone="warning">환불은 구매자의 결제수단으로 처리합니다. 받는 분에게 결제정보를 전달하지 마세요.</AdminNotice></> : null}
                    <Row label="결제금액" value={`${krw(order.total)} (배송비 ${krw(order.shippingFee)} 포함)`} />
                    <Row
                      label="결제사"
                      value={payment
                        ? <span className={ROW_INLINE}>{PAYMENT_PROVIDER_LABELS[payment.provider ?? ''] ?? payment.provider ?? '알 수 없음'}<AdminStatusBadge tone={statusTone('payment', payment.status)}>{paymentStatusLabel(payment.status)}</AdminStatusBadge></span>
                        : '결제 내역 없음'}
                    />
                    {order.transaction ? <><Row label="복수구매 할인" value={krw(order.transaction.totals.volumeDiscountTotal)} /><Row label="계약상 착불 배송비" value={`${krw(order.transaction.totals.collectShippingTotal)} · 온라인 환불금액에 포함되지 않음`} /></> : null}
                  </div>
                  {/* 배송 건의 품목 줄은 아래 주문 상품(옵션·금액 포함)과 겹친다. ShipmentDetails는 고객 화면과 함께 쓰는 부품이라 여기서만 감춘다. */}
                  <div className="[&_section>ul]:hidden"><ShipmentDetails admin shipments={order.shipments} items={order.items} transactionShipping={order.transaction?.shipping} /></div>
                  <section aria-label="주문 상품" className="flex flex-col gap-1.5 border-t pt-3">
                    <h4 className="text-xs font-medium text-muted-foreground">주문 상품</h4>
                    <ul className="flex flex-col gap-1.5">
                      {order.items.map((item, index) => (
                        <li className="flex items-baseline justify-between gap-3" key={`${item.name}-${index}`}>
                          <span className="min-w-0 break-words">
                            {item.name} × {item.qty}
                            {item.variantName ? <span className="ml-1.5 text-xs text-muted-foreground">{item.variantName}</span> : null}
                            <GoodsCustomInputsSummary selection={item.customInputs} />
                          </span>
                          <span className="shrink-0 tabular-nums">{krw(item.unitPrice * item.qty)}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                  <p className="text-xs text-muted-foreground">
                    {V.claimRequest}은 주문 단위 전액으로만 처리됩니다. 일부 품목만 불량이면 전체 반품, 또는 교환에서
                    하자·오배송 배송 건을 회수 없이 재출고하는 것으로 안내하고, 부분 환불을 약속하지 마세요.
                  </p>
                  <Link className={OUTLINE_SM} data-slot="button" href={adminOrderSearchHref(order.id)}>
                    주문 통합검색에서 열기
                  </Link>
                </>
              ) : (
                <p className="text-muted-foreground">주문 정보를 불러오지 못했습니다.</p>
              )}
            </CardContent>
          </Card>

          <Card id="claim-request" className="scroll-mt-16">
            <CardHeading>요청 내용</CardHeading>
            <CardContent className="flex min-w-0 flex-col gap-3">
              <p className="break-words whitespace-pre-wrap">{claim.reason}</p>
              {claim.staffNote || claim.decisionNote || claim.holdReason || claim.lastErrorCode || claim.reshipTrackingNumber || claim.reshipments?.length || claim.reshippedItems?.length ? <div>
                {claim.staffNote ? <Row label="운영 메모" value={claim.staffNote} /> : null}
                {claim.decisionNote ? <Row label="거부 사유" value={claim.decisionNote} /> : null}
                {claim.holdReason ? <Row label="보류 사유" value={claim.holdReason} /> : null}
                {claim.lastErrorCode ? (
                  <Row label="결제사 확인 오류" value={adminPaymentCancelErrorLabel(claim.lastErrorCode)} />
                ) : null}
                {claim.reshipments?.length ? claim.reshipments.map(row => <Row key={row.id} label={`재출고 운송장${row.originName ? ` · ${row.originName}` : ''}`}
                  value={`${row.carrierLabel ?? row.carrier} ${row.trackingNumber}${row.collectionWaived ? ' · 회수 생략' : ''}`} />)
                  : claim.reshipTrackingNumber ? (
                  <Row
                    label="재출고 운송장"
                    value={`${claim.reshipCarrier ?? ''} ${claim.reshipTrackingNumber}`}
                  />
                ) : null}
                {claim.reshippedItems?.map((item) => <Row key={item.orderItemId} label="재출고 상품"
                  value={`${item.name} · ${item.variantName} · ${item.variantCode} · ${item.qty}개`} />)}
              </div> : null}
              {detail.sellerIntake ? <SellerClaimIntakeEvidence intake={detail.sellerIntake} /> : null}

              <h4 className="font-medium">타임라인</h4>
              {timeline.length === 0 ? (
                <p className="text-muted-foreground">아직 기록된 처리가 없습니다.</p>
              ) : (
                <ol className="flex flex-col gap-1.5 border-l pl-4">
                  {timeline.map((entry, index) => (
                    <li className="break-words" key={`${entry.action}-${index}`}>
                      <time className="text-muted-foreground tabular-nums" dateTime={entry.createdAt}>{formatOrderDateTime(entry.createdAt)}</time>
                      {' · '}
                      {timelineLabel(entry)}
                      {entry.actorName ? ` · @${entry.actorName}` : ''}
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
          {/* 배송비 청구와 운영 확인액은 승인에 앞서 채우는 칸이 아니다 — 주문 맥락과 요청 아래에 둔다. */}
          {actorId && claim.claimType !== 'cancel' ? <Card><CardContent className="min-w-0"><ClaimFeePanel actorId={actorId} claimId={claim.id} operator /></CardContent></Card> : null}
          <ClaimOperationalFeePanel claimId={claim.id} claimType={claim.claimType} fee={claim.operationalFee} />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          {/* 승인·거부가 이 화면의 본론이다 — 처리 박스를 오른쪽 맨 위에 두고 진행 중인 요청은 주 색 테두리로 표시한다. 반품은 안쪽의 지금 단계 칸이 그 표시라 바깥 테두리를 겹치지 않는다. */}
          <Card id="claim-process" tabIndex={-1} className={`scroll-mt-16 outline-none${awaitsOperator && claim.claimType !== 'return' ? ' ring-2 ring-primary/40' : ''}`}>
            <CardContent className="flex min-w-0 flex-col gap-4">
              <ClaimActionPanel
                actorId={actorId}
                refundAmount={refund?.amount ?? order?.total ?? null}
                requestSummary={exchangeRequest}
                bankTransfer={payment?.provider === 'bank_transfer'}
                key={claim.id}
                cancellationForm={cancellationForm}
                carriers={carriers}
                claimId={claim.id}
                claimType={claim.claimType}
                collectionPolicy={claim.collectionPolicy}
                collectionComplete={claim.collectionComplete}
                collectedAt={claim.collectedAt}
                returnCollectionContact={claim.claimType === 'return' ? collectionContact : undefined}
                returnRefundSummary={claim.claimType === 'return' ? refundSummary : undefined}
                collections={claim.collections}
                heldFrom={claim.heldFrom}
                reshipmentStarted={claim.reshippedAt !== null || (claim.reshipments ?? []).length > 0}
                orderId={claim.orderId}
                paymentProvider={payment?.provider ?? null}
                recordedRefundMethod={refund?.method ?? null}
                refundCompleted={Boolean(refund?.completedAt)}
                refundFiled={Boolean(refund?.filedAt)}
                refundLedgerOpen={Boolean(refund)}
                reshipItems={order?.items}
                stage={claim.stage}
                exchangeSteps={claim.claimType === 'exchange' ? <ClaimExchangeSteps claim={claim} /> : undefined}
                exchangeShipping={claim.claimType === 'exchange' ? <ClaimReshipmentDelivery carriers={carriers} claim={claim} /> : undefined}
                secondaryActions={claim.claimType === 'exchange' ? <>
                  <ClaimWithdrawal claimId={claim.id} stage={claim.stage} operator />
                  <ClaimTypeConversion embedded={embedded} key={`${claim.id}-${claim.claimType}`} claimId={claim.id} />
                  <ClaimReasonChange key={`reason-${claim.id}`} claimId={claim.id} />
                </> : undefined}
              />
              {claim.claimType !== 'exchange' ? <>
                <ClaimReshipmentDelivery claim={claim} />
                <ClaimWithdrawal claimId={claim.id} stage={claim.stage} operator />
                {claim.claimType !== 'cancel' ? <ClaimTypeConversion embedded={embedded} key={`${claim.id}-${claim.claimType}`} claimId={claim.id} /> : null}
              </> : null}
            </CardContent>
          </Card>
          {claim.claimType !== 'return' ? <>{collectionContact}{refundSummary}</> : null}
        </div>
      </div>
    </section>
  );
}
