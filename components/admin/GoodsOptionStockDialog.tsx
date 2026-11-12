'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useRef, useState, useTransition } from 'react';
import { adjustAdminStockAction } from '@/app/admin/actions';
import { statusTone } from '@/lib/admin/status-tone';
import {
  OPTION_STOCK_REASON_MAX, OPTION_STOCK_STATUS_LABELS, applyOptionStockOutcomes, openOptionStockRows, optionStockCurrent, optionStockSummary, planOptionStockSave,
  type GoodsListOptionStock, type OptionStockOutcome, type OptionStockRequest, type OptionStockRow,
} from '@/lib/admin/goods-list-inline';
import { CustomerServiceDialog } from './screens/CustomerServiceDialog';
import { GroupTable } from './GoodsGroupOperation';
import { AdminStatusBadge } from './console/AdminKit';
import { Button } from './kit/ui/button';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from './kit/ui/table';
import { GOOD_INPUT_CLASS, GOOD_NUMBER_INPUT_CLASS } from './GoodEditorParts';

/*
 * 옵션이 여러 개인 상품의 목록 재고 칸(1014-106·107·1027T-025, 묶음 15 '옵션별 재고 바로 수정').
 * 옵션마다 기존 실재고 조정(admin_adjust_stock)을 차례로 부른다. 이 창에서 본 수량을 기대값으로 보내므로
 * 그사이 판매·다른 수정으로 바뀐 옵션만 거절되어 '다시 확인'이 되고, 나머지 옵션은 저장된다.
 */

const UNCERTAIN = '저장 결과를 확인하지 못했습니다. 같은 수량으로 다시 저장하면 한 번만 반영됩니다.';

/** 옵션마다 한 건씩 차례로 조정한다. 한 옵션의 거절·응답 끊김은 그 옵션의 결과로만 남고 다른 옵션을 막지 않는다. */
export async function saveGoodsOptionStocks(good: { goodId: string; ipId: string }, requests: readonly OptionStockRequest[]): Promise<OptionStockOutcome[]> {
  const outcomes: OptionStockOutcome[] = [];
  for (const request of requests) {
    const data = new FormData();
    data.set('adjustmentId', request.requestId); data.set('goodId', good.goodId); data.set('ipId', good.ipId); data.set('variantId', request.variantId);
    data.set('expectedStockQty', String(request.expectedStockQty)); data.set('delta', String(request.nextStockQty - request.expectedStockQty));
    data.set('reason', request.reason);
    try {
      const result = await adjustAdminStockAction({}, data);
      const message = result.errors ? result.errors.form ?? Object.values(result.errors).find(Boolean) : undefined;
      /* 거절(기대 수량과 다름·이미 쓴 요청·옵션 없음 등)은 반영되지 않은 것이 확실하다. */
      outcomes.push(message ? { variantId: request.variantId, state: 'rejected', message }
        : { variantId: request.variantId, state: 'saved', stockQty: result.stockAdjustment?.stockQty ?? request.nextStockQty });
    } catch {
      outcomes.push({ variantId: request.variantId, state: 'uncertain', message: UNCERTAIN });
    }
  }
  return outcomes;
}

const newRequestId = () => crypto.randomUUID();

/** 창의 상태와 동작. 창이 닫혀 있으면 `rows`가 null이다. 상태는 재고 칸 부품이 들고 있어 저장 뒤 목록이 새로 그려져도 창이 남는다. */
export function useOptionStockDialog({ goodId, ipId, options }: { goodId: string; ipId: string; options: readonly GoodsListOptionStock[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<OptionStockRow[] | null>(null);
  const [summary, setSummary] = useState('');
  const [pending, start] = useTransition();
  const busy = useRef(false);
  return {
    rows, summary, pending,
    open() { if (busy.current || rows) return; setRows(openOptionStockRows([...options], newRequestId)); setSummary(''); },
    close() { if (busy.current || !rows) return; setRows(null); setSummary(''); },
    change(variantId: string, patch: Partial<Pick<OptionStockRow, 'input' | 'reason'>>) {
      setRows(current => current?.map(row => row.variantId === variantId ? { ...row, ...patch } : row) ?? null);
    },
    save() {
      if (!rows || busy.current) return;
      const plan = planOptionStockSave(rows, options);
      setRows(plan.rows);
      if (!plan.ok) { setSummary('입력을 확인해주세요. 아무 옵션도 저장하지 않았습니다.'); return; }
      if (!plan.requests.length) { setSummary('바뀐 수량이 없습니다.'); return; }
      busy.current = true; setSummary('');
      start(async () => {
        try {
          const outcomes = await saveGoodsOptionStocks({ goodId, ipId }, plan.requests);
          if (outcomes.every(outcome => outcome.state === 'saved')) { setRows(null); router.refresh(); return; }
          setRows(current => applyOptionStockOutcomes(current ?? plan.rows, outcomes, newRequestId));
          setSummary(optionStockSummary(outcomes));
          router.refresh();
        } finally { busy.current = false; }
      });
    },
  };
}

export type OptionStockDialogFlow = ReturnType<typeof useOptionStockDialog>;

/** 옵션별 재고 창. 옵션마다 현재·새 수량·사유를 두고, 저장 뒤 옵션마다 결과(저장됨·다시 확인·결과 확인 필요)를 밝힌다. */
export function GoodsOptionStockDialog({ goodName, goodCode, live, editorHref, flow }: {
  goodName: string; goodCode: string | null; live: readonly GoodsListOptionStock[]; editorHref: string;
  flow: Pick<OptionStockDialogFlow, 'rows' | 'summary' | 'pending' | 'change' | 'close' | 'save'>;
}) {
  const prefix = useId();
  const { rows, pending } = flow;
  if (!rows) return null;
  return <CustomerServiceDialog title="옵션별 재고수량" busy={pending} onClose={flow.close}>
    <form className="flex min-w-0 flex-col gap-4" data-option-stock-dialog="" aria-busy={pending} onSubmit={event => { event.preventDefault(); flow.save(); }}>
      <p className="text-sm"><strong className="font-semibold">{goodName}</strong>{goodCode ? <small className="ml-1.5 text-xs text-muted-foreground">{goodCode}</small> : null}</p>
      <p className="text-sm text-muted-foreground">옵션마다 새 수량을 입력하고 저장합니다. 이 창을 연 때의 수량을 기준으로 저장해서, 그사이 판매나 다른 수정으로 수량이 바뀐 옵션은 저장하지 않고 다시 확인을 요청합니다. 저장한 옵션마다 실재고 조정 기록과 사유가 남습니다(사유를 비우면 바뀐 수량이 사유로 남습니다).</p>
      <fieldset className="m-0 min-w-0 border-0 p-0" disabled={pending}><legend className="sr-only">옵션별 재고수량</legend>
        <GroupTable label="옵션별 재고수량" layout="fixed" className="min-w-[30rem]">
          <TableHeader><TableRow><TableHead className="w-[36%]">옵션</TableHead><TableHead className="w-[18%] text-right">현재</TableHead><TableHead className="w-[18%]">새 수량</TableHead><TableHead>사유 (선택)</TableHead></TableRow></TableHeader>
          <TableBody>{rows.map((row, index) => {
            const current = optionStockCurrent(row, live);
            const messageId = `${prefix}-message-${index}`;
            const label = row.status === 'idle' || row.status === 'invalid' ? null : OPTION_STOCK_STATUS_LABELS[row.status];
            return <TableRow key={row.variantId} data-option-stock={row.status}>
              <TableCell className="align-top whitespace-normal wrap-anywhere">{row.name}<small className="block text-xs text-muted-foreground">{row.code}</small>
                {label ? <AdminStatusBadge className="mt-1" tone={statusTone('optionStockEdit', row.status)}>{label}</AdminStatusBadge> : null}
                {row.message ? <small id={messageId} role={row.status === 'saved' ? undefined : 'alert'} className={`mt-1 block text-xs ${row.status === 'invalid' ? 'text-destructive' : 'text-foreground'}`}>{row.message}</small> : null}
              </TableCell>
              <TableCell className="text-right align-top tabular-nums">{current === null ? '확인 필요' : `${current.toLocaleString('ko-KR')}개`}</TableCell>
              <TableCell className="align-top"><input aria-label={`${row.name} 새 수량`} inputMode="numeric" value={row.input} onChange={event => flow.change(row.variantId, { input: event.target.value })}
                className={GOOD_NUMBER_INPUT_CLASS} data-slot="input" {...(index === 0 ? { 'data-dialog-autofocus': '' } : {})}
                aria-invalid={row.status === 'invalid' ? true : undefined} aria-describedby={row.message ? messageId : undefined} /></TableCell>
              <TableCell className="align-top"><input aria-label={`${row.name} 사유`} value={row.reason} maxLength={OPTION_STOCK_REASON_MAX} placeholder="비우면 자동 기록"
                onChange={event => flow.change(row.variantId, { reason: event.target.value })} className={GOOD_INPUT_CLASS} data-slot="input" /></TableCell>
            </TableRow>;
          })}</TableBody>
        </GroupTable>
      </fieldset>
      {flow.summary ? <p className="text-sm" role="status">{flow.summary}</p> : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" href={editorHref}>옵션 추가·안전재고는 상품 수정에서</Link>
        <span className="flex gap-2">
          <Button type="button" variant="outline" disabled={pending} onClick={flow.close}>닫기</Button>
          <Button type="submit" disabled={pending}>{pending ? '저장 중' : '저장'}</Button>
        </span>
      </div>
    </form>
  </CustomerServiceDialog>;
}
