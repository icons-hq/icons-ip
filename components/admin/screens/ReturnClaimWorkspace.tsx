'use client';

import { useRef, type ReactNode } from 'react';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { cn } from 'cn';
import { adminClaimStageLabel } from '@/lib/admin/claims';
import type { OrderClaimStage } from '@/lib/orders/claims';

/* 단계 바로가기. 지금 할 단계(aria-current=step)는 테두리·글자로 강조하고, 고대비 모드에서도 윤곽선으로 남긴다. */
const STEP_BUTTON_CLASS = 'flex min-h-9 items-center rounded-lg border bg-background px-3 py-1.5 text-left text-sm text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-[current=step]:border-primary aria-[current=step]:font-medium aria-[current=step]:text-foreground forced-colors:aria-[current=step]:outline-2 forced-colors:aria-[current=step]:outline-[Highlight]';

export interface ReturnClaimProgress {
  stage: OrderClaimStage;
  heldFrom: OrderClaimStage | null;
  collectionPolicy: 'origin' | 'legacy' | null;
  collectionComplete: boolean;
  collectedAt: string | null;
  collectionCount: number;
  collectedCount: number;
  refundLedgerOpen: boolean;
  refundFiled: boolean;
  refundCompleted: boolean;
}

type StepId = 'review' | 'collection' | 'hold' | 'refund';

/** Navigation derives only from refreshed claim evidence. It never submits or advances a claim. */
export function ReturnClaimWorkspace({ progress, review, collection, hold, refund, exception }: {
  progress: ReturnClaimProgress;
  review: ReactNode;
  collection: ReactNode;
  hold: ReactNode;
  refund: ReactNode;
  exception: ReactNode;
}) {
  const headings = useRef<Partial<Record<StepId, HTMLHeadingElement | null>>>({});
  const closed = progress.stage === 'withdrawn' || progress.stage === 'rejected';
  const next: StepId | null = closed || progress.stage === 'completed' && progress.refundCompleted ? null
    : progress.stage === 'on_hold' ? 'hold'
      : progress.stage === 'requested' || progress.stage === 'in_review' ? 'review'
        : progress.collectionPolicy === null || !progress.collectionComplete
          || progress.stage === 'collecting'
          || progress.collectionPolicy === 'legacy' && !progress.collectedAt ? 'collection' : 'refund';
  const collectionSummary = progress.collectionPolicy === null ? '회수 기준 확인 필요'
    : progress.collectionPolicy === 'legacy' ? progress.collectedAt ? '입고 확인 기록 있음' : '입고 확인 기록 없음'
      : progress.collectionCount === 0 ? '회수 대상 확인 전'
        : `${progress.collectedCount} / ${progress.collectionCount}개 출고지 확인 · ${progress.collectionComplete ? '전체 회수 확인 완료' : '전체 회수 확인 전'}`;
  const steps: { id: StepId; title: string; summary: string; content: ReactNode }[] = [
    { id: 'review', title: '검토·승인', summary: `현재 단계: ${adminClaimStageLabel('return', progress.stage)}`, content: review },
    { id: 'collection', title: '회수 확인', summary: collectionSummary, content: collection },
    { id: 'hold', title: '보류 상태 · 필요 시 처리', summary: progress.stage === 'on_hold'
      ? `보류 중 · 보류 전 ${progress.heldFrom ? adminClaimStageLabel('return', progress.heldFrom) : '단계 확인 필요'}`
      : '현재 보류 중인 요청이 아닙니다.', content: hold },
    { id: 'refund', title: '환불 처리', summary: progress.refundCompleted ? '환불 완료 시각 기록됨'
      : progress.refundLedgerOpen ? progress.refundFiled ? '환불 접수 기록 있음 · 완료 시각 없음' : '환불 원장 열림 · 완료 시각 없음'
        : '환불 기록 없음', content: refund },
  ];
  const nextStep = steps.find(step => step.id === next);
  function focusStep(id: StepId) {
    headings.current[id]?.focus();
    headings.current[id]?.scrollIntoView({ block: 'start', behavior: 'instant' });
  }

  return <div className="flex min-w-0 flex-col gap-5" data-claim-workspace="return">
    <header className="flex min-w-0 flex-col gap-2">
      <h3 className="text-base leading-snug font-medium">반품 단계별 처리</h3>
      <p className="text-muted-foreground">주문과 요청을 확인한 뒤 회수·환불을 각각 처리합니다. 보류는 필요한 경우에만 설정합니다.</p>
      {/* 지금 할 단계를 가리키는 자리 — 주 색 옅은 바탕으로 '현재 위치'를 표시한다. */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary-soft px-3 py-2.5 text-primary-soft-foreground">
        <p className="min-w-0 font-medium break-words" role="status">{closed ? '요청 처리가 종료됐습니다. 기존 증빙과 환불 기록을 확인하세요.'
          : nextStep ? `다음 확인: ${nextStep.title}` : '반품과 환불 완료 기록을 확인했습니다.'}</p>
        {nextStep ? <button className={`${cn(buttonVariants({ size: 'sm', variant: 'outline' }))} print:hidden`} data-slot="button" type="button" onClick={() => focusStep(nextStep.id)}>다음 작업 보기</button> : null}
      </div>
    </header>
    <nav aria-label="반품 처리 단계" className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap print:hidden">
      {steps.map((step, index) => <button key={step.id} type="button" aria-current={step.id === next ? 'step' : undefined}
        className={STEP_BUTTON_CLASS} data-slot="button"
        onClick={() => focusStep(step.id)}>{index + 1}. {step.title}</button>)}
    </nav>
    {steps.map((step, index) => <section key={step.id} className="flex min-w-0 flex-col gap-3 border-t pt-5" aria-labelledby={`return-${step.id}`}>
      <h4 className="flex w-fit scroll-mt-16 items-center gap-2 rounded-sm text-base font-medium outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
        id={`return-${step.id}`} tabIndex={-1} ref={node => { headings.current[step.id] = node; }}>
        <span aria-hidden="true" className="inline-grid size-6 shrink-0 place-items-center rounded-full border text-xs tabular-nums">{index + 1}</span>{step.title}
      </h4>
      <p className="break-words text-muted-foreground">{step.summary}</p>
      <div className="flex min-w-0 flex-col gap-4">{step.content}</div>
    </section>)}
    {exception ? <section className="flex min-w-0 flex-col gap-3 border-t pt-5" aria-label="요청 거부">{exception}</section> : null}
  </div>;
}
