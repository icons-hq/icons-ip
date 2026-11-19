'use client';

import type { ReactNode } from 'react';
import { GoodsKcDisclosure } from '@/components/shop/GoodsKcDisclosure';
import {
  MAX_GOODS_KC_MODELS, emptyGoodsKcModel, goodsKcChoice, goodsKcReviewProblems, goodsKcSoleNotApplicable, goodsKcSubjectModel,
  goodsKcProductNotApplicableConfirm, planGoodsKcProductNotApplicable, publicGoodsKcDisclosures, type GoodsKcChoice, type GoodsKcModelInput,
} from '@/lib/admin/goods-kc';
import { goodWorkspaceKcVariants, goodWorkspacePreorderCapacity, type GoodWorkspaceKcDraft, type GoodWorkspacePreorderDraft } from '@/lib/admin/good-workspace-sections';
import { PreorderCapacityStockHint } from './PreorderCapacityStockHint';
import { goodsOptionRowKey } from '@/lib/admin/goods-option-editor';
import {
  GOODS_KC_SUBJECT_ATTESTATION, GOODS_KC_SUBJECT_GUIDE, GOODS_OTHER_CERTIFICATIONS_GUIDE, GoodsKcSubjectChoice, GoodsOtherCertificationsFields,
  ModelFields, ProductNotApplicable,
} from './GoodsKcPanel';
import { GOOD_DETACHED_FORM_ID, GoodEditorSubsection, useGoodWorkspaceSections } from './GoodWorkspace';
import { GOOD_INPUT_CLASS, GOOD_NOTE_CLASS, GOOD_NUMBER_INPUT_CLASS, GOOD_TEXTAREA_CLASS } from './GoodEditorParts';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { adminConfirm } from '@/lib/admin/confirm';
import { PREORDER_STAFF_DRAFT_NOTE, preorderApplyProblems, type PreorderApplyProblems } from '@/lib/admin/goods-preorders';

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

const PREORDER_LABEL_CLASS = 'flex min-w-0 flex-col gap-2 text-sm font-medium text-foreground';
const PREORDER_HINT_CLASS = 'text-xs font-normal text-muted-foreground';
const PREORDER_CELL_CLASS = 'flex min-w-0 flex-col gap-1.5';

let draftSequence = 0;
/** 새 예약 조건. 적용 권한이 있으면 '판매에 적용'이 기본이다(2026-11-19 사고 — 예전 기본값 '초안'으로 저장한 예약이 판매에 반영되지 않았다). */
export function emptyGoodWorkspacePreorder(optionKey: string, canActivate: boolean): GoodWorkspacePreorderDraft {
  draftSequence += 1;
  return { key: `preorder-${draftSequence}`, optionKey, state: canActivate ? 'active' : 'draft', capacityQty: '', capacityFromStock: true, startsAt: '', endsAt: '', expectedShipDate: '', approvalReference: '' };
}

/*
 * 등록 화면의 예약 조건 입력. 판매 정보 카드(기본 폼 안)에 놓이지만 입력은 이름 없이 provider에 있고, 소속 폼을 떼어(GOOD_DETACHED_FORM_ID)
 * 기본 폼의 브라우저 검증·Enter 제출에 섞이지 않는다. 검증은 저장할 때 prepareGoodWorkspaceSections가 한 번에 한다.
 * '판매에 적용'으로 둔 조건은 상품을 저장하면 바로 예약판매로 적용된다. 저장이 막히면(섹션 오류) 적용에 필요한 칸 옆에 이유를 보인다.
 */
export function GoodWorkspacePreorderCard({ canActivate, serverError, disabled = false }: { canActivate: boolean; serverError?: string; disabled?: boolean }) {
  const workspace = useGoodWorkspaceSections();
  if (!workspace) return null;
  const { sections, setSections, optionRows, sectionErrors } = workspace;
  const entries = sections.preorders;
  const options = optionRows.map((row, index) => ({ key: goodsOptionRowKey(row), label: `${row.name.trim() || `옵션 ${index + 1}`}${row.isActive === false ? ' (사용 중지)' : ''}` }));
  const update = (key: string, changes: Partial<GoodWorkspacePreorderDraft>) =>
    setSections((current) => ({ ...current, preorders: current.preorders.map((entry) => entry.key === key ? { ...entry, ...changes } : entry) }));
  const free = options.find((option) => !entries.some((entry) => entry.optionKey === option.key));
  const error = sectionErrors.workspacePreorders ?? serverError;
  const form = GOOD_DETACHED_FORM_ID;
  return <div className="flex min-w-0 flex-col gap-4 text-sm" data-good-workspace-preorders="">
    <p className="text-sm text-muted-foreground">승인된 미래 공급 물량을 옵션별로 입력합니다. {canActivate
      ? "'판매에 적용'으로 둔 조건은 상품을 저장하면 바로 예약판매로 적용되고, '임시저장'은 판매에 반영되지 않습니다."
      : PREORDER_STAFF_DRAFT_NOTE} 예약판매 옵션은 일반 판매기간과 함께 쓸 수 없습니다.</p>
    {!entries.length && <p className="text-sm text-muted-foreground">입력한 예약 조건이 없습니다. 필요 없으면 비워 두세요.</p>}
    {entries.map((entry, index) => {
      /* 저장을 시도해 섹션 오류가 났을 때만 칸별 안내를 보인다. 칸을 고치면 다음 그리기에서 바로 사라진다. */
      const apply = entry.state === 'active';
      /* 승인 예약 물량은 기본으로 대상 옵션의 재고수량을 따라간다(재고수량을 나중에 넣거나 바꿔도 따라간다). 직접 고치면 그 값을 쓴다. */
      const stockQty = optionRows.find((row) => goodsOptionRowKey(row) === entry.optionKey)?.stockQty;
      const capacityQty = goodWorkspacePreorderCapacity(entry, optionRows);
      const problems: PreorderApplyProblems = apply && error ? preorderApplyProblems({ ...entry, capacityQty }) : {};
      const problemId = (field: keyof PreorderApplyProblems) => `${entry.key}-${field}-problem`;
      const invalid = (field: keyof PreorderApplyProblems) => problems[field] ? { 'aria-invalid': true, 'aria-describedby': problemId(field) } as const : {};
      const hint = (field: keyof PreorderApplyProblems) => problems[field]
        ? <span className="text-xs font-medium text-destructive" data-preorder-field-problem="" id={problemId(field)}>{problems[field]}</span> : null;
      const required = apply ? <span className={PREORDER_HINT_CLASS}> · 적용 필수</span> : null;
      return <fieldset key={entry.key} className="m-0 flex min-w-0 flex-col gap-3 rounded-lg border p-4" disabled={disabled} data-preorder-state={entry.state}>
        <legend className="float-left w-full p-0 text-sm font-medium">예약 조건 {index + 1}</legend>
        <div className="flex min-w-0 flex-col gap-2">
          <label className={PREORDER_LABEL_CLASS} htmlFor={`${entry.key}-option`}>예약 대상 옵션</label>
          <NativeSelect className="w-full" form={form} id={`${entry.key}-option`} value={entry.optionKey} onChange={(event) => update(entry.key, { optionKey: event.target.value })}>
            {options.some((option) => option.key === entry.optionKey) ? null : <option value={entry.optionKey} disabled>옵션을 다시 선택해주세요</option>}
            {options.map((option) => <option key={option.key} value={option.key} disabled={option.key !== entry.optionKey && entries.some((other) => other.optionKey === option.key)}>{option.label}</option>)}
          </NativeSelect>
        </div>
        {canActivate ? <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0" data-preorder-mode="">
          <legend className="mb-2 p-0 text-sm font-medium text-foreground">상품을 저장할 때</legend>
          <label className="flex items-start gap-2 font-normal"><input className="mt-0.5" form={form} type="radio" name={`${entry.key}-mode`} value="active" checked={apply} onChange={() => update(entry.key, { state: 'active' })} />
            <span><span className="font-medium">판매에 적용</span><span className="text-muted-foreground"> — 바로 예약판매로 적용합니다. 아래 적용 필수 칸을 모두 채워야 저장됩니다.</span></span></label>
          <label className="flex items-start gap-2 font-normal"><input className="mt-0.5" form={form} type="radio" name={`${entry.key}-mode`} value="draft" checked={!apply} onChange={() => update(entry.key, { state: 'draft' })} />
            <span><span className="font-medium">임시저장</span><span className="text-muted-foreground"> — 판매에 반영하지 않고 조건만 보관합니다. 나중에 상품 편집에서 [예약판매 적용]을 눌러야 판매됩니다.</span></span></label>
        </fieldset> : <p className="text-xs text-muted-foreground" data-preorder-draft-note="">{PREORDER_STAFF_DRAFT_NOTE}</p>}
        <div className="grid min-w-0 gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,10.5rem),1fr))]">
          <div className={PREORDER_CELL_CLASS}><label className={PREORDER_LABEL_CLASS}><span>승인 예약 물량{required}</span><input className={GOOD_NUMBER_INPUT_CLASS} data-slot="input" form={form} type="number" min={1} max={2147483647} step={1} inputMode="numeric" value={capacityQty} placeholder="미설정"
            onChange={(event) => update(entry.key, { capacityQty: event.target.value, capacityFromStock: false })} {...invalid('capacityQty')} /></label>{hint('capacityQty')}
            <PreorderCapacityStockHint fromStock={entry.capacityFromStock === true} capacity={capacityQty} stockQty={Number.isFinite(stockQty) ? stockQty : 0} disabled={disabled}
              onUseStock={() => update(entry.key, { capacityFromStock: true })} /></div>
          <div className={PREORDER_CELL_CLASS}><label className={PREORDER_LABEL_CLASS}><span>접수 시작 (KST){required}</span><input className={GOOD_INPUT_CLASS} data-slot="input" form={form} type="datetime-local" value={entry.startsAt} onChange={(event) => update(entry.key, { startsAt: event.target.value })} {...invalid('startsAt')} /></label>{hint('startsAt')}</div>
          <div className={PREORDER_CELL_CLASS}><label className={PREORDER_LABEL_CLASS}><span>접수 종료 (KST){required}</span><input className={GOOD_INPUT_CLASS} data-slot="input" form={form} type="datetime-local" value={entry.endsAt} onChange={(event) => update(entry.key, { endsAt: event.target.value })} {...invalid('endsAt')} /></label>{hint('endsAt')}</div>
          <div className={PREORDER_CELL_CLASS}><label className={PREORDER_LABEL_CLASS}><span>발송 예정일{required}</span><input className={GOOD_INPUT_CLASS} data-slot="input" form={form} type="date" value={entry.expectedShipDate} min={entry.endsAt.slice(0, 10) || undefined} onChange={(event) => update(entry.key, { expectedShipDate: event.target.value })} {...invalid('expectedShipDate')} /></label>{hint('expectedShipDate')}</div>
        </div>
        <div className={PREORDER_CELL_CLASS}><label className={PREORDER_LABEL_CLASS}><span>승인 문서·확인 근거{required}</span>
          <textarea className={GOOD_TEXTAREA_CLASS} data-slot="textarea" form={form} value={entry.approvalReference} maxLength={2000} rows={3} placeholder="승인된 공급 물량과 일정을 확인할 수 있는 문서 번호 또는 자료 위치"
            onChange={(event) => update(entry.key, { approvalReference: event.target.value })} {...invalid('approvalReference')} /></label>{hint('approvalReference')}</div>
        <div><button type="button" className={buttonVariants({ variant: 'outline', size: 'sm' })} data-slot="button" form={form} onClick={() => setSections((current) => ({ ...current, preorders: current.preorders.filter((item) => item.key !== entry.key) }))}>이 예약 조건 빼기</button></div>
      </fieldset>;
    })}
    <div><button type="button" className={buttonVariants({ variant: 'outline' })} data-slot="button" form={form} disabled={disabled || !free}
      onClick={() => free && setSections((current) => ({ ...current, preorders: [...current.preorders, emptyGoodWorkspacePreorder(free.key, canActivate)] }))}>예약 조건 추가</button></div>
    {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
  </div>;
}

/** 등록 화면 예약판매 줄의 요약. 적용·임시저장 개수를 나눠 보인다. */
export function goodWorkspacePreorderSummary(entries: readonly Pick<GoodWorkspacePreorderDraft, 'state'>[]): string {
  if (!entries.length) return '설정안함';
  const apply = entries.filter((entry) => entry.state === 'active').length, draft = entries.length - apply;
  return [apply ? `판매에 적용 ${apply}개` : '', draft ? `임시저장 ${draft}개(판매 미반영)` : ''].filter(Boolean).join(' · ');
}

/**
 * 판매 정보 카드의 예약판매(11/11 1027T-023 결정 "펼친 채로" — 판매기간 바로 뒤). 등록 화면은 상품과 함께 저장하는 입력이고,
 * 저장된 상품은 같은 자리(같은 id)의 예약판매 패널이 별도 저장으로 이어 받는다.
 */
export function GoodWorkspacePreorderRow({ title, canActivate, serverError, disabled = false }: { title: string; canActivate: boolean; serverError?: string; disabled?: boolean }) {
  const workspace = useGoodWorkspaceSections();
  return <GoodEditorSubsection id="good-operation-preorders" title={title} mode="상품과 함께 저장" summary={goodWorkspacePreorderSummary(workspace?.sections.preorders ?? [])}>
    <GoodWorkspacePreorderCard canActivate={canActivate} serverError={serverError} disabled={disabled} />
  </GoodEditorSubsection>;
}

/** 저장된 상품의 예약판매 패널을 같은 자리에 둔다. 패널은 별도 저장이고, 입력은 기본 폼에 섞이지 않는다(GoodsPreordersPanel). */
export function GoodSavedPreorderSection({ title, children }: { title: string; children: ReactNode }) {
  return <GoodEditorSubsection id="good-operation-preorders" title={title} mode="별도 저장">{children}</GoodEditorSubsection>;
}
