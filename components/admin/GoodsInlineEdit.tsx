'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, useTransition, type FormEvent, type ReactNode } from 'react';
import { Pencil } from 'lucide-react';
import { adjustAdminStockAction } from '@/app/admin/actions';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { GOOD_NUMBER_INPUT_CLASS } from './GoodEditorParts';
import { commitGoodsBulkAction, previewGoodsBulkAction, readGoodsBulkAction } from '@/app/admin/goods-bulk-actions';
import { goodsBulkError, parseGoodsBulkRequest, type GoodsBulkCommand, type GoodsBulkGood } from '@/lib/admin/goods-bulk';
import type { GoodsGroupIdentity } from '@/lib/admin/goods-groups';

/*
 * 상품 목록에서 바로 수정(A9). 새 쓰기 경로를 만들지 않는다.
 * - 판매가·판매상태: 일괄 변경 RPC(미리보기 → 확정)를 상품 1개로 재사용한다. 미리보기의 현재 값이
 *   목록을 열 때 본 값과 다르면 확정하지 않고 요청을 종료한다(다른 사람의 수정 덮어쓰기 방지).
 *   미리보기와 확정 사이의 변경은 기존 지문 비교가, 감사는 기존 일괄 변경 기록이 맡는다.
 * - 재고수량: 기존 실재고 조정(admin_adjust_stock)을 쓴다. 본 수량을 기대값으로 보내므로
 *   그사이 판매·조정이 있으면 거절된다. 옵션이 여럿이면 옵션 단위라 상품 편집으로 보낸다.
 */

type BulkOutcome = { ok: true } | { ok: false; message: string; operationId?: string };

export async function runSingleGoodBulk(identity: GoodsGroupIdentity, goodId: string, command: GoodsBulkCommand,
  values: Record<string, string | number | null>, staleMessage: (row: GoodsBulkGood) => string | null): Promise<BulkOutcome> {
  const request = parseGoodsBulkRequest({ kind: 'goods', ids: [goodId], command, values });
  if (!request) return { ok: false, message: '입력값을 확인해주세요.' };
  const operationId = crypto.randomUUID();
  const preview = await previewGoodsBulkAction(operationId, request, identity);
  if ('error' in preview) return { ok: false, message: preview.error };
  const row = preview.value.goods.find(item => item.id === goodId);
  const stale = row ? staleMessage(row) : '현재 상품 정보를 확인하지 못했습니다.';
  if (stale) {
    // Close the reviewed request so it can never be committed later.
    await readGoodsBulkAction(operationId, identity, true).catch(() => null);
    return { ok: false, message: stale };
  }
  const receipt = await commitGoodsBulkAction(operationId, identity);
  if ('error' in receipt) return { ok: false, message: receipt.error, ...(receipt.uncertain ? { operationId } : {}) };
  if (receipt.value.state === 'completed') return { ok: true };
  return { ok: false, message: goodsBulkError(receipt.value.error) };
}

/*
 * 값 버튼(R11). 칸 폭을 채우고, 오른쪽 정렬 칸(ConsoleGrid의 td[data-align=end])에서는 값을 오른쪽에 둔다.
 * `fillCell`이면 버튼의 ::after 덮개가 칸 전체를 덮는다 — 감싼 칸(td)을 기준 상자로 세우는 것은
 * 감싸개의 `[td:has(&)]:relative`다(표 부품을 고치지 않고 이 칸에만). 인쇄에서는 덮개를 걷는다.
 */
const INLINE_VALUE_CLASS = 'group/inline flex w-full min-w-0 cursor-pointer items-center justify-start gap-1.5 rounded-md border border-dashed border-transparent bg-transparent px-1.5 py-0.5 text-left text-inherit transition-colors outline-none hover:border-input hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 in-data-[align=end]:justify-end';
const INLINE_FILL_CLASS = 'after:absolute after:inset-0 print:after:hidden';
/* 전체 수정은 '수정' 버튼 하나로 충분해 연필은 값에 커서·포커스가 닿을 때만 보인다(터치 기기는 커서가 없어 항상 보인다). */
const INLINE_PENCIL_CLASS = 'size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/inline:opacity-100 group-focus-visible/inline:opacity-100 pointer-coarse:opacity-100';
/** 같은 칸의 다른 조작(처리 결과 조회)은 덮개 위에 둔다. 틀고정 칸(z-10)보다는 아래다. */
const INLINE_ABOVE_FILL_CLASS = 'relative z-1';
const INLINE_INPUT_CLASS = `${GOOD_NUMBER_INPUT_CLASS} h-7 w-28 max-md:w-full`;

/**
 * `fillCell`: 그 칸의 주 내용이면 셀 어디를 눌러도 수정이 열린다(R11). 다른 링크와 한 칸을 쓰면 그 줄만 채운다.
 * `compact`: 한 칸에 여러 줄이 쌓일 때 값 버튼 높이를 줄여 표 줄 높이를 지킨다.
 */
export function InlineEditor({ label, display, children, onSubmit, pending, error, recovery, onRecover, editing, setEditing, fillCell = false, compact = false }: {
  label: string; display: ReactNode; children: ReactNode; onSubmit: (form: FormData) => void; pending: boolean; error: string;
  recovery: boolean; onRecover: () => void; editing: boolean; setEditing: (value: boolean) => void; fillCell?: boolean; compact?: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const errorId = useId();
  const valueRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  /* Esc·취소로 닫으면 포커스가 사라지지 않게 값 버튼으로 돌려준다. 저장으로 닫힐 때는 화면을 새로 읽으니 옮기지 않는다. */
  useEffect(() => {
    if (editing || !returnFocus.current) return;
    returnFocus.current = false;
    valueRef.current?.focus();
  }, [editing]);
  function cancel() { returnFocus.current = true; setEditing(false); }
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); onSubmit(new FormData(event.currentTarget)); }
  const valueClass = `${INLINE_VALUE_CLASS} ${compact ? 'min-h-6' : 'min-h-8'}${fillCell ? ` ${INLINE_FILL_CLASS}` : ''}`;
  if (!editing) return <span className={`grid w-full min-w-0 justify-items-stretch gap-1${fillCell ? ' [td:has(&)]:relative' : ''}`} data-inline-edit={fillCell ? 'cell' : 'value'}>
    <button type="button" ref={valueRef} className={valueClass} aria-label={`${label} 바로 수정`} onClick={() => setEditing(true)}>{display}<Pencil aria-hidden="true" className={INLINE_PENCIL_CLASS} /></button>
    {error ? <small role="alert" className="text-xs text-destructive">{error}</small> : null}
    {recovery ? <button type="button" className={`${buttonVariants({ variant: 'outline', size: 'xs' })} ${INLINE_ABOVE_FILL_CLASS} justify-self-start in-data-[align=end]:justify-self-end`} data-slot="button" disabled={pending} onClick={onRecover}>처리 결과 조회</button> : null}
  </span>;
  return <form ref={formRef} className="grid w-full min-w-0 gap-1 in-data-[align=end]:justify-items-end" data-inline-edit="editing" onSubmit={submit} aria-busy={pending}
    onKeyDown={event => { if (event.key === 'Escape' && !pending) { event.preventDefault(); cancel(); } }}>
    <fieldset className="m-0 grid min-w-0 gap-1 border-0 p-0 in-data-[align=end]:justify-items-end" disabled={pending}><legend className="sr-only">{label} 수정</legend>
      {children}
      <span className="flex gap-1.5">
        <button type="submit" className={buttonVariants({ size: 'xs' })} data-slot="button">{pending ? '저장 중' : '저장'}</button>
        <button type="button" className={buttonVariants({ variant: 'outline', size: 'xs' })} data-slot="button" onClick={cancel}>취소</button>
      </span>
    </fieldset>
    {error ? <small id={errorId} role="alert" className="text-xs text-destructive">{error}</small> : null}
  </form>;
}

function useInlineState() {
  const router = useRouter();
  const [editing, setEditing] = useState(false), [error, setError] = useState(''), [recovery, setRecovery] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return { router, editing, setEditing: (value: boolean) => { setEditing(value); if (value) setError(''); }, error, setError, recovery, setRecovery, pending, start };
}

export function GoodsInlinePrice({ goodId, basePrice, display, identity, hasOptions }: {
  goodId: string; basePrice: number; display: ReactNode; identity: GoodsGroupIdentity; hasOptions: boolean;
}) {
  const state = useInlineState();
  const inputId = useId();
  function save(form: FormData) {
    const raw = String(form.get('price') ?? '').replaceAll(',', '').trim();
    const next = Number(raw);
    if (!/^[1-9][0-9]*$/.test(raw) || !Number.isSafeInteger(next) || next > 2_147_483_647) { state.setError('1원 이상의 정수로 입력해주세요.'); return; }
    if (next === basePrice) { state.setEditing(false); return; }
    state.setError(''); state.start(async () => {
      try {
        const result = await runSingleGoodBulk(identity, goodId, 'price', { mode: 'set', value: next },
          row => row.price === basePrice ? null : `다른 곳에서 기본 판매가가 ${row.price.toLocaleString('ko-KR')}원으로 바뀌었습니다. 새로고침 후 다시 수정해주세요.`);
        if (result.ok) { state.setEditing(false); state.setRecovery(null); state.router.refresh(); return; }
        state.setError(result.message); state.setRecovery(result.operationId ?? null); if (result.operationId) state.setEditing(false);
      } catch { state.setError('판매가를 저장하지 못했습니다. 새로고침 후 결과를 확인해주세요.'); }
    });
  }
  function recover() {
    if (!state.recovery) return;
    const id = state.recovery;
    state.start(async () => {
      const result = await readGoodsBulkAction(id, identity).catch(() => null);
      if (!result || 'error' in result) { state.setError(result?.error ?? '처리 결과를 불러오지 못했습니다.'); return; }
      state.setRecovery(result.value.state === 'unresolved' ? id : null);
      state.setError(result.value.state === 'completed' ? '' : result.value.state === 'unresolved' ? '아직 완료 기록이 없습니다. 잠시 후 다시 조회해주세요.' : goodsBulkError(result.value.error));
      if (result.value.state === 'completed') state.router.refresh();
    });
  }
  return <InlineEditor fillCell label="판매가" display={display} onSubmit={save} pending={state.pending} error={state.error} recovery={Boolean(state.recovery)} onRecover={recover} editing={state.editing} setEditing={state.setEditing}>
    <label htmlFor={inputId} className="sr-only">기본 판매가 (원)</label>
    <input id={inputId} name="price" inputMode="numeric" defaultValue={basePrice} autoFocus className={INLINE_INPUT_CLASS} data-slot="input" />
    <small className="text-xs text-muted-foreground">{hasOptions ? '기본 판매가 · 옵션 추가금 유지' : '판매가'}</small>
  </InlineEditor>;
}

/** `display`: 값 버튼에 그릴 내용. 주지 않으면 판매상태 이름 글자다. 무엇을 그리든 누르면 판매중·판매중지를 고른다. */
export function GoodsInlineSale({ goodId, stopped, identity, display, compact = false }: { goodId: string; stopped: boolean; identity: GoodsGroupIdentity; display?: ReactNode; compact?: boolean }) {
  const state = useInlineState();
  const inputId = useId();
  function save(form: FormData) {
    const nextStopped = form.get('sale') === 'stopped';
    if (nextStopped === stopped) { state.setEditing(false); return; }
    state.setError(''); state.start(async () => {
      try {
        const result = await runSingleGoodBulk(identity, goodId, nextStopped ? 'stop' : 'start', {},
          row => row.stopped === stopped ? null : '다른 곳에서 판매상태가 바뀌었습니다. 새로고침 후 다시 수정해주세요.');
        if (result.ok) { state.setEditing(false); state.router.refresh(); return; }
        state.setError(result.message); state.setRecovery(result.operationId ?? null); if (result.operationId) state.setEditing(false);
      } catch { state.setError('판매상태를 저장하지 못했습니다. 새로고침 후 결과를 확인해주세요.'); }
    });
  }
  function recover() {
    if (!state.recovery) return;
    const id = state.recovery;
    state.start(async () => {
      const result = await readGoodsBulkAction(id, identity).catch(() => null);
      if (!result || 'error' in result) { state.setError(result?.error ?? '처리 결과를 불러오지 못했습니다.'); return; }
      state.setRecovery(result.value.state === 'unresolved' ? id : null);
      state.setError(result.value.state === 'completed' ? '' : result.value.state === 'unresolved' ? '아직 완료 기록이 없습니다. 잠시 후 다시 조회해주세요.' : goodsBulkError(result.value.error));
      if (result.value.state === 'completed') state.router.refresh();
    });
  }
  return <InlineEditor compact={compact} label="판매상태" display={display ?? (stopped ? '판매중지' : '판매중')} onSubmit={save} pending={state.pending} error={state.error} recovery={Boolean(state.recovery)} onRecover={recover} editing={state.editing} setEditing={state.setEditing}>
    <label htmlFor={inputId} className="sr-only">판매상태</label>
    <NativeSelect id={inputId} name="sale" defaultValue={stopped ? 'stopped' : 'active'} autoFocus size="sm" className="w-28 max-md:w-full">
      <option value="active">판매중</option><option value="stopped">판매중지</option>
    </NativeSelect>
  </InlineEditor>;
}

export function GoodsInlineStock({ goodId, ipId, variantId, stockQty }: {
  goodId: string; ipId: string; variantId: string; stockQty: number;
}) {
  const state = useInlineState();
  const inputId = useId();
  // The request id is never rendered; it only makes one adjustment idempotent.
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  function save(form: FormData) {
    const raw = String(form.get('stockQty') ?? '').replaceAll(',', '').trim();
    const next = Number(raw);
    if (!/^(0|[1-9][0-9]*)$/.test(raw) || !Number.isSafeInteger(next) || next > 2_147_483_647) { state.setError('0 이상의 정수로 입력해주세요.'); return; }
    if (next === stockQty) { state.setEditing(false); return; }
    const data = new FormData();
    data.set('adjustmentId', requestId); data.set('goodId', goodId); data.set('ipId', ipId); data.set('variantId', variantId);
    data.set('expectedStockQty', String(stockQty)); data.set('delta', String(next - stockQty));
    data.set('reason', `상품 목록에서 재고수량 수정 (${stockQty.toLocaleString('ko-KR')} → ${next.toLocaleString('ko-KR')})`);
    state.setError(''); state.start(async () => {
      try {
        const result = await adjustAdminStockAction({}, data);
        if (result.stockAdjustment) { setRequestId(result.stockAdjustment.adjustmentId); state.setEditing(false); state.router.refresh(); return; }
        state.setError(result.errors?.form ?? Object.values(result.errors ?? {}).find(Boolean) ?? '재고수량을 저장하지 못했습니다.');
        // A stale-quantity or reused request was not applied; a fresh request id is needed after refresh.
        setRequestId(crypto.randomUUID());
      } catch { state.setError('재고수량을 저장하지 못했습니다. 새로고침 후 수량을 확인해주세요.'); }
    });
  }
  return <InlineEditor fillCell label="재고수량" display={`${stockQty.toLocaleString('ko-KR')}개`} onSubmit={save} pending={state.pending} error={state.error} recovery={false} onRecover={() => undefined} editing={state.editing} setEditing={state.setEditing}>
    <label htmlFor={inputId} className="sr-only">재고수량 (개)</label>
    <input id={inputId} name="stockQty" inputMode="numeric" defaultValue={stockQty} autoFocus className={INLINE_INPUT_CLASS} data-slot="input" />
    <small className="text-xs text-muted-foreground">실재고 조정 기록이 남습니다.</small>
  </InlineEditor>;
}
