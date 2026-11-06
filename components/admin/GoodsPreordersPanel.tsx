'use client';

import { useEffect, useId, useState, useTransition, type FormEvent } from 'react';
import {
  allocateGoodsPreordersAction, listGoodsPreorderReservationsAction, listGoodsPreordersAction, saveGoodsPreorderAction, switchToStockSupplyAction,
} from '@/app/admin/goods-preorder-actions';
import { toKstDateTimeInput } from '@/lib/admin/goods-price-periods';
import { preparePreorderAllocation, type AdminGoodsPreorder, type AdminPreorderReservationPage } from '@/lib/admin/goods-preorders';
import type { AdminGoodsVariant } from '@/lib/admin/goods-variants';
import { goodsShipDateLabel } from '@/lib/goods-preorders';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { Label } from '@/components/admin/kit/ui/label';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { GOOD_INPUT_CLASS, GOOD_NOTE_CLASS, GOOD_NUMBER_INPUT_CLASS, GOOD_SUBPANEL_CLASS, GOOD_TEXTAREA_CLASS } from './GoodEditorParts';

/* 템플릿 룩(ADR-0028). 라벨이 입력을 감싸므로 라벨 글자만 굵게 한다. */
const FIELD_CLASS = 'flex min-w-0 flex-col gap-2 text-sm';
const DETAILS_CLASS = 'min-w-0 rounded-lg border';
const SUMMARY_CLASS = 'cursor-pointer rounded-lg px-3 py-2.5 text-sm font-medium outline-none select-none marker:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50';

function PreorderEditor({ goodId, variants, policy, canActivate, onSaved }: {
  goodId: string; variants: AdminGoodsVariant[]; policy?: AdminGoodsPreorder; canActivate: boolean; onSaved: (message: string) => void;
}) {
  const [variantId, setVariantId] = useState(policy?.variantId ?? variants.find((variant) => !variant.archivedAt)?.id ?? '');
  const [state, setState] = useState<'draft' | 'active'>('draft');
  const [capacityQty, setCapacityQty] = useState(String(policy?.capacityQty ?? ''));
  const [startsAt, setStartsAt] = useState(toKstDateTimeInput(policy?.startsAt ?? null));
  const [endsAt, setEndsAt] = useState(toKstDateTimeInput(policy?.endsAt ?? null));
  const [expectedShipDate, setExpectedShipDate] = useState(policy?.expectedShipDate ?? '');
  const [approvalReference, setApprovalReference] = useState(policy?.approvalReference ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const id = useId();
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null);
    const data = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await saveGoodsPreorderAction(data);
      if (result.ok) onSaved(result.message); else setError(result.error);
    });
  }
  return <form className="flex min-w-0 flex-col gap-4" onSubmit={save}>
    <input type="hidden" name="goodId" value={goodId} /><input type="hidden" name="variantId" value={variantId} />
    <input type="hidden" name="policyId" value={policy?.id ?? ''} /><input type="hidden" name="revision" value={policy?.revision ?? ''} />
    <input type="hidden" name="policy" value={JSON.stringify({ state, capacityQty, startsAt, endsAt, expectedShipDate, approvalReference })} />
    <div className={FIELD_CLASS}>
      <Label htmlFor={`${id}-variant`}>예약 대상 옵션</Label>
      <NativeSelect className="w-full" id={`${id}-variant`} value={variantId} onChange={(event) => setVariantId(event.target.value)} disabled={pending || Boolean(policy)} required>
        <option value="" disabled>옵션을 선택해주세요</option>
        {variants.map((variant) => <option key={variant.id} value={variant.id}>{variant.name} · {variant.code}{variant.archivedAt ? ' (사용 중지)' : ''}</option>)}
      </NativeSelect>
    </div>
    <div className="grid min-w-0 gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,10.5rem),1fr))]">
      <label className={FIELD_CLASS}><span className="font-medium">승인 예약 물량</span>
        <input className={GOOD_NUMBER_INPUT_CLASS} data-slot="input" type="number" min={1} max={2147483647} step={1} value={capacityQty} onChange={(event) => setCapacityQty(event.target.value)}
          placeholder="미설정" required={state === 'active'} disabled={pending} />
      </label>
      <label className={FIELD_CLASS}><span className="font-medium">접수 시작 (한국 시간)</span>
        <input className={GOOD_INPUT_CLASS} data-slot="input" type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} required={state === 'active'} disabled={pending} />
      </label>
      <label className={FIELD_CLASS}><span className="font-medium">접수 종료 (한국 시간)</span>
        <input className={GOOD_INPUT_CLASS} data-slot="input" type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} required={state === 'active'} disabled={pending} />
      </label>
      <label className={FIELD_CLASS}><span className="font-medium">발송 예정일</span>
        <input className={GOOD_INPUT_CLASS} data-slot="input" type="date" value={expectedShipDate} min={endsAt.slice(0, 10) || undefined} onChange={(event) => setExpectedShipDate(event.target.value)}
          required={state === 'active'} disabled={pending} />
      </label>
    </div>
    <label className={FIELD_CLASS}><span className="font-medium">승인 문서·확인 근거</span>
      <textarea className={GOOD_TEXTAREA_CLASS} data-slot="textarea" value={approvalReference} maxLength={2000} rows={3} onChange={(event) => setApprovalReference(event.target.value)}
        placeholder="승인된 공급 물량과 일정을 확인할 수 있는 문서 번호 또는 자료 위치" required={state === 'active'} disabled={pending} />
    </label>
    <div className={FIELD_CLASS}>
      <Label htmlFor={`${id}-state`}>저장 방식</Label>
      <NativeSelect className="w-full sm:w-fit" id={`${id}-state`} value={state} onChange={(event) => setState(event.target.value as 'draft' | 'active')} disabled={pending}>
        <option value="draft">초안 저장</option>
        {canActivate && <option value="active">승인 조건으로 예약 활성화</option>}
      </NativeSelect>
    </div>
    <p className="text-sm text-muted-foreground">초안은 현재 판매 방식에 반영되지 않습니다. 활성화한 옵션은 승인 예약 물량으로 판매하며,
      접수 중지·종료 후에도 일반 재고 판매로 자동 전환하지 않습니다. 활성화한 물량과 원 일정은 변경할 수 없습니다.</p>
    {!canActivate && <p className="text-xs text-muted-foreground">예약 활성화는 관리자가 저장된 초안과 승인 근거를 확인한 뒤 진행합니다.</p>}
    {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    <button className={`${buttonVariants()} self-start`} data-slot="button" type="submit" disabled={pending || !variantId}>{pending ? '저장 중…' : state === 'active' ? '예약 활성화' : '예약 초안 저장'}</button>
  </form>;
}

function PreorderReceipt({ policy, variant, canActivate, onSaved }: {
  policy: AdminGoodsPreorder; variant?: AdminGoodsVariant; canActivate: boolean; onSaved: (message: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  function stop() {
    const data = new FormData(); data.set('goodId', policy.goodId); data.set('variantId', policy.variantId);
    data.set('policyId', policy.id); data.set('revision', String(policy.revision)); data.set('policy', JSON.stringify({ state: 'stopped' }));
    setError(null);
    startTransition(async () => {
      const result = await saveGoodsPreorderAction(data);
      if (result.ok) onSaved(result.message); else setError(result.error);
    });
  }
  function regular() {
    setError(null);
    startTransition(async () => {
      const result = await switchToStockSupplyAction(policy.goodId, policy.variantId, policy.id, policy.revision);
      if (result.ok) onSaved(result.message); else setError(result.error);
    });
  }
  const at = (date: string | null) => date ? new Date(date).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '미설정';
  return <div className="flex min-w-0 flex-col gap-1.5 text-sm" data-preorder-receipt="">
    <strong className="font-medium">{variant?.name ?? '이전 옵션'} · {policy.state === 'active' ? '승인된 예약 조건' : '접수 중지'}{policy.selected ? ' · 현재 선택' : ''}</strong>
    <span className="text-muted-foreground tabular-nums">승인 {policy.capacityQty?.toLocaleString('ko-KR') ?? '미설정'}개 · 미할당 예약 {policy.reservedQty.toLocaleString('ko-KR')}개 · 실물 할당 누적 {policy.allocatedQty.toLocaleString('ko-KR')}개</span>
    <span className="text-muted-foreground tabular-nums">승인 물량 중 미사용 {policy.remainingQty?.toLocaleString('ko-KR') ?? '미설정'}개</span>
    <span className="text-muted-foreground tabular-nums">{at(policy.startsAt)} ~ {at(policy.endsAt)} (한국 시간)</span>
    <span className="text-muted-foreground">{goodsShipDateLabel(policy.expectedShipDate)}</span>
    <p className="text-xs whitespace-pre-wrap text-muted-foreground wrap-anywhere">승인 근거: {policy.approvalReference}</p>
    <div className="mt-1.5 flex flex-wrap gap-2 empty:hidden">
      {policy.state === 'active' && <button className={buttonVariants({ variant: 'outline', size: 'sm' })} data-slot="button" type="button" disabled={pending} onClick={stop}>새 예약 접수 중지</button>}
      {policy.state === 'stopped' && policy.selected && canActivate && <button className={buttonVariants({ variant: 'outline', size: 'sm' })} data-slot="button" type="button" disabled={pending || policy.reservedQty > 0} onClick={regular}>일반 재고 판매로 전환</button>}
    </div>
    {policy.state === 'stopped' && policy.selected && policy.reservedQty > 0 && <small className="text-xs text-muted-foreground">미할당 예약 주문을 먼저 처리해야 일반 재고 판매로 전환할 수 있습니다.</small>}
    {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
  </div>;
}

function ReservationSelection({ goodId, page, onSaved, canAllocate }: { goodId: string; page: AdminPreorderReservationPage; canAllocate: boolean; onSaved: (message: string) => void }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [receipt, setReceipt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const selectedRows = page.items.filter((item) => selected.includes(item.orderItemId));
  const totals = new Map<string, { name: string; qty: number; available: number }>();
  for (const row of selectedRows) {
    const previous = totals.get(row.variantId);
    totals.set(row.variantId, { name: row.variantName ?? '기본 옵션', qty: (previous?.qty ?? 0) + row.qty, available: row.physicalStockQty });
  }
  const shortage = [...totals.values()].some((total) => total.qty > total.available);
  function allocate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null);
    const selection = preparePreorderAllocation(page.items, selected);
    if (!selection) { setError('선택한 예약 주문과 현재 재고를 다시 확인해주세요.'); return; }
    startTransition(async () => {
      const result = await allocateGoodsPreordersAction(goodId, selection, receipt);
      if (result.ok) onSaved(result.message); else setError(result.error);
    });
  }
  const status = { reserved: '미할당', allocated: '할당 완료', released: '입고 전 취소', returned: '입고 후 환불' };
  return <form className="flex min-w-0 flex-col gap-3" onSubmit={allocate}>
    {page.items.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">해당 상태의 예약 주문이 없습니다.</p> : <ul className="m-0 flex list-none flex-col divide-y rounded-lg border p-0">
      {page.items.map((item) => <li key={item.orderItemId} className="flex min-w-0 flex-col gap-1 px-3 py-3">
        <label className="flex items-start gap-2 text-sm">
          {canAllocate && item.state === 'reserved' && <input className="mt-0.5" type="checkbox" checked={selected.includes(item.orderItemId)}
            disabled={pending || !['paid', 'confirmed', 'shipping'].includes(item.orderStatus)}
            onChange={(event) => setSelected((current) => event.target.checked ? [...current, item.orderItemId] : current.filter((id) => id !== item.orderItemId))} />}
          <span className="min-w-0">{item.variantName ?? '기본 옵션'} · <span className="tabular-nums">{item.qty.toLocaleString('ko-KR')}개</span> · {status[item.state]}{item.orderStatus === 'pending' ? ' · 결제 대기' : ''}</span>
        </label>
        <a className="w-fit text-xs underline underline-offset-4 wrap-anywhere" href={`/admin/sales/orders/${item.orderId}`}>주문 {item.orderId}</a>
        <small className="block text-xs text-muted-foreground">{goodsShipDateLabel(item.expectedShipDate)} · 현재 실제 옵션 재고 <span className="tabular-nums">{item.physicalStockQty.toLocaleString('ko-KR')}개</span></small>
        {canAllocate && item.allocationReference && <small className="block text-xs text-muted-foreground wrap-anywhere">입고 근거: {item.allocationReference}</small>}
        {canAllocate && item.releaseReason && <small className="block text-xs text-muted-foreground">취소·환불 기록: {item.releaseReason}</small>}
      </li>)}
    </ul>}
    {canAllocate && page.items.some((item) => item.state === 'reserved') && <>
      <p className="text-sm text-muted-foreground">입고를 확인하고 옵션 재고에 실제 수량을 반영한 뒤, 결제가 확인된 예약 주문을 선택해주세요.
        선택한 품목 수량만 실제 옵션 재고에서 예약 주문으로 할당합니다.</p>
      {totals.size > 0 && <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-sm tabular-nums">{[...totals.entries()].map(([id, total]) => <li key={id}>
        {total.name}: 할당 {total.qty.toLocaleString('ko-KR')}개 / 실제 재고 {total.available.toLocaleString('ko-KR')}개
      </li>)}</ul>}
      {shortage && <p className="text-sm text-destructive" role="alert">선택한 품목을 할당할 실제 옵션 재고가 부족합니다.</p>}
      <label className={FIELD_CLASS}><span className="font-medium">입고 확인 근거</span>
        <textarea className={GOOD_TEXTAREA_CLASS} data-slot="textarea" rows={2} maxLength={2000} value={receipt} onChange={(event) => setReceipt(event.target.value)} disabled={pending} required
          placeholder="입고 내역을 확인할 수 있는 문서 번호 또는 자료 위치" />
      </label>
      <button className={`${buttonVariants()} self-start`} data-slot="button" type="submit" disabled={pending || !selected.length || shortage || !receipt.trim()}>{pending ? '할당 중…' : '선택한 예약 품목에 실제 재고 할당'}</button>
    </>}
    {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
  </form>;
}

function PreorderReservations({ goodId, revision, onSaved, canAllocate }: { goodId: string; revision: number; canAllocate: boolean; onSaved: (message: string) => void }) {
  const [state, setState] = useState('reserved');
  const [pageNumber, setPageNumber] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const key = `${goodId}:${state}:${pageNumber}:${revision}:${refresh}`;
  const [loaded, setLoaded] = useState<{ key: string; reservations?: AdminPreorderReservationPage; error?: string } | null>(null);
  const stateId = useId();
  useEffect(() => {
    let canceled = false;
    void listGoodsPreorderReservationsAction(goodId, state, pageNumber).then((result) => {
      if (!canceled) setLoaded(result.ok ? { key, reservations: result.reservations } : { key, error: result.error });
    }).catch(() => { if (!canceled) setLoaded({ key, error: '예약 주문을 불러오지 못했습니다.' }); });
    return () => { canceled = true; };
  }, [goodId, key, pageNumber, state]);
  const visible = loaded?.key === key ? loaded : null;
  return <div className="flex min-w-0 flex-col gap-3 border-t pt-4" data-preorder-reservations="">
    <h3 className="text-sm font-medium">{canAllocate ? '예약 주문·입고 할당' : '예약 주문'}</h3>
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex min-w-0 flex-col gap-2"><Label htmlFor={stateId}>예약 상태</Label><NativeSelect className="w-full sm:w-40" id={stateId} value={state} onChange={(event) => { setState(event.target.value); setPageNumber(1); }}>
        <option value="reserved">미할당 예약</option><option value="allocated">실물 할당 완료</option><option value="released">입고 전 취소</option><option value="returned">입고 후 환불</option>
      </NativeSelect></div>
      <button className={buttonVariants({ variant: 'outline' })} data-slot="button" type="button" onClick={() => setRefresh((value) => value + 1)}>예약 주문 새로고침</button>
    </div>
    {!visible ? <p className="text-sm text-muted-foreground" role="status">예약 주문을 불러오는 중입니다…</p> : visible.error ? <p className="text-sm text-destructive" role="alert">{visible.error}</p> : visible.reservations ? <>
      <small className="text-xs text-muted-foreground tabular-nums">총 {visible.reservations.total.toLocaleString('ko-KR')}품목 · {pageNumber}페이지</small>
      <ReservationSelection key={key} canAllocate={canAllocate} goodId={goodId} page={visible.reservations} onSaved={(message) => { setPageNumber(1); onSaved(message); }} />
      <div className="flex gap-2">
        <button className={buttonVariants({ variant: 'outline', size: 'sm' })} data-slot="button" type="button" disabled={pageNumber === 1} onClick={() => setPageNumber((page) => page - 1)}>이전</button>
        <button className={buttonVariants({ variant: 'outline', size: 'sm' })} data-slot="button" type="button" disabled={!visible.reservations.hasMore} onClick={() => setPageNumber((page) => page + 1)}>다음</button>
      </div>
    </> : null}
  </div>;
}

/** Independent product operations panel; keep it outside GoodSection's form. */
export function GoodsPreordersPanel({ goodId, variants, canActivate = false, canReadOrders = true, canAllocate = true }: {
  goodId: string; variants: AdminGoodsVariant[]; canActivate?: boolean; canReadOrders?: boolean; canAllocate?: boolean;
}) {
  const [refresh, setRefresh] = useState(0);
  const [notice, setNotice] = useState<{ goodId: string; message: string } | null>(null);
  const [loaded, setLoaded] = useState<{ key: string; policies?: AdminGoodsPreorder[]; error?: string } | null>(null);
  const key = `${goodId}:${refresh}`;
  useEffect(() => {
    let canceled = false;
    void listGoodsPreordersAction(goodId).then((result) => {
      if (!canceled) setLoaded(result.ok ? { key, policies: result.policies } : { key, error: result.error });
    }).catch(() => { if (!canceled) setLoaded({ key, error: '예약 조건을 불러오지 못했습니다.' }); });
    return () => { canceled = true; };
  }, [goodId, key]);
  const visible = loaded?.key === key ? loaded : null;
  const selectedVariants = variants.filter((variant) => variant.goodId === goodId);
  const reload = () => setRefresh((value) => value + 1);
  const saved = (message: string) => { setNotice({ goodId, message }); reload(); };
  return <section className={`${GOOD_SUBPANEL_CLASS} text-sm`} aria-labelledby={`goods-preorders-${goodId}`} data-preorders-panel="">
    <div className="flex flex-col gap-1"><h2 id={`goods-preorders-${goodId}`} className="text-base leading-snug font-medium">예약판매</h2>
      <p className="text-sm text-muted-foreground">승인된 미래 공급 물량을 실제 옵션 재고와 구별하여 관리합니다. 물량·접수 기간·발송 예정일·승인 근거가 모두 있어야 활성화할 수 있습니다.
        같은 출고지에서 주문한 일반 상품과 예약 상품은 가장 늦은 예정일에 함께 발송하도록 안내합니다.</p>
    </div>
    {notice?.goodId === goodId && <p className={`${GOOD_NOTE_CLASS} font-medium text-[var(--wc-success)]`} role="status">{notice.message}</p>}
    {!visible ? <p className="text-sm text-muted-foreground" role="status">예약 조건을 불러오는 중입니다…</p> : visible.error ? <p className="text-sm text-destructive" role="alert">{visible.error}</p> : <>
      {!visible.policies?.length && <p className="text-sm text-muted-foreground">등록된 예약 조건이 없습니다.</p>}
      {visible.policies?.map((policy) => <div key={`${policy.id}:${policy.revision}`} className="min-w-0">
        {policy.state === 'draft' ? <details className={DETAILS_CLASS}><summary className={SUMMARY_CLASS}>예약 초안 · {selectedVariants.find((variant) => variant.id === policy.variantId)?.name ?? '이전 옵션'}</summary>
          <div className="border-t p-3"><PreorderEditor goodId={goodId} variants={selectedVariants} policy={policy} canActivate={canActivate} onSaved={saved} /></div>
        </details> : <div className="rounded-lg border p-3"><PreorderReceipt policy={policy} variant={selectedVariants.find((variant) => variant.id === policy.variantId)} canActivate={canActivate} onSaved={saved} /></div>}
      </div>)}
      <details className={DETAILS_CLASS}><summary className={SUMMARY_CLASS}>새 예약 조건</summary><div className="border-t p-3"><PreorderEditor key={key} goodId={goodId} variants={selectedVariants} canActivate={canActivate} onSaved={saved} /></div></details>
      {canReadOrders ? <PreorderReservations goodId={goodId} revision={refresh} onSaved={saved} canAllocate={canAllocate} /> : null}
    </>}
    <button className={`${buttonVariants({ variant: 'outline' })} self-start`} data-slot="button" type="button" onClick={reload}>저장된 예약 조건 새로고침</button>
  </section>;
}
