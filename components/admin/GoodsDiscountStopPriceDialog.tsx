'use client';

import { useRouter } from 'next/navigation';
import { useId, useRef, useState, useTransition } from 'react';
import { readGoodsBulkAction } from '@/app/admin/goods-bulk-actions';
import type { GoodsGroupIdentity } from '@/lib/admin/goods-groups';
import { discountStopApplied, discountStopAwaitingResult, discountStopSummary, parseInlineSalePrice, type DiscountStopPricePhase } from '@/lib/admin/goods-list-inline';
import { CustomerServiceDialog } from './screens/CustomerServiceDialog';
import { AdminNotice } from './console/AdminKit';
import { Button } from './kit/ui/button';
import { GOOD_NUMBER_INPUT_CLASS } from './GoodEditorParts';
import { changePriceAfterStop, recoverDiscountStopPrice, reviewDiscountStop, stopDiscountThenChangePrice, type DiscountStopPriceStep } from './goods-inline-bulk';

/*
 * 즉시할인(기간 할인)이 진행·예정인 상품의 목록 판매가 칸(1027T-025, 묶음 15 '할인 멈추고 판매가 변경').
 * 칸을 누르면 이 창이 멈출 할인을 먼저 보여 주고, 확인하면 기존 '기간 할인 중지' → '판매가 변경'을 한 번에 차례로 부른다.
 * 판매가 변경이 실패하면 할인은 이미 멈춘 상태임을 밝히고 같은 창에서 판매가만 다시 시도한다(되돌리기는 없다).
 */

const won = (value: number) => `${value.toLocaleString('ko-KR')}원`;
const NOTE = 'text-sm text-muted-foreground';
const UNEXPECTED = '처리 중 문제가 생겼습니다. 창을 닫고 새로고침한 뒤 상품의 할인과 판매가를 확인해주세요.';

/** 창의 상태와 동작. 창이 닫혀 있으면 `phase`가 null이다. 상태는 판매가 칸 부품이 들고 있어 저장 뒤 목록이 새로 그려져도 창이 남는다. */
export function useDiscountStopPrice({ goodId, basePrice, identity }: { goodId: string; basePrice: number; identity: GoodsGroupIdentity }) {
  const router = useRouter();
  const [phase, setPhase] = useState<DiscountStopPricePhase | null>(null);
  const [seenBasePrice, setSeenBasePrice] = useState(basePrice);
  const [input, setInput] = useState('');
  const [inputError, setInputError] = useState('');
  const [pending, start] = useTransition();
  const busy = useRef(false);
  function run(task: () => Promise<void>, onUnexpected: () => void) {
    busy.current = true;
    start(async () => {
      try { await task(); } catch { onUnexpected(); } finally { busy.current = false; }
    });
  }
  function apply(step: DiscountStopPriceStep) {
    if (step.seenBasePrice !== undefined) setSeenBasePrice(step.seenBasePrice);
    if (step.done) { setPhase(null); router.refresh(); return; }
    setPhase(step.phase);
  }
  function load(seen: number) {
    setPhase({ step: 'loading' });
    run(async () => setPhase(await reviewDiscountStop(identity, goodId, seen)),
      () => setPhase({ step: 'review-failed', message: '멈출 할인을 확인하지 못했습니다. 다시 확인해주세요.', retry: true }));
  }
  return {
    phase, seenBasePrice, input, inputError, pending,
    setInput(value: string) { setInput(value); setInputError(''); },
    /** 목록에서 본 기본 판매가로 창을 열고 멈출 할인을 읽는다. */
    open() {
      if (busy.current || phase) return;
      setSeenBasePrice(basePrice); setInput(String(basePrice)); setInputError('');
      load(basePrice);
    },
    reload() { if (!busy.current && phase?.step === 'review-failed' && phase.retry) load(seenBasePrice); },
    close() {
      if (!phase || busy.current || discountStopAwaitingResult(phase)) return;
      // A reviewed stop that is never confirmed must not be committable later.
      if (phase.step === 'ready') void readGoodsBulkAction(phase.review.operationId, identity, true).catch(() => null);
      const refresh = discountStopApplied(phase) || phase.step === 'review-failed' && !phase.retry;
      setPhase(null);
      if (refresh) router.refresh();
    },
    submit() {
      if (!phase || busy.current || (phase.step !== 'ready' && phase.step !== 'price')) return;
      const next = parseInlineSalePrice(input);
      if (next === null) { setInputError('1원 이상의 정수로 입력해주세요.'); return; }
      if (next === seenBasePrice) { setInputError('지금 판매가와 같습니다. 바꿀 판매가를 입력해주세요.'); return; }
      setInputError('');
      if (phase.step === 'ready') {
        const review = phase.review;
        /* 확정 응답을 받기 전에 실패하면 할인이 멈췄는지 알 수 없다 — 결과 조회로 끝낸다. */
        run(async () => apply(await stopDiscountThenChangePrice(identity, goodId, review, seenBasePrice, next, setPhase)),
          () => setPhase({ step: 'stop-uncertain', review, operationId: review.operationId, message: UNEXPECTED }));
      } else {
        const stop = { stoppedHere: phase.stoppedHere, stopped: phase.stopped };
        run(async () => apply(await changePriceAfterStop(identity, goodId, seenBasePrice, next, stop)),
          () => setPhase({ step: 'price', ...stop, error: UNEXPECTED }));
      }
    },
    /** 결과를 모르는 단계의 처리 결과 조회(`seal`이면 미처리 요청 종료). */
    recover(seal: boolean) {
      if (!phase || busy.current || (phase.step !== 'stop-uncertain' && phase.step !== 'price-uncertain')) return;
      const uncertain = phase;
      run(async () => apply(await recoverDiscountStopPrice(identity, uncertain, seal)), () => setPhase({ ...uncertain, message: UNEXPECTED }));
    },
  };
}

export type DiscountStopPriceFlow = ReturnType<typeof useDiscountStopPrice>;

/** 할인 중지 후 판매가 변경 창. `flow`의 단계마다 무엇이 이미 바뀌었고 무엇이 남았는지 글자로 밝힌다. */
export function GoodsDiscountStopPriceDialog({ goodName, goodCode, hasOptions, flow }: {
  goodName: string; goodCode: string | null; hasOptions: boolean;
  flow: Pick<DiscountStopPriceFlow, 'phase' | 'seenBasePrice' | 'input' | 'inputError' | 'pending' | 'setInput' | 'reload' | 'close' | 'submit' | 'recover'>;
}) {
  const inputId = useId(), errorId = useId();
  const { phase, pending } = flow;
  if (!phase) return null;
  const awaiting = discountStopAwaitingResult(phase);
  /* 멈출 할인을 읽는 동안에도 새 판매가는 미리 입력할 수 있다(창을 열면 입력 칸에서 시작한다). 저장 단계에서는 잠근다. */
  const editable = phase.step === 'loading' || !pending && (phase.step === 'ready' || phase.step === 'price');
  const stopped = phase.step === 'price' || phase.step === 'price-uncertain' ? phase : null;
  const stoppedLine = stopped?.stoppedHere && stopped.stopped ? <p className="mt-1">멈춘 할인: {discountStopSummary(stopped.stopped)}</p> : null;
  return <CustomerServiceDialog title="할인 중지 후 판매가 변경" busy={pending || awaiting} onClose={flow.close}>
    <form className="flex min-w-0 flex-col gap-4" data-discount-stop-price={phase.step} aria-busy={pending}
      onSubmit={event => { event.preventDefault(); flow.submit(); }}>
      <p className="text-sm"><strong className="font-semibold">{goodName}</strong>{goodCode ? <small className="ml-1.5 text-xs text-muted-foreground">{goodCode}</small> : null}</p>
      {phase.step === 'loading' ? <AdminNotice tone="info" title="멈출 할인을 확인하는 중입니다." /> : null}
      {phase.step === 'ready' ? <AdminNotice tone="warning" title="할인을 멈추고 판매가를 바꿉니다.">
        <p>멈출 할인: {phase.review.discounts ? discountStopSummary(phase.review.discounts) : '진행 중이거나 예정된 기간 할인'}</p>
        <p className="mt-1">할인 프로모션이 건 할인을 포함해 이 상품의 진행 중이거나 예정된 기간 할인을 모두 멈춘 뒤 판매가를 바꿉니다. 멈춘 할인은 되돌리지 않으니 다시 필요하면 새로 등록하세요. 이미 끝난 할인과 기존 주문 금액은 바뀌지 않습니다.</p>
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
      {phase.step === 'price' && phase.stoppedHere && !phase.error ? <AdminNotice role="status" tone="info" title={pending ? '할인을 멈췄습니다. 판매가를 바꾸는 중입니다.' : '할인을 멈췄습니다. 판매가 변경을 계속해주세요.'}>
        {stoppedLine}
      </AdminNotice> : null}
      {phase.step === 'price' && !phase.stoppedHere ? <AdminNotice role={phase.error ? 'alert' : undefined} tone={phase.error ? 'warning' : 'info'} title="멈출 할인이 이미 없습니다. 판매가만 바꿉니다.">
        <p>진행 중이거나 예정된 기간 할인이 그사이 끝났거나 다른 곳에서 멈췄습니다.</p>{phase.error ? <p className="mt-1">{phase.error}</p> : null}
      </AdminNotice> : null}
      {phase.step === 'price-uncertain' ? <AdminNotice role="alert" tone="warning" title={phase.stoppedHere ? '할인은 멈췄습니다. 판매가 변경 결과를 확인하지 못했습니다.' : '판매가 변경 결과를 확인하지 못했습니다.'}>
        <p>{phase.message}</p>{stoppedLine}
      </AdminNotice> : null}
      <fieldset className="m-0 grid min-w-0 gap-1.5 border-0 p-0" disabled={!editable}><legend className="sr-only">판매가</legend>
        <p className="text-sm">현재 판매가 <strong className="font-semibold tabular-nums">{won(flow.seenBasePrice)}</strong>
          <small className="ml-1.5 text-xs text-muted-foreground">{hasOptions ? '할인 전 기본 판매가 · 옵션 추가금 유지' : '할인 전 판매가'}</small></p>
        <label className="text-sm font-medium" htmlFor={inputId}>새 판매가 (원)</label>
        <input id={inputId} name="price" inputMode="numeric" value={flow.input} onChange={event => flow.setInput(event.target.value)}
          className={`${GOOD_NUMBER_INPUT_CLASS} sm:max-w-48`} data-slot="input" data-dialog-autofocus=""
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
          {phase.step === 'ready' || phase.step === 'loading' ? <Button type="submit" disabled={pending || phase.step === 'loading'}>{pending ? '처리 중' : '할인 중지 후 변경'}</Button> : null}
          {phase.step === 'price' ? <Button type="submit" disabled={pending}>{pending ? '처리 중' : phase.error ? '판매가 변경 다시 시도' : '판매가 변경'}</Button> : null}
        </>}
      </div>
    </form>
  </CustomerServiceDialog>;
}
