'use client';

import { useRef, type ReactNode } from 'react';
import { ORDER_CLAIM_STAGE_LABELS, type OrderClaimStage } from '@/lib/orders/claims';

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
    { id: 'review', title: '검토·승인', summary: `현재 단계: ${ORDER_CLAIM_STAGE_LABELS[progress.stage]}`, content: review },
    { id: 'collection', title: '회수 확인', summary: collectionSummary, content: collection },
    { id: 'hold', title: '보류 상태 · 필요 시 처리', summary: progress.stage === 'on_hold'
      ? `보류 중 · 보류 전 ${progress.heldFrom ? ORDER_CLAIM_STAGE_LABELS[progress.heldFrom] : '단계 확인 필요'}`
      : '현재 보류 중인 요청이 아닙니다.', content: hold },
    { id: 'refund', title: '환불 처리', summary: progress.refundCompleted ? '환불 완료 시각 기록됨'
      : progress.refundLedgerOpen ? progress.refundFiled ? '환불 접수 기록 있음 · 완료 시각 없음' : '환불 원장 열림 · 완료 시각 없음'
        : '환불 원장 없음', content: refund },
  ];
  const nextStep = steps.find(step => step.id === next);
  function focusStep(id: StepId) {
    headings.current[id]?.focus();
    headings.current[id]?.scrollIntoView({ block: 'start', behavior: 'instant' });
  }

  return <div className="admin-return-workspace">
    <header className="admin-return-workspace__heading">
      <h3>반품 단계별 처리</h3>
      <p>주문과 요청을 확인한 뒤 회수·환불을 각각 처리합니다. 보류는 필요한 경우에만 설정합니다.</p>
      <div className="admin-return-workspace__next">
        <p role="status">{closed ? '요청 처리가 종료됐습니다. 기존 증빙과 환불 기록을 확인하세요.'
          : nextStep ? `다음 확인: ${nextStep.title}` : '반품과 환불 완료 기록을 확인했습니다.'}</p>
        {nextStep ? <button className="btn btn-sm btn-ghost" type="button" onClick={() => focusStep(nextStep.id)}>다음 작업 보기</button> : null}
      </div>
    </header>
    <nav aria-label="반품 처리 단계" className="admin-return-workspace__navigation">
      {steps.map((step, index) => <button key={step.id} type="button" aria-current={step.id === next ? 'step' : undefined}
        onClick={() => focusStep(step.id)}>{index + 1}. {step.title}</button>)}
    </nav>
    {steps.map((step, index) => <section key={step.id} className="admin-return-workspace__step" aria-labelledby={`return-${step.id}`}>
      <h4 id={`return-${step.id}`} tabIndex={-1} ref={node => { headings.current[step.id] = node; }}>
        <span aria-hidden="true">{index + 1}</span>{step.title}
      </h4>
      <p className="admin-return-workspace__evidence">{step.summary}</p>
      <div className="admin-return-workspace__content">{step.content}</div>
    </section>)}
    {exception ? <section className="admin-return-workspace__exception" aria-label="요청 거부">{exception}</section> : null}
  </div>;
}
