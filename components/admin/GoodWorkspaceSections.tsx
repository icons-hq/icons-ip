'use client';

import type { ReactNode } from 'react';
import { GoodsKcDisclosure } from '@/components/shop/GoodsKcDisclosure';
import {
  MAX_GOODS_KC_MODELS, emptyGoodsKcModel, goodsKcChoice, goodsKcReviewProblems, goodsKcSoleNotApplicable, goodsKcSubjectModel,
  goodsKcProductNotApplicableConfirm, planGoodsKcProductNotApplicable, publicGoodsKcDisclosures, type GoodsKcChoice, type GoodsKcModelInput,
} from '@/lib/admin/goods-kc';
import {
  goodWorkspaceKcVariants, goodWorkspacePreorderTargets, goodWorkspaceRandomSale, withGoodWorkspacePreorderPlan, type GoodWorkspaceKcDraft,
} from '@/lib/admin/good-workspace-sections';
import { useGoodSaleTiming, type GoodPreorderSlotKind } from './GoodSaleTimingContext';
import { PreorderPlanFields, RANDOM_PREORDER_CAPACITY_NOTE } from './PreorderPlanFields';
import {
  GOODS_KC_SUBJECT_ATTESTATION, GOODS_KC_SUBJECT_GUIDE, GOODS_OTHER_CERTIFICATIONS_GUIDE, GoodsKcSubjectChoice, GoodsOtherCertificationsFields,
  ModelFields, ProductNotApplicable,
} from './GoodsKcPanel';
import { useGoodWorkspaceSections } from './GoodWorkspace';
import { GOOD_NOTE_CLASS } from './GoodEditorParts';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { adminConfirm } from '@/lib/admin/confirm';
import { preorderPlanProblems } from '@/lib/admin/goods-preorders';

/*
 * 등록 화면의 원자 저장 섹션(10/27 회의 R13·D6②). 입력은 GoodWorkspaceProvider(폼 키 밖)에 두고,
 * 기본 상품 폼이 저장할 때 hidden JSON 하나로 함께 보낸다. 이 카드들은 <form>도 name도 갖지 않아, 고시 카드 안에 놓여도 폼 제출·자동복구·임시저장에 실리지 않는다.
 * 저장 뒤에는 같은 자리(같은 id)의 독립 KC·예약판매 패널이 저장값을 읽어 이어서 관리한다.
 */

/** 등록 화면 KC 확인 체크 문구. 저장된 상품의 KC 정보와 같은 자가 신고 확인이다(1007-034). */
export const GOOD_WORKSPACE_KC_ATTESTATION = GOODS_KC_SUBJECT_ATTESTATION;

/*
 * 등록 화면 KC 카드(1007-034 자가 신고 · SHEET-014 기타 인증 · TKT-006 KC 틀). 'KC 인증 대상 여부'를 먼저 고른다.
 * 대상 아님은 확인 체크 하나로 끝나고(고르는 순간 체크된다), 대상은 사용 중인 옵션을 모두 연결한 모델 1개로 시작해 인증 종류·번호·
 * 모델·사업자를 넣는다. 내부 검토 근거는 선택이다. 기타 인증은 KC와 별개로 여러 건 넣고 상품과 함께 저장한다.
 */
export function GoodWorkspaceKcCard({ serverError, disabled = false }: { serverError?: string; disabled?: boolean }) {
  const workspace = useGoodWorkspaceSections();
  if (!workspace) return null;
  const { sections, setSections, optionRows, sectionErrors } = workspace;
  const { models, attested } = sections.kc;
  const otherCertifications = sections.otherCertifications ?? [];
  const variants = goodWorkspaceKcVariants(optionRows);
  const choice = goodsKcChoice(models);
  const problems = choice === 'subject' ? goodsKcReviewProblems(models, variants) : [];
  const setKc = (kc: GoodWorkspaceKcDraft) => setSections((current) => ({ ...current, kc }));
  const change = (next: GoodsKcModelInput[]) => setKc({ models: next, attested: false });
  async function choose(next: GoodsKcChoice) {
    if (next === 'not_applicable') {
      /* 고르는 순간 상품 전체 해당 없음을 확인한 것으로 체크한다(아래 체크를 풀면 미검토로 저장). 해당 없음 모델(프리셋 틀 포함)은 지키고,
         입력이 있는 대상 모델을 지울 때만 그 모델을 들어 묻는다('대상'을 고를 때 생긴 빈 모델은 묻지 않는다). */
      const plan = planGoodsKcProductNotApplicable(models, variants);
      const confirm = goodsKcProductNotApplicableConfirm(plan, { completing: false });
      if (confirm && !await adminConfirm(confirm)) return;
      setKc({ models: plan.models, attested: true, productNotApplicable: true });
    } else if (!models.length || goodsKcSoleNotApplicable(models)) setKc({ models: [goodsKcSubjectModel(variants)], attested: false });
  }
  const status = choice === null ? 'KC 미입력 · KC 인증 대상 여부를 고르세요. 비워 두고 저장해도 저장 뒤 이 자리의 KC 정보에서 입력할 수 있습니다.'
    : choice === 'not_applicable' ? (attested ? 'KC 해당 없음 · 저장하면 검토 완료로 함께 저장됩니다.' : 'KC 해당 없음 · 확인 체크 전이라 저장하면 미검토로 함께 저장됩니다.')
    : attested ? '저장하면 KC 검토 완료로 함께 저장됩니다.' : '저장하면 KC 미검토로 함께 저장됩니다. 검토 완료는 아래 확인을 체크하세요.';
  const error = sectionErrors.workspaceKc ?? serverError;
  return <div className="flex min-w-0 flex-col gap-4 text-sm" data-good-workspace-kc="">
    <p className="font-medium" role="status">{status}</p>
    <GoodsKcSubjectChoice value={choice} disabled={disabled} onChange={choose} />
    {choice === 'not_applicable' ? <ProductNotApplicable checkOnly checked={attested} variants={variants} models={models} disabled={disabled}
      onNoteChange={(publicNote) => setSections((current) => ({ ...current, kc: { ...current.kc, models: [{ ...current.kc.models[0], publicNote }] } }))}
      onComplete={(next) => setKc({ models: next, attested: true, productNotApplicable: true })}
      onUncheck={() => setSections((current) => ({ ...current, kc: { ...current.kc, attested: false } }))} /> : null}
    {/* 1027T 원칙("펼친 채로"): '대상'을 고르면 모델 입력을 접힌 줄이 아니라 바로 보인다. 마지막 모델을 빼면 고르기 전으로 돌아간다. */}
    {choice === 'subject' ? <div className="flex min-w-0 flex-col gap-4" data-good-kc-models="">
      <p className="text-sm text-muted-foreground">{GOODS_KC_SUBJECT_GUIDE} 적용 옵션은 위 옵션목록의 현재 옵션입니다.</p>
      {models.map((model, index) => <ModelFields key={index} model={model} index={index} variants={variants} disabled={disabled}
        onChange={(next) => change(models.map((item, position) => position === index ? next : item))}
        onRemove={() => change(models.filter((_, position) => position !== index))} />)}
      <div><button type="button" className={buttonVariants({ variant: 'outline' })} data-slot="button" disabled={disabled || models.length >= MAX_GOODS_KC_MODELS}
        onClick={() => change([...models, emptyGoodsKcModel()])}>KC 모델 추가</button></div>
      {problems.length > 0 && <div className={GOOD_NOTE_CLASS}><strong className="font-medium">검토 완료 전 확인</strong><ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-muted-foreground">{problems.map((problem, index) => <li key={index}>{problem}</li>)}</ul></div>}
      {problems.length === 0 && <GoodsKcDisclosure title="고객 고시 미리보기" disclosures={publicGoodsKcDisclosures(models, variants)} />}
      <label className="flex items-start gap-2 text-sm">
        <input className="mt-0.5" type="checkbox" checked={attested} disabled={disabled || problems.length > 0}
          onChange={(event) => setSections((current) => ({ ...current, kc: { ...current.kc, attested: event.target.checked } }))} />
        <span>{GOOD_WORKSPACE_KC_ATTESTATION}</span>
      </label>
    </div> : null}
    <div className="flex min-w-0 flex-col gap-3 border-t pt-4" data-good-workspace-other-certifications="">
      <div className="flex flex-col gap-1"><h3 className="text-sm font-medium">기타 인증 <span className="font-normal text-muted-foreground">· 상품과 함께 저장</span></h3>
        <p className="text-sm text-muted-foreground">{GOODS_OTHER_CERTIFICATIONS_GUIDE}</p></div>
      <GoodsOtherCertificationsFields entries={otherCertifications} disabled={disabled}
        onChange={(next) => setSections((current) => ({ ...current, otherCertifications: next }))} />
    </div>
    {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
    <small className="text-xs text-muted-foreground">KC 내부 근거 참조는 브라우저 자동복구·임시저장에 담지 않습니다. 화면을 닫기 전에 저장해주세요.</small>
  </div>;
}

/*
 * 등록 화면의 예약판매 입력(판매 시기에서 '예약판매'를 골랐을 때만 열린다). 판매 정보 카드(기본 폼 안)에 놓이지만 입력은 이름 없이 provider에 있고,
 * 소속 폼을 떼어(GOOD_DETACHED_FORM_ID) 기본 폼의 브라우저 검증·Enter 제출에 섞이지 않는다. 검증은 저장할 때 prepareGoodWorkspaceSections가 한 번에 한다.
 * 일정은 한 번 넣고 예약 물량만 옵션별로 정한다(규칙 6). 상품을 저장하면 바로 예약판매로 적용되고, 저장이 막히면(섹션 오류) 그때만 칸 옆에 이유를 보인다.
 * 랜덤 판매를 골랐으면 모든 옵션이 같은 일정으로 예약해야 하므로 옵션을 빼거나 일정을 다르게 넣는 칸을 보이지 않는다(ADR-0027).
 */
export function GoodWorkspacePreorderCard({ serverError, disabled = false }: { serverError?: string; disabled?: boolean }) {
  const workspace = useGoodWorkspaceSections();
  if (!workspace) return null;
  const { sections, setSections, optionRows, sectionErrors } = workspace;
  const plan = sections.preorderPlan;
  if (!plan) return null;
  const targets = goodWorkspacePreorderTargets(optionRows);
  const all = goodWorkspaceRandomSale(sections);
  const error = sectionErrors.workspacePreorders ?? serverError;
  return <div className="flex min-w-0 flex-col gap-4 text-sm" data-good-workspace-preorders="">
    {targets.length
      ? <PreorderPlanFields plan={plan} targets={targets} table={targets.length > 1} all={all} disabled={disabled} idPrefix="workspace-preorder"
        /* 저장을 시도해 섹션 오류가 났을 때만 칸별 안내를 보인다. 칸을 고치면 다음 그리기에서 바로 사라진다. */
        problems={error ? preorderPlanProblems(plan, targets, { all }) : null}
        capacityNote={all ? RANDOM_PREORDER_CAPACITY_NOTE : undefined}
        onChange={(update) => setSections((current) => current.preorderPlan ? withGoodWorkspacePreorderPlan(current, update(current.preorderPlan), optionRows) : current)} />
      : <p className="text-sm text-muted-foreground">사용 중인 옵션이 없습니다. 위 옵션목록에서 옵션을 사용으로 바꾸면 예약 물량을 넣을 수 있습니다.</p>}
    <p className="text-xs text-muted-foreground">상품을 저장하면 바로 적용됩니다. 저장한 뒤에는 예약 물량과 일정을 고칠 수 없고, 바꾸려면 접수를 중지하고 새로 저장합니다.</p>
    {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
  </div>;
}

/**
 * 예약판매 자리의 틀. 판매 시기에서 예약판매를 고르지 않았을 때도 같은 id의 빈 자리로 남아 오류 포커스·'예약판매로 이동' 링크가 닿고,
 * 안의 패널(저장된 상품)이 마운트된 채 예약 상태를 판매 시기에 알린다. 열고 닫을 때 같은 요소를 써서 안의 입력·불러온 값이 다시 만들어지지 않는다.
 */
function GoodPreorderSlotShell({ title, mode, open, children }: { title: string; mode?: string; open: boolean; children: ReactNode }) {
  return <section aria-labelledby={open ? 'good-operation-preorders-title' : undefined} className={open ? 'flex min-w-0 scroll-mt-24 flex-col gap-4 border-t pt-5 outline-none' : 'flex min-w-0 scroll-mt-24 flex-col gap-4 outline-none empty:-mt-4'}
    data-good-subsection={open ? '' : undefined} data-good-preorder-open={open ? 'true' : 'false'} id="good-operation-preorders" tabIndex={-1}>
    {open ? <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
      <h2 className="text-sm font-medium text-foreground" data-good-section-title="" id="good-operation-preorders-title">{title}</h2>
      {mode ? <span className="text-xs text-muted-foreground" data-good-operation-mode="">{mode}</span> : null}
    </div> : null}
    {children}
  </section>;
}

/**
 * 등록 화면의 예약판매 자리(판매 시기 안). 상품과 함께 저장하는 입력이고, 저장된 상품은 같은 자리(같은 id)의 예약판매 패널이 별도 저장으로 이어 받는다.
 * 판매 시기 밖(시험)에서는 예약 입력이 있을 때 열린다.
 */
export function GoodWorkspacePreorderRow({ title, serverError, disabled = false }: { title: string; serverError?: string; disabled?: boolean }) {
  const workspace = useGoodWorkspaceSections();
  const timing = useGoodSaleTiming();
  const open = Boolean(workspace?.sections.preorderPlan) && (!timing || timing.mode === 'preorder');
  const error = workspace?.sectionErrors.workspacePreorders ?? serverError;
  return <GoodPreorderSlotShell title={title} open={open}>
    {open ? <GoodWorkspacePreorderCard serverError={serverError} disabled={disabled} />
      /* 예약판매를 고르지 않았는데 예약 오류가 돌아왔으면(다른 창에서 바뀐 경우) 같은 자리에서 알린다. */
      : error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
  </GoodPreorderSlotShell>;
}
/* 판매 시기가 자리의 종류를 읽는 표식(GOOD_PREORDER_SLOT_KIND). */
GoodWorkspacePreorderRow.goodPreorderSlotKind = 'draft' satisfies GoodPreorderSlotKind;

/**
 * 저장된 상품의 예약판매 패널을 같은 자리에 둔다. 패널은 별도 저장이고, 입력은 기본 폼에 섞이지 않는다(GoodsPreordersPanel).
 * 판매 시기에서 예약판매를 고르지 않았으면 제목 없이 패널만 남는다(패널이 지난 예약 기록만 접어서 보이거나 아무것도 그리지 않는다).
 */
export function GoodSavedPreorderSection({ title, children }: { title: string; children: ReactNode }) {
  const timing = useGoodSaleTiming();
  return <GoodPreorderSlotShell title={title} mode="별도 저장" open={!timing || timing.mode === 'preorder'}>{children}</GoodPreorderSlotShell>;
}
GoodSavedPreorderSection.goodPreorderSlotKind = 'saved' satisfies GoodPreorderSlotKind;
