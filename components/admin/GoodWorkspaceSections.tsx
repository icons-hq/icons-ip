'use client';

import { GoodsKcDisclosure } from '@/components/shop/GoodsKcDisclosure';
import {
  MAX_GOODS_KC_MODELS, emptyGoodsKcModel, goodsKcReviewProblems, goodsKcSoleNotApplicable, publicGoodsKcDisclosures, type GoodsKcModelInput,
} from '@/lib/admin/goods-kc';
import { goodWorkspaceKcVariants, type GoodWorkspacePreorderDraft } from '@/lib/admin/good-workspace-sections';
import { goodsOptionRowKey } from '@/lib/admin/goods-option-editor';
import { ModelFields, ProductNotApplicable } from './GoodsKcPanel';
import { GoodOperationSection, GoodWorkspaceDetails, useGoodWorkspaceSections } from './GoodWorkspace';
import { GOOD_INPUT_CLASS, GOOD_NOTE_CLASS, GOOD_NUMBER_INPUT_CLASS, GOOD_TEXTAREA_CLASS } from './GoodEditorParts';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';

/*
 * 등록 화면의 원자 저장 섹션(10/27 회의 R13·D6②). 입력은 GoodWorkspaceProvider(폼 키 밖)에 두고,
 * 기본 상품 폼이 저장할 때 hidden JSON 하나로 함께 보낸다. 이 카드들은 <form>도 name도 갖지 않아, 고시 카드 안에 놓여도 폼 제출·자동복구·임시저장에 실리지 않는다.
 * 저장 뒤에는 같은 자리(같은 id)의 독립 KC·예약판매 패널이 저장값을 읽어 이어서 관리한다.
 */

export const GOOD_WORKSPACE_KC_ATTESTATION = '원본 근거와 실제 모델·사업자·대상 옵션이 일치하고, 해당 제도의 필수 사항을 확인했습니다.';

export function GoodWorkspaceKcCard({ serverError, disabled = false }: { serverError?: string; disabled?: boolean }) {
  const workspace = useGoodWorkspaceSections();
  if (!workspace) return null;
  const { sections, setSections, optionRows, sectionErrors } = workspace;
  const { models, attested, productNotApplicable = false } = sections.kc;
  const variants = goodWorkspaceKcVariants(optionRows);
  /* 해당 없음을 체크하면 거기서 끝나 보이게 모델 칸을 그리지 않는다. 연결 옵션은 제출할 때 현재 옵션으로 다시 맞춘다. */
  const notApplicable = productNotApplicable && attested && goodsKcSoleNotApplicable(models);
  const problems = !notApplicable && models.length ? goodsKcReviewProblems(models, variants) : [];
  const change = (next: GoodsKcModelInput[], nextAttested = false) => setSections((current) => ({ ...current, kc: { models: next, attested: nextAttested } }));
  const status = notApplicable ? 'KC 해당 없음 · 저장하면 검토 완료로 함께 저장됩니다.'
    : !models.length ? 'KC 미입력 · 저장 뒤에도 이 자리의 KC 정보에서 검토할 수 있습니다.'
    : attested ? '저장하면 KC 검토 완료로 함께 저장됩니다.' : '저장하면 KC 미검토로 함께 저장됩니다. 검토 완료는 아래 확인을 체크하세요.';
  const error = sectionErrors.workspaceKc ?? serverError;
  return <div className="flex min-w-0 flex-col gap-4 text-sm" data-good-workspace-kc="">
    <p className="font-medium" role="status">{status}</p>
    <ProductNotApplicable checkOnly checked={notApplicable} variants={variants} models={models} disabled={disabled}
      onNoteChange={(publicNote) => setSections((current) => ({ ...current, kc: { ...current.kc, models: [{ ...current.kc.models[0], publicNote }] } }))}
      onComplete={(next) => setSections((current) => ({ ...current, kc: { models: next, attested: true, productNotApplicable: true } }))} onClear={() => change([])} />
    {notApplicable ? null : <GoodWorkspaceDetails stateId="good-kc-models" className="min-w-0 rounded-lg border" data-good-kc-models="" forceOpen={models.length > 0}>
      <summary className="cursor-pointer rounded-lg px-3 py-2.5 text-sm font-medium outline-none select-none marker:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50">KC 대상 상품이면 모델·옵션별로 입력</summary>
      <div className="flex min-w-0 flex-col gap-4 border-t p-3">
        <p className="text-sm text-muted-foreground">적용 옵션은 위 옵션목록의 현재 옵션입니다. 검토 완료는 확인 체크가 있을 때만 저장합니다.</p>
        {models.map((model, index) => <ModelFields key={index} model={model} index={index} variants={variants} disabled={disabled}
          onChange={(next) => change(models.map((item, position) => position === index ? next : item))}
          onRemove={() => change(models.filter((_, position) => position !== index))} />)}
        <div><button type="button" className={buttonVariants({ variant: 'outline' })} data-slot="button" disabled={disabled || models.length >= MAX_GOODS_KC_MODELS}
          onClick={() => change([...models, emptyGoodsKcModel()])}>KC 모델 추가</button></div>
        {problems.length > 0 && <div className={GOOD_NOTE_CLASS}><strong className="font-medium">검토 완료 전 확인</strong><ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-muted-foreground">{problems.map((problem, index) => <li key={index}>{problem}</li>)}</ul></div>}
        {models.length > 0 && problems.length === 0 && <GoodsKcDisclosure title="고객 고시 미리보기" disclosures={publicGoodsKcDisclosures(models, variants)} />}
        {models.length > 0 && <label className="flex items-start gap-2 text-sm">
          <input className="mt-0.5" type="checkbox" checked={attested} disabled={disabled || problems.length > 0}
            onChange={(event) => setSections((current) => ({ ...current, kc: { ...current.kc, attested: event.target.checked } }))} />
          <span>{GOOD_WORKSPACE_KC_ATTESTATION}</span>
        </label>}
      </div>
    </GoodWorkspaceDetails>}
    {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
    <small className="text-xs text-muted-foreground">KC 내부 근거 참조는 브라우저 자동복구·임시저장에 담지 않습니다. 화면을 닫기 전에 저장해주세요.</small>
  </div>;
}

const PREORDER_LABEL_CLASS = 'flex min-w-0 flex-col gap-2 text-sm font-medium text-foreground';

let draftSequence = 0;
function emptyPreorder(optionKey: string): GoodWorkspacePreorderDraft {
  draftSequence += 1;
  return { key: `preorder-${draftSequence}`, optionKey, state: 'draft', capacityQty: '', startsAt: '', endsAt: '', expectedShipDate: '', approvalReference: '' };
}

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
  return <div className="flex min-w-0 flex-col gap-4 text-sm" data-good-workspace-preorders="">
    <p className="text-sm text-muted-foreground">승인된 미래 공급 물량을 옵션별로 입력합니다. 초안은 판매에 반영되지 않고, 활성화한 옵션은 승인 물량으로 판매합니다.
      예약판매 옵션은 일반 판매기간과 함께 쓸 수 없습니다.</p>
    {!entries.length && <p className="text-sm text-muted-foreground">입력한 예약 조건이 없습니다. 필요 없으면 비워 두세요.</p>}
    {entries.map((entry, index) => <fieldset key={entry.key} className="m-0 flex min-w-0 flex-col gap-3 rounded-lg border p-4" disabled={disabled}>
      <legend className="float-left w-full p-0 text-sm font-medium">예약 조건 {index + 1}</legend>
      <div className="flex min-w-0 flex-col gap-2">
        <label className={PREORDER_LABEL_CLASS} htmlFor={`${entry.key}-option`}>예약 대상 옵션</label>
        <NativeSelect className="w-full" id={`${entry.key}-option`} value={entry.optionKey} onChange={(event) => update(entry.key, { optionKey: event.target.value })}>
          {options.some((option) => option.key === entry.optionKey) ? null : <option value={entry.optionKey} disabled>옵션을 다시 선택해주세요</option>}
          {options.map((option) => <option key={option.key} value={option.key} disabled={option.key !== entry.optionKey && entries.some((other) => other.optionKey === option.key)}>{option.label}</option>)}
        </NativeSelect>
      </div>
      <div className="grid min-w-0 gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,10.5rem),1fr))]">
        <label className={PREORDER_LABEL_CLASS}>승인 예약 물량<input className={GOOD_NUMBER_INPUT_CLASS} data-slot="input" type="number" min={1} max={2147483647} step={1} inputMode="numeric" value={entry.capacityQty} placeholder="미설정"
          onChange={(event) => update(entry.key, { capacityQty: event.target.value })} /></label>
        <label className={PREORDER_LABEL_CLASS}>접수 시작 (한국 시간)<input className={GOOD_INPUT_CLASS} data-slot="input" type="datetime-local" value={entry.startsAt} onChange={(event) => update(entry.key, { startsAt: event.target.value })} /></label>
        <label className={PREORDER_LABEL_CLASS}>접수 종료 (한국 시간)<input className={GOOD_INPUT_CLASS} data-slot="input" type="datetime-local" value={entry.endsAt} onChange={(event) => update(entry.key, { endsAt: event.target.value })} /></label>
        <label className={PREORDER_LABEL_CLASS}>발송 예정일<input className={GOOD_INPUT_CLASS} data-slot="input" type="date" value={entry.expectedShipDate} min={entry.endsAt.slice(0, 10) || undefined} onChange={(event) => update(entry.key, { expectedShipDate: event.target.value })} /></label>
      </div>
      <label className={PREORDER_LABEL_CLASS}>승인 문서·확인 근거
        <textarea className={GOOD_TEXTAREA_CLASS} data-slot="textarea" value={entry.approvalReference} maxLength={2000} rows={3} placeholder="승인된 공급 물량과 일정을 확인할 수 있는 문서 번호 또는 자료 위치"
          onChange={(event) => update(entry.key, { approvalReference: event.target.value })} />
      </label>
      <div className="flex min-w-0 flex-col gap-2">
        <label className={PREORDER_LABEL_CLASS} htmlFor={`${entry.key}-state`}>저장 방식</label>
        <NativeSelect className="w-full sm:w-fit" id={`${entry.key}-state`} value={entry.state} onChange={(event) => update(entry.key, { state: event.target.value === 'active' ? 'active' : 'draft' })}>
          <option value="draft">초안 저장</option>
          {canActivate && <option value="active">승인 조건으로 예약 활성화</option>}
        </NativeSelect>
      </div>
      {!canActivate && <p className="text-xs text-muted-foreground">예약 활성화는 관리자가 저장된 초안과 승인 근거를 확인한 뒤 진행합니다.</p>}
      <div><button type="button" className={buttonVariants({ variant: 'outline', size: 'sm' })} data-slot="button" onClick={() => setSections((current) => ({ ...current, preorders: current.preorders.filter((item) => item.key !== entry.key) }))}>이 예약 조건 빼기</button></div>
    </fieldset>)}
    <div><button type="button" className={buttonVariants({ variant: 'outline' })} data-slot="button" disabled={disabled || !free}
      onClick={() => free && setSections((current) => ({ ...current, preorders: [...current.preorders, emptyPreorder(free.key)] }))}>예약 조건 추가</button></div>
    {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
  </div>;
}

/** 등록 화면의 예약판매 접힌 줄. 조건을 넣기 전에는 접어 두고, 입력이 있으면 펼친 채로 저장 뒤까지 이어 보인다. */
export function GoodWorkspacePreorderRow({ title, canActivate, serverError, disabled = false }: { title: string; canActivate: boolean; serverError?: string; disabled?: boolean }) {
  const workspace = useGoodWorkspaceSections();
  const filled = Boolean(workspace?.sections.preorders.length || workspace?.sectionErrors.workspacePreorders || serverError);
  return <GoodOperationSection id="preorders" title={title} mode="inline" defaultOpen={filled}>
    <GoodWorkspacePreorderCard canActivate={canActivate} serverError={serverError} disabled={disabled} />
  </GoodOperationSection>;
}
