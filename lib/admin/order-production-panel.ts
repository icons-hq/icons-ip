import type { AdminConfirmRequest } from '@/lib/admin/confirm';
import type { ProductionJob } from '@/lib/order-production';

/*
 * 주문 상세의 주문제작 처리 카드(components/admin/OrderProductionPanel)가 쓰는 판단과 문구.
 * 서버(order_production_document·admin_change_order_production)가 최종 판정을 하고, 여기는 화면이 누르기 전에 잠그고 확인창에 말할 것만 계산한다.
 */

/** 지금 제작 시작·완료를 기록할 수 있는 상품(서버가 건마다 알려 준다). */
export const productionActionable = (job: Pick<ProductionJob, 'canStart' | 'canComplete'>) => job.canStart || job.canComplete;

/**
 * 제작 상품이 지금 기록할 수 없는 이유. 서버가 canStart·canComplete로 막는 조건을 그대로 말한다 —
 * 교환 제작은 회수 확인 전, 결제 확인 전, 그 밖에는 주문 상태나 진행 중인 취소 요청이다. 끝난 상품(완료·취소)은 이유를 달지 않는다.
 */
export function productionLockReason(job: Pick<ProductionJob, 'state' | 'claimId' | 'basisAt' | 'canStart' | 'canComplete'>): string | null {
  if ((job.state !== 'pending' && job.state !== 'started') || productionActionable(job)) return null;
  if (job.claimId) return '교환 제작은 회수 확인(하자·오배송은 회수 생략 기록)을 마친 뒤에 할 수 있습니다.';
  if (job.state === 'pending' && !job.basisAt) return '결제가 확인된 뒤에 시작할 수 있습니다.';
  return '결제 확인 전이거나, 취소 요청이 진행 중이거나, 이미 발송이 시작된 주문이라 지금은 기록할 수 없습니다.';
}

/**
 * 제작 시작·완료 기록의 확인창. 두 기록 모두 되돌릴 수 없다. 완료를 기록해야 이 주문의 배송 건을 출고지시·발송할 수 있다 —
 * 서버는 제작 완료 전에는 출고지시 전달과 배송중 처리를 막는다(교환 제작은 별도 흐름이라 그 말을 하지 않는다).
 */
export function productionConfirmRequest(job: Pick<ProductionJob, 'goodName' | 'quantity' | 'claimId'>, kind: 'start' | 'complete'): AdminConfirmRequest {
  const target = `${job.goodName} · ${job.quantity}개${job.claimId ? ' (교환 제작)' : ''}`;
  const effect = kind === 'complete' && !job.claimId ? '제작이 끝나야 이 상품이 든 배송 건을 출고지시·발송할 수 있습니다. ' : '';
  return {
    title: kind === 'complete' ? '제작 완료로 기록할까요?' : '제작 시작으로 기록할까요?',
    message: `${target}\n${effect}기록한 뒤에는 되돌릴 수 없습니다.`,
    confirmLabel: kind === 'complete' ? '제작 완료로 기록' : '제작 시작으로 기록', cancelLabel: '돌아가기',
  };
}
