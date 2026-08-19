import Link from 'next/link';
import type { AdminClaimDetail } from '@/lib/admin/claims.server';
import { krw } from '@/lib/format';
import {
  formatOrderDateTime,
  ORDER_WITHDRAWAL_REASON_LABELS,
  orderReferenceLabel,
  refundStatusLabel,
} from '@/lib/orders';
import {
  ORDER_CLAIM_REFUND_METHOD_LABELS,
  ORDER_CLAIM_STAGE_LABELS,
  ORDER_CLAIM_TYPE_LABELS,
  orderClaimReferenceLabel,
  orderClaimSlaState,
} from '@/lib/orders/claims';
import type { ShippingCarrierRegistry } from '@/lib/orders/shipment';
import { ClaimActionPanel } from './ClaimActionPanel';

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
  'order.claim_auto_approved': '자동 승인 (발송 전 변심 취소)',
  'admin.order.claim_in_review': '검토중으로 변경',
  'admin.order.claim_approved': '승인',
  'admin.order.claim_rejected': '거부',
  'admin.order.claim_held': '보류',
  'admin.order.claim_resumed': '보류 해제',
  'admin.order.claim_collected': '수거·입고',
  'admin.order.claim_refund_filed': '환불 접수',
  'admin.order.claim_refund_completed': '환불 완료',
  'admin.order.claim_reshipped': '교환 재출고',
  'admin.order.cancellation_approved': '청약철회 승인 (레거시 경로)',
  'admin.order.cancellation_rejected': '청약철회 거절 (레거시 경로)',
};

const PAYMENT_PROVIDER_LABELS: Record<string, string> = {
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
    <div className="row" style={{ gap: 8, justifyContent: 'space-between' }}>
      <span className="muted" style={{ fontSize: 12 }}>{label}</span>
      <span style={{ fontSize: 13 }}>{value}</span>
    </div>
  );
}

export function ClaimDetailScreen({
  backHref,
  carriers,
  cancellationForm,
  detail,
  now = new Date(),
}: {
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

  return (
    <section className="admin-console admin-claim-detail">
      <div className="row" style={{ gap: 12, justifyContent: 'space-between' }}>
        <div>
          <Link className="btn btn-sm btn-ghost" href={backHref}>← 목록으로</Link>
          <h2 style={{ margin: '8px 0 0' }}>
            {ORDER_CLAIM_TYPE_LABELS[claim.claimType]} {orderClaimReferenceLabel(claim.reference)}
          </h2>
          <p className="muted" style={{ fontSize: 12.5, margin: '4px 0 0' }}>
            {ORDER_CLAIM_STAGE_LABELS[claim.stage]}
            {' · '}
            {ORDER_WITHDRAWAL_REASON_LABELS[claim.reasonType]}
            {' · 접수 '}
            <time dateTime={claim.requestedAt}>{formatOrderDateTime(claim.requestedAt)}</time>
          </p>
        </div>
        <p data-sla-tone={sla.tone} style={{ fontSize: 13, margin: 0 }}>
          환급 기한 {sla.label}
        </p>
      </div>

      <div className="admin-claim-detail-layout">
        <div className="card">
          <h3 style={{ marginTop: 0 }}>주문 요약</h3>
          {order ? (
            <>
              <Row
                label="주문번호"
                value={`${orderReferenceLabel(order.id)} · ${ORDER_STATUS_LABELS[order.status] ?? order.status}`}
              />
              <Row label="구매자" value={`${order.buyerName ?? '-'} (${order.buyerEmail ?? '이메일 없음'})`} />
              <Row label="결제금액" value={`${krw(order.total)} (배송비 ${krw(order.shippingFee)} 포함)`} />
              <Row
                label="결제사"
                value={payment
                  ? `${PAYMENT_PROVIDER_LABELS[payment.provider ?? ''] ?? payment.provider ?? '알 수 없음'} · ${payment.status}`
                  : '결제 내역 없음'}
              />
              <Row
                label="배송"
                value={order.trackingNumber
                  ? `${order.shippingCarrier ?? ''} ${order.trackingNumber}`
                  : '운송장 없음'}
              />
              <ul style={{ margin: '10px 0 0', paddingLeft: 18 }}>
                {order.items.map((item, index) => (
                  <li key={`${item.name}-${index}`} style={{ fontSize: 13 }}>
                    {item.name} × {item.qty} · {krw(item.unitPrice * item.qty)}
                  </li>
                ))}
              </ul>
              <p className="muted" style={{ fontSize: 12, margin: '10px 0 0' }}>
                클레임은 주문 단위 전액으로만 처리됩니다. 일부 품목만 불량이면 전체 반품 또는
                협의 재발송으로 안내하고, 부분 환불을 약속하지 마세요.
              </p>
              <Link
                className="btn btn-sm btn-ghost"
                href={`/admin/sales/orders?query=${encodeURIComponent(order.id)}`}
                style={{ marginTop: 10 }}
              >
                주문 통합검색에서 열기
              </Link>
            </>
          ) : (
            <p className="muted">주문 정보를 불러오지 못했습니다.</p>
          )}
        </div>

        <div className="card">
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
                  : '계좌 원문은 화면에 표시하지 않습니다. 송금은 결제·정산 담당자가 처리합니다. 환불 완료 30일 뒤 원문은 자동 파기됩니다.'}
              </p>
            </>
          ) : null}
        </div>
      </div>

      <div className="admin-claim-detail-layout">
        <div className="card">
          <h3 style={{ marginTop: 0 }}>요청 내용</h3>
          <p style={{ fontSize: 13 }}>{claim.reason}</p>
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

        <div className="card">
          <ClaimActionPanel
            cancellationForm={cancellationForm}
            carriers={carriers}
            claimId={claim.id}
            claimType={claim.claimType}
            heldFrom={claim.heldFrom}
            orderId={claim.orderId}
            refundCompleted={Boolean(refund?.completedAt)}
            refundFiled={Boolean(refund?.filedAt)}
            refundLedgerOpen={Boolean(refund)}
            stage={claim.stage}
          />
        </div>
      </div>
    </section>
  );
}
