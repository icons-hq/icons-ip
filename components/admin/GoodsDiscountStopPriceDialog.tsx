'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, useTransition } from 'react';
import { readGoodsBulkAction } from '@/app/admin/goods-bulk-actions';
import type { GoodsGroupIdentity } from '@/lib/admin/goods-groups';
import { discountStopApplied, discountStopAwaitingResult, discountStopLossSummary, parseInlineSalePrice, type DiscountStopPricePhase } from '@/lib/admin/goods-list-inline';
import { adminConfirm } from '@/lib/admin/confirm';
import { CustomerServiceDialog } from './screens/CustomerServiceDialog';
import { AdminNotice } from './console/AdminKit';
import { Button } from './kit/ui/button';
import { GOOD_NUMBER_INPUT_CLASS } from './GoodEditorParts';
import { changePriceAfterStop, recoverDiscountStopPrice, reviewDiscountStop, stopDiscountThenChangePrice, type DiscountStopPriceStep } from './goods-inline-bulk';

/*
 * 즉시할인(기간 할인)이 진행·예정이거나 기간 없는 즉시할인(정가 표시) 중인 상품의 목록 판매가 칸(1027T-025, 묶음 15 '할인 멈추고 판매가 변경', TKT-033).
 * 칸을 누르면 이 창이 멈출 할인을 먼저 보여 주고, 확인하면 기존 '기간 할인 중지' → '판매가 변경'을 한 번에 차례로 부른다.
 * 판매가 변경이 실패하면 할인은 이미 멈춘 상태임을 밝히고 같은 창에서 판매가만 다시 시도한다(되돌리기는 없다).
 * 창과 상태는 목록 화면 수준(GoodsInlineDialogHost)에 있다 — 저장 뒤 목록이 다시 그려지며 그 상품이 현재 페이지에서 빠져도
 * (필터·정렬) 창과 결과가 남는다. 창을 열 때 받은 상품 값(스냅샷)만 쓰고 목록 행에 기대지 않는다.
 */

const won = (value: number) => `${value.toLocaleString('ko-KR')}원`;
const NOTE = 'text-sm text-muted-foreground';
const UNEXPECTED = '처리 중 문제가 생겼습니다. 창을 닫고 새로고침한 뒤 상품의 할인과 판매가를 확인해주세요.';

/**
 * 창을 열 때 판매가 칸이 넘기는 상품 값. `basePrice`는 운영자가 목록에서 본 할인 전 기본 판매가(첫 기대값)다.
 * `instant`면 기간 없는 즉시할인 상품이다 — `basePrice`는 정가 표시(할인 전 판매가)이고, 그 즉시할인도 함께 멈춘다(TKT-033).
 */
export interface DiscountStopTarget { goodId: string; goodName: string; goodCode: string | null; basePrice: number; hasOptions: boolean; instant?: boolean }

/**
 * 창의 상태와 동작. 창이 닫혀 있으면 `phase`가 null이다. `committing`은 확정·결과 조회가 서버에 가 있는 동안이다 —
 * 그때만 입력을 잠근다(멈출 할인을 읽는 동안과 그 결과가 그려질 때는 잠그지 않아 입력 칸 포커스가 유지된다).
 */
export function useDiscountStopPrice({ identity, onDone }: { identity?: GoodsGroupIdentity; onDone?: (target: DiscountStopTarget, price: number, stoppedHere: boolean) => void } = {}) {
  const router = useRouter();
  const [target, setTarget] = useState<DiscountStopTarget | null>(null);
  const [phase, setPhase] = useState<DiscountStopPricePhase | null>(null);
  const [seenBasePrice, setSeenBasePrice] = useState(0);
  const [input, setInput] = useState('');
  const [inputError, setInputError] = useState('');
  const [committing, setCommitting] = useState(false);
  /** 확정에 보낸 판매가(결과 조회로 끝날 때 결과 문구에 쓴다). */
  const [submitted, setSubmitted] = useState<{ price: number; stoppedHere: boolean } | null>(null);
  const [pending, start] = useTransition();
  const busy = useRef(false);
  function run(task: () => Promise<void>, onUnexpected: () => void, commit: boolean) {
    busy.current = true;
    if (commit) setCommitting(true);
    start(async () => {
      try { await task(); } catch { onUnexpected(); } finally { busy.current = false; if (commit) setCommitting(false); }
    });
  }
  function finish(goal: DiscountStopTarget, done: { price: number; stoppedHere: boolean } | null) {
    setPhase(null); setTarget(null); setSubmitted(null);
    if (done) onDone?.(goal, done.price, done.stoppedHere);
    router.refresh();
  }
  function apply(goal: DiscountStopTarget, step: DiscountStopPriceStep, done: { price: number; stoppedHere: boolean } | null) {
    if (step.seenBasePrice !== undefined) setSeenBasePrice(step.seenBasePrice);
    if (step.done) { finish(goal, done); return; }
    setPhase(step.phase);
  }
  function load(goal: DiscountStopTarget, seen: number) {
    if (!identity) return;
    setPhase({ step: 'loading' });
    run(async () => setPhase(await reviewDiscountStop(identity, goal.goodId, seen, Boolean(goal.instant))),
      () => setPhase({ step: 'review-failed', message: '멈출 할인을 확인하지 못했습니다. 다시 확인해주세요.', retry: true }), false);
  }
  /** 확인받은 뒤 실제 실행. */
  function execute(goal: DiscountStopTarget, phase: Extract<DiscountStopPricePhase, { step: 'ready' | 'price' }>, next: number) {
    if (!identity || busy.current) return;
    if (phase.step === 'ready') {
      const review = phase.review;
      const done = { price: next, stoppedHere: true };
      setSubmitted(done);
      /* 확정 응답을 받기 전에 실패하면 할인이 멈췄는지 알 수 없다 — 결과 조회로 끝낸다. */
      run(async () => apply(goal, await stopDiscountThenChangePrice(identity, goal.goodId, review, seenBasePrice, next, setPhase), done),
        () => setPhase({ step: 'stop-uncertain', review, operationId: review.operationId, message: UNEXPECTED }), true);
    } else {
      const stop = { stoppedHere: phase.stoppedHere, stopped: phase.stopped, ...(phase.stoppedInstant ? { stoppedInstant: phase.stoppedInstant } : {}) };
      const done = { price: next, stoppedHere: stop.stoppedHere };
      setSubmitted(done);
      run(async () => apply(goal, await changePriceAfterStop(identity, goal.goodId, seenBasePrice, next, stop), done),
        () => setPhase({ step: 'price', ...stop, error: UNEXPECTED }), true);
    }
  }
  return {
    target, phase, seenBasePrice, input, inputError, pending, committing,
    setInput(value: string) { setInput(value); setInputError(''); },
    /** 목록에서 본 기본 판매가로 창을 열고 멈출 할인을 읽는다. 다른 창이 열려 있으면 열지 않는다. */
    open(next: DiscountStopTarget) {
      if (!identity || busy.current || phase) return;
      setTarget(next); setSeenBasePrice(next.basePrice); setInput(String(next.basePrice)); setInputError(''); setSubmitted(null);
      load(next, next.basePrice);
    },
    reload() { if (target && !busy.current && phase?.step === 'review-failed' && phase.retry) load(target, seenBasePrice); },
    close() {
      if (!phase || !target || busy.current || discountStopAwaitingResult(phase)) return;
      // A reviewed stop that is never confirmed must not be committable later.
      if (phase.step === 'ready' && identity) void readGoodsBulkAction(phase.review.operationId, identity, true).catch(() => null);
      const refresh = discountStopApplied(phase) || phase.step === 'review-failed' && !phase.retry;
      setPhase(null); setTarget(null); setSubmitted(null);
      if (refresh) router.refresh();
    },
    submit() {
      if (!identity || !target || !phase || busy.current || (phase.step !== 'ready' && phase.step !== 'price')) return;
      const next = parseInlineSalePrice(input);
      if (next === null) { setInputError('1원 이상의 정수로 입력해주세요.'); return; }
      if (next === seenBasePrice) { setInputError('지금 판매가와 같습니다. 바꿀 판매가를 입력해주세요.'); return; }
      setInputError('');
      const goal = target;
      /* 돈이 걸린 변경이라 실행 전에 이전 → 새 판매가를 한 번 더 확인받는다(QA2). 확인창이 떠 있는 동안은 busy로 거듭 제출을 막는다. */
      const stopping = phase.step === 'ready';
      busy.current = true;
      void adminConfirm({
        title: '판매가 변경 확인',
        message: `${goal.goodName}의 판매가를 ${won(seenBasePrice)}에서 ${won(next)}(으)로 바꿉니다.${stopping ? ' 진행 중이거나 예정된 할인은 먼저 모두 멈추며 되돌리지 않습니다.' : ''}`,
        confirmLabel: stopping ? '할인 중지 후 변경' : '판매가 변경',
      }).then(ok => { busy.current = false; if (ok) execute(goal, phase, next); });
    },
    /** 결과를 모르는 단계의 처리 결과 조회(`seal`이면 미처리 요청 종료). */
    recover(seal: boolean) {
      if (!identity || !target || !phase || busy.current || (phase.step !== 'stop-uncertain' && phase.step !== 'price-uncertain')) return;
      const uncertain = phase, goal = target, done = submitted;
      run(async () => apply(goal, await recoverDiscountStopPrice(identity, uncertain, seal), done), () => setPhase({ ...uncertain, message: UNEXPECTED }), true);
    },
  };
}

export type DiscountStopPriceFlow = ReturnType<typeof useDiscountStopPrice>;

/** 할인 중지 후 판매가 변경 창. `flow`의 단계마다 무엇이 이미 바뀌었고 무엇이 남았는지 글자로 밝힌다. */
export function GoodsDiscountStopPriceDialog({ flow }: {
  flow: Pick<DiscountStopPriceFlow, 'target' | 'phase' | 'seenBasePrice' | 'input' | 'inputError' | 'pending' | 'committing' | 'setInput' | 'reload' | 'close' | 'submit' | 'recover'>;
}) {
  const inputId = useId(), errorId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const wasCommitting = useRef(false);
  const { phase, target, pending, committing } = flow;
  const awaiting = discountStopAwaitingResult(phase);
  /* 확정이 서버에 가 있는 동안과 결과를 모르는 동안만 잠근다. 멈출 할인을 읽는 동안에도 새 판매가는 미리 입력할 수 있다. */
  const locked = committing || awaiting;
  /* 확정이 끝나 다시 입력할 수 있게 되면(판매가 실패·결과 조회 뒤) 입력 칸으로 포커스를 돌려준다 — 잠그는 동안 포커스가 문서로 빠진다. */
  useEffect(() => {
    if (committing) { wasCommitting.current = true; return; }
    if (!wasCommitting.current) return;
    wasCommitting.current = false;
    if (!awaiting) inputRef.current?.focus({ preventScroll: true });
  }, [committing, awaiting]);
  if (!phase || !target) return null;
  const stopped = phase.step === 'price' || phase.step === 'price-uncertain' ? phase : null;
  const stoppedText = stopped?.stoppedHere ? discountStopLossSummary(stopped.stopped, stopped.stoppedInstant) : null;
  const stoppedLine = stoppedText ? <p className="mt-1">멈춘 할인: {stoppedText}</p> : null;
  return <CustomerServiceDialog title="할인 중지 후 판매가 변경" busy={pending || awaiting} onClose={flow.close}>
    <form className="flex min-w-0 flex-col gap-4" data-discount-stop-price={phase.step} aria-busy={pending}
      onSubmit={event => { event.preventDefault(); flow.submit(); }}>
      <p className="text-sm"><strong className="font-semibold">{target.goodName}</strong>{target.goodCode ? <small className="ml-1.5 text-xs text-muted-foreground">{target.goodCode}</small> : null}</p>
      {phase.step === 'loading' ? <AdminNotice tone="info" title="멈출 할인을 확인하는 중입니다." /> : null}
      {phase.step === 'ready' ? <AdminNotice tone="warning" title="할인을 멈추고 판매가를 바꿉니다.">
        <p>멈출 할인: {discountStopLossSummary(phase.review.discounts, phase.review.instant) ?? '진행 중이거나 예정된 기간 할인'}</p>
        <p className="mt-1">{phase.review.instant ? '기간 없는 즉시할인을 멈춰 판매가(할인 전)로 되돌리고, ' : ''}할인 프로모션이 건 할인을 포함해 이 상품의 진행 중이거나 예정된 기간 할인을 모두 멈춘 뒤 판매가를 바꿉니다. 멈춘 할인은 되돌리지 않으니 다시 필요하면 새로 등록하세요. 이미 끝난 할인과 기존 주문 금액은 바뀌지 않습니다.</p>
      </AdminNotice> : null}
      {phase.step === 'review-failed' ? <AdminNotice role="alert" tone="danger" title="할인과 판매가는 바뀌지 않았습니다.">
        <p>{phase.message}</p>
      </AdminNotice> : null}
      {phase.step === 'stop-uncertain' ? <AdminNotice role="alert" tone="warning" title="할인 중지 결과를 확인하지 못했습니다.">
        <p>{phase.message}</p><p className="mt-1">판매가 변경은 시작하지 않았습니다. 처리 결과를 조회하거나 미처리 요청을 종료해주세요.</p>
      </AdminNotice> : null}
      {phase.step === 'price' && phase.stoppedHere && phase.error ? <AdminNotice role="alert" tone="warning" title="할인은 멈췄습니다. 판매가는 바뀌지 않았습니다.">
        <p>{phase.error}</p>{stoppedLine}<p className="mt-1">멈춘 할인은 그대로 두고, 이 창에서 판매가만 다시 시도할 수 있습니다.</p>
      </AdminNotice> : null}
      {phase.step === 'price' && phase.stoppedHere && !phase.error ? <AdminNotice role="status" tone="info" title={committing ? '할인을 멈췄습니다. 판매가를 바꾸는 중입니다.' : '할인을 멈췄습니다. 판매가 변경을 계속해주세요.'}>
        {stoppedLine}
      </AdminNotice> : null}
      {phase.step === 'price' && !phase.stoppedHere ? <AdminNotice role={phase.error ? 'alert' : undefined} tone={phase.error ? 'warning' : 'info'} title="멈출 할인이 이미 없습니다. 판매가만 바꿉니다.">
        <p>진행 중이거나 예정된 기간 할인이 그사이 끝났거나 다른 곳에서 멈췄습니다.</p>{phase.error ? <p className="mt-1">{phase.error}</p> : null}
      </AdminNotice> : null}
      {phase.step === 'price-uncertain' ? <AdminNotice role="alert" tone="warning" title={phase.stoppedHere ? '할인은 멈췄습니다. 판매가 변경 결과를 확인하지 못했습니다.' : '판매가 변경 결과를 확인하지 못했습니다.'}>
        <p>{phase.message}</p>{stoppedLine}<p className="mt-1">판매가가 이미 바뀌었을 수 있습니다. 처리 결과를 조회하거나 미처리 요청을 종료해주세요.</p>
      </AdminNotice> : null}
      <fieldset className="m-0 grid min-w-0 gap-1.5 border-0 p-0" disabled={locked}><legend className="sr-only">판매가</legend>
        <p className="text-sm">현재 판매가 <strong className="font-semibold tabular-nums">{won(flow.seenBasePrice)}</strong>
          <small className="ml-1.5 text-xs text-muted-foreground">{target.hasOptions ? '할인 전 기본 판매가 · 옵션 추가금 유지' : '할인 전 판매가'}</small></p>
        <label className="text-sm font-medium" htmlFor={inputId}>새 판매가 (원)</label>
        <input id={inputId} ref={inputRef} name="price" inputMode="numeric" value={flow.input} onChange={event => flow.setInput(event.target.value)}
          className={`${GOOD_NUMBER_INPUT_CLASS} sm:max-w-48`} data-slot="input" data-dialog-autofocus="" onFocus={event => event.currentTarget.select()}
          aria-invalid={flow.inputError ? true : undefined} aria-describedby={flow.inputError ? errorId : undefined} />
        {flow.inputError ? <small id={errorId} role="alert" className="text-xs text-destructive">{flow.inputError}</small> : null}
      </fieldset>
      {phase.step === 'ready' || phase.step === 'loading' ? <p className={NOTE}>멈출 할인을 확인한 뒤 15분 안에 진행해주세요. 그사이 할인이나 옵션 가격이 바뀌면 아무것도 바꾸지 않고 다시 확인을 요청합니다.</p> : null}
      <div className="flex flex-wrap justify-end gap-2">
        {awaiting ? <>
          <Button type="button" variant="outline" disabled={pending} onClick={() => flow.recover(true)}>미처리 요청 종료</Button>
          <Button type="button" disabled={pending} onClick={() => flow.recover(false)}>처리 결과 조회</Button>
        </> : <>
          <Button type="button" variant="outline" disabled={pending} onClick={flow.close}>{phase.step === 'ready' || phase.step === 'loading' ? '취소' : '닫기'}</Button>
          {phase.step === 'review-failed' && phase.retry ? <Button type="button" disabled={pending} onClick={flow.reload}>다시 확인</Button> : null}
          {phase.step === 'ready' || phase.step === 'loading' ? <Button type="submit" disabled={pending || phase.step === 'loading'}>{committing ? '처리 중' : '할인 중지 후 변경'}</Button> : null}
          {phase.step === 'price' ? <Button type="submit" disabled={pending}>{committing ? '처리 중' : phase.error ? '판매가 변경 다시 시도' : '판매가 변경'}</Button> : null}
        </>}
      </div>
    </form>
  </CustomerServiceDialog>;
}
