'use client';

import { useRef, type ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { adminClaimStageLabel } from '@/lib/admin/claims';
import { orderClaimEffectiveStage, type OrderClaimStage } from '@/lib/orders/claims';

/*
 * 단계 표시. 끝난 단계(초록 체크)·지금 단계(주 색)·남은 단계(회색 번호)를 모양과 글자로 나눈다.
 * 고대비 모드에서는 지금 단계가 윤곽선으로 남는다.
 */
const STEP_BUTTON_CLASS = 'flex min-h-12 items-center gap-2 rounded-lg border bg-background px-2.5 py-1.5 text-left text-sm text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 data-[step-state=current]:border-primary data-[step-state=current]:bg-primary-soft data-[step-state=current]:text-primary-soft-foreground data-[step-state=done]:text-foreground data-[step-state=optional]:border-dashed forced-colors:aria-[current=step]:outline-2 forced-colors:aria-[current=step]:outline-[Highlight]';
const STEP_MARK_CLASS = 'inline-grid size-6 shrink-0 place-items-center rounded-full border text-xs font-semibold tabular-nums data-[step-state=current]:border-primary data-[step-state=current]:bg-primary data-[step-state=current]:text-primary-foreground data-[step-state=done]:border-success-border data-[step-state=done]:bg-success-soft data-[step-state=done]:text-success';
/* 접힌 단계도 인쇄에서는 내용이 보이게 한다. */
const STEP_SECTION_CLASS = 'group/section min-w-0 rounded-lg border data-[step-state=current]:border-primary/50 data-[step-state=current]:bg-primary-soft/25 print:[&::details-content]:[content-visibility:visible]';

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
type StepState = 'done' | 'current' | 'todo' | 'optional' | 'closed';
const STEP_CAPTION: Record<StepState, string> = { done: '완료', current: '지금 할 일', todo: '남은 단계', optional: '필요 시', closed: '종료' };

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
  const effective = orderClaimEffectiveStage(progress.stage, progress.heldFrom);
  const evidence: Record<'review' | 'collection' | 'refund', boolean> = {
    review: !closed && effective !== 'requested' && effective !== 'in_review',
    collection: progress.collectionPolicy !== null && progress.collectionComplete && effective !== 'collecting'
      && (progress.collectionPolicy !== 'legacy' || Boolean(progress.collectedAt)),
    refund: progress.refundCompleted,
  };
  const stateOf = (id: StepId): StepState => {
    if (id === next) return 'current';
    if (id === 'hold') return closed || next === null ? 'closed' : 'optional';
    return evidence[id] ? 'done' : closed ? 'closed' : 'todo';
  };
  const collectionSummary = progress.collectionPolicy === null ? '회수 기준 확인 필요'
    : progress.collectionPolicy === 'legacy' ? progress.collectedAt ? '입고 확인 기록 있음' : '입고 확인 기록 없음'
      : progress.collectionCount === 0 ? '회수 대상 확인 전'
        : `${progress.collectedCount} / ${progress.collectionCount}개 출고지 확인 · ${progress.collectionComplete ? '전체 회수 확인 완료' : '전체 회수 확인 전'}`;
  /* 처리 순서는 검토 → 회수 → 환불이고, 보류는 순서 밖의 예외라 번호 없이 맨 뒤에 둔다. */
  const steps: { id: StepId; number: number | null; title: string; label: string; summary: string; content: ReactNode }[] = [
    { id: 'review', number: 1, title: '검토·승인', label: '검토·승인', summary: evidence.review ? '승인 완료' : `현재 단계: ${adminClaimStageLabel('return', progress.stage)}`, content: review },
    { id: 'collection', number: 2, title: '회수 확인', label: '회수 확인', summary: collectionSummary, content: collection },
    { id: 'refund', number: 3, title: '환불 처리', label: '환불 처리', summary: progress.refundCompleted ? '환불 완료 시각 기록됨'
      : progress.refundLedgerOpen ? progress.refundFiled ? '환불 접수 기록 있음 · 완료 시각 없음' : '환불 원장 열림 · 완료 시각 없음'
        : '환불 기록 없음', content: refund },
    { id: 'hold', number: null, title: '보류 상태 · 필요 시 처리', label: '보류', summary: progress.stage === 'on_hold'
      ? `보류 중 · 보류 전 ${progress.heldFrom ? adminClaimStageLabel('return', progress.heldFrom) : '단계 확인 필요'}`
      : '현재 보류 중인 요청이 아닙니다.', content: hold },
  ];
  const nextStep = steps.find(step => step.id === next);
  /* 접힌 단계를 눌렀을 때도 내용이 보이도록 펼친 뒤 그 단계 제목으로 옮긴다. */
  function focusStep(id: StepId) {
    const heading = headings.current[id];
    const section = heading?.closest('details');
    if (section) section.open = true;
    heading?.focus();
    heading?.scrollIntoView({ block: 'start', behavior: 'instant' });
  }

  return <div className="flex min-w-0 flex-col gap-3" data-claim-workspace="return">
    <header className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-base leading-snug font-medium">반품 단계별 처리</h3>
        <p className={`min-w-0 break-words ${nextStep ? 'font-medium text-primary-soft-foreground' : 'text-muted-foreground'}`} role="status">{closed ? '요청 처리가 종료됐습니다. 기존 증빙과 환불 기록을 확인하세요.'
          : nextStep ? `다음 확인: ${nextStep.title}` : '반품과 환불 완료 기록을 확인했습니다.'}</p>
      </div>
      <nav aria-label="반품 처리 단계" className="grid grid-cols-2 gap-2 sm:grid-cols-4 print:hidden">
        {steps.map(step => {
          const state = stateOf(step.id);
          return <button key={step.id} type="button" aria-current={state === 'current' ? 'step' : undefined}
            className={STEP_BUTTON_CLASS} data-slot="button" data-step-state={state}
            onClick={() => focusStep(step.id)}>
            <span aria-hidden="true" className={STEP_MARK_CLASS} data-step-state={state}>{state === 'done' ? <Check className="size-3.5" /> : step.number ?? '–'}</span>
            <span className="flex min-w-0 flex-col">
              <span className="text-xs font-normal">{STEP_CAPTION[state]}</span>
              <span className="font-medium">{step.number ? <span className="sr-only">{step.number}. </span> : null}{step.label}</span>
            </span>
          </button>;
        })}
      </nav>
    </header>
    {/* 지금 단계만 펼친다. 끝난 단계는 한 줄로 접혀 지금 할 일이 첫 화면에 오고, 접어도 입력은 DOM에 남는다. */}
    <div className="flex min-w-0 flex-col gap-2">
      {steps.map(step => {
        const state = stateOf(step.id);
        return <details key={step.id} className={STEP_SECTION_CLASS} data-step-state={state} open={state === 'current'}>
          <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-3 py-2.5 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
            <h4 className="flex min-w-0 flex-1 scroll-mt-16 flex-wrap items-center gap-x-2 gap-y-0.5 rounded-sm text-sm font-medium outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
              id={`return-${step.id}`} tabIndex={-1} ref={node => { headings.current[step.id] = node; }}>
              <span aria-hidden="true" className={STEP_MARK_CLASS} data-step-state={state}>{state === 'done' ? <Check className="size-3.5" /> : step.number ?? '–'}</span>
              {step.title}
              <span className="min-w-0 text-xs font-normal break-words text-muted-foreground">{step.summary}</span>
            </h4>
            <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform group-open/section:rotate-180" />
          </summary>
          <div className="flex min-w-0 flex-col gap-4 border-t px-3 py-3">{step.content}</div>
        </details>;
      })}
    </div>
    {exception ? <section className="flex min-w-0 flex-col gap-3 border-t pt-3" aria-label="요청 거부">{exception}</section> : null}
    <p className="text-xs text-muted-foreground">주문과 요청을 확인한 뒤 회수·환불을 각각 처리합니다. 보류는 필요한 경우에만 설정합니다.</p>
  </div>;
}
