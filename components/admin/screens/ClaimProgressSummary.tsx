import type { AdminClaimDetail } from '@/lib/admin/claims.server';
import { adminClaimStageLabel } from '@/lib/admin/claims';
import { orderClaimEffectiveStage } from '@/lib/orders/claims';
import { Check } from 'lucide-react';
import { formatOrderDateTime, refundStatusLabel } from '@/lib/orders';
import { statusTone } from '@/lib/admin/status-tone';
import { AdminStatusBadge } from '@/components/admin/console/AdminKit';
import type { ReactNode } from 'react';

type Fact = { label: string; value: ReactNode; detail: string; href: string; link: string };
type Props = Pick<AdminClaimDetail, 'claim' | 'refund'>;

/** 단계 표시의 동그란 번호(반품 처리 칸과 같은 모양). 끝난 단계는 초록 체크, 지금 단계는 주 색이다. */
export const CLAIM_STEP_MARK_CLASS = 'inline-grid size-6 shrink-0 place-items-center rounded-full border text-xs font-semibold tabular-nums data-[step-state=current]:border-primary data-[step-state=current]:bg-primary data-[step-state=current]:text-primary-foreground data-[step-state=done]:border-success-border data-[step-state=done]:bg-success-soft data-[step-state=done]:text-success';
const EXCHANGE_STEPS = ['검토·승인', '회수 확인', '재출고', '도착 확인'] as const;
type ExchangeStepState = 'done' | 'current' | 'todo';
const EXCHANGE_STEP_CAPTION: Record<ExchangeStepState, string> = { done: '완료', current: '지금 할 일', todo: '남은 단계' };

/** 교환 처리 칸의 단계 표시. 반품 칸과 같은 말(완료·지금 할 일·남은 단계)로 어디까지 왔는지 보인다. 저장된 처리 기록에서만 읽고 아무것도 바꾸지 않는다. */
export function ClaimExchangeSteps({ claim }: Pick<AdminClaimDetail, 'claim'>) {
  if (claim.stage === 'rejected' || claim.stage === 'withdrawn') return null;
  const effective = orderClaimEffectiveStage(claim.stage, claim.heldFrom);
  const current = claim.stage === 'completed' ? EXCHANGE_STEPS.length
    : effective === 'requested' || effective === 'in_review' ? 0
      : effective === 'collecting' || !claim.collectionComplete ? 1
        : !claim.reshippedAt ? 2 : 3;
  return <ol aria-label="교환 처리 단계" className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-claim-exchange-steps="">
    {EXCHANGE_STEPS.map((label, index) => {
      const state: ExchangeStepState = index < current ? 'done' : index === current ? 'current' : 'todo';
      return <li aria-current={state === 'current' ? 'step' : undefined} className="flex min-w-0 items-center gap-2 rounded-lg border bg-background px-2.5 py-1.5 text-muted-foreground data-[step-state=current]:border-primary data-[step-state=current]:bg-primary-soft data-[step-state=current]:text-primary-soft-foreground data-[step-state=done]:text-foreground" data-step-state={state} key={label}>
        <span aria-hidden="true" className={CLAIM_STEP_MARK_CLASS} data-step-state={state}>{state === 'done' ? <Check className="size-3.5" /> : index + 1}</span>
        <span className="flex min-w-0 flex-col"><span className="text-xs font-normal">{EXCHANGE_STEP_CAPTION[state]}</span><span className="font-medium">{label}</span></span>
      </li>;
    })}
  </ol>;
}

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
      value: refund?.status === 'awaiting_transfer' ? '환불 송금 대기' : refund?.completedAt ? '환불 완료 기록됨' : refund?.status === 'done' ? '환불 완료 시각 미기록' : refund?.filedAt ? '환불 접수 기록됨' : refund ? '환불 원장 열림' : '환불 기록 없음',
      detail: refund?.status === 'awaiting_transfer' ? '주문 취소·재고 복원 완료 · 실제 송금 확인 전' : refund?.completedAt ? `완료 ${formatOrderDateTime(refund.completedAt)}`
        : refund ? `원장 상태 ${refundStatusLabel(refund.status)} · 완료 시각 없음` : '환불 접수·완료 기록을 확인해주세요.',
      href: '#claim-refund', link: '환불 내역 보기',
    };
  const facts: Fact[] = [
    {
      label: '현재 처리 단계', value: <AdminStatusBadge tone={statusTone('claim', claim.stage)}>{adminClaimStageLabel(claim.claimType, claim.stage)}</AdminStatusBadge>,
      detail: claim.stage === 'on_hold'
        ? `보류 전 ${claim.heldFrom ? adminClaimStageLabel(claim.claimType, claim.heldFrom) : '단계 확인 필요'}`
        : `최근 변경 ${formatOrderDateTime(claim.updatedAt)}`,
      href: '#claim-process', link: '처리 항목 보기',
    },
    collection,
    settlement,
  ];

  /* 처리 현황은 한 줄 요약이다 — 카드 세 개로 키우면 지금 할 일(처리 칸)이 첫 화면 아래로 밀린다. */
  return <section aria-label="클레임 처리 현황" className="flex min-w-0 flex-col gap-2 rounded-xl border bg-card px-4 py-3 text-sm text-card-foreground" data-admin-kit="claim-progress">
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-3 sm:divide-x">{facts.map(fact => <div className="flex min-w-0 flex-col gap-1 sm:pl-6 sm:first:pl-0" key={fact.label}>
      <dt className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">{fact.label}<a className="shrink-0 underline underline-offset-4 hover:text-foreground" href={fact.href}>{fact.link}</a></dt>
      <dd className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 break-words">
        <strong className="font-semibold">{fact.value}</strong>
        <span className="text-xs text-muted-foreground">{fact.detail}</span>
      </dd>
    </div>)}</dl>
    {claim.stage === 'on_hold' && claim.holdReason ? <p className="break-words text-muted-foreground">보류 사유: {claim.holdReason}</p> : null}
  </section>;
}
