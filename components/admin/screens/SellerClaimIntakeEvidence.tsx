import Link from 'next/link';
import { SELLER_CLAIM_COLLECTION_METHODS, SELLER_CLAIM_SOURCES, type SellerClaimReceipt } from '@/lib/admin/seller-claim-intake';
import { formatOrderDateTime } from '@/lib/orders';

const TERM_CLASS = 'text-muted-foreground';
const VALUE_CLASS = 'm-0 min-w-0 break-words';

export function SellerClaimIntakeEvidence({ intake }: { intake: SellerClaimReceipt }) {
  const address = intake.collectionAddress;
  return <section className="flex min-w-0 flex-col gap-3 rounded-lg border bg-muted/40 p-3 text-sm" aria-label="판매자 대리 접수 근거" data-seller-claim-evidence="">
    <h4 className="font-medium">판매자 대리 접수 근거</h4>
    <dl className="grid grid-cols-1 gap-x-3 gap-y-1.5 sm:grid-cols-[8rem_minmax(0,1fr)]">
      <dt className={TERM_CLASS}>접수 담당자</dt><dd className={VALUE_CLASS}>{intake.actorName || intake.actorId}</dd>
      <dt className={TERM_CLASS}>확인 경로</dt><dd className={VALUE_CLASS}>{SELLER_CLAIM_SOURCES.find(source => source.value === intake.source)?.label}{intake.inquiryId ? <> · <Link className="underline underline-offset-4" href={`/admin/cs/inquiries/${intake.inquiryId}`}>연결된 문의</Link></> : null}</dd>
      <dt className={TERM_CLASS}>고객 요청 시각</dt><dd className={VALUE_CLASS}>{formatOrderDateTime(intake.customerRequestedAt)} · 근거용, 접수 기한 소급 없음</dd>
      <dt className={TERM_CLASS}>실제 접수 시각</dt><dd className={VALUE_CLASS}>{formatOrderDateTime(intake.requestedAt)}</dd>
      <dt className={TERM_CLASS}>고객 합의 근거</dt><dd className={`${VALUE_CLASS} whitespace-pre-wrap`}>{intake.agreementEvidence}</dd>
      {address ? <><dt className={TERM_CLASS}>수거 안내 주소</dt><dd className={VALUE_CLASS}>{address.recipientName} · {address.phone}<br />[{address.postalCode}] {address.address1} {address.address2}</dd></> : null}
    </dl>
    {intake.collections.length ? <h4 className="font-medium">접수 당시 출고지별 수거 계획</h4> : null}
    {intake.collections.map(collection => <div className="flex min-w-0 flex-col gap-1 border-t pt-2" key={collection.shipmentId}>
      <p><strong className="font-medium">{collection.originName}</strong> · {SELLER_CLAIM_COLLECTION_METHODS.find(method => method.value === collection.method)?.label}</p>
      <p className="break-words">{collection.items.map(item => `${item.name} ${item.qty}개`).join(' · ')}</p>
      {collection.carrier ? <p>수거 운송장: {collection.carrier} {collection.trackingNumber}</p> : null}
      {collection.note ? <p className="break-words whitespace-pre-wrap">{collection.note}</p> : null}
    </div>)}
    <p className="text-xs text-muted-foreground">{intake.claimType === 'cancel' ? '고객이 요청한 주문 전체 취소의 접수 근거입니다. 승인과 결제 취소·환급 결과는 아래 처리 단계에서 별도로 확인해주세요.' : '접수 근거와 수거 계획입니다. 아래 처리 단계와 출고지별 실제 입고 확인을 별도로 진행해주세요.'}</p>
  </section>;
}
