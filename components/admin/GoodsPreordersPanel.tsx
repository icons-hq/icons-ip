'use client';

import { useEffect, useId, useRef, useState, useTransition } from 'react';
import {
  allocateGoodsPreordersAction, listGoodsPreorderReservationsAction, listGoodsPreordersAction, saveGoodsPreorderAction, saveGoodsPreordersBulkAction,
  saveRandomGoodsPreordersAction, switchToStockSupplyAction,
} from '@/app/admin/goods-preorder-actions';
import {
  ADMIN_PREORDER_RESERVATION_PAGE_SIZE, emptyPreorderPlan, expandPreorderPlan, firstPreorderPlanProblemField, pendingPreorderReservationsByVariant,
  preorderBulkSavedMessage, preorderEditorTargets, preorderOptionNames, preorderPlanProblemMessage, preorderPlanProblems, preparePreorderAllocation,
  type AdminGoodsPreorder, type AdminPreorderReservationPage, type PreorderPlan, type PreorderPlanTarget,
} from '@/lib/admin/goods-preorders';
import { adminConfirm } from '@/lib/admin/confirm';
import { ConsolePagination } from '@/components/admin/console/ConsolePagination';
import type { AdminGoodsVariant } from '@/lib/admin/goods-variants';
import { goodsShipDateLabel } from '@/lib/goods-preorders';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { Label } from '@/components/admin/kit/ui/label';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { GOOD_NOTE_CLASS, GOOD_SUBPANEL_CLASS, GOOD_TEXTAREA_CLASS } from './GoodEditorParts';
import { useGoodSaleTiming } from './GoodSaleTimingContext';
import { GOOD_DETACHED_FORM_ID, GoodWorkspaceDetails, useGoodWorkspaceStash } from './GoodWorkspace';
import { GoodsPreorderSchedulePanel, type PreorderScheduleSuggestion } from './GoodsPreorderSchedulePanel';
import { PreorderPlanFields, RANDOM_PREORDER_CAPACITY_NOTE } from './PreorderPlanFields';

/* 템플릿 룩(ADR-0028). 라벨이 입력을 감싸므로 라벨 글자만 굵게 한다. */
const FIELD_CLASS = 'flex min-w-0 flex-col gap-2 text-sm';
const DETAILS_CLASS = 'min-w-0 rounded-lg border';
const SUMMARY_CLASS = 'cursor-pointer rounded-lg px-3 py-2.5 text-sm font-medium outline-none select-none marker:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50';
/*
 * 1027T-023: 이 패널은 상품 편집기의 판매 정보 카드(기본 폼 <form> 안)에 놓인다. 중첩 form을 만들지 않으려고 입력 묶음은 form 대신
 * div이고, 모든 입력·버튼은 소속 폼을 떼어(GOOD_DETACHED_FORM_ID) 기본 폼의 FormData·브라우저 검증·Enter 제출에 섞이지 않는다.
 * 저장은 버튼 클릭으로만 한다. 기본 폼은 저장 시도마다 다시 마운트되므로 입력 중인 예약 조건은 키 밖에 맡긴다(useGoodWorkspaceStash).
 */
const form = GOOD_DETACHED_FORM_ID;
const planTargets = (variants: readonly AdminGoodsVariant[]): PreorderPlanTarget[] => variants.map((variant) => ({ key: variant.id, name: variant.name, stockQty: variant.stockQty }));
/** 저장한 예약 조건은 고칠 수 없다는 것은 화면에 보이지 않는 결과라 저장 버튼 위에 한 줄로 남긴다. */
const SAVE_APPLIES_NOTE = '저장하면 바로 적용됩니다. 저장한 뒤에는 예약 물량과 일정을 고칠 수 없고, 바꾸려면 접수를 중지하고 새로 저장합니다.';
/** 이미 예약판매 중인 옵션을 중지하고 새로 저장할 때 더 팔지 않게 하는 주의. 새 예약 조건은 이전에 받은 수량을 모른다. */
const RESTART_CAPACITY_NOTE = '접수를 중지하고 새로 저장하면 예약 물량을 처음부터 다시 셉니다. 이미 받은 수량을 뺀 물량을 넣어주세요.';

/*
 * 2026-11-19 사용자·MD 결정(런북 goods-preorders.md '등록과 공개'): 예약판매는 저장하면 바로 적용된다. 임시저장(초안)·승인 근거·
 * 적용 권한 구분·적용 확인창은 없다. 필요한 칸이 비거나 DB가 거절할 값이면 저장할 때 그 칸 옆에 이유를 보이고 저장하지 않는다.
 */

/**
 * 접수 중(또는 접수 예정)인 예약을 일반 재고로 바꾸는 확인. 접수를 중지하고(되돌릴 수 없다) 재고수량을 바로 판매하므로,
 * 아직 입고되지 않은 재고가 발송 상품으로 팔리지 않게 판매될 수량을 보여 주고 한 번 묻는다(AGENTS.md: 되돌릴 수 없는 작업은 adminConfirm).
 * 이미 접수를 중지한 조건의 전환은 묻지 않는다.
 */
export function stockSwitchConfirmMessage(stock: readonly (readonly [name: string, qty: number])[]): string {
  return `예약 접수를 중지하고 지금 재고수량(${stock.map(([name, qty]) => `${name} ${qty.toLocaleString('ko-KR')}개`).join(' · ')})을 바로 일반 판매합니다. 중지한 예약은 다시 열 수 없습니다. 아직 물건이 들어오지 않았다면 취소해주세요.`;
}

/**
 * 일반 재고 전환을 막는 미할당 예약 안내. 서버는 지금 선택된 예약 조건만이 아니라 옵션의 모든 예약 조건(이전 회차의 중지된 조건 포함)에
 * 남은 미할당 예약으로 전환을 거절하므로(pendingPreorderReservationsByVariant), 어느 옵션에 몇 개가 남았는지 함께 보인다.
 */
export function stockSupplyBlockedText(pending: readonly (readonly [name: string, qty: number])[]): string {
  return `입고 확인 전인 예약 주문이 남아 있어 일반 재고 판매로 전환할 수 없습니다. 아래 예약 주문 목록에서 입고 확인을 하거나 주문을 취소한 뒤 전환해주세요. 이전에 중지한 예약 조건에 남은 주문도 셉니다. 입고 확인 전 수량: ${
    pending.map(([name, qty]) => `${name} ${qty.toLocaleString('ko-KR')}개`).join(' · ')}`;
}

/**
 * 이전 회차의 예약 주문이 입고 확인 전으로 남은 옵션에 새 예약을 저장할 때의 주의. 새 예약 조건은 예약 물량을 처음부터 세고
 * 기본값이 재고수량이라, 재고수량에 이전 예약분이 들어 있으면 그만큼 더 팔린다. 막지는 않는다.
 */
export function previousRoundPendingText(pending: readonly (readonly [name: string, qty: number])[]): string {
  return `입고 확인 전인 예약 주문이 남은 옵션이 있습니다(${pending.map(([name, qty]) => `${name} ${qty.toLocaleString('ko-KR')}개`).join(' · ')}). 재고수량에 그 수량이 들어 있으면 그만큼 뺀 예약 물량을 넣어주세요.`;
}

/** 막힌 첫 칸으로 포커스를 옮긴다. 칸은 늘 그려져 있어 바로 찾을 수 있다. */
function focusField(group: HTMLElement | null, key: string | undefined) {
  if (key) group?.querySelector<HTMLElement>(`[data-preorder-field="${CSS.escape(key)}"]`)?.focus();
}

/**
 * 옵션 선택 판매 상품의 새 예약(규칙 6). 일정을 한 번 넣고 예약 물량만 옵션별로 정해 모든 옵션을 한 번에 저장한다
 * (`admin_save_goods_preorders_bulk` — 하나라도 거절되면 아무것도 저장하지 않는다). 예약하지 않을 옵션은 체크를 끄고,
 * 옵션마다 일정이 다를 때만 '옵션마다 일정을 다르게'를 켠다. 이미 예약판매 중인 옵션은 표에 넣지 않는다(`busy`) — 중지하고 새로 만들면
 * 남은 예약 물량이 처음부터 다시 계산되기 때문이다. 그사이 다른 창에서 예약을 건 옵션은 서버가 건너뛰고 알려 준다.
 * 저장 뒤에도 입력한 일정은 남아, 남은 옵션을 이어서 저장할 수 있다.
 */
export function PreorderEditor({ goodId, variants, table = variants.length > 1, busy = [], pending: pendingOrders = [], blockedReason = null, onSaved, onActivated }: {
  goodId: string;
  /** 새로 예약할 수 있는 옵션(사용 중이고 예약판매 중이 아닌 옵션). */
  variants: AdminGoodsVariant[];
  /** 옵션 표를 보인다(상품의 사용 중인 옵션이 둘 이상). 하나뿐이면 '예약 대상 옵션'을 고를 일이 없어 예약 물량 한 칸만 보인다. */
  table?: boolean;
  /** 이미 예약판매 중이라 표에서 뺀 옵션. */
  busy?: AdminGoodsVariant[];
  /** 이전 회차에 받아 아직 입고 확인하지 않은 예약 주문이 남은 옵션과 수량. 새 예약 물량에서 그만큼 빼야 더 팔지 않는다. */
  pending?: readonly (readonly [name: string, qty: number])[];
  /** 지금은 저장할 수 없는 이유(저장된 판매기간이 남아 있음). 있으면 저장 버튼을 막고 그 자리에 보인다. */
  blockedReason?: string | null;
  onSaved: (message: string) => void;
  /** QNA-040: 새 발송 예정일로 저장하면 이미 받은 예약 주문도 그 날짜로 바꿀지 묻는다. 옵션 하나만 저장했으면 그 옵션으로 좁힌다. */
  onActivated?: (expectedShipDate: string, variantId: string | null) => void;
}) {
  const [plan, setPlan, forget] = useGoodWorkspaceStash<PreorderPlan>(`preorder-plan:${goodId}`, emptyPreorderPlan);
  const targets = planTargets(variants);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [pending, startTransition] = useTransition();
  const group = useRef<HTMLDivElement>(null);
  const id = useId();
  function save() {
    setError(null);
    const found = preorderPlanProblems(plan, targets);
    const problem = preorderPlanProblemMessage(found, { table });
    if (problem) {
      setChecked(true);
      setError(`${problem} 저장하지 않았습니다.`);
      focusField(group.current, firstPreorderPlanProblemField(found, targets, { table }));
      return;
    }
    const entries = expandPreorderPlan(plan, targets);
    startTransition(async () => {
      const result = await saveGoodsPreordersBulkAction(goodId, entries.map((entry) => ({ variantId: entry.key, capacityQty: entry.capacityQty.trim(),
        startsAt: entry.startsAt, endsAt: entry.endsAt, expectedShipDate: entry.expectedShipDate })));
      if (!result.ok) { setError(result.error); return; }
      /* 예약할 수 있는 옵션을 모두 저장했으면 입력을 비우고, 남은 옵션이 있으면 일정을 남겨 이어서 저장하게 한다. */
      if (entries.length >= targets.length) forget();
      setChecked(false);
      onSaved(preorderBulkSavedMessage(result.savedVariantIds.length, preorderOptionNames(result.skippedVariantIds.map((skipped) => variants.find((variant) => variant.id === skipped)?.name ?? '다른'))));
      const dates = new Set(entries.filter((entry) => result.savedVariantIds.includes(entry.key)).map((entry) => entry.expectedShipDate));
      if (dates.size === 1) onActivated?.([...dates][0], table && result.savedVariantIds.length === 1 ? result.savedVariantIds[0] : null);
    });
  }
  return <div className="flex min-w-0 flex-col gap-4" data-preorder-editor="" ref={group} role="group" aria-label="새 예약 조건">
    <PreorderPlanFields plan={plan} onChange={setPlan} targets={targets} table={table} disabled={pending} idPrefix={id} problems={checked ? preorderPlanProblems(plan, targets) : null}
      excludedNote={busy.length ? `${preorderOptionNames(busy.map((variant) => variant.name))} 옵션은 이미 예약판매 중이라 표에서 뺐습니다. ${RESTART_CAPACITY_NOTE}` : undefined} />
    {pendingOrders.length ? <p className="text-xs font-medium text-warning" data-preorder-pending-note="">{previousRoundPendingText(pendingOrders)}</p> : null}
    <p className="text-xs text-muted-foreground">{SAVE_APPLIES_NOTE}</p>
    {blockedReason ? <p className="text-sm text-warning" data-preorder-save-blocked="">{blockedReason}</p> : null}
    {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    <button className={`${buttonVariants()} self-start`} data-slot="button" data-preorder-save="" form={form} type="button" disabled={pending || !targets.length || Boolean(blockedReason)} onClick={save}>{pending ? '저장 중…' : '예약판매 저장'}</button>
  </div>;
}

/**
 * 랜덤 판매 상품의 예약 등록. 모든 판매 중 옵션이 같은 접수 기간·발송 예정일을 쓰고 예약 물량만 옵션별로 정한다
 * (옵션마다 일정이 다르면 고객의 발송 예정일로 배정 옵션이 드러난다). 그래서 옵션을 빼거나 일정을 다르게 넣는 칸이 없다.
 */
export function RandomPreorderEditor({ goodId, variants, pending: pendingOrders = [], blockedReason = null, onSaved, onActivated }: {
  goodId: string; variants: AdminGoodsVariant[]; blockedReason?: string | null; onSaved: (message: string) => void;
  onActivated?: (expectedShipDate: string) => void;
  /** 이전 회차에 받아 아직 입고 확인하지 않은 예약 주문이 남은 옵션과 수량(PreorderEditor와 같다). */
  pending?: readonly (readonly [name: string, qty: number])[];
}) {
  const [plan, setPlan, forget] = useGoodWorkspaceStash<PreorderPlan>(`random-preorder-plan:${goodId}`, emptyPreorderPlan);
  const targets = planTargets(variants);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [pending, startTransition] = useTransition();
  const group = useRef<HTMLDivElement>(null);
  const id = useId();
  function save() {
    setError(null);
    const found = preorderPlanProblems(plan, targets, { all: true });
    const problem = preorderPlanProblemMessage(found);
    if (problem) {
      setChecked(true);
      setError(`${problem} 저장하지 않았습니다.`);
      focusField(group.current, firstPreorderPlanProblemField(found, targets));
      return;
    }
    const { startsAt, endsAt, expectedShipDate } = plan;
    const options = expandPreorderPlan(plan, targets, { all: true }).map((entry) => ({ variantId: entry.key, policyId: null, expectedRevision: null, capacityQty: entry.capacityQty.trim() }));
    startTransition(async () => {
      const result = await saveRandomGoodsPreordersAction(goodId, 'active', { startsAt, endsAt, expectedShipDate }, options);
      if (result.ok) { forget(); onSaved(result.message); if (expectedShipDate) onActivated?.(expectedShipDate); } else setError(result.error);
    });
  }
  return <div className="flex min-w-0 flex-col gap-4" data-random-preorder-editor="" ref={group} role="group" aria-label="랜덤 판매 예약">
    <PreorderPlanFields all table plan={plan} onChange={setPlan} targets={targets} disabled={pending} idPrefix={id} problems={checked ? preorderPlanProblems(plan, targets, { all: true }) : null}
      capacityNote={RANDOM_PREORDER_CAPACITY_NOTE} />
    {pendingOrders.length ? <p className="text-xs font-medium text-warning" data-preorder-pending-note="">{previousRoundPendingText(pendingOrders)}</p> : null}
    <p className="text-xs text-muted-foreground">{SAVE_APPLIES_NOTE}</p>
    {blockedReason ? <p className="text-sm text-warning" data-preorder-save-blocked="">{blockedReason}</p> : null}
    {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    <button className={`${buttonVariants()} self-start`} data-slot="button" data-preorder-save="" form={form} type="button" disabled={pending || !variants.length || Boolean(blockedReason)} onClick={save}>{pending ? '저장 중…' : '모든 옵션 예약판매 저장'}</button>
  </div>;
}

/** 랜덤 판매 상품: 모든 옵션의 접수 중지·일반 재고 전환을 한 번에 한다. 옵션 하나만 일반 재고로 바꾸면 커밋에서 거절된다. */
export function RandomPreorderBulkActions({ goodId, variants, policies, onSaved }: {
  goodId: string; variants: AdminGoodsVariant[]; policies: AdminGoodsPreorder[];
  /** `switched`: 일반 재고 판매로 전환했다(예약 연결이 풀렸다). */
  onSaved: (message: string, switched?: boolean) => void;
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
  async function run(state: 'stopped' | 'stock', targets: AdminGoodsPreorder[]) {
    setError(null);
    if (state === 'stock' && open.length > 0 && !await adminConfirm({ title: '모든 옵션을 일반 재고 판매로 바꿀까요?', confirmLabel: '일반 재고 판매로 전환',
      message: stockSwitchConfirmMessage(variants.filter((variant) => targets.some((policy) => policy.variantId === variant.id)).map((variant) => [variant.name, variant.stockQty] as const)) })) return;
    startTransition(async () => {
      const result = await saveRandomGoodsPreordersAction(goodId, state, null,
        targets.map((policy) => ({ variantId: policy.variantId, policyId: policy.id, expectedRevision: policy.revision })));
      if (result.ok) onSaved(result.message, state === 'stock'); else setError(result.error);
    });
  }
  if (!selected.length) return null;
  return <div className="flex min-w-0 flex-col gap-2 rounded-lg border p-3" data-random-preorder-actions="">
    <strong className="font-medium">모든 옵션 한 번에 처리</strong>
    <div className="flex flex-wrap gap-2">
      {open.length > 0 && <button className={buttonVariants({ variant: 'outline', size: 'sm' })} data-slot="button" form={form} type="button" disabled={pending} onClick={() => { void run('stopped', open); }}>모든 옵션 새 예약 접수 중지</button>}
      <button className={buttonVariants({ variant: 'outline', size: 'sm' })} data-slot="button" data-stock-supply="" form={form} type="button" disabled={pending || blocking.length > 0} onClick={() => { void run('stock', selected); }}>모든 옵션 일반 재고 판매로 전환</button>
    </div>
    <small className="text-xs text-muted-foreground">일반 재고 판매로 전환하면 접수 중인 예약도 함께 중지하고, 지금 재고수량으로 바로 판매합니다.</small>
    {blocking.length > 0 && <small className="text-xs text-muted-foreground" data-stock-supply-blocked="">{stockSupplyBlockedText(blocking)}</small>}
    {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
  </div>;
}

export function PreorderReceipt({ policy, variant, pendingQty, onSaved, randomSale = false }: {
  policy: AdminGoodsPreorder; variant?: AdminGoodsVariant; onSaved: (message: string, switched?: boolean) => void; randomSale?: boolean;
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
  async function regular() {
    setError(null);
    if (policy.state === 'active' && !await adminConfirm({ title: '일반 재고 판매로 바꿀까요?', confirmLabel: '일반 재고 판매로 전환',
      message: stockSwitchConfirmMessage([[variant?.name ?? '이 옵션', variant?.stockQty ?? 0]]) })) return;
    startTransition(async () => {
      const result = await switchToStockSupplyAction(policy.goodId, policy.variantId, policy.id, policy.revision);
      if (result.ok) onSaved(result.message, true); else setError(result.error);
    });
  }
  const at = (date: string | null) => date ? new Date(date).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '없음';
  const count = (qty: number | null) => qty === null ? '없음' : `${qty.toLocaleString('ko-KR')}개`;
  /* 일반 재고 전환은 지금 선택된 조건에서 한 번에 한다(접수 중이면 서버가 접수를 중지하고 전환한다). 랜덤 판매는 모든 옵션 묶음 버튼으로 한다. */
  const switchable = policy.selected && !randomSale;
  return <div className="flex min-w-0 flex-col gap-1.5 text-sm" data-preorder-receipt="">
    <strong className="font-medium">{variant?.name ?? '이전 옵션'} · {policy.state === 'active' ? '예약판매 중' : '접수 중지'}{policy.selected ? ' · 현재 선택' : ''}</strong>
    <span className="text-muted-foreground tabular-nums">예약 물량 {count(policy.capacityQty)} · 입고 확인 전 예약 {policy.reservedQty.toLocaleString('ko-KR')}개 · 입고 확인 누적 {policy.allocatedQty.toLocaleString('ko-KR')}개</span>
    <span className="text-muted-foreground tabular-nums">남은 예약 물량 {count(policy.remainingQty)}</span>
    <span className="text-muted-foreground tabular-nums">{at(policy.startsAt)} ~ {at(policy.endsAt)} (KST)</span>
    <span className="text-muted-foreground">{goodsShipDateLabel(policy.expectedShipDate)}</span>
    {policy.approvalReference ? <p className="text-xs whitespace-pre-wrap text-muted-foreground wrap-anywhere">메모: {policy.approvalReference}</p> : null}
    <div className="mt-1.5 flex flex-wrap gap-2 empty:hidden">
      {policy.state === 'active' && <button className={buttonVariants({ variant: 'outline', size: 'sm' })} data-slot="button" form={form} type="button" disabled={pending} onClick={stop}>새 예약 접수 중지</button>}
      {switchable && <button className={buttonVariants({ variant: 'outline', size: 'sm' })} data-slot="button" data-stock-supply="" form={form} type="button" disabled={pending || pendingQty > 0} onClick={() => { void regular(); }}>일반 재고 판매로 전환</button>}
    </div>
    {switchable && pendingQty > 0 && <small className="text-xs text-muted-foreground" data-stock-supply-blocked="">{stockSupplyBlockedText([[variant?.name ?? '이전 옵션', pendingQty]])}</small>}
    {switchable && pendingQty === 0 && policy.state === 'active' && <small className="text-xs text-muted-foreground">일반 재고 판매로 전환하면 접수를 중지하고 지금 재고수량으로 바로 판매합니다.</small>}
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
    if (!selection) { setError('선택한 예약 주문의 재고수량 정보가 서로 맞지 않습니다. [예약 주문 새로고침]을 누른 뒤 다시 선택해주세요.'); return; }
    startTransition(async () => {
      const result = await allocateGoodsPreordersAction(goodId, selection, receipt);
      if (result.ok) onSaved(result.message); else setError(result.error);
    });
  }
  const status = { reserved: '입고 확인 전', allocated: '입고 확인 완료', released: '입고 전 취소', returned: '입고 후 환불' };
  return <div className="flex min-w-0 flex-col gap-3" data-preorder-allocation="" role="group" aria-label="예약 주문 선택">
    {page.items.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">이 상태의 예약 주문이 없습니다.</p> : <ul className="m-0 flex list-none flex-col divide-y rounded-lg border p-0">
      {page.items.map((item) => <li key={item.orderItemId} className="flex min-w-0 flex-col gap-1 px-3 py-3">
        <label className="flex items-start gap-2 text-sm">
          {canAllocate && item.state === 'reserved' && <input className="mt-0.5" form={form} type="checkbox" checked={selected.includes(item.orderItemId)}
            disabled={pending || !['paid', 'confirmed', 'shipping'].includes(item.orderStatus) || item.fulfillmentHold === true}
            onChange={(event) => setSelected((current) => event.target.checked ? [...current, item.orderItemId] : current.filter((id) => id !== item.orderItemId))} />}
          <span className="min-w-0">{item.variantName ?? '기본 옵션'} · <span className="tabular-nums">{item.qty.toLocaleString('ko-KR')}개</span> · {status[item.state]}{item.orderStatus === 'pending' ? ' · 결제 대기' : ''}{item.fulfillmentHold ? <span className="font-medium text-destructive"> · 출고 보류(입고 확인 불가 — 주문 상세 확인)</span> : null}</span>
        </label>
        <a className="w-fit text-xs underline underline-offset-4 wrap-anywhere" href={`/admin/sales/orders/${item.orderId}`}>주문 {item.orderId}</a>
        <small className="block text-xs text-muted-foreground">{goodsShipDateLabel(item.expectedShipDate)} · 지금 옵션 재고수량 <span className="tabular-nums">{item.physicalStockQty.toLocaleString('ko-KR')}개</span></small>
        {canAllocate && item.allocationReference && <small className="block text-xs text-muted-foreground wrap-anywhere">입고 확인 근거: {item.allocationReference}</small>}
        {canAllocate && item.releaseReason && <small className="block text-xs text-muted-foreground">취소·환불 기록: {item.releaseReason}</small>}
      </li>)}
    </ul>}
    {canAllocate && page.items.some((item) => item.state === 'reserved') && <>
      <p className="text-sm text-muted-foreground" data-preorder-allocation-guide="">물건이 들어오면 결제가 확인된 예약 주문을 선택하고 입고 확인 근거를 적은 뒤 [선택한 예약 주문 입고 확인]을 누릅니다.
        선택한 품목 수량만큼 옵션 재고수량에서 빠지고, 배송 건에 든 예약 품목이 모두 입고 확인되면 출고할 수 있습니다.
        재고수량을 미리 넣어 둔 옵션은 재고를 다시 더하지 않습니다(더하면 재고가 두 번 잡힙니다). 재고수량이 0이거나 실제로 들어온 수량과 다르면 재고 조정으로 먼저 맞춥니다.</p>
      {totals.size > 0 && <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-sm tabular-nums">{[...totals.entries()].map(([id, total]) => <li key={id}>
        {total.name}: 입고 확인 {total.qty.toLocaleString('ko-KR')}개 / 재고수량 {total.available.toLocaleString('ko-KR')}개
      </li>)}</ul>}
      {shortage && <p className="text-sm text-destructive" role="alert">선택한 품목 수량이 옵션 재고수량보다 많습니다. 선택을 줄이거나 재고 조정으로 재고수량을 맞춰주세요.</p>}
      <label className={FIELD_CLASS}><span className="font-medium">입고 확인 근거</span>
        <textarea className={GOOD_TEXTAREA_CLASS} data-slot="textarea" form={form} rows={2} maxLength={2000} value={receipt} onChange={(event) => setReceipt(event.target.value)} disabled={pending} required
          placeholder="입고 내역을 확인할 수 있는 문서 번호 또는 자료 위치" />
      </label>
      <button className={`${buttonVariants()} self-start`} data-slot="button" form={form} type="button" disabled={pending || !selected.length || shortage || !receipt.trim()} onClick={allocate}>{pending ? '입고 확인 중…' : '선택한 예약 주문 입고 확인'}</button>
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
    <h3 className="text-sm font-medium">{canAllocate ? '예약 주문·입고 확인' : '예약 주문'}</h3>
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex min-w-0 flex-col gap-2"><Label htmlFor={stateId}>예약 상태</Label><NativeSelect className="w-full sm:w-40" form={form} id={stateId} value={state} onChange={(event) => { setState(event.target.value); setPageNumber(1); }}>
        <option value="reserved">입고 확인 전</option><option value="allocated">입고 확인 완료</option><option value="released">입고 전 취소</option><option value="returned">입고 후 환불</option>
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

/** 판매기간이 저장돼 있는 동안 예약 저장 버튼 자리에 보이는 이유. DB가 판매기간과 예약을 함께 받지 않는다(goods_sale_period_preorder_conflict). */
export const PREORDER_SALE_PERIOD_BLOCKED = '상품을 먼저 저장해 판매기간을 꺼야 예약판매를 저장할 수 있습니다.';

/**
 * 저장된 상품의 예약판매 패널(별도 저장). 판매 정보 카드의 '판매 시기' 안(GoodSavedPreorderSection)에 놓여 제목은 그 자리가 갖는다.
 * 기본 폼 안에 있어도 입력은 기본 폼에 섞이지 않는다(위 GOOD_DETACHED_FORM_ID 설명).
 * 판매 시기에서 예약판매를 고르지 않았을 때도 마운트돼 있어, 불러온 예약 상태(예약 연결이 남은 옵션 수·저장된 판매기간)를 판매 시기에 알린다 —
 * 그래야 '기간을 정해 판매'를 고를 수 없는 이유를 그 자리에서 말하고, 판매기간이 켜진 채 예약을 저장하지 않는다(규칙 5).
 * 그때는 새 예약 입력을 감추고, 지난 예약 기록이 있으면 접어서만 보인다.
 */
export function GoodsPreordersPanel({ goodId, variants, canReadOrders = true, canAllocate = true, randomSale = false }: {
  goodId: string; variants: AdminGoodsVariant[]; canReadOrders?: boolean; canAllocate?: boolean;
  /** 랜덤 판매 상품이면 모든 옵션을 같은 일정으로 한 번에 예약한다(옵션을 빼거나 일정을 다르게 넣지 않는다). */
  randomSale?: boolean;
}) {
  const timing = useGoodSaleTiming();
  const [refresh, setRefresh] = useState(0);
  const [notice, setNotice] = useState<{ goodId: string; message: string } | null>(null);
  const [loaded, setLoaded] = useState<{ goodId: string; policies?: AdminGoodsPreorder[]; salePeriodSaved?: boolean; error?: string } | null>(null);
  /* 운영자가 고른 '예약판매'(아직 저장한 예약 조건이 없을 때). 기본 폼이 다시 마운트돼도 이어지게 상품별로 키 밖에 둔다. */
  const [wanted, setWanted] = useGoodWorkspaceStash<boolean>(`preorder-wanted:${goodId}`, () => false);
  useEffect(() => {
    let canceled = false;
    void listGoodsPreordersAction(goodId).then((result) => {
      if (!canceled) setLoaded(result.ok ? { goodId, policies: result.policies, salePeriodSaved: result.salePeriodSaved } : { goodId, error: result.error });
    }).catch(() => { if (!canceled) setLoaded({ goodId, error: '예약 조건을 불러오지 못했습니다.' }); });
    return () => { canceled = true; };
  }, [goodId, refresh]);
  /* 새로고침하는 동안에는 방금까지 보던 내용을 그대로 둔다(판매 시기 선택과 입력 중인 예약이 깜빡이지 않게). */
  const visible = loaded?.goodId === goodId ? loaded : null;
  const policies = visible?.policies ?? [];
  const selectedVariants = variants.filter((variant) => variant.goodId === goodId);
  const activeVariants = selectedVariants.filter((variant) => !variant.archivedAt);
  const { available, busy } = preorderEditorTargets(selectedVariants, policies);
  const randomOpen = busy.length > 0;
  const pendingByVariant = pendingPreorderReservationsByVariant(policies);
  const reload = () => setRefresh((value) => value + 1);
  const saved = (message: string, switched = false) => { if (switched) setWanted(false); setNotice({ goodId, message }); reload(); };
  /* 예약 조건을 새 날짜로 저장한 직후 '기존 예약 주문도 이 날짜로' 미리보기 입구(QNA-040). 주문 관리 권한이 있을 때만 보인다. */
  const [scheduleSuggestion, setScheduleSuggestion] = useState<PreorderScheduleSuggestion | null>(null);
  const activated = (expectedShipDate: string, variantId: string | null) => setScheduleSuggestion({ expectedShipDate, variantId: randomSale ? null : variantId, key: Date.now() });

  const state = !visible ? 'loading' : visible.error ? 'error' : 'ready';
  /* 예약 연결은 접수를 중지하거나 접수 기간이 끝나도 [일반 재고 판매로 전환] 전까지 남는다. 남아 있는 동안 판매기간을 저장할 수 없다. */
  const linked = policies.filter((policy) => policy.selected && activeVariants.some((variant) => variant.id === policy.variantId)).length;
  const total = policies.length;
  const salePeriodSaved = visible?.salePeriodSaved === true;
  const stockSwitchLabel = randomSale ? '모든 옵션 일반 재고 판매로 전환' : '일반 재고 판매로 전환';
  const report = timing?.report;
  useEffect(() => { report?.({ state, linked, total, salePeriodSaved, wanted, setWanted, stockSwitchLabel }); }, [report, state, linked, total, salePeriodSaved, wanted, setWanted, stockSwitchLabel]);
  useEffect(() => () => report?.(null), [report]);

  const refreshButton = <button className={`${buttonVariants({ variant: 'outline' })} self-start`} data-slot="button" form={form} type="button" onClick={reload}>저장된 예약 조건 새로고침</button>;
  if (!visible) return <p className="text-sm text-muted-foreground" data-preorders-panel="loading" role="status">예약 조건을 불러오는 중입니다…</p>;
  if (visible.error) return <div className="flex min-w-0 flex-col gap-3 text-sm" data-preorders-panel="error"><p className="text-sm text-destructive" role="alert">{visible.error}</p>{refreshButton}</div>;

  const editing = !timing || timing.mode === 'preorder';
  const noticeLine = notice?.goodId === goodId ? <p className={`${GOOD_NOTE_CLASS} font-medium text-[var(--wc-success)]`} role="status">{notice.message}</p> : null;
  const receipts = policies.map((policy) => <div key={`${policy.id}:${policy.revision}`} className="min-w-0 rounded-lg border p-3">
    <PreorderReceipt policy={policy} variant={selectedVariants.find((variant) => variant.id === policy.variantId)}
      pendingQty={pendingByVariant.get(policy.variantId) ?? 0} onSaved={saved} randomSale={randomSale} />
  </div>);
  /* QNA-040: 예약 주문의 발송 예정일 일괄 변경·고객 안내. 주문 약속일을 바꾸므로 입고 할당과 같은 주문 관리 권한일 때만. */
  const orders = <>
    {canReadOrders && canAllocate ? <GoodsPreorderSchedulePanel goodId={goodId} variants={selectedVariants} randomSale={randomSale} suggestion={scheduleSuggestion} /> : null}
    {canReadOrders ? <PreorderReservations goodId={goodId} revision={refresh} onSaved={saved} canAllocate={canAllocate} /> : null}
  </>;
  if (!editing) {
    /* 예약판매를 고르지 않았다: 새 예약 입력은 감추고, 지난 예약 기록(주문·입고 확인 포함)만 접어서 남긴다. */
    if (!total) return noticeLine;
    return <div className="flex min-w-0 flex-col gap-3 text-sm" data-preorders-panel="history">
      {noticeLine}
      <GoodWorkspaceDetails stateId={`good-preorder-history-${goodId}`} className={DETAILS_CLASS}><summary className={SUMMARY_CLASS}>지난 예약 기록 {total.toLocaleString('ko-KR')}건</summary>
        <div className="flex min-w-0 flex-col gap-3 border-t p-3">{receipts}{orders}{refreshButton}</div>
      </GoodWorkspaceDetails>
    </div>;
  }
  const blockedReason = salePeriodSaved ? PREORDER_SALE_PERIOD_BLOCKED : null;
  const previousRound = (targets: readonly AdminGoodsVariant[]) => targets.flatMap((variant) => { const qty = pendingByVariant.get(variant.id) ?? 0; return qty > 0 ? [[variant.name, qty] as const] : []; });
  const editor = randomSale
    ? randomOpen ? <p className="text-sm text-muted-foreground">접수 중인 예약이 있습니다. 새 예약은 모든 옵션의 접수를 중지한 뒤 저장할 수 있습니다. {RESTART_CAPACITY_NOTE}</p>
      : <RandomPreorderEditor goodId={goodId} variants={activeVariants} blockedReason={blockedReason} pending={previousRound(activeVariants)} onSaved={saved} onActivated={(date) => activated(date, null)} />
    : available.length ? <PreorderEditor goodId={goodId} variants={available} table={activeVariants.length > 1} busy={busy} blockedReason={blockedReason} pending={previousRound(available)} onSaved={saved} onActivated={activated} />
      : activeVariants.length ? <p className="text-sm text-muted-foreground" data-preorder-all-busy="">{activeVariants.length > 1 ? '모든 옵션이 이미 예약판매 중입니다.' : '이미 예약판매 중입니다.'} 일정이나 물량을 바꾸려면 [새 예약 접수 중지]를 누른 뒤 새로 저장합니다. {RESTART_CAPACITY_NOTE}</p>
      : <p className="text-sm text-muted-foreground">사용 중인 옵션이 없습니다. 옵션을 사용으로 바꾸면 예약판매를 저장할 수 있습니다.</p>;
  /* 저장한 예약 조건이 있으면 새 입력은 접어 두고(기록이 먼저 보이게), 없으면 바로 펼쳐 둔다. */
  const editorSummary = randomSale ? '랜덤 판매 예약 (모든 옵션)' : '새 예약 조건';
  return <div className={`${GOOD_SUBPANEL_CLASS} text-sm`} data-preorders-panel="">
    {noticeLine}
    {randomSale && <RandomPreorderBulkActions goodId={goodId} variants={activeVariants} policies={policies} onSaved={saved} />}
    {receipts}
    {total && (randomSale ? !randomOpen : available.length > 0)
      ? <GoodWorkspaceDetails stateId={`good-preorder-new-${goodId}`} className={DETAILS_CLASS}><summary className={SUMMARY_CLASS}>{editorSummary}</summary><div className="border-t p-3">{editor}</div></GoodWorkspaceDetails>
      : editor}
    {orders}
    {refreshButton}
  </div>;
}
