import type { AdminClaimDetail } from '@/lib/admin/claims.server';
import { adminClaimStageLabel } from '@/lib/admin/claims';
import { formatOrderDateTime, refundStatusLabel } from '@/lib/orders';

type Fact = { label: string; value: string; detail: string; href: string; link: string };
type Props = Pick<AdminClaimDetail, 'claim' | 'refund'>;

/** Read the existing evidence independently. A closed claim is not proof of a refund or delivery. */
export function ClaimProgressSummary({ claim, refund }: Props) {
  const collection: Fact = { label: '회수 확인', value: '회수 기준 확인 필요', detail: '회수 기준을 불러오지 못했습니다.', href: '#claim-process', link: '회수 내역 보기' };
  if (claim.collectionPolicy !== null) {
    if (claim.claimType === 'cancel' && claim.collectionComplete && claim.collections.length === 0) {
      collection.value = '회수 대상 없음';
      collection.detail = '상품 회수가 필요하지 않은 취소입니다.';
    } else if (claim.collectionPolicy === 'origin') {
      const checked = claim.collections.filter(item => item.collectedAt !== null).length;
      collection.value = claim.collections.length ? `${checked} / ${claim.collections.length}개 출고지 확인` : '회수 대상 확인 전';
      collection.detail = claim.collectionComplete ? '전체 회수 확인 완료' : '전체 회수 확인 전';
    } else {
      // The legacy completion flag bypasses the newer origin gate. Only the receipt proves collection.
      collection.value = claim.collectedAt ? '회수 확인 완료' : '회수 미확인';
      collection.detail = claim.collectedAt ? `입고 ${formatOrderDateTime(claim.collectedAt)}` : '입고 확인 기록 없음';
    }
  }

  const settlement: Fact = claim.claimType === 'exchange'
    ? {
      label: '교환 배송',
      value: claim.reshipDeliveredAt ? '배송완료 확인' : claim.reshippedAt ? '재출고 기록됨' : '재출고 기록 없음',
      detail: claim.reshipDeliveredAt ? `배송완료 ${formatOrderDateTime(claim.reshipDeliveredAt)}`
        : claim.reshippedAt ? `재출고 ${formatOrderDateTime(claim.reshippedAt)} · 배송완료 미확인` : '재출고와 배송완료를 각각 확인합니다.',
      href: '#claim-process', link: '교환 처리 보기',
    }
    : {
      label: '환불 기록',
      value: refund?.status === 'awaiting_transfer' ? '환불 송금 대기' : refund?.completedAt ? '환불 완료 기록됨' : refund?.status === 'done' ? '환불 완료 시각 미기록' : refund?.filedAt ? '환불 접수 기록됨' : refund ? '환불 원장 열림' : '환불 원장 없음',
      detail: refund?.status === 'awaiting_transfer' ? '주문 취소·재고 복원 완료 · 실제 송금 확인 전' : refund?.completedAt ? `완료 ${formatOrderDateTime(refund.completedAt)}`
        : refund ? `원장 상태 ${refundStatusLabel(refund.status)} · 완료 시각 없음` : '환불 접수·완료 기록을 확인해주세요.',
      href: '#claim-refund', link: '환불 내역 보기',
    };
  const facts: Fact[] = [
    {
      label: '현재 처리 단계', value: adminClaimStageLabel(claim.claimType, claim.stage),
      detail: claim.stage === 'on_hold'
        ? `보류 전 ${claim.heldFrom ? adminClaimStageLabel(claim.claimType, claim.heldFrom) : '단계 확인 필요'}`
        : `최근 변경 ${formatOrderDateTime(claim.updatedAt)}`,
      href: '#claim-process', link: '처리 항목 보기',
    },
    collection,
    settlement,
  ];

  return <section className="admin-claim-progress" aria-label="클레임 처리 현황">
    <div className="admin-claim-progress__heading"><h3>처리 현황</h3><p>처리 단계와 회수·환불·배송 기록을 각각 확인합니다.</p></div>
    <dl>{facts.map(fact => <div key={fact.label}>
      <dt>{fact.label}</dt><dd><strong>{fact.value}</strong><span>{fact.detail}</span><a href={fact.href}>{fact.link}</a></dd>
    </div>)}</dl>
    {claim.stage === 'on_hold' && claim.holdReason ? <p className="admin-claim-progress__hold">보류 사유: {claim.holdReason}</p> : null}
  </section>;
}
