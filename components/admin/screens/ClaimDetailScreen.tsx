import { ClaimCollectionPlan } from '@/components/orders/ClaimCollectionPlan';
import { ClaimFeePanel } from '@/components/orders/ClaimFeePanel';

import { GoodsCustomInputsSummary } from '@/components/shop/GoodsCustomInputs';
import { ShipmentDetails } from '@/components/shop/ShipmentDetails';
import { ADMIN_VOCABULARY as V } from '@/lib/admin/vocabulary';
import { adminClaimReasonText } from '@/lib/admin/claims';
import Link from 'next/link';
import type { AdminClaimDetail } from '@/lib/admin/claims.server';
import { adminClaimStageLabel } from '@/lib/admin/claims';
import { adminOrderSearchHref } from '@/lib/admin/orders';
import { krw } from '@/lib/format';
import {
  formatOrderDateTime,
  orderReferenceLabel,
  refundStatusLabel,
} from '@/lib/orders';
import {
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
import { ClaimOperationalFeePanel } from './ClaimOperationalFeePanel';
import { ClaimReshipmentDelivery } from './ClaimReshipmentDelivery';
import { SellerClaimIntakeEvidence } from './SellerClaimIntakeEvidence';
import { ClaimProgressSummary } from './ClaimProgressSummary';
import { ClaimContactOperations } from '@/components/admin/ClaimContactOperations';
import { ClaimContactHistory } from '@/components/claim-contact/ClaimContactHistory';

/* 어드민 클레임 상세(#252).
 *
 * 왼쪽이 주문 맥락, 오른쪽이 처리다. 운영자가 승인 버튼을 누르기 전에 확인해야 하는
 * 것 — 품목·금액·결제사·뽑기권 발급/사용 여부·환불계좌 — 이 전부 이 화면에 있어야
 * 한다. 뽑기권을 보여주는 이유는 취소·반품 완료가 미개봉 카드팩을 회수하기
 * 때문이다(약관 제17조): 이미 개봉된 카드팩은 회수되지 않으므로, 개봉 이력이 있는
 * 주문의 취소는 사람이 한 번 더 봐야 한다.
 *
 * 타임라인은 감사 로그를 그대로 읽는다. 별도 이력 테이블을 만들면 감사와 화면이
 * 갈라지고, 갈라지면 어느 쪽이 사실인지 알 수 없다. */

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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="admin-claim-summary-row">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

export function ClaimDetailScreen({
  actorId,
  backHref,
  carriers,
  cancellationForm,
  detail,
  now = new Date(),
}: {
  actorId?: string;
  backHref: string;
  carriers: ShippingCarrierRegistry;
  /** 코페이 취소 접수 양식. 카드 결제가 아니면 null이다. */
  cancellationForm: string | null;
  detail: AdminClaimDetail;
  now?: Date;
}) {
  const { cardPacks, claim, order, payment, refund, refundAccount, timeline } = detail;
  const sla = orderClaimSlaState(
    {
      claimType: claim.claimType,
      stage: claim.stage,
      collectedAt: claim.collectedAt,
      completedAt: claim.completedAt,
    },
    now,
  );

  const collectionContact = actorId && claim.claimType !== 'cancel' ? <div className="card">
          <ClaimCollectionPlan actorId={actorId} claimId={claim.id} operator carriers={carriers} />
          <ClaimContactOperations actorId={actorId} orderId={claim.orderId} claimId={claim.id}
            canReship={claim.claimType === 'exchange' && claim.stage === 'collected' && claim.collectionPolicy !== null && claim.collectionComplete}
            carriers={carriers} reshipItems={order?.items ?? []} />
          <ClaimContactHistory actorId={actorId} orderId={claim.orderId} claimId={claim.id} operator />
        </div> : null;
  const refundSummary = <div className="card" id="claim-refund" tabIndex={-1}>
          <h3 style={{ marginTop: 0 }}>카드팩 · 환불</h3>
          <Row
            label="뽑기권 발급"
            value={cardPacks.issued === 0
              ? '없음'
              : `${cardPacks.issued}개 (개봉 ${cardPacks.consumed} · 회수 ${cardPacks.revoked})`}
          />
          {claim.claimType === 'exchange' ? (
            <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
              교환은 카드팩을 회수하지 않습니다.
            </p>
          ) : cardPacks.consumed > 0 ? (
            <p style={{ fontSize: 12, margin: '6px 0 0' }}>
              이미 개봉된 카드팩 {cardPacks.consumed}개는 회수되지 않습니다(약관 제17조).
              승인 전에 확인해주세요.
            </p>
          ) : null}

          <hr style={{ margin: '12px 0' }} />

          {refund ? (
            <>
              <Row label="환불 원장" value={`${refundStatusLabel(refund.status)} · ${krw(refund.amount)}`} />
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
            </>
          ) : (
            <p className="muted" style={{ fontSize: 12.5 }}>
              {claim.claimType === 'exchange'
                ? '교환에는 환불 원장이 없습니다.'
                : '아직 환불 원장이 열리지 않았습니다.'}
            </p>
          )}

          {refundAccount ? (
            <>
              <hr style={{ margin: '12px 0' }} />
              <Row label="환불계좌" value={refundAccount.maskedAccount} />
              <Row label="예금주" value={refundAccount.maskedHolder} />
              <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
                {refundAccount.purgedAt
                  ? '원문은 파기됐습니다. 송금이 필요하면 구매자에게 다시 요청하세요.'
                  : '기본 화면에는 마스킹된 계좌만 표시합니다. 무통장 환불 담당자는 아래 처리에서 열람 기록을 남긴 뒤 원문을 확인할 수 있습니다. 요청 종결 또는 교환 전환 후 30일이 지나면 원문을 파기합니다.'}
              </p>
            </>
          ) : null}
        </div>;

  return (
    <section className="admin-console admin-sales-console admin-claim-detail">
      <div className="admin-sales-detail-header">
        <div>
          <Link className="btn btn-sm btn-ghost" href={backHref}>← 목록으로</Link>
          <h2>
            {ORDER_CLAIM_TYPE_LABELS[claim.claimType]} {orderClaimReferenceLabel(claim.reference)}
          </h2>
          <p>
            {adminClaimStageLabel(claim.claimType, claim.stage)}
            {' · '}
            {adminClaimReasonText(claim.reasonType, claim.staffReasonCode)}
            {' · 접수 '}
            <time dateTime={claim.requestedAt}>{formatOrderDateTime(claim.requestedAt)}</time>
          </p>
        </div>
        <p data-sla-tone={sla.tone}>
          환급 기한 {sla.label}
        </p>
      </div>
      <nav className="admin-sales-detail-tabs" aria-label="클레임 상세 항목">
        <Link href="#claim-order">주문정보</Link><Link href="#claim-request">요청·처리이력</Link><Link href="#claim-process">처리</Link>
      </nav>
      <ClaimProgressSummary claim={claim} refund={refund} />

      <div className="admin-claim-detail-layout">
        <div className="admin-claim-detail-column">
        {actorId && claim.claimType !== 'cancel' ? <div className="card"><ClaimFeePanel actorId={actorId} claimId={claim.id} operator /></div> : null}
        <div className="card">
          <ClaimOperationalFeePanel claimId={claim.id} claimType={claim.claimType} fee={claim.operationalFee} />
        </div>
        <div className="card" id="claim-order">
          <h3 style={{ marginTop: 0 }}>주문 요약</h3>
          {order ? (
            <>
              <Row
                label="주문번호"
                value={`${orderReferenceLabel(order.id)} · ${ORDER_STATUS_LABELS[order.status] ?? order.status}`}
              />
              <Row label="구매자" value={`${order.buyerName ?? '-'} (${order.buyerEmail ?? '이메일 없음'})`} />
              {detail.gift ? <><Row label="선물 요청자" value={`${detail.gift.requesterName} · ${detail.gift.requesterRole === 'recipient' ? '선물 받는 분' : '구매자'}`} /><p>환불은 구매자의 결제수단으로 처리합니다. 받는 분에게 결제정보를 전달하지 마세요.</p></> : null}
              <Row label="결제금액" value={`${krw(order.total)} (배송비 ${krw(order.shippingFee)} 포함)`} />
              <Row
                label="결제사"
                value={payment
                  ? `${PAYMENT_PROVIDER_LABELS[payment.provider ?? ''] ?? payment.provider ?? '알 수 없음'} · ${payment.status}`
                  : '결제 내역 없음'}
              />
              {order.transaction ? <><Row label="복수구매 할인" value={krw(order.transaction.totals.volumeDiscountTotal)} /><Row label="계약상 착불 배송비" value={`${krw(order.transaction.totals.collectShippingTotal)} · 온라인 환불금액에 포함되지 않음`} /></> : null}
              <ShipmentDetails admin shipments={order.shipments} items={order.items} transactionShipping={order.transaction?.shipping} />
              <ul style={{ margin: '10px 0 0', paddingLeft: 18 }}>
                {order.items.map((item, index) => (
                  <li key={`${item.name}-${index}`} style={{ fontSize: 13 }}>
                    {item.name} × {item.qty} · {krw(item.unitPrice * item.qty)}<GoodsCustomInputsSummary selection={item.customInputs} />
                  </li>
                ))}
              </ul>
              <p className="muted" style={{ fontSize: 12, margin: '10px 0 0' }}>
                {V.claimRequest}은 주문 단위 전액으로만 처리됩니다. 일부 품목만 불량이면 전체 반품 또는
                협의 재발송으로 안내하고, 부분 환불을 약속하지 마세요.
              </p>
              <Link
                className="btn btn-sm btn-ghost"
                href={adminOrderSearchHref(order.id)}
                style={{ marginTop: 10 }}
              >
                주문 통합검색에서 열기
              </Link>
            </>
          ) : (
            <p className="muted">주문 정보를 불러오지 못했습니다.</p>
          )}
        </div>

        <div className="card" id="claim-request">
          <h3 style={{ marginTop: 0 }}>요청 내용</h3>
          <p style={{ fontSize: 13 }}>{claim.reason}</p>
          {claim.staffNote ? <Row label="운영 메모" value={claim.staffNote} /> : null}
          {detail.sellerIntake ? <SellerClaimIntakeEvidence intake={detail.sellerIntake} /> : null}
          {claim.decisionNote ? <Row label="거부 사유" value={claim.decisionNote} /> : null}
          {claim.holdReason ? <Row label="보류 사유" value={claim.holdReason} /> : null}
          {claim.lastErrorCode ? (
            <Row label="정합화 오류" value={claim.lastErrorCode} />
          ) : null}
          {claim.reshipTrackingNumber ? (
            <Row
              label="재출고 운송장"
              value={`${claim.reshipCarrier ?? ''} ${claim.reshipTrackingNumber}`}
            />
          ) : null}
          {claim.reshippedItems?.map((item) => <Row key={item.orderItemId} label="재출고 상품"
            value={`${item.name} · ${item.variantName} · ${item.variantCode} · ${item.qty}개`} />)}

          <h4 style={{ margin: '14px 0 6px' }}>타임라인</h4>
          {timeline.length === 0 ? (
            <p className="muted" style={{ fontSize: 12.5 }}>아직 기록된 처리가 없습니다.</p>
          ) : (
            <ol style={{ margin: 0, paddingLeft: 18 }}>
              {timeline.map((entry, index) => (
                <li key={`${entry.action}-${index}`} style={{ fontSize: 12.5 }}>
                  <time dateTime={entry.createdAt}>{formatOrderDateTime(entry.createdAt)}</time>
                  {' · '}
                  {TIMELINE_LABELS[entry.action] ?? entry.action}
                  {entry.actorName ? ` · @${entry.actorName}` : ''}
                </li>
              ))}
            </ol>
          )}
        </div>

        </div>
        <div className="admin-claim-detail-column">
        {claim.claimType !== 'return' ? <>{collectionContact}{refundSummary}</> : null}
        <div className="card" id="claim-process" tabIndex={-1}>
          <ClaimActionPanel
            actorId={actorId}
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
            orderId={claim.orderId}
            paymentProvider={payment?.provider ?? null}
            recordedRefundMethod={refund?.method ?? null}
            refundCompleted={Boolean(refund?.completedAt)}
            refundFiled={Boolean(refund?.filedAt)}
            refundLedgerOpen={Boolean(refund)}
            reshipItems={order?.items}
            stage={claim.stage}
          />
          <ClaimReshipmentDelivery claim={claim} />
          <ClaimWithdrawal claimId={claim.id} stage={claim.stage} operator />
          {claim.claimType !== 'cancel' ? <ClaimTypeConversion key={`${claim.id}-${claim.claimType}`} claimId={claim.id} /> : null}
          {claim.claimType === 'exchange' ? <ClaimReasonChange key={`reason-${claim.id}`} claimId={claim.id} /> : null}
        </div>
        </div>
      </div>
    </section>
  );
}
