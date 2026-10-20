import Link from 'next/link';
import { SELLER_CLAIM_COLLECTION_METHODS, SELLER_CLAIM_SOURCES, type SellerClaimReceipt } from '@/lib/admin/seller-claim-intake';
import { formatOrderDateTime } from '@/lib/orders';

export function SellerClaimIntakeEvidence({ intake }: { intake: SellerClaimReceipt }) {
  const address = intake.collectionAddress;
  return <section className="admin-seller-claim-evidence" aria-label="판매자 대리 접수 근거">
    <h4>판매자 대리 접수 근거</h4>
    <dl>
      <dt>접수 담당자</dt><dd>{intake.actorName || intake.actorId}</dd>
      <dt>확인 경로</dt><dd>{SELLER_CLAIM_SOURCES.find(source => source.value === intake.source)?.label}{intake.inquiryId ? <> · <Link href={`/admin/cs/inquiries/${intake.inquiryId}`}>연결된 문의</Link></> : null}</dd>
      <dt>고객 요청 시각</dt><dd>{formatOrderDateTime(intake.customerRequestedAt)} · 근거용, 접수 기한 소급 없음</dd>
      <dt>실제 접수 시각</dt><dd>{formatOrderDateTime(intake.requestedAt)}</dd>
      <dt>고객 합의 근거</dt><dd className="admin-seller-claim-evidence__text">{intake.agreementEvidence}</dd>
      {address ? <><dt>수거 안내 주소</dt><dd>{address.recipientName} · {address.phone}<br />[{address.postalCode}] {address.address1} {address.address2}</dd></> : null}
    </dl>
    {intake.collections.length ? <h4>접수 당시 출고지별 수거 계획</h4> : null}
    {intake.collections.map(collection => <div key={collection.shipmentId} className="admin-seller-claim-evidence__collection">
      <strong>{collection.originName}</strong> · {SELLER_CLAIM_COLLECTION_METHODS.find(method => method.value === collection.method)?.label}
      <p>{collection.items.map(item => `${item.name} ${item.qty}개`).join(' · ')}</p>
      {collection.carrier ? <p>수거 운송장: {collection.carrier} {collection.trackingNumber}</p> : null}
      {collection.note ? <p className="admin-seller-claim-evidence__text">{collection.note}</p> : null}
    </div>)}
    <p className="faint">{intake.claimType === 'cancel' ? '고객이 요청한 주문 전체 취소의 접수 근거입니다. 승인과 결제 취소·환급 결과는 아래 처리 단계에서 별도로 확인해주세요.' : '접수 근거와 수거 계획입니다. 아래 처리 단계와 출고지별 실제 입고 확인을 별도로 진행해주세요.'}</p>
  </section>;
}
