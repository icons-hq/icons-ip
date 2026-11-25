'use client';

import { useState, type ReactNode } from 'react';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { adminConfirm } from '@/lib/admin/confirm';
import {
  expandPreorderPlan, fillPreorderPlanCapacity, preorderCapacityProblem, preorderCapacityStockNote, preorderPlanManualCapacities, preorderPlanOwnSchedules,
  preorderPlanReadback, preorderSellableStock, setPreorderPlanPerOption,
  type PreorderApplyField, type PreorderApplyProblems, type PreorderPlan, type PreorderPlanOption, type PreorderPlanProblems, type PreorderPlanTarget,
} from '@/lib/admin/goods-preorders';
import { GOOD_INPUT_CLASS, GOOD_NUMBER_INPUT_CLASS, GOOD_TABLE_FRAME_CLASS, GoodReadback } from './GoodEditorParts';
import { GOOD_DETACHED_FORM_ID } from './GoodWorkspace';
import { PreorderCapacityStockHint } from './PreorderCapacityStockHint';

/*
 * 예약판매 한 번에 입력(docs/admin-screen-rules.md 규칙 6). 등록 화면(상품과 함께 저장)과 저장된 상품의 예약판매 패널(별도 저장)이 같이 쓴다.
 * 접수 시작·종료·발송 예정일을 한 번 넣고, 옵션 표에서 예약 물량만 옵션별로 정한다([전체 같은 수량 넣기]·[재고수량과 같게]).
 * 예약하지 않을 옵션은 체크를 끄고, 옵션마다 일정이 다를 때만 '옵션마다 일정을 다르게'를 켠다.
 * 기본 폼 <form> 안에 놓이므로 모든 입력·버튼은 소속 폼을 떼어(GOOD_DETACHED_FORM_ID) 상품 저장의 FormData·검증·Enter 제출에 섞이지 않는다.
 */
const form = GOOD_DETACHED_FORM_ID;
const FIELD_CLASS = 'flex min-w-0 flex-col gap-2 text-sm';
const CELL_CLASS = 'px-3 py-2 align-top';
const SCHEDULE_FIELDS = [
  ['startsAt', '접수 시작 (KST)', 'datetime-local'], ['endsAt', '접수 종료 (KST)', 'datetime-local'], ['expectedShipDate', '발송 예정일', 'date'],
] as const satisfies readonly (readonly [Exclude<PreorderApplyField, 'capacityQty'>, string, string])[];

/** 랜덤 판매 예약의 옵션별 물량 아래 한 줄. 물량이 배정 비율이 된다는 것은 화면에 보이지 않는 결과라 남긴다. */
export const RANDOM_PREORDER_CAPACITY_NOTE = '랜덤 판매는 모든 옵션을 같은 일정으로 예약합니다. 주문할 때 옵션별 남은 예약 물량에 비례해 옵션이 정해집니다.';

/** 칸 옆 안내. 저장이 막힌 뒤부터 보이고, 칸을 고치면 다음 그리기에서 바로 사라진다. */
function FieldProblem({ id, message }: { id: string; message?: string | null }) {
  return message ? <p className="text-xs font-medium text-destructive" data-preorder-field-problem="" id={id}>{message}</p> : null;
}
const invalidProps = (message: string | null | undefined, id: string) => message ? { 'aria-invalid': true, 'aria-describedby': id } as const : {};

export function PreorderPlanFields({ plan, onChange, targets, table, all = false, problems = null, disabled = false, idPrefix, excludedNote, capacityNote }: {
  plan: PreorderPlan;
  onChange: (update: (plan: PreorderPlan) => PreorderPlan) => void;
  /** 예약할 수 있는 옵션(사용 중이고 이미 예약판매 중이 아닌 옵션). */
  targets: readonly PreorderPlanTarget[];
  /** 옵션 표를 보인다(상품의 사용 중인 옵션이 둘 이상). 하나뿐이면 옵션을 고를 일이 없어 예약 물량 한 칸만 보인다. */
  table: boolean;
  /** 랜덤 판매: 모든 옵션을 같은 일정으로 예약한다(옵션을 빼거나 일정을 다르게 넣지 않는다). */
  all?: boolean;
  /** 저장이 막힌 뒤의 칸별 이유. 저장을 누르기 전에는 null. */
  problems?: PreorderPlanProblems | null;
  disabled?: boolean;
  idPrefix: string;
  /** 표에서 뺀 옵션 안내(규칙 2 — 고를 수 없는 옵션은 목록에 넣지 않고 한 줄로 알린다). */
  excludedNote?: ReactNode;
  /** 옵션별 물량 아래 한 줄(랜덤 판매의 배정 방식). */
  capacityNote?: ReactNode;
}) {
  const [fill, setFill] = useState('');
  const scope = { all };
  const perOption = plan.perOption && !all && table;
  const entries = expandPreorderPlan(plan, targets, scope);
  const entryByKey = new Map(entries.map((entry) => [entry.key, entry]));
  const readback = preorderPlanReadback(plan, targets, { all, table });
  const set = (changes: Partial<PreorderPlan>) => onChange((current) => ({ ...current, ...changes }));
  const setOption = (key: string, changes: Partial<PreorderPlanOption>) => onChange((current) => ({ ...current, options: { ...current.options, [key]: { ...current.options[key], ...changes } } }));
  const setAllIncluded = (checked: boolean) => onChange((current) => {
    const options = { ...current.options };
    for (const target of targets) options[target.key] = { ...options[target.key], excluded: !checked };
    return { ...current, options };
  });
  const followStock = (key: string) => onChange((current) => fillPreorderPlanCapacity(current, targets.filter((target) => target.key === key), null, { all: true }));
  /* 한꺼번에 채우면 직접 넣어 둔 물량이 바뀐다. 바뀌는 수를 보여 주고 묻는다(규칙 7). */
  async function fillAll(qty: string | null) {
    const manual = preorderPlanManualCapacities(plan, targets, qty, scope);
    if (manual > 0 && !await adminConfirm({ title: '예약 물량을 한꺼번에 바꿀까요?', confirmLabel: '바꾸기',
      message: `옵션 ${manual.toLocaleString('ko-KR')}개에 직접 넣은 예약 물량이 ${qty === null ? '재고수량으로' : `${Number(qty).toLocaleString('ko-KR')}개로`} 바뀝니다.` })) return;
    onChange((current) => fillPreorderPlanCapacity(current, targets, qty, scope));
  }
  async function togglePerOption(next: boolean) {
    const own = next ? 0 : preorderPlanOwnSchedules(plan, targets);
    if (own > 0 && !await adminConfirm({ title: '모든 옵션을 같은 일정으로 바꿀까요?', confirmLabel: '같은 일정으로 바꾸기',
      message: `옵션 ${own.toLocaleString('ko-KR')}개에 따로 넣은 일정이 사라지고, 모든 옵션이 같은 일정을 씁니다.` })) return;
    onChange((current) => setPreorderPlanPerOption(current, next));
  }
  const included = targets.filter((target) => entryByKey.has(target.key));
  const differing = entries.filter((entry) => !entry.capacityFromStock && preorderCapacityStockNote(entry.capacityQty, preorderSellableStock(targets.find((target) => target.key === entry.key)))).length;
  const fillValid = !preorderCapacityProblem(fill);
  const only = table ? undefined : targets[0];
  const onlyEntry = only ? entryByKey.get(only.key) : undefined;
  const onlyProblems: PreorderApplyProblems = only ? problems?.options[only.key] ?? {} : {};

  return <div className="flex min-w-0 flex-col gap-4" data-preorder-plan="">
    {perOption ? null : <div className="grid min-w-0 gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,10.5rem),1fr))]">
      {only && onlyEntry ? <div className={FIELD_CLASS}><label className="font-medium" htmlFor={`${idPrefix}-capacityQty`}>예약 물량</label>
        <input className={GOOD_NUMBER_INPUT_CLASS} data-slot="input" data-preorder-field="capacityQty" form={form} id={`${idPrefix}-capacityQty`} type="number" min={1} max={2147483647} step={1} inputMode="numeric"
          value={onlyEntry.capacityQty} placeholder="예: 100" disabled={disabled} {...invalidProps(onlyProblems.capacityQty, `${idPrefix}-capacityQty-problem`)}
          onChange={(event) => setOption(only.key, { capacityQty: event.target.value })} />
        <FieldProblem id={`${idPrefix}-capacityQty-problem`} message={onlyProblems.capacityQty} />
        <PreorderCapacityStockHint fromStock={onlyEntry.capacityFromStock} capacity={onlyEntry.capacityQty} stockQty={preorderSellableStock(only)} disabled={disabled} onUseStock={() => followStock(only.key)} />
      </div> : null}
      {SCHEDULE_FIELDS.map(([field, label, type]) => <div className={FIELD_CLASS} key={field}><label className="font-medium" htmlFor={`${idPrefix}-${field}`}>{label}</label>
        <input className={GOOD_INPUT_CLASS} data-slot="input" data-preorder-field={field} form={form} id={`${idPrefix}-${field}`} type={type} value={plan[field]} disabled={disabled}
          min={field === 'expectedShipDate' ? plan.endsAt.slice(0, 10) || undefined : undefined} {...invalidProps(problems?.common[field], `${idPrefix}-${field}-problem`)}
          onChange={(event) => set({ [field]: event.target.value })} />
        <FieldProblem id={`${idPrefix}-${field}-problem`} message={problems?.common[field]} />
      </div>)}
    </div>}
    {table && !all ? <label className="inline-flex min-h-8 w-fit cursor-pointer items-center gap-2 text-sm text-foreground has-disabled:cursor-not-allowed has-disabled:opacity-50">
      <input form={form} type="checkbox" checked={plan.perOption} disabled={disabled} data-preorder-per-option="" onChange={(event) => { void togglePerOption(event.target.checked); }} />옵션마다 일정을 다르게
    </label> : null}
    {table ? <div className="flex min-w-0 flex-col gap-2" data-preorder-options="">
      <div className="flex min-w-0 flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <span className="text-sm font-medium text-foreground">옵션별 예약 물량</span>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {/* 입력칸 클래스가 w-full이라 폭은 감싼 칸이 정한다(버튼과 한 줄에 놓인다). */}
          <span className="w-28 shrink-0"><input className={GOOD_NUMBER_INPUT_CLASS} data-slot="input" form={form} type="number" min={1} max={2147483647} step={1} inputMode="numeric" aria-label="모든 옵션에 넣을 예약 물량" placeholder="예: 100"
            value={fill} disabled={disabled} onChange={(event) => setFill(event.target.value)} /></span>
          <button className={buttonVariants({ variant: 'outline', size: 'sm' })} data-slot="button" data-preorder-fill="same" form={form} type="button" disabled={disabled || !fillValid || !included.length}
            onClick={() => { void fillAll(fill.trim()); }}>전체 같은 수량 넣기</button>
          <button className={buttonVariants({ variant: 'outline', size: 'sm' })} data-slot="button" data-preorder-fill="stock" form={form} type="button" disabled={disabled || !included.length}
            onClick={() => { void fillAll(null); }}>재고수량과 같게</button>
        </div>
      </div>
      <div className={`${GOOD_TABLE_FRAME_CLASS} max-h-[28rem] overflow-y-auto`} role="region" aria-label="옵션별 예약 물량 표" tabIndex={0}>
        <table className={perOption ? 'w-full min-w-[58rem] text-sm' : 'w-full min-w-[30rem] text-sm'}>
          <thead className="sticky top-0 z-10 bg-muted"><tr>
            {all ? null : <th scope="col" className="w-10 px-3 py-2 text-left font-medium"><input form={form} type="checkbox" aria-label="모든 옵션 예약" checked={included.length === targets.length && targets.length > 0} disabled={disabled}
              onChange={(event) => setAllIncluded(event.target.checked)} /></th>}
            <th scope="col" className="px-3 py-2 text-left font-medium">옵션</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">재고수량</th>
            <th scope="col" className="px-3 py-2 text-left font-medium">예약 물량</th>
            {perOption ? SCHEDULE_FIELDS.map(([field, label]) => <th scope="col" className="px-3 py-2 text-left font-medium" key={field}>{label}</th>) : null}
          </tr></thead>
          <tbody className="divide-y">{targets.map((target, index) => {
            const entry = entryByKey.get(target.key);
            const found: PreorderApplyProblems = problems?.options[target.key] ?? {};
            /* 옵션 키에는 빈칸·따옴표가 들어갈 수 있어(새 옵션의 옵션값 조합) id에는 줄 번호를 쓴다 — aria-describedby는 빈칸으로 id를 나눈다. */
            const problemId = (field: string) => `${idPrefix}-${field}-${index}-problem`;
            return <tr key={target.key} data-variant-id={target.key}>
              {all ? null : <td className={CELL_CLASS}><input form={form} type="checkbox" aria-label={`${target.name} 예약`} checked={Boolean(entry)} disabled={disabled}
                onChange={(event) => setOption(target.key, { excluded: !event.target.checked })} /></td>}
              <td className={`${CELL_CLASS} wrap-anywhere`}>{target.name}</td>
              <td className={`${CELL_CLASS} text-right tabular-nums`}>{(Number.isFinite(target.stockQty) ? target.stockQty ?? 0 : 0).toLocaleString('ko-KR')}개
                {target.pendingQty ? <small className="block text-xs font-normal text-warning" data-preorder-row-pending="">이전 예약 {target.pendingQty.toLocaleString('ko-KR')}개 포함</small> : null}</td>
              <td className={CELL_CLASS}><div className="flex flex-col gap-1">
                <input className={`${GOOD_NUMBER_INPUT_CLASS} max-w-40`} data-slot="input" data-preorder-field={`capacity:${target.key}`} form={form} type="number" min={1} max={2147483647} step={1} inputMode="numeric"
                  aria-label={`${target.name} 예약 물량`} placeholder="예: 100" value={entry?.capacityQty ?? ''} disabled={disabled || !entry} {...invalidProps(found.capacityQty, problemId('capacity'))}
                  onChange={(event) => setOption(target.key, { capacityQty: event.target.value })} />
                <FieldProblem id={problemId('capacity')} message={found.capacityQty} />
                {entry ? <PreorderCapacityStockHint compact fromStock={entry.capacityFromStock} capacity={entry.capacityQty} stockQty={preorderSellableStock(target)} onUseStock={() => followStock(target.key)} /> : null}
              </div></td>
              {perOption ? SCHEDULE_FIELDS.map(([field, label, type]) => <td className={CELL_CLASS} key={field}><div className="flex flex-col gap-1">
                <input className={GOOD_INPUT_CLASS} data-slot="input" data-preorder-field={`${field}:${target.key}`} form={form} type={type} aria-label={`${target.name} ${label}`} value={entry?.[field] ?? ''} disabled={disabled || !entry}
                  min={field === 'expectedShipDate' ? entry?.endsAt.slice(0, 10) || undefined : undefined} {...invalidProps(found[field], problemId(field))}
                  onChange={(event) => setOption(target.key, { [field]: event.target.value })} />
                <FieldProblem id={problemId(field)} message={found[field]} />
              </div></td>) : null}
            </tr>;
          })}</tbody>
        </table>
      </div>
      {differing > 0
        ? <p className="text-xs font-medium text-warning" data-preorder-capacity-differs="">예약 물량이 재고수량과 다른 옵션이 {differing.toLocaleString('ko-KR')}개 있습니다. 상품이 들어오면 재고수량을 실제로 들어온 수량으로 맞춘 뒤 입고 확인을 합니다.</p>
        : <p className="text-xs text-muted-foreground">고치지 않은 예약 물량은 재고수량을 따라 바뀝니다.</p>}
      {capacityNote ? <p className="text-xs text-muted-foreground">{capacityNote}</p> : null}
      {/* 화면에 보이지 않는 결과: 체크를 끈 옵션은 예약이 아니라 지금 재고로 바로 팔린다. */}
      {!all && included.length > 0 && included.length < targets.length ? <p className="text-xs text-muted-foreground" data-preorder-unchecked-note="">체크를 끈 옵션은 예약 없이 재고수량으로 바로 팝니다.</p> : null}
      {excludedNote ? <p className="text-xs text-muted-foreground" data-preorder-excluded-note="">{excludedNote}</p> : null}
    </div> : null}
    {readback ? <GoodReadback>{readback.problem ? <span className="font-medium text-warning">{readback.text}</span> : readback.text}</GoodReadback> : null}
  </div>;
}
