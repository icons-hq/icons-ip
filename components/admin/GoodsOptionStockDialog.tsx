'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, useTransition } from 'react';
import { adjustGoodsOptionStocksAction, readGoodsOptionStocksAction, type GoodsOptionStockSaveResult } from '@/app/admin/goods-list-inline-actions';
import { statusTone } from '@/lib/admin/status-tone';
import {
  OPTION_STOCK_REASON_MAX, OPTION_STOCK_STATUS_LABELS, applyOptionStockOutcomes, applyOptionStockRead, openOptionStockRows, optionStockNeedsRead, optionStockSummary,
  planOptionStockSave, type GoodsListOptionStock, type OptionStockRequest, type OptionStockRow,
} from '@/lib/admin/goods-list-inline';
import { CustomerServiceDialog } from './screens/CustomerServiceDialog';
import { GroupTable } from './GoodsGroupOperation';
import { AdminStatusBadge } from './console/AdminKit';
import { Button } from './kit/ui/button';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from './kit/ui/table';
import { GOOD_INPUT_CLASS, GOOD_NUMBER_INPUT_CLASS } from './GoodEditorParts';

/*
 * 옵션이 여러 개인 상품의 목록 재고 칸(1014-106·107·1027T-025, 묶음 15 '옵션별 재고 바로 수정').
 * 바뀐 옵션을 한 번의 서버 요청(adjustGoodsOptionStocksAction)으로 보내고, 서버가 옵션마다 기존 실재고 조정(admin_adjust_stock)을
 * 차례로 부른다. 이 창에서 본 수량을 기대값으로 보내므로 그사이 판매·다른 수정으로 바뀐 옵션만 거절되어 '다시 확인'이 되고,
 * 나머지 옵션은 저장된다. 목록 갱신은 서버가 묶음 끝에 한 번 한다.
 * 창과 상태는 목록 화면 수준(GoodsInlineDialogHost)에 있다 — 저장 뒤 목록이 다시 그려지며 그 상품이 현재 페이지에서
 * 빠져도(품절 필터·정렬) 창과 옵션별 결과가 남는다. 거절된 옵션의 새 현재 수량은 서버가 같은 응답에 다시 읽어 준다.
 */

const UNCERTAIN = '저장 결과를 확인하지 못했습니다. 같은 수량으로 다시 저장하면 한 번만 반영됩니다.';

/**
 * 바뀐 옵션을 한 번에 저장한다. 서버가 거절한 묶음(권한·입력)은 아무 옵션도 바꾸지 않았다는 뜻이다.
 * 응답을 받지 못하면 보낸 옵션 모두 결과를 모른다 — 같은 요청번호·같은 값으로 다시 보내면 옵션마다 한 번만 반영된다.
 */
export async function saveGoodsOptionStocks(good: { goodId: string; ipId: string }, requests: readonly OptionStockRequest[]): Promise<GoodsOptionStockSaveResult> {
  try {
    return await adjustGoodsOptionStocksAction(good.goodId, good.ipId, requests);
  } catch {
    return { ok: true, outcomes: requests.map(request => ({ variantId: request.variantId, state: 'uncertain' as const, message: UNCERTAIN })) };
  }
}

/** 창을 열 때 재고 칸이 넘기는 상품 값. `options`는 목록이 읽은 옵션별 실재고(이 창의 첫 기대값)다. */
export interface OptionStockTarget { goodId: string; ipId: string; goodName: string; goodCode: string | null; editorHref: string; options: GoodsListOptionStock[] }

const newRequestId = () => crypto.randomUUID();
const READ_FAILED = ' 바뀐 현재 수량을 읽지 못했습니다. 저장을 누르면 먼저 다시 읽습니다.';

/** 창의 상태와 동작. 창이 닫혀 있으면 `rows`가 null이다. `onSaved`는 모든 옵션이 저장돼 창이 닫힐 때 목록 화면에 결과를 남긴다. */
export function useOptionStockDialog({ onSaved }: { onSaved?: (target: OptionStockTarget, count: number) => void } = {}) {
  const router = useRouter();
  const [target, setTarget] = useState<OptionStockTarget | null>(null);
  const [rows, setRows] = useState<OptionStockRow[] | null>(null);
  const [summary, setSummary] = useState('');
  /** 저장·다시 읽기를 마칠 때마다 늘어난다. 창이 남으면 확인할 첫 줄로 포커스를 옮긴다. */
  const [settled, setSettled] = useState(0);
  const [pending, start] = useTransition();
  const busy = useRef(false);
  function run(task: () => Promise<void>) {
    busy.current = true;
    start(async () => { try { await task(); } finally { busy.current = false; setSettled(count => count + 1); } });
  }
  return {
    target, rows, summary, pending, settled,
    open(next: OptionStockTarget) {
      if (busy.current || rows) return;
      setTarget(next); setRows(openOptionStockRows(next.options, newRequestId)); setSummary('');
    },
    close() {
      if (busy.current || !rows) return;
      /* 저장 결과를 모르는 옵션이 있으면 서버의 화면 갱신이 없었을 수 있어 목록을 다시 읽는다(나머지는 서버가 이미 갱신했다). */
      const unknown = rows.some(row => row.status === 'uncertain');
      setRows(null); setTarget(null); setSummary('');
      if (unknown) router.refresh();
    },
    change(variantId: string, patch: Partial<Pick<OptionStockRow, 'input' | 'reason'>>) {
      setRows(current => current?.map(row => row.variantId === variantId ? { ...row, ...patch } : row) ?? null);
    },
    save() {
      if (!rows || !target || busy.current) return;
      const goal = target;
      /* 거절된 옵션의 현재 수량을 아직 못 읽었으면 먼저 읽어 보인다 — 운영자가 보지 않은 수량을 기대값으로 보내지 않는다. */
      if (optionStockNeedsRead(rows)) {
        const before = rows;
        run(async () => {
          const fresh = await readGoodsOptionStocksAction(goal.goodId).catch(() => null);
          if (!fresh?.ok) { setSummary(`현재 수량을 읽지 못했습니다. 잠시 후 다시 저장해주세요.${fresh ? ` (${fresh.error})` : ''}`); return; }
          setRows(applyOptionStockRead(before, fresh.options));
          setSummary('바뀐 현재 수량을 다시 읽었습니다. 확인하고 다시 저장해주세요.');
        });
        return;
      }
      const plan = planOptionStockSave(rows);
      setRows(plan.rows);
      if (!plan.ok) { setSummary('입력을 확인해주세요. 아무 옵션도 저장하지 않았습니다.'); return; }
      if (!plan.requests.length) { setSummary('바뀐 수량이 없습니다.'); return; }
      setSummary('');
      run(async () => {
        const result = await saveGoodsOptionStocks(goal, plan.requests);
        if (!result.ok) { setSummary(`${result.error} 아무 옵션도 저장하지 않았습니다.`); return; }
        const { outcomes } = result;
        if (outcomes.every(outcome => outcome.state === 'saved')) {
          setRows(null); setTarget(null); onSaved?.(goal, outcomes.length);
          return;
        }
        let next = applyOptionStockOutcomes(plan.rows, outcomes, newRequestId);
        let note = '';
        if (outcomes.some(outcome => outcome.state === 'rejected')) {
          if (result.options) next = applyOptionStockRead(next, result.options); else note = READ_FAILED;
        }
        setRows(next); setSummary(`${optionStockSummary(outcomes)}${note}`);
      });
    },
  };
}

export type OptionStockDialogFlow = ReturnType<typeof useOptionStockDialog>;

/*
 * 좁은 폭(모바일)에서는 표를 옵션마다 두 줄 카드로 바꾼다 — 1줄 옵션명·현재 수량, 2줄 새 수량·사유 입력. 가로로 밀지 않고 입력·저장한다.
 * 넓은 폭(sm 이상)은 표 그대로다. 화면 전용 CSS 없이 kit 표 부품에 Tailwind 반응형 유틸리티만 얹는다(ADR-0028).
 */
const NARROW_TABLE = 'max-sm:block sm:min-w-[30rem]';
const NARROW_ROW = 'max-sm:grid max-sm:grid-cols-2 max-sm:items-start max-sm:gap-x-3 max-sm:gap-y-2 max-sm:px-3 max-sm:py-3';
const NARROW_CELL = 'max-sm:block max-sm:min-w-0 max-sm:p-0 max-sm:whitespace-normal';
/** 넓은 폭에서는 표 머리글이 말하므로 화면에서 숨기고, 좁은 폭에서는 입력 위 이름표로 보인다. */
const NARROW_LABEL = 'mb-1 block text-xs text-muted-foreground sm:sr-only';

/** 옵션별 재고 창. 옵션마다 현재·새 수량·사유를 두고, 저장 뒤 옵션마다 결과(저장됨·다시 확인·결과 확인 필요)를 밝힌다. */
export function GoodsOptionStockDialog({ flow }: {
  flow: Pick<OptionStockDialogFlow, 'target' | 'rows' | 'summary' | 'pending' | 'settled' | 'change' | 'close' | 'save'>;
}) {
  const prefix = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const { rows, target, pending, settled } = flow;
  /* 저장 중에는 입력을 잠가 포커스가 문서로 빠진다. 창이 남으면 확인할 첫 줄(오류·다시 확인·결과 확인 필요), 없으면 첫 입력으로 돌려준다. */
  useEffect(() => {
    if (!settled) return;
    const form = formRef.current;
    const focus = form?.querySelector<HTMLInputElement>('tr:is([data-option-stock=invalid],[data-option-stock=recheck],[data-option-stock=uncertain]) input')
      ?? form?.querySelector<HTMLInputElement>('input');
    focus?.focus({ preventScroll: true });
  }, [settled]);
  if (!rows || !target) return null;
  return <CustomerServiceDialog title="옵션별 재고수량" busy={pending} onClose={flow.close}>
    <form ref={formRef} className="flex min-w-0 flex-col gap-4" data-option-stock-dialog="" aria-busy={pending} onSubmit={event => { event.preventDefault(); flow.save(); }}>
      <p className="text-sm"><strong className="font-semibold">{target.goodName}</strong>{target.goodCode ? <small className="ml-1.5 text-xs text-muted-foreground">{target.goodCode}</small> : null}</p>
      <p className="text-sm text-muted-foreground">옵션마다 새 수량을 입력하고 저장합니다. 이 창을 연 때의 수량을 기준으로 저장해서, 그사이 판매나 다른 수정으로 수량이 바뀐 옵션은 저장하지 않고 다시 확인을 요청합니다. 저장한 옵션마다 실재고 조정 기록과 사유가 남습니다(사유를 비우면 바뀐 수량이 사유로 남습니다).</p>
      <fieldset className="m-0 min-w-0 border-0 p-0" disabled={pending}><legend className="sr-only">옵션별 재고수량</legend>
        <GroupTable label="옵션별 재고수량" layout="fixed" className={NARROW_TABLE}>
          <TableHeader className="max-sm:hidden"><TableRow><TableHead className="w-[36%]">옵션</TableHead><TableHead className="w-[18%] text-right">현재</TableHead><TableHead className="w-[18%]">새 수량</TableHead><TableHead>사유 (선택)</TableHead></TableRow></TableHeader>
          <TableBody className="max-sm:block">{rows.map((row, index) => {
            const messageId = `${prefix}-message-${index}`;
            const qtyId = `${prefix}-qty-${index}`, reasonId = `${prefix}-reason-${index}`;
            const label = row.status === 'idle' || row.status === 'invalid' ? null : OPTION_STOCK_STATUS_LABELS[row.status];
            return <TableRow key={row.variantId} data-option-stock={row.status} className={NARROW_ROW}>
              <TableCell className={`align-top whitespace-normal wrap-anywhere ${NARROW_CELL}`}>{row.name}<small className="block text-xs text-muted-foreground">{row.code}</small>
                {label ? <AdminStatusBadge className="mt-1" tone={statusTone('optionStockEdit', row.status)}>{label}</AdminStatusBadge> : null}
                {row.message ? <small id={messageId} role={row.status === 'saved' ? undefined : 'alert'} className={`mt-1 block text-xs ${row.status === 'invalid' ? 'text-destructive' : 'text-foreground'}`}>{row.message}</small> : null}
              </TableCell>
              <TableCell className={`text-right align-top tabular-nums ${NARROW_CELL}`}><span className="text-xs text-muted-foreground sm:sr-only">현재 </span>{row.seen === null ? '확인 필요' : `${row.seen.toLocaleString('ko-KR')}개`}</TableCell>
              <TableCell className={`align-top ${NARROW_CELL}`}><label className={NARROW_LABEL} htmlFor={qtyId}>새 수량</label>
                <input id={qtyId} aria-label={`${row.name} 새 수량`} inputMode="numeric" value={row.input} onChange={event => flow.change(row.variantId, { input: event.target.value })}
                  className={GOOD_NUMBER_INPUT_CLASS} data-slot="input" readOnly={row.missing} {...(index === 0 ? { 'data-dialog-autofocus': '' } : {})}
                  aria-invalid={row.status === 'invalid' ? true : undefined} aria-describedby={row.message ? messageId : undefined} /></TableCell>
              <TableCell className={`align-top ${NARROW_CELL}`}><label className={NARROW_LABEL} htmlFor={reasonId}>사유 (선택)</label>
                <input id={reasonId} aria-label={`${row.name} 사유`} value={row.reason} maxLength={OPTION_STOCK_REASON_MAX} placeholder="비우면 자동 기록" readOnly={row.missing}
                  onChange={event => flow.change(row.variantId, { reason: event.target.value })} className={GOOD_INPUT_CLASS} data-slot="input" /></TableCell>
            </TableRow>;
          })}</TableBody>
        </GroupTable>
      </fieldset>
      {flow.summary ? <p className="text-sm" role="status">{flow.summary}</p> : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" href={target.editorHref}>옵션 추가·안전재고는 상품 수정에서</Link>
        <span className="flex gap-2">
          <Button type="button" variant="outline" disabled={pending} onClick={flow.close}>닫기</Button>
          <Button type="submit" disabled={pending}>{pending ? '저장 중' : '저장'}</Button>
        </span>
      </div>
    </form>
  </CustomerServiceDialog>;
}
