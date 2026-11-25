'use client';

import { useCallback, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { adminConfirm } from '@/lib/admin/confirm';
import {
  goodWorkspacePreorderTargets, goodWorkspaceRandomSale, withGoodWorkspacePreorderPlan, type GoodWorkspaceSectionsDraft,
} from '@/lib/admin/good-workspace-sections';
import type { GoodsOptionRow } from '@/lib/admin/goods-option-editor';
import { emptyPreorderPlan, expandPreorderPlan, preorderPlanHasInput } from '@/lib/admin/goods-preorders';
import { goodSaleTimingMode, type GoodSaleTimingMode } from '@/lib/admin/goods-sale-period';
import { GOOD_SALE_TIMING_HELP } from '@/lib/admin/help/good-sale-timing';
import { GOOD_NOTE_CLASS, GoodChoiceCard, GoodChoiceCards } from './GoodEditorParts';
import { GoodsSalePeriodFields } from './GoodsSalePeriodFields';
import {
  GoodSaleTimingProvider, goodPreorderSlotKind, type GoodPreorderSlotKind, type GoodSaleTimingBridge, type SavedPreorderTimingReport,
} from './GoodSaleTimingContext';
import { GOOD_DETACHED_FORM_ID, GoodEditorSubsection, useGoodWorkspaceSections } from './GoodWorkspace';

/** 판매 시기 카드의 이름과 한 줄 설명. 카드가 스스로 말하므로 설명 문단을 따로 두지 않는다('글보다 화면' 2). */
export const GOOD_SALE_TIMING_CHOICES = [
  ['now', '바로 판매', '공개하면 바로 살 수 있습니다.'],
  ['period', '기간을 정해 판매', '정한 기간에만 팝니다. 기간 밖에는 보이지만 살 수 없습니다.'],
  ['preorder', '예약판매', '미리 주문받아 정한 날 보냅니다.'],
] as const satisfies readonly (readonly [GoodSaleTimingMode, string, string])[];

/** 등록 화면에서 예약판매를 그만둘 때의 확인. 입력해 둔 예약 조건이 몇 개 사라지는지 말한다(규칙 7). */
export function saleTimingDiscardConfirm(count: number) {
  return { title: '판매 시기를 바꿀까요?', confirmLabel: '바꾸기', message: `입력한 예약 조건 ${count.toLocaleString('ko-KR')}개가 사라집니다.` };
}

/**
 * 판매 시기를 바꾼다. 판매기간은 상품 폼 값(`onChange`)으로, 예약판매는 등록 화면이면 함께 저장할 입력(`setSections`)으로,
 * 저장된 상품이면 예약판매 패널 쪽 선택(`saved.setWanted`)으로 남긴다. 등록 화면에서 예약 입력을 버리게 되면 먼저 묻고, 취소하면 그대로 둔다.
 */
export async function chooseGoodSaleTiming(next: GoodSaleTimingMode, { mode, kind, sections, optionRows, setSections, saved, onChange }: {
  mode: GoodSaleTimingMode | null; kind: GoodPreorderSlotKind | null;
  sections?: GoodWorkspaceSectionsDraft; optionRows?: readonly GoodsOptionRow[]; setSections?: Dispatch<SetStateAction<GoodWorkspaceSectionsDraft>>;
  saved?: Pick<SavedPreorderTimingReport, 'setWanted'> | null;
  onChange: (patch: Record<string, string>) => void;
}): Promise<boolean> {
  if (next === mode) return false;
  const rows = optionRows ?? [];
  if (kind === 'draft' && sections?.preorderPlan && next !== 'preorder') {
    const count = expandPreorderPlan(sections.preorderPlan, goodWorkspacePreorderTargets(rows), { all: goodWorkspaceRandomSale(sections) }).length;
    if (preorderPlanHasInput(sections.preorderPlan) && !await adminConfirm(saleTimingDiscardConfirm(count))) return false;
    setSections?.((current) => withGoodWorkspacePreorderPlan(current, null, rows));
  }
  if (kind === 'draft' && next === 'preorder') setSections?.((current) => withGoodWorkspacePreorderPlan(current, current.preorderPlan ?? emptyPreorderPlan(), rows));
  if (kind === 'saved') saved?.setWanted(next === 'preorder');
  onChange({ salePeriodEnabled: next === 'period' ? 'true' : 'false' });
  return true;
}

/**
 * 카드마다 고를 수 있는지와, 못 고르면 그 이유·푸는 방법(규칙 5 — 이유 없이 흐리게만 두지 않는다).
 * - 저장된 상품에 예약을 건 옵션이 남아 있으면 바로 판매·기간을 정해 판매를 고를 수 없다. 접수를 중지했거나 접수 기간이 끝나도
 *   [일반 재고 판매로 전환] 전까지는 그 옵션이 예약으로 묶여 있고, DB가 판매기간 저장을 거절한다.
 * - 저장된 상품의 예약 조건을 아직 읽지 못했으면(불러오는 중·실패) 어느 쪽인지 알 수 없어 모두 잠근다(`locked`). 이유는 아래 패널의 안내가 말한다.
 * - 등록 화면에서 '주문 후 제작'을 켰으면 예약판매를 고를 수 없다(DB가 둘을 함께 받지 않는다).
 */
export function goodSaleTimingCardStates({ mode, kind, saved, sections }: {
  mode: GoodSaleTimingMode | null; kind: GoodPreorderSlotKind | null;
  saved?: Pick<SavedPreorderTimingReport, 'state' | 'linked' | 'stockSwitchLabel'> | null;
  sections?: Pick<GoodWorkspaceSectionsDraft, 'extras' | 'preorderPlan'>;
}): { locked: boolean; cards: { value: GoodSaleTimingMode; title: string; description: string; checked: boolean; disabled: boolean; blockedReason?: string }[] } {
  const locked = kind === 'saved' && saved?.state !== 'ready';
  const linkedReason = kind === 'saved' && saved?.state === 'ready' && saved.linked > 0
    ? `예약판매가 걸린 옵션이 있어 고를 수 없습니다. 아래 예약 조건에서 [${saved.stockSwitchLabel}]을 누르면 고를 수 있습니다.` : undefined;
  const blocked: Record<GoodSaleTimingMode, string | undefined> = {
    now: linkedReason,
    period: linkedReason,
    preorder: !kind ? '보관한 상품은 예약판매를 바꿀 수 없습니다.'
      : kind === 'draft' && sections?.extras?.production?.enabled && !sections.preorderPlan ? "'주문 후 제작'을 쓰는 상품은 예약판매를 함께 쓸 수 없습니다. 아래 '주문 후 제작'의 체크를 끄면 고를 수 있습니다." : undefined,
  };
  return { locked, cards: GOOD_SALE_TIMING_CHOICES.map(([value, title, description]) => ({ value, title, description, checked: mode === value,
    disabled: locked || (Boolean(blocked[value]) && mode !== value), blockedReason: blocked[value] })) };
}

/**
 * 판매 정보 카드의 '판매 시기'(규칙 5): 바로 판매 · 기간을 정해 판매 · 예약판매 가운데 하나를 고르고, 고른 것의 입력만 연다.
 * 판매기간과 예약판매는 함께 쓸 수 없으므로(DB가 양방향으로 거절) 둘을 나란히 열어 두지 않고, 고를 수 없는 카드에는 이유와 푸는 방법을 적는다.
 * 판매기간 값은 상품 폼이 제출한다(`salePeriodEnabled`·`saleStartsAt`·`saleEndsAt`·`salePeriodRevision` — 바로 판매·예약판매는 `salePeriodEnabled=false`).
 * 예약판매는 상위가 넘긴 자리(`preorderSlot`)가 그린다 — 등록 화면은 상품과 함께 저장하는 입력, 저장된 상품은 별도 저장 패널이고,
 * 패널은 고르지 않았을 때도 마운트돼 있어 불러온 예약 상태를 이 선택에 알린다.
 */
export function GoodSaleTiming({ values, error, errorCount, onChange, preorderSlot, preorderKind }: {
  values: Record<string, string>;
  error?: string;
  errorCount: number;
  onChange: (patch: Record<string, string>) => void;
  preorderSlot?: ReactNode;
  /** 예약판매 자리의 종류. 주지 않으면 `preorderSlot` 부품(GoodWorkspacePreorderRow·GoodSavedPreorderSection)에서 읽는다. */
  preorderKind?: GoodPreorderSlotKind;
}) {
  const workspace = useGoodWorkspaceSections();
  const kind = preorderSlot ? preorderKind ?? goodPreorderSlotKind(preorderSlot) : null;
  const [saved, setSaved] = useState<SavedPreorderTimingReport | null>(null);
  const report = useCallback((status: SavedPreorderTimingReport | null) => setSaved(status), []);
  const sections = kind === 'draft' ? workspace?.sections : undefined;
  const mode = goodSaleTimingMode({ salePeriodEnabled: values.salePeriodEnabled === 'true', draftPreorder: Boolean(sections?.preorderPlan), saved: kind === 'saved' ? saved : undefined });
  const bridge = useMemo<GoodSaleTimingBridge>(() => ({ mode, report }), [mode, report]);
  const choose = (next: GoodSaleTimingMode) => {
    void chooseGoodSaleTiming(next, { mode, kind, sections, optionRows: workspace?.optionRows, setSections: workspace?.setSections, saved, onChange });
  };
  const { cards } = goodSaleTimingCardStates({ mode, kind, saved, sections });
  const periodPending = kind === 'saved' && mode === 'preorder' && saved?.state === 'ready' && saved.salePeriodSaved;
  return <GoodSaleTimingProvider value={bridge}>
    <GoodEditorSubsection title="판매 시기" id="good-section-period" errorCount={errorCount} help={GOOD_SALE_TIMING_HELP.saleTiming}>
      <input type="hidden" name="salePeriodRevision" value={values.salePeriodRevision || '0'} />
      <input type="hidden" name="salePeriodEnabled" value={mode === 'period' ? 'true' : 'false'} />
      <GoodChoiceCards legend={<span className="sr-only">판매 시기</span>} data-good-sale-timing={mode ?? 'unknown'}>
        {cards.map(({ value, title, description, checked, disabled, blockedReason }) => <GoodChoiceCard key={value} title={title} description={description} blockedReason={blockedReason}
          form={GOOD_DETACHED_FORM_ID} name="saleTimingChoice" value={value} checked={checked} disabled={disabled} onChange={() => choose(value)} />)}
      </GoodChoiceCards>
      {kind === 'saved' && saved?.state === 'error' ? <p className="text-sm text-destructive" role="alert">예약 조건을 불러오지 못해 판매 시기를 바꿀 수 없습니다. 아래 [저장된 예약 조건 새로고침]을 눌러주세요.</p> : null}
      {mode === 'period'
        ? <GoodsSalePeriodFields values={values} error={error} onChange={onChange} />
        : <><input type="hidden" name="saleStartsAt" value={values.saleStartsAt ?? ''} /><input type="hidden" name="saleEndsAt" value={values.saleEndsAt ?? ''} />
          {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}</>}
      {periodPending ? <p className={GOOD_NOTE_CLASS} data-good-sale-period-pending="" role="status">이 상품에는 판매기간이 저장돼 있습니다. 먼저 상품을 저장해 판매기간을 없앤 뒤에 예약판매를 저장할 수 있습니다. 공개 중인 상품은 그 사이에 지금 재고수량으로 바로 팔립니다.</p> : null}
      {/* 예약판매 입력은 이름이 없고 소속 폼을 뗐다(GOOD_DETACHED_FORM_ID). Enter로 상품이 저장되지 않게 막고, 자동복구는 이 안의 입력을 수정으로 세지 않는다. */}
      {preorderSlot ? <div className="contents" data-good-preorder-slot="" onKeyDown={(event) => { if (event.key === 'Enter' && event.target instanceof HTMLInputElement) event.preventDefault(); }}>{preorderSlot}</div> : null}
    </GoodEditorSubsection>
  </GoodSaleTimingProvider>;
}
