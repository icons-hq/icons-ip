import Link from 'next/link';
import { SELLER_CLAIM_COLLECTION_METHODS, SELLER_CLAIM_SOURCES, type SellerClaimReceipt } from '@/lib/admin/seller-claim-intake';
import { formatOrderDateTime } from '@/lib/orders';
import { shippingCarrierLabel, type ShippingCarrierRegistry } from '@/lib/orders/shipment';

const TERM_CLASS = 'text-muted-foreground';
const VALUE_CLASS = 'm-0 min-w-0 break-words';
/* 이름표에 없는 값(담당자 이름·확인 경로·수거 방법·택배사)은 번호나 영문 코드를 그대로 내지 않고 이 말로 받는다(화면 규칙 8). */
const UNKNOWN_LABEL = '확인 필요';

/**
 * 판매자가 대신 접수한 요청의 접수 근거(요청 내용 칸 안). `carriers`는 수거 택배사 코드를 이름으로 바꿀 때만 쓴다 —
 * 주지 않으면 택배사 이름은 '확인 필요'로 보인다.
 */
export function SellerClaimIntakeEvidence({ intake, carriers = [] }: { intake: SellerClaimReceipt; carriers?: ShippingCarrierRegistry }) {
  const address = intake.collectionAddress;
  return <section className="flex min-w-0 flex-col gap-3 rounded-lg border bg-muted/40 p-3 text-sm" aria-label="판매자 직접 접수 근거" data-seller-claim-evidence="">
    <h4 className="font-medium">판매자 직접 접수 근거</h4>
    <dl className="grid grid-cols-1 gap-x-3 gap-y-1.5 sm:grid-cols-[8rem_minmax(0,1fr)]">
      <dt className={TERM_CLASS}>접수 담당자</dt><dd className={VALUE_CLASS}>{intake.actorName || '이름 없음'}</dd>
      <dt className={TERM_CLASS}>확인 경로</dt><dd className={VALUE_CLASS}>{SELLER_CLAIM_SOURCES.find(source => source.value === intake.source)?.label ?? UNKNOWN_LABEL}{intake.inquiryId ? <> · <Link className="underline underline-offset-4" href={`/admin/cs/inquiries/${intake.inquiryId}`}>연결된 문의</Link></> : null}</dd>
      <dt className={TERM_CLASS}>고객 요청 시각</dt><dd className={VALUE_CLASS}>{formatOrderDateTime(intake.customerRequestedAt)} · 근거로만 남김, 신청 기한은 실제 접수 시각 기준</dd>
      <dt className={TERM_CLASS}>실제 접수 시각</dt><dd className={VALUE_CLASS}>{formatOrderDateTime(intake.requestedAt)}</dd>
      <dt className={TERM_CLASS}>고객 합의 근거</dt><dd className={`${VALUE_CLASS} whitespace-pre-wrap`}>{intake.agreementEvidence}</dd>
      {address ? <><dt className={TERM_CLASS}>수거 안내 주소</dt><dd className={VALUE_CLASS}>{address.recipientName} · {address.phone}<br />[{address.postalCode}] {address.address1} {address.address2}</dd></> : null}
    </dl>
    {intake.collections.length ? <h4 className="font-medium">접수 당시 출고지별 수거 계획</h4> : null}
    {intake.collections.map(collection => <div className="flex min-w-0 flex-col gap-1 border-t pt-2" key={collection.shipmentId}>
      <p><strong className="font-medium">{collection.originName}</strong> · {SELLER_CLAIM_COLLECTION_METHODS.find(method => method.value === collection.method)?.label ?? UNKNOWN_LABEL}</p>
      <p className="break-words">{collection.items.map(item => `${item.name} ${item.qty}개`).join(' · ')}</p>
      {collection.carrier ? <p>수거 운송장: {shippingCarrierLabel(carriers, collection.carrier) ?? UNKNOWN_LABEL} {collection.trackingNumber}</p> : null}
      {collection.note ? <p className="break-words whitespace-pre-wrap">{collection.note}</p> : null}
    </div>)}
    <p className="text-xs text-muted-foreground">{intake.claimType === 'cancel' ? '고객이 요청한 주문 전체 취소의 접수 근거입니다. 승인과 결제 취소·환불 결과는 아래 처리 단계에서 따로 확인해주세요.' : '접수 근거와 수거 계획입니다. 아래 처리 단계와 출고지별 실제 입고 확인을 별도로 진행해주세요.'}</p>
  </section>;
}
