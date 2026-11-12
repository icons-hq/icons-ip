'use client';

import { useEffect, useId, useRef, useState, useTransition } from 'react';
import {
  allocateGoodsPreordersAction, listGoodsPreorderReservationsAction, listGoodsPreordersAction, saveGoodsPreorderAction, saveRandomGoodsPreordersAction,
  switchToStockSupplyAction,
} from '@/app/admin/goods-preorder-actions';
import { toKstDateTimeInput } from '@/lib/admin/goods-price-periods';
import {
  ADMIN_PREORDER_RESERVATION_PAGE_SIZE, pendingPreorderReservationsByVariant, preparePreorderAllocation, type AdminGoodsPreorder, type AdminPreorderReservationPage,
} from '@/lib/admin/goods-preorders';
import { ConsolePagination } from '@/components/admin/console/ConsolePagination';
import type { AdminGoodsVariant } from '@/lib/admin/goods-variants';
import { goodsShipDateLabel } from '@/lib/goods-preorders';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { Label } from '@/components/admin/kit/ui/label';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { GOOD_INPUT_CLASS, GOOD_NOTE_CLASS, GOOD_NUMBER_INPUT_CLASS, GOOD_SUBPANEL_CLASS, GOOD_TEXTAREA_CLASS } from './GoodEditorParts';
import { GOOD_DETACHED_FORM_ID, GoodWorkspaceDetails, reportDetachedValidity, useGoodWorkspaceStash } from './GoodWorkspace';
import { GoodsPreorderSchedulePanel, type PreorderScheduleSuggestion } from './GoodsPreorderSchedulePanel';

/* 템플릿 룩(ADR-0028). 라벨이 입력을 감싸므로 라벨 글자만 굵게 한다. */
const FIELD_CLASS = 'flex min-w-0 flex-col gap-2 text-sm';
const DETAILS_CLASS = 'min-w-0 rounded-lg border';
const SUMMARY_CLASS = 'cursor-pointer rounded-lg px-3 py-2.5 text-sm font-medium outline-none select-none marker:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50';
/*
 * 1027T-023: 이 패널은 상품 편집기의 판매 정보 카드(기본 폼 <form> 안)에 놓인다. 중첩 form을 만들지 않으려고 입력 묶음은 form 대신
 * div이고, 모든 입력·버튼은 소속 폼을 떼어(GOOD_DETACHED_FORM_ID) 기본 폼의 FormData·브라우저 검증·Enter 제출에 섞이지 않는다.
 * 저장은 버튼 클릭으로만 하고, 필수 칸은 reportDetachedValidity로 이 묶음만 검사한다. 기본 폼은 저장 시도마다 다시 마운트되므로
 * 입력 중인 예약 조건은 키 밖에 맡긴다(useGoodWorkspaceStash).
 */
const form = GOOD_DETACHED_FORM_ID;
type PreorderEditorDraft = { variantId: string; state: 'draft' | 'active'; capacityQty: string; startsAt: string; endsAt: string; expectedShipDate: string; approvalReference: string };

/**
 * 일반 재고 전환을 막는 미할당 예약 안내. 서버는 지금 선택된 예약 조건만이 아니라 옵션의 모든 예약 조건(이전 회차의 중지된 조건 포함)에
 * 남은 미할당 예약으로 전환을 거절하므로(pendingPreorderReservationsByVariant), 어느 옵션에 몇 개가 남았는지 함께 보인다.
 */
export function stockSupplyBlockedText(pending: readonly (readonly [name: string, qty: number])[]): string {
  return `미할당 예약 주문을 먼저 실제 재고로 할당하거나 취소해야 일반 재고 판매로 전환할 수 있습니다. 이전 예약 조건에 남은 예약도 포함합니다. 남은 미할당 예약: ${
    pending.map(([name, qty]) => `${name} ${qty.toLocaleString('ko-KR')}개`).join(' · ')}`;
}

function PreorderEditor({ goodId, variants, policy, canActivate, onSaved, onActivated }: {
  goodId: string; variants: AdminGoodsVariant[]; policy?: AdminGoodsPreorder; canActivate: boolean; onSaved: (message: string) => void;
  /** QNA-040: 새 발송 예정일로 활성화하면 이미 받은 예약 주문도 그 날짜로 바꿀지 묻는다. */
  onActivated?: (expectedShipDate: string, variantId: string) => void;
}) {
  const [draft, setDraft, forget] = useGoodWorkspaceStash<PreorderEditorDraft>(`preorder:${goodId}:${policy?.id ?? 'new'}:${policy?.revision ?? 0}`, () => ({
    variantId: policy?.variantId ?? variants.find((variant) => !variant.archivedAt)?.id ?? '', state: 'draft', capacityQty: String(policy?.capacityQty ?? ''),
    startsAt: toKstDateTimeInput(policy?.startsAt ?? null), endsAt: toKstDateTimeInput(policy?.endsAt ?? null),
    expectedShipDate: policy?.expectedShipDate ?? '', approvalReference: policy?.approvalReference ?? '',
  }));
  const { variantId, state, capacityQty, startsAt, endsAt, expectedShipDate, approvalReference } = draft;
  const change = (changes: Partial<PreorderEditorDraft>) => setDraft((current) => ({ ...current, ...changes }));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const group = useRef<HTMLDivElement>(null);
  const id = useId();
  function save() {
    setError(null);
    if (!variantId || !reportDetachedValidity(group.current)) return;
    const data = new FormData();
    data.set('goodId', goodId); data.set('variantId', variantId); data.set('policyId', policy?.id ?? ''); data.set('revision', String(policy?.revision ?? ''));
    data.set('policy', JSON.stringify({ state, capacityQty, startsAt, endsAt, expectedShipDate, approvalReference }));
    startTransition(async () => {
      const result = await saveGoodsPreorderAction(data);
      if (result.ok) { forget(); onSaved(result.message); if (state === 'active' && expectedShipDate) onActivated?.(expectedShipDate, variantId); } else setError(result.error);
    });
  }
  return <div className="flex min-w-0 flex-col gap-4" data-preorder-editor="" ref={group} role="group" aria-label={policy ? '예약 초안' : '새 예약 조건'}>
    <div className={FIELD_CLASS}>
      <Label htmlFor={`${id}-variant`}>예약 대상 옵션</Label>
      <NativeSelect className="w-full" form={form} id={`${id}-variant`} value={variantId} onChange={(event) => change({ variantId: event.target.value })} disabled={pending || Boolean(policy)} required>
        <option value="" disabled>옵션을 선택해주세요</option>
        {variants.map((variant) => <option key={variant.id} value={variant.id}>{variant.name} · {variant.code}{variant.archivedAt ? ' (사용 중지)' : ''}</option>)}
      </NativeSelect>
    </div>
    <div className="grid min-w-0 gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,10.5rem),1fr))]">
      <label className={FIELD_CLASS}><span className="font-medium">승인 예약 물량</span>
        <input className={GOOD_NUMBER_INPUT_CLASS} data-slot="input" form={form} type="number" min={1} max={2147483647} step={1} value={capacityQty} onChange={(event) => change({ capacityQty: event.target.value })}
          placeholder="미설정" required={state === 'active'} disabled={pending} />
      </label>
      <label className={FIELD_CLASS}><span className="font-medium">접수 시작 (KST)</span>
        <input className={GOOD_INPUT_CLASS} data-slot="input" form={form} type="datetime-local" value={startsAt} onChange={(event) => change({ startsAt: event.target.value })} required={state === 'active'} disabled={pending} />
      </label>
      <label className={FIELD_CLASS}><span className="font-medium">접수 종료 (KST)</span>
        <input className={GOOD_INPUT_CLASS} data-slot="input" form={form} type="datetime-local" value={endsAt} onChange={(event) => change({ endsAt: event.target.value })} required={state === 'active'} disabled={pending} />
      </label>
      <label className={FIELD_CLASS}><span className="font-medium">발송 예정일</span>
        <input className={GOOD_INPUT_CLASS} data-slot="input" form={form} type="date" value={expectedShipDate} min={endsAt.slice(0, 10) || undefined} onChange={(event) => change({ expectedShipDate: event.target.value })}
          required={state === 'active'} disabled={pending} />
      </label>
    </div>
    <label className={FIELD_CLASS}><span className="font-medium">승인 문서·확인 근거</span>
      <textarea className={GOOD_TEXTAREA_CLASS} data-slot="textarea" form={form} value={approvalReference} maxLength={2000} rows={3} onChange={(event) => change({ approvalReference: event.target.value })}
        placeholder="승인된 공급 물량과 일정을 확인할 수 있는 문서 번호 또는 자료 위치" required={state === 'active'} disabled={pending} />
    </label>
    <div className={FIELD_CLASS}>
      <Label htmlFor={`${id}-state`}>저장 방식</Label>
      <NativeSelect className="w-full sm:w-fit" form={form} id={`${id}-state`} value={state} onChange={(event) => change({ state: event.target.value as 'draft' | 'active' })} disabled={pending}>
        <option value="draft">초안 저장</option>
        {canActivate && <option value="active">승인 조건으로 예약 활성화</option>}
      </NativeSelect>
    </div>
    <p className="text-sm text-muted-foreground">초안은 현재 판매 방식에 반영되지 않습니다. 활성화한 옵션은 승인 예약 물량으로 판매하며,
      접수 중지·종료 후에도 일반 재고 판매로 자동 전환하지 않습니다. 활성화한 물량과 원 일정은 변경할 수 없습니다.</p>
    {!canActivate && <p className="text-xs text-muted-foreground">예약 활성화는 관리자가 저장된 초안과 승인 근거를 확인한 뒤 진행합니다.</p>}
    {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    <button className={`${buttonVariants()} self-start`} data-slot="button" form={form} type="button" disabled={pending || !variantId} onClick={save}>{pending ? '저장 중…' : state === 'active' ? '예약 활성화' : '예약 초안 저장'}</button>
  </div>;
}

/**
 * 랜덤 판매 상품의 예약 등록. 모든 판매 중 옵션이 같은 접수 기간·발송 예정일·승인 근거를 쓰고 승인 예약 물량만 옵션별로 정한다
 * (옵션마다 일정이 다르면 고객의 발송 예정일로 배정 옵션이 드러난다). 옵션마다 가장 최근 초안을 이어 쓴다.
 */
function RandomPreorderEditor({ goodId, variants, policies, canActivate, onSaved, onActivated }: {
  goodId: string; variants: AdminGoodsVariant[]; policies: AdminGoodsPreorder[]; canActivate: boolean; onSaved: (message: string) => void;
  onActivated?: (expectedShipDate: string) => void;
}) {
  /* 목록은 만든 시각 내림차순이라 옵션마다 처음 만나는 초안이 가장 최근이다. */
  const drafts = new Map<string, AdminGoodsPreorder>();
  for (const policy of policies) if (policy.state === 'draft' && !drafts.has(policy.variantId)) drafts.set(policy.variantId, policy);
  const sample = variants.map((variant) => drafts.get(variant.id)).find(Boolean);
  /* 다른 운영자가 초안을 바꾸면 초안 판(revision)이 달라져 서버 값에서 다시 시작한다. */
  const draftVersion = [...drafts.values()].map((draft) => `${draft.id}@${draft.revision}`).join(',');
  const [values, setValues, forget] = useGoodWorkspaceStash(`random-preorder:${goodId}:${draftVersion}`, () => ({
    state: 'draft' as 'draft' | 'active',
    capacities: Object.fromEntries(variants.map((variant) => [variant.id, String(drafts.get(variant.id)?.capacityQty ?? '')])) as Record<string, string>,
    startsAt: toKstDateTimeInput(sample?.startsAt ?? null), endsAt: toKstDateTimeInput(sample?.endsAt ?? null),
    expectedShipDate: sample?.expectedShipDate ?? '', approvalReference: sample?.approvalReference ?? '',
  }));
  const { state, capacities, startsAt, endsAt, expectedShipDate, approvalReference } = values;
  const change = (changes: Partial<typeof values>) => setValues((current) => ({ ...current, ...changes }));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const group = useRef<HTMLDivElement>(null);
  const id = useId();
  const total = variants.reduce((sum, variant) => sum + (Number(capacities[variant.id]) || 0), 0);
  function save() {
    setError(null);
    if (!reportDetachedValidity(group.current)) return;
    const options = variants.map((variant) => {
      const draft = drafts.get(variant.id);
      return { variantId: variant.id, policyId: draft?.id ?? null, expectedRevision: draft?.revision ?? null, capacityQty: capacities[variant.id] ?? '' };
    });
    startTransition(async () => {
      const result = await saveRandomGoodsPreordersAction(goodId, state, { startsAt, endsAt, expectedShipDate, approvalReference }, options);
      if (result.ok) { forget(); onSaved(result.message); if (state === 'active' && expectedShipDate) onActivated?.(expectedShipDate); } else setError(result.error);
    });
  }
  return <div className="flex min-w-0 flex-col gap-4" data-random-preorder-editor="" ref={group} role="group" aria-label="랜덤 판매 예약">
    <div className="grid min-w-0 gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,10.5rem),1fr))]">
      <label className={FIELD_CLASS}><span className="font-medium">접수 시작 (KST)</span>
        <input className={GOOD_INPUT_CLASS} data-slot="input" form={form} type="datetime-local" value={startsAt} onChange={(event) => change({ startsAt: event.target.value })} required={state === 'active'} disabled={pending} />
      </label>
      <label className={FIELD_CLASS}><span className="font-medium">접수 종료 (KST)</span>
        <input className={GOOD_INPUT_CLASS} data-slot="input" form={form} type="datetime-local" value={endsAt} onChange={(event) => change({ endsAt: event.target.value })} required={state === 'active'} disabled={pending} />
      </label>
      <label className={FIELD_CLASS}><span className="font-medium">발송 예정일</span>
        <input className={GOOD_INPUT_CLASS} data-slot="input" form={form} type="date" value={expectedShipDate} min={endsAt.slice(0, 10) || undefined} onChange={(event) => change({ expectedShipDate: event.target.value })}
          required={state === 'active'} disabled={pending} />
      </label>
    </div>
    <div className="flex min-w-0 flex-col gap-2">
      <span className="font-medium">옵션별 승인 예약 물량</span>
      <div className="min-w-0 overflow-x-auto rounded-lg border" role="region" aria-label="옵션별 승인 예약 물량 표" tabIndex={0}>
        <table className="w-full min-w-[22rem] text-sm">
          <thead className="bg-muted/50"><tr><th scope="col" className="px-3 py-2 text-left font-medium">옵션</th><th scope="col" className="px-3 py-2 text-left font-medium">승인 예약 물량</th></tr></thead>
          <tbody className="divide-y">{variants.map((variant) => <tr key={variant.id} data-variant-id={variant.id}>
            <td className="px-3 py-2 wrap-anywhere">{variant.name} · {variant.code}</td>
            <td className="px-3 py-2"><input className={`${GOOD_NUMBER_INPUT_CLASS} max-w-40`} data-slot="input" form={form} type="number" min={1} max={2147483647} step={1} inputMode="numeric"
              aria-label={`${variant.name} 승인 예약 물량`} placeholder="미설정" value={capacities[variant.id] ?? ''} required={state === 'active'} disabled={pending}
              onChange={(event) => change({ capacities: { ...capacities, [variant.id]: event.target.value } })} /></td>
          </tr>)}</tbody>
        </table>
      </div>
      <small className="text-xs text-muted-foreground tabular-nums">합계 {total.toLocaleString('ko-KR')}개 · 주문할 때 옵션별 남은 예약 물량에 비례해 무작위로 정해집니다.</small>
    </div>
    <label className={FIELD_CLASS}><span className="font-medium">승인 문서·확인 근거</span>
      <textarea className={GOOD_TEXTAREA_CLASS} data-slot="textarea" form={form} value={approvalReference} maxLength={2000} rows={3} onChange={(event) => change({ approvalReference: event.target.value })}
        placeholder="승인된 공급 물량과 일정을 확인할 수 있는 문서 번호 또는 자료 위치" required={state === 'active'} disabled={pending} />
    </label>
    <div className={FIELD_CLASS}>
      <Label htmlFor={`${id}-state`}>저장 방식</Label>
      <NativeSelect className="w-full sm:w-fit" form={form} id={`${id}-state`} value={state} onChange={(event) => change({ state: event.target.value as 'draft' | 'active' })} disabled={pending}>
        <option value="draft">초안 저장</option>
        {canActivate && <option value="active">승인 조건으로 모든 옵션 예약 활성화</option>}
      </NativeSelect>
    </div>
    <p className="text-sm text-muted-foreground">모든 판매 중 옵션에 같은 접수 기간·발송 예정일·승인 근거가 들어갑니다. 초안은 판매에 반영되지 않고,
      활성화한 물량과 일정은 바꿀 수 없습니다. 접수 중지·종료 후에도 일반 재고 판매로 자동 전환하지 않습니다.</p>
    {!canActivate && <p className="text-xs text-muted-foreground">예약 활성화는 관리자가 저장된 초안과 승인 근거를 확인한 뒤 진행합니다.</p>}
    {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    <button className={`${buttonVariants()} self-start`} data-slot="button" form={form} type="button" disabled={pending || !variants.length} onClick={save}>{pending ? '저장 중…' : state === 'active' ? '모든 옵션 예약 활성화' : '모든 옵션 예약 초안 저장'}</button>
  </div>;
}

/** 랜덤 판매 상품: 모든 옵션의 접수 중지·일반 재고 전환을 한 번에 한다. 옵션 하나만 일반 재고로 바꾸면 커밋에서 거절된다. */
export function RandomPreorderBulkActions({ goodId, variants, policies, canActivate, onSaved }: {
  goodId: string; variants: AdminGoodsVariant[]; policies: AdminGoodsPreorder[]; canActivate: boolean; onSaved: (message: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const activeIds = new Set(variants.map((variant) => variant.id));
  const selected = policies.filter((policy) => policy.selected && activeIds.has(policy.variantId));
  const open = selected.filter((policy) => policy.state === 'active');
  /* 선택된 정책의 미할당 수량만 보면 2회차부터 이전 회차 예약이 남은 채 버튼이 켜지고 서버가 거절한다. 옵션의 모든 정책을 합한다. */
  const pendingByVariant = pendingPreorderReservationsByVariant(policies);
  const blocking = selected.flatMap((policy) => {
    const qty = pendingByVariant.get(policy.variantId) ?? 0;
    return qty > 0 ? [[variants.find((variant) => variant.id === policy.variantId)?.name ?? '이전 옵션', qty] as const] : [];
  });
  function run(state: 'stopped' | 'stock', targets: AdminGoodsPreorder[]) {
    setError(null);
    startTransition(async () => {
      const result = await saveRandomGoodsPreordersAction(goodId, state, null,
        targets.map((policy) => ({ variantId: policy.variantId, policyId: policy.id, expectedRevision: policy.revision })));
      if (result.ok) onSaved(result.message); else setError(result.error);
    });
  }
  if (!selected.length) return null;
  return <div className="flex min-w-0 flex-col gap-2 rounded-lg border p-3" data-random-preorder-actions="">
    <strong className="font-medium">모든 옵션 한 번에 처리</strong>
    <div className="flex flex-wrap gap-2">
      {open.length > 0 && <button className={buttonVariants({ variant: 'outline', size: 'sm' })} data-slot="button" form={form} type="button" disabled={pending} onClick={() => run('stopped', open)}>모든 옵션 새 예약 접수 중지</button>}
      {!open.length && canActivate && <button className={buttonVariants({ variant: 'outline', size: 'sm' })} data-slot="button" form={form} type="button" disabled={pending || blocking.length > 0} onClick={() => run('stock', selected)}>모든 옵션 일반 재고 판매로 전환</button>}
    </div>
    {!open.length && blocking.length > 0 && <small className="text-xs text-muted-foreground" data-stock-supply-blocked="">{stockSupplyBlockedText(blocking)}</small>}
    {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
  </div>;
}

export function PreorderReceipt({ policy, variant, pendingQty, canActivate, onSaved, randomSale = false }: {
  policy: AdminGoodsPreorder; variant?: AdminGoodsVariant; canActivate: boolean; onSaved: (message: string) => void; randomSale?: boolean;
  /** 이 옵션의 모든 예약 조건(이전 회차 포함)에 남은 미할당 예약 합계. 일반 재고 전환은 이 값이 0일 때만 서버가 받는다. */
  pendingQty: number;
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
    <span className="text-muted-foreground tabular-nums">{at(policy.startsAt)} ~ {at(policy.endsAt)} (KST)</span>
    <span className="text-muted-foreground">{goodsShipDateLabel(policy.expectedShipDate)}</span>
    <p className="text-xs whitespace-pre-wrap text-muted-foreground wrap-anywhere">승인 근거: {policy.approvalReference}</p>
    <div className="mt-1.5 flex flex-wrap gap-2 empty:hidden">
      {policy.state === 'active' && <button className={buttonVariants({ variant: 'outline', size: 'sm' })} data-slot="button" form={form} type="button" disabled={pending} onClick={stop}>새 예약 접수 중지</button>}
      {policy.state === 'stopped' && policy.selected && canActivate && !randomSale && <button className={buttonVariants({ variant: 'outline', size: 'sm' })} data-slot="button" form={form} type="button" disabled={pending || pendingQty > 0} onClick={regular}>일반 재고 판매로 전환</button>}
    </div>
    {policy.state === 'stopped' && policy.selected && pendingQty > 0 && !randomSale && <small className="text-xs text-muted-foreground" data-stock-supply-blocked="">{stockSupplyBlockedText([[variant?.name ?? '이전 옵션', pendingQty]])}</small>}
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
  function allocate() {
    setError(null);
    const selection = preparePreorderAllocation(page.items, selected);
    if (!selection) { setError('선택한 예약 주문과 현재 재고를 다시 확인해주세요.'); return; }
    startTransition(async () => {
      const result = await allocateGoodsPreordersAction(goodId, selection, receipt);
      if (result.ok) onSaved(result.message); else setError(result.error);
    });
  }
  const status = { reserved: '미할당', allocated: '할당 완료', released: '입고 전 취소', returned: '입고 후 환불' };
  return <div className="flex min-w-0 flex-col gap-3" data-preorder-allocation="" role="group" aria-label="예약 주문 선택">
    {page.items.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">해당 상태의 예약 주문이 없습니다.</p> : <ul className="m-0 flex list-none flex-col divide-y rounded-lg border p-0">
      {page.items.map((item) => <li key={item.orderItemId} className="flex min-w-0 flex-col gap-1 px-3 py-3">
        <label className="flex items-start gap-2 text-sm">
          {canAllocate && item.state === 'reserved' && <input className="mt-0.5" form={form} type="checkbox" checked={selected.includes(item.orderItemId)}
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
        <textarea className={GOOD_TEXTAREA_CLASS} data-slot="textarea" form={form} rows={2} maxLength={2000} value={receipt} onChange={(event) => setReceipt(event.target.value)} disabled={pending} required
          placeholder="입고 내역을 확인할 수 있는 문서 번호 또는 자료 위치" />
      </label>
      <button className={`${buttonVariants()} self-start`} data-slot="button" form={form} type="button" disabled={pending || !selected.length || shortage || !receipt.trim()} onClick={allocate}>{pending ? '할당 중…' : '선택한 예약 품목에 실제 재고 할당'}</button>
    </>}
    {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
  </div>;
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
      if (canceled) return;
      /* 새로고침 사이 건수가 줄어 보던 페이지가 범위를 벗어나면 마지막 페이지를 다시 읽는다(공용 페이지 이동은 번호를 안쪽으로 보정해 보여 준다). */
      const last = result.ok ? Math.max(1, Math.ceil(result.reservations.total / ADMIN_PREORDER_RESERVATION_PAGE_SIZE)) : 1;
      if (result.ok && pageNumber > last) { setPageNumber(last); return; }
      setLoaded(result.ok ? { key, reservations: result.reservations } : { key, error: result.error });
    }).catch(() => { if (!canceled) setLoaded({ key, error: '예약 주문을 불러오지 못했습니다.' }); });
    return () => { canceled = true; };
  }, [goodId, key, pageNumber, state]);
  const visible = loaded?.key === key ? loaded : null;
  return <div className="flex min-w-0 flex-col gap-3 border-t pt-4" data-preorder-reservations="">
    <h3 className="text-sm font-medium">{canAllocate ? '예약 주문·입고 할당' : '예약 주문'}</h3>
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex min-w-0 flex-col gap-2"><Label htmlFor={stateId}>예약 상태</Label><NativeSelect className="w-full sm:w-40" form={form} id={stateId} value={state} onChange={(event) => { setState(event.target.value); setPageNumber(1); }}>
        <option value="reserved">미할당 예약</option><option value="allocated">실물 할당 완료</option><option value="released">입고 전 취소</option><option value="returned">입고 후 환불</option>
      </NativeSelect></div>
      <button className={buttonVariants({ variant: 'outline' })} data-slot="button" form={form} type="button" onClick={() => setRefresh((value) => value + 1)}>예약 주문 새로고침</button>
    </div>
    {!visible ? <p className="text-sm text-muted-foreground" role="status">예약 주문을 불러오는 중입니다…</p> : visible.error ? <p className="text-sm text-destructive" role="alert">{visible.error}</p> : visible.reservations ? <>
      <small className="text-xs text-muted-foreground tabular-nums">총 {visible.reservations.total.toLocaleString('ko-KR')}품목 · {pageNumber}페이지</small>
      <ReservationSelection key={key} canAllocate={canAllocate} goodId={goodId} page={visible.reservations} onSaved={(message) => { setPageNumber(1); onSaved(message); }} />
      <ConsolePagination label="예약 주문 페이지" page={pageNumber} pageSize={ADMIN_PREORDER_RESERVATION_PAGE_SIZE} total={visible.reservations.total} unit="품목" onPageChange={setPageNumber} />
    </> : null}
  </div>;
}

/**
 * 저장된 상품의 예약판매 패널(별도 저장). 1027T-023부터 판매 정보 카드의 판매기간 바로 뒤(GoodSavedPreorderSection)에 놓여 제목은 그 소항목이 갖는다.
 * 기본 폼 안에 있어도 입력은 기본 폼에 섞이지 않는다(위 GOOD_DETACHED_FORM_ID 설명).
 */
export function GoodsPreordersPanel({ goodId, variants, canActivate = false, canReadOrders = true, canAllocate = true, randomSale = false }: {
  goodId: string; variants: AdminGoodsVariant[]; canActivate?: boolean; canReadOrders?: boolean; canAllocate?: boolean;
  /** 랜덤 판매 상품이면 옵션별 등록 대신 모든 옵션을 한 번에 예약한다(같은 일정, 옵션별 승인 물량). */
  randomSale?: boolean;
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
  const activeVariants = selectedVariants.filter((variant) => !variant.archivedAt);
  const randomOpen = Boolean(visible?.policies?.some((policy) => policy.state === 'active' && activeVariants.some((variant) => variant.id === policy.variantId)));
  const pendingByVariant = pendingPreorderReservationsByVariant(visible?.policies ?? []);
  const reload = () => setRefresh((value) => value + 1);
  const saved = (message: string) => { setNotice({ goodId, message }); reload(); };
  /* 예약 조건을 새 날짜로 활성화한 직후 '기존 예약 주문도 이 날짜로' 미리보기 입구(QNA-040). 주문 관리 권한이 있을 때만 보인다. */
  const [scheduleSuggestion, setScheduleSuggestion] = useState<PreorderScheduleSuggestion | null>(null);
  const activated = (expectedShipDate: string, variantId: string | null) => setScheduleSuggestion({ expectedShipDate, variantId: randomSale ? null : variantId, key: Date.now() });
  return <div className={`${GOOD_SUBPANEL_CLASS} text-sm`} data-preorders-panel="">
    <div className="flex flex-col gap-1">
      <p className="text-sm text-muted-foreground">승인된 미래 공급 물량을 실제 옵션 재고와 구별하여 관리합니다. 물량·접수 기간·발송 예정일·승인 근거가 모두 있어야 활성화할 수 있습니다.
        같은 출고지에서 주문한 일반 상품과 예약 상품은 가장 늦은 예정일에 함께 발송하도록 안내합니다.</p>
      {randomSale && <p className="text-sm text-muted-foreground" data-random-preorder-note="">랜덤 판매 상품은 모든 판매 중 옵션을 같은 접수 기간·발송 예정일로 한 번에 예약합니다.
        승인 예약 물량만 옵션별로 정하고, 주문할 때 남은 예약 물량에 비례해 옵션이 정해집니다. 고객에게는 공통 일정과 남은 물량 합계만 보입니다.</p>}
    </div>
    {notice?.goodId === goodId && <p className={`${GOOD_NOTE_CLASS} font-medium text-[var(--wc-success)]`} role="status">{notice.message}</p>}
    {!visible ? <p className="text-sm text-muted-foreground" role="status">예약 조건을 불러오는 중입니다…</p> : visible.error ? <p className="text-sm text-destructive" role="alert">{visible.error}</p> : <>
      {!visible.policies?.length && <p className="text-sm text-muted-foreground">등록된 예약 조건이 없습니다.</p>}
      {randomSale && <RandomPreorderBulkActions goodId={goodId} variants={activeVariants} policies={visible.policies ?? []} canActivate={canActivate} onSaved={saved} />}
      {visible.policies?.map((policy) => randomSale && policy.state === 'draft' ? null : <div key={`${policy.id}:${policy.revision}`} className="min-w-0">
        {policy.state === 'draft' ? <GoodWorkspaceDetails stateId={`good-preorder-draft-${policy.id}`} className={DETAILS_CLASS}><summary className={SUMMARY_CLASS}>예약 초안 · {selectedVariants.find((variant) => variant.id === policy.variantId)?.name ?? '이전 옵션'}</summary>
          <div className="border-t p-3"><PreorderEditor goodId={goodId} variants={selectedVariants} policy={policy} canActivate={canActivate} onSaved={saved} onActivated={activated} /></div>
        </GoodWorkspaceDetails> : <div className="rounded-lg border p-3"><PreorderReceipt policy={policy} variant={selectedVariants.find((variant) => variant.id === policy.variantId)}
          pendingQty={pendingByVariant.get(policy.variantId) ?? 0} canActivate={canActivate} onSaved={saved} randomSale={randomSale} /></div>}
      </div>)}
      {randomSale
        ? randomOpen ? <p className="text-sm text-muted-foreground">접수 중인 예약이 있습니다. 새 예약은 모든 옵션의 접수를 중지한 뒤 등록할 수 있습니다.</p>
          : <GoodWorkspaceDetails stateId={`good-preorder-random-${goodId}`} className={DETAILS_CLASS} defaultOpen={!visible.policies?.length}><summary className={SUMMARY_CLASS}>랜덤 판매 예약 (모든 옵션)</summary><div className="border-t p-3"><RandomPreorderEditor key={key} goodId={goodId} variants={activeVariants} policies={visible.policies ?? []} canActivate={canActivate} onSaved={saved} onActivated={(date) => activated(date, null)} /></div></GoodWorkspaceDetails>
        : <GoodWorkspaceDetails stateId={`good-preorder-new-${goodId}`} className={DETAILS_CLASS}><summary className={SUMMARY_CLASS}>새 예약 조건</summary><div className="border-t p-3"><PreorderEditor key={key} goodId={goodId} variants={selectedVariants} canActivate={canActivate} onSaved={saved} onActivated={activated} /></div></GoodWorkspaceDetails>}
      {/* QNA-040: 예약 주문의 발송 예정일 일괄 변경·고객 안내. 주문 약속일을 바꾸므로 입고 할당과 같은 주문 관리 권한일 때만. */}
      {canReadOrders && canAllocate ? <GoodsPreorderSchedulePanel goodId={goodId} variants={selectedVariants} randomSale={randomSale} suggestion={scheduleSuggestion} /> : null}
      {canReadOrders ? <PreorderReservations goodId={goodId} revision={refresh} onSaved={saved} canAllocate={canAllocate} /> : null}
    </>}
    <button className={`${buttonVariants({ variant: 'outline' })} self-start`} data-slot="button" form={form} type="button" onClick={reload}>저장된 예약 조건 새로고침</button>
  </div>;
}
