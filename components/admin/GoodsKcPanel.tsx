'use client';

import { useCallback, useEffect, useId, useState, useTransition } from 'react';
import type { GoodsKcTemplateRequest } from './useGoodsKcTemplate';
import { readGoodsKcAction, saveGoodsKcAction } from '@/app/admin/goods-kc-actions';
import { GoodsKcDisclosure } from '@/components/shop/GoodsKcDisclosure';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { Label } from '@/components/admin/kit/ui/label';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import {
  GOODS_KC_EVIDENCE_LABELS, MAX_GOODS_KC_MODELS, emptyGoodsKcModel, goodsKcReviewProblems, planGoodsKcProductNotApplicable,
  goodsKcEditorRefresh, goodsKcProductNotApplicableNote, goodsKcSoleNotApplicable, publicGoodsKcDisclosures, kcModelFromTemplate,
  type AdminGoodsKc, type GoodsKcModelInput, type GoodsKcVariant,
} from '@/lib/admin/goods-kc';
import {
  GOODS_KC_BUSINESS_LABELS, GOODS_KC_FAMILY_LABELS, GOODS_KC_SCHEME_LABELS, goodsKcNeedsIdentifier, goodsKcSchemeAllowed,
  type GoodsKcFamily, type GoodsKcScheme,
} from '@/lib/goods-kc';
import { GOOD_INPUT_CLASS, GOOD_NOTE_CLASS, GOOD_SUBPANEL_CLASS, GOOD_TEXTAREA_CLASS } from './GoodEditorParts';
import { useGoodWorkspaceSections, type GoodsKcPanelStash } from './GoodWorkspace';

/* 템플릿 룩(ADR-0028). 입력 라벨 글자만 굵게 하고 입력값은 보통 굵기로 둔다(라벨이 입력을 감싼다). */
const FIELD_CLASS = 'flex min-w-0 flex-col gap-2 text-sm';
const FIELD_GRID_CLASS = 'grid min-w-0 gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,11rem),1fr))]';
/* 패널 안 접는 묶음. 요약 글자 바로 뒤를 시험이 대조하므로 표시는 네이티브 펼침 표식을 쓴다. */
const DETAILS_CLASS = 'min-w-0 rounded-lg border';
const SUMMARY_CLASS = 'cursor-pointer rounded-lg px-3 py-2.5 text-sm font-medium outline-none select-none marker:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50';
const DETAILS_BODY_CLASS = 'flex min-w-0 flex-col gap-3 border-t px-3 py-3';
const CHECK_LABEL_CLASS = 'flex items-start gap-2 text-sm';

export function ModelFields({ model, index, variants, disabled, onChange, onRemove }: {
  model: GoodsKcModelInput; index: number; variants: readonly GoodsKcVariant[]; disabled: boolean;
  onChange: (model: GoodsKcModelInput) => void; onRemove: () => void;
}) {
  const label = `모델 ${index + 1}`;
  const id = useId();
  // 해당 없음은 제품군·제도·적용 옵션만 필수다. 나머지 칸은 보이는 라벨과 접근 가능한 이름 모두에 선택으로 표시한다.
  const hint = model.scheme === 'not_applicable' ? ' (선택)' : '';
  function field(key: 'productCategory' | 'modelName' | 'businessName' | 'identifier', title: string, limit = 200) {
    const optional = key === 'identifier' ? '' : hint;
    return <label className={FIELD_CLASS}><span className="font-medium">{title}{optional}</span><input className={GOOD_INPUT_CLASS} data-slot="input" aria-label={`${label} ${title}${optional}`} value={model[key]} maxLength={limit} disabled={disabled}
      onChange={(event) => onChange({ ...model, [key]: event.target.value })} /></label>;
  }
  const needsNumber = model.scheme && goodsKcNeedsIdentifier(model.scheme);
  const evidenceValues = [model.basis, ...Object.keys(GOODS_KC_EVIDENCE_LABELS).map((key) => model.evidence[key as keyof GoodsKcModelInput['evidence']])];
  const evidenceTotal = evidenceValues.length, evidenceFilled = evidenceValues.filter((value) => value?.trim()).length;
  return <fieldset className="m-0 flex min-w-0 flex-col gap-4 rounded-lg border p-4" data-kc-model="" disabled={disabled}>
    <legend className="float-left w-full p-0 text-sm font-medium">{label}{model.modelName ? ` · ${model.modelName}` : ''}</legend>
    <div className={FIELD_GRID_CLASS}>
      <div className={FIELD_CLASS}><Label htmlFor={`${id}-family`}>제품군</Label><NativeSelect className="w-full" id={`${id}-family`} aria-label={`${label} 제품군`} value={model.family} onChange={(event) => {
        const family = event.target.value as GoodsKcModelInput['family'];
        onChange({ ...model, family, scheme: model.scheme && family && goodsKcSchemeAllowed(family, model.scheme) ? model.scheme : '' });
      }}><option value="">미선택</option>{Object.entries(GOODS_KC_FAMILY_LABELS).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</NativeSelect></div>
      <div className={FIELD_CLASS}><Label htmlFor={`${id}-scheme`}>적용 제도</Label><NativeSelect className="w-full" id={`${id}-scheme`} aria-label={`${label} 적용 제도`} value={model.scheme} onChange={(event) => onChange({ ...model, scheme: event.target.value as GoodsKcModelInput['scheme'] })}>
        <option value="">미선택</option>{Object.entries(GOODS_KC_SCHEME_LABELS).filter(([value]) => model.family && goodsKcSchemeAllowed(model.family, value as GoodsKcScheme))
          .map(([value, text]) => <option key={value} value={value}>{text}</option>)}</NativeSelect></div>
      {field('productCategory', '품목 분류')}{field('modelName', '모델명')}
      <div className={FIELD_CLASS}><Label htmlFor={`${id}-business`}>사업자 구분{hint}</Label><NativeSelect className="w-full" id={`${id}-business`} aria-label={`${label} 사업자 구분${hint}`} value={model.businessRole} onChange={(event) => onChange({ ...model, businessRole: event.target.value as GoodsKcModelInput['businessRole'] })}>
        <option value="">미선택</option>{Object.entries(GOODS_KC_BUSINESS_LABELS).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</NativeSelect></div>
      {field('businessName', '사업자명')}
      {(needsNumber || model.identifier) ? field('identifier', model.scheme === 'safety_certification' ? '안전인증번호' : '인증·신고번호', 100) : null}
    </div>
    {model.scheme && !needsNumber && <p className="text-sm text-muted-foreground">이 제도에는 공통 인증·신고번호를 요구하지 않습니다. 실제 원본 자료는 아래 근거 참조에 연결해주세요.</p>}
    <fieldset className="m-0 min-w-0 border-0 p-0"><legend className="float-left mb-2 w-full p-0 text-sm font-medium">적용 옵션</legend>
      <div className="clear-both flex flex-col gap-1.5">{variants.map((variant) => <label key={variant.id} className={CHECK_LABEL_CLASS}>
        <input className="mt-0.5" type="checkbox" checked={model.variantIds.includes(variant.id)} aria-label={`${label} 적용 옵션 ${variant.name}`}
          onChange={(event) => onChange({ ...model, variantIds: event.target.checked ? [...model.variantIds, variant.id] : model.variantIds.filter((id) => id !== variant.id) })} />
        <span className="min-w-0 wrap-anywhere">{variant.name} <small className="text-xs text-muted-foreground">{variant.code}{variant.active ? '' : ' · 사용 중지'}</small></span>
      </label>)}{model.variantIds.filter((id) => !variants.some((variant) => variant.id === id)).map((id) => <label key={id} className={CHECK_LABEL_CLASS}>
        <input className="mt-0.5" type="checkbox" checked aria-label={`${label} 삭제된 옵션 연결 해제`} onChange={() => onChange({ ...model, variantIds: model.variantIds.filter((value) => value !== id) })} />
        <span className="min-w-0 text-[var(--wc-warning)] wrap-anywhere">삭제된 옵션 · 연결을 해제하고 다시 선택해주세요. <small className="text-xs text-muted-foreground">{id}</small></span>
      </label>)}</div>
    </fieldset>
    <label className={FIELD_CLASS}><span className="font-medium">고객 안내{hint}</span><textarea className={GOOD_TEXTAREA_CLASS} data-slot="textarea" aria-label={`${label} 고객 안내${hint}`} rows={2} maxLength={1000} value={model.publicNote}
      onChange={(event) => onChange({ ...model, publicNote: event.target.value })} /></label>
    {/* ADM-004(복잡도 표 335행): 고객에게 보이지 않는 내부 근거는 기본으로 접고, 몇 칸을 채웠는지만 요약에 보인다. 빠진 근거는 아래 '검토 완료 전 확인'이 알린다. */}
    <details className={DETAILS_CLASS} data-kc-evidence=""><summary className={SUMMARY_CLASS}>{`내부 검토 근거${hint} · 고객에게 공개되지 않습니다 · ${evidenceFilled}/${evidenceTotal}칸 입력`}</summary>
      <div className={DETAILS_BODY_CLASS}>
        <label className={FIELD_CLASS}><span className="font-medium">적용 판단 사유</span><textarea className={GOOD_TEXTAREA_CLASS} data-slot="textarea" aria-label={`${label} 적용 판단 사유`} rows={3} maxLength={2000} value={model.basis}
          onChange={(event) => onChange({ ...model, basis: event.target.value })} /></label>
        <div className="grid min-w-0 gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,13.5rem),1fr))]">
          {Object.entries(GOODS_KC_EVIDENCE_LABELS).map(([key, text]) => <label key={key} className={FIELD_CLASS}><span className="font-medium">{text}</span>
            <input className={GOOD_INPUT_CLASS} data-slot="input" aria-label={`${label} ${text}`} value={model.evidence[key as keyof GoodsKcModelInput['evidence']]} maxLength={500}
              onChange={(event) => onChange({ ...model, evidence: { ...model.evidence, [key]: event.target.value } })} />
          </label>)}
        </div>
        <small className="text-xs text-muted-foreground">실제 원본 자료를 찾을 수 있는 사내 문서번호나 접근 제한 문서 주소를 입력하세요. 이 입력으로 인증을 발급하거나 원본의 진위를 자동 확인하지 않습니다.</small>
      </div>
    </details>
    <button type="button" className={`${buttonVariants({ variant: 'outline', size: 'sm' })} self-start`} data-slot="button" onClick={onRemove}>이 모델 입력 제거</button>
  </fieldset>;
}

export const GOODS_KC_NOT_APPLICABLE_ATTESTATION = '이 상품은 KC 안전인증·안전확인·공급자적합성확인·안전기준준수 대상이 아님을 확인했습니다.';

/** "상품 전체 KC 해당 없음": one confirmation replaces the model list with a single
 * not-applicable model covering every active option. On a saved product the button
 * saves it as reviewed through the same attested save contract. On the create screen
 * nothing is saved yet, so the checkbox alone sets that state (`checkOnly`) and the
 * save button carries it; the option list is re-linked at submit. */
export function ProductNotApplicable({ variants, models, disabled, onNoteChange, onComplete, checkOnly = false, checked = false, onClear }: {
  variants: readonly GoodsKcVariant[]; models: readonly GoodsKcModelInput[]; disabled: boolean;
  onNoteChange: (publicNote: string) => void; onComplete: (models: GoodsKcModelInput[]) => void;
  /** 등록 화면: 저장 전이라 체크 하나로 해당 없음 상태를 만든다. 버튼이 없다. */
  checkOnly?: boolean;
  checked?: boolean;
  onClear?: () => void;
}) {
  const active = variants.filter((variant) => variant.active);
  const [confirmed, setConfirmed] = useState(false);
  // 해당 없음 모델 1개가 이미 있으면 이 칸은 그 모델의 고객 안내를 그대로 보여주고 고친다.
  // 따로 들고 있으면 아래 모델 칸에서 고친 안내가 접힌 칸의 이전 값으로 덮인다.
  const [draftNote, setDraftNote] = useState('');
  const sole = goodsKcSoleNotApplicable(models);
  const note = goodsKcProductNotApplicableNote(models, draftNote);
  function complete() {
    const plan = planGoodsKcProductNotApplicable(models, variants, draftNote);
    if (plan.discarded && !window.confirm(`입력한 KC 모델 ${plan.discarded}개를 지우고 상품 전체 해당 없음으로 검토를 완료합니다. 계속할까요?`)) return;
    onComplete(plan.models);
  }
  /* legend 문구 바로 앞을 시험이 대조한다 — legend 모양은 fieldset의 자식 선택 유틸리티로 입힌다. */
  return <fieldset className="m-0 flex min-w-0 flex-col gap-3 rounded-lg border bg-muted/30 p-4 [&>legend]:float-left [&>legend]:w-full [&>legend]:p-0 [&>legend]:text-sm [&>legend]:font-medium [&>legend]:text-foreground" disabled={disabled} data-kc-not-applicable="">
    <legend>상품 전체 KC 해당 없음</legend>
    <p className="text-sm text-muted-foreground">{!active.length ? '사용 중인 옵션이 없습니다. 옵션을 저장한 뒤 해당 없음으로 검토를 완료할 수 있습니다.'
      : checkOnly ? (checked ? `사용 중인 옵션 ${active.length}개가 모두 연결됩니다. 저장하기를 누르면 해당 없음으로 검토 완료됩니다. 더 입력할 것은 없습니다.` : 'KC 대상이 아닌 상품은 확인 체크 하나로 끝납니다. 모델·사업자·판단 근거는 입력하지 않아도 됩니다.')
      : `KC 대상이 아닌 상품은 확인 체크 후 바로 검토를 끝낼 수 있습니다. 사용 중인 옵션 ${active.length}개가 모두 연결되고, 모델·사업자·판단 근거는 입력하지 않아도 됩니다.`}</p>
    <label className={CHECK_LABEL_CLASS}><input className="mt-0.5" type="checkbox" checked={checkOnly ? checked : confirmed} disabled={!active.length && !(checkOnly && checked)}
      onChange={(event) => { if (!checkOnly) setConfirmed(event.target.checked); else if (event.target.checked) complete(); else onClear?.(); }} /><span>{GOODS_KC_NOT_APPLICABLE_ATTESTATION}</span></label>
    <details className={`${DETAILS_CLASS} bg-background`}><summary className={SUMMARY_CLASS}>고객 안내 추가 (선택)</summary>
      <div className={DETAILS_BODY_CLASS}>
        <textarea className={GOOD_TEXTAREA_CLASS} data-slot="textarea" aria-label="해당 없음 고객 안내" rows={2} maxLength={1000} value={note}
          onChange={(event) => (sole ? onNoteChange : setDraftNote)(event.target.value)} />
      </div>
    </details>
    {checkOnly ? null : <div><button type="button" className={buttonVariants()} data-slot="button" disabled={!active.length || !confirmed} onClick={complete}>해당 없음으로 검토 완료</button></div>}
  </fieldset>;
}

export function GoodsKcEditor({ goodId, configuration, onSaved, templateRequest, onTemplateApplied, initialDraft = null, onDraftChange }: {
  goodId: string; configuration: AdminGoodsKc; onSaved: (configuration: AdminGoodsKc, message: string) => void;
  templateRequest?:GoodsKcTemplateRequest|null;onTemplateApplied?:(id:string)=>void;
  /** 다시 마운트돼도 이어 쓸 입력(패널이 고시 카드 안에 있어 기본 저장 때 함께 다시 마운트된다). */
  initialDraft?: { models: GoodsKcModelInput[]; attested: boolean } | null;
  onDraftChange?: (draft: { models: GoodsKcModelInput[]; attested: boolean }) => void;
}) {
  const [models, setModels] = useState(initialDraft?.models ?? configuration.models);
  const [attested, setAttested] = useState(initialDraft?.attested ?? false);
  // 기본 상품 저장이 KC 버전을 올려도 편집기를 다시 마운트하지 않는다. 입력 중인 모델은 지키고
  // 새 버전(기대 revision·맥락 지문)만 받아, 다시 저장할 때 충돌하지 않게 한다.
  const [seenConfiguration, setSeenConfiguration] = useState(configuration);
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null);
  if (seenConfiguration !== configuration) {
    const refreshed = goodsKcEditorRefresh(seenConfiguration, configuration, models);
    setSeenConfiguration(configuration);
    setModels(refreshed.models);
    if (configuration.revision !== seenConfiguration.revision || configuration.contextFingerprint !== seenConfiguration.contextFingerprint) setAttested(false);
    setRefreshNotice(refreshed.keptUnsavedInput
      ? '기본 상품 저장으로 KC 검토가 다시 열렸습니다. 입력 중인 KC 내용은 그대로 두었으니 확인 체크 후 다시 저장해주세요.'
      : refreshed.reopened ? '기본 상품 저장으로 상품·옵션 정보가 바뀌어 KC 검토가 다시 필요합니다.' : null);
  }
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [templateFamily, setTemplateFamily] = useState<GoodsKcFamily>('living');
  const [templateScheme, setTemplateScheme] = useState<GoodsKcScheme>('safety_certification');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const templateId = useId();
  const readOnly = Boolean(configuration.publishedAt || configuration.archivedAt);
  const [appliedTemplate,setAppliedTemplate]=useState<string|null>(null);
  if (templateRequest && !pending && appliedTemplate!==templateRequest.id) {
    setAppliedTemplate(templateRequest.id);
    const model=kcModelFromTemplate(templateRequest.template.family,templateRequest.template.scheme,templateRequest.template.publicNote);
    if (readOnly) setError('KC 유형 틀은 비공개 상품의 미검토 모델에 적용할 수 있습니다.');
    else if (!model || models.length>=MAX_GOODS_KC_MODELS) setError('KC 모델의 최대 개수와 유형 틀을 확인해주세요.');
    else {setModels([...models,model]);setAttested(false);setError(null);}
  }
  useEffect(()=>{if(appliedTemplate) onTemplateApplied?.(appliedTemplate);},[appliedTemplate,onTemplateApplied]);
  const dirty=JSON.stringify(models)!==JSON.stringify(configuration.models);
  useEffect(()=>{onDraftChange?.({models,attested});},[models,attested,onDraftChange]);
  // 해당 없음 완료 요약의 모델 상세는 사용자가 연 상태를 유지한다. 미저장 입력이 생기면 열기만 하고 닫지는 않는다.
  const [wasDirty, setWasDirty] = useState(false);
  if (wasDirty !== dirty) { setWasDirty(dirty); if (dirty) setDetailsOpen(true); }
  const problems = goodsKcReviewProblems(models, configuration.variants);
  function change(next: GoodsKcModelInput[]) { setModels(next); setAttested(false); }
  function persist(nextModels: GoodsKcModelInput[], status: 'unreviewed' | 'reviewed', attestedValue: boolean) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await saveGoodsKcAction(goodId, { models: nextModels, status, expectedRevision: configuration.revision,
          expectedContextFingerprint: configuration.contextFingerprint, attested: status === 'reviewed' && attestedValue });
        if (result.ok) onSaved(result.configuration, result.message); else setError(result.error);
      } catch { setError('KC 정보를 저장하지 못했습니다. 입력은 유지되므로 다시 시도해주세요.'); }
    });
  }
  function save(status: 'unreviewed' | 'reviewed') { persist(models, status, attested); }
  function completeNotApplicable(next: GoodsKcModelInput[]) { change(next); persist(next, 'reviewed', true); }
  // 저장된 검토가 상품 전체 해당 없음 1개로 완료됐으면 결과를 위에 요약하고 모델 상세는 접는다.
  // 저장값으로만 판단해 입력 중에 화면 구조가 바뀌지 않게 하고, 미저장 입력이 생기면 펼친다.
  const notApplicableReviewed = configuration.status === 'reviewed' && goodsKcSoleNotApplicable(configuration.models);
  const linked = configuration.variants.filter((variant) => variant.active).length;
  const modelDetails = <>
    <p className="text-sm text-muted-foreground">KC 대상 상품은 아래에서 모델별로 제도·번호·근거를 입력합니다.</p>
    {models.map((model, index) => <ModelFields key={index} model={model} index={index} variants={configuration.variants} disabled={pending || readOnly}
      onChange={(next) => change(models.map((item, position) => position === index ? next : item))}
      onRemove={() => change(models.filter((_, position) => position !== index))} />)}
    {!readOnly && <div className="flex min-w-0 flex-col gap-2" data-kc-template="">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-0 flex-col gap-2"><Label htmlFor={`${templateId}-family`}>KC 유형 틀</Label><NativeSelect className="w-full sm:w-44" id={`${templateId}-family`} aria-label="추가할 KC 제품군" value={templateFamily} disabled={pending} onChange={(event) => {
          const family = event.target.value as GoodsKcFamily;
          setTemplateFamily(family); if (!goodsKcSchemeAllowed(family, templateScheme)) setTemplateScheme('not_applicable');
        }}>{Object.entries(GOODS_KC_FAMILY_LABELS).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</NativeSelect></div>
        <div className="flex min-w-0 flex-col gap-2"><Label htmlFor={`${templateId}-scheme`}>제도</Label><NativeSelect className="w-full sm:w-52" id={`${templateId}-scheme`} aria-label="추가할 KC 제도" value={templateScheme} disabled={pending} onChange={(event) => setTemplateScheme(event.target.value as GoodsKcScheme)}>
          {Object.entries(GOODS_KC_SCHEME_LABELS).filter(([value]) => goodsKcSchemeAllowed(templateFamily, value as GoodsKcScheme))
            .map(([value, text]) => <option key={value} value={value}>{text}</option>)}</NativeSelect></div>
        <button type="button" className={buttonVariants({ variant: 'outline' })} data-slot="button" disabled={pending || models.length >= MAX_GOODS_KC_MODELS}
          onClick={() => change([...models, { ...emptyGoodsKcModel(), family: templateFamily, scheme: templateScheme }])}>유형 틀로 모델 추가</button>
      </div>
      <small className="text-xs text-muted-foreground">유형 틀은 제품군·제도만 채웁니다. 모델·옵션·번호·사업자·증빙은 새로 입력하며, 기존 고시 프리셋의 7개 항목은 그대로 유지합니다.</small>
    </div>}
    {problems.length > 0 && !readOnly && <div className={GOOD_NOTE_CLASS}><strong className="font-medium">검토 완료 전 확인</strong><ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-muted-foreground">{problems.map((problem, index) => <li key={index}>{problem}</li>)}</ul></div>}
    {models.length > 0 && problems.length === 0 && <GoodsKcDisclosure title="고객 고시 미리보기" disclosures={publicGoodsKcDisclosures(models, configuration.variants)} />}
    {!readOnly && <>
      <label className={CHECK_LABEL_CLASS}><input className="mt-0.5" type="checkbox" checked={attested} disabled={pending || problems.length > 0}
        onChange={(event) => setAttested(event.target.checked)} />
        <span>원본 근거와 실제 모델·사업자·대상 옵션이 일치하고, 해당 제도의 필수 사항을 확인했습니다.</span>
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonVariants({ variant: 'outline' })} data-slot="button" disabled={pending} onClick={() => save('unreviewed')}>{pending ? '저장 중…' : '미검토로 저장'}</button>
        <button type="button" className={buttonVariants()} data-slot="button" disabled={pending || !attested || problems.length > 0} onClick={() => save('reviewed')}>KC 검토 완료</button>
      </div>
    </>}
  </>;
  /* 첫 상태 문단은 시험이 속성 없이 대조한다 — 굵기는 부모의 자식 선택 유틸리티로 준다. */
  return <div className="flex min-w-0 flex-col gap-4 text-sm [&>p[role=status]:first-child]:font-medium" data-kc-editor="">
    <p role="status">{dirty?'KC 미검토 초안 · 미저장':configuration.status === 'reviewed' ? notApplicableReviewed ? '상품 전체 KC 해당 없음으로 검토 완료' : 'KC 검토 완료' : configuration.publishedAt ? '기존 공개 · KC 미기록' : 'KC 미검토'}
      {!dirty && configuration.reviewedAt ? ` · ${configuration.reviewerName ?? '운영자'} · ${new Date(configuration.reviewedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}` : ''}</p>
    {refreshNotice && <p className={GOOD_NOTE_CLASS} role="status">{refreshNotice}</p>}
    {readOnly && <p className="text-sm text-muted-foreground">{configuration.archivedAt ? '보관된 상품은 복원한 뒤 검토할 수 있습니다.' : 'KC 정보를 수정하려면 먼저 상품을 비공개로 전환해주세요.'}</p>}
    {notApplicableReviewed ? <>
      <p className="text-sm text-muted-foreground">사용 중인 옵션 {linked}개가 모두 해당 없음으로 연결되어 있습니다. 확인 체크를 다시 누르지 않아도 됩니다.
        {readOnly ? ' 모델 상세는 아래에서 확인할 수 있습니다.' : ' 고객 안내를 고치거나 KC 대상으로 바꾸려면 아래 모델 상세를 펼쳐주세요.'}
        {configuration.models[0].publicNote ? ` 고객 안내: ${configuration.models[0].publicNote}` : ''}</p>
      <details className={DETAILS_CLASS} data-kc-model-details="" open={detailsOpen} onToggle={(event) => setDetailsOpen(event.currentTarget.open)}><summary className={SUMMARY_CLASS}>모델 상세 보기·고치기</summary>
        <div className="flex min-w-0 flex-col gap-4 border-t p-3">{modelDetails}</div>
      </details>
    </> : <>
      <ProductNotApplicable variants={configuration.variants} models={models} disabled={pending || readOnly}
        onNoteChange={(publicNote) => change([{ ...models[0], publicNote }])} onComplete={completeNotApplicable} />
      {modelDetails}
    </>}
    {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    <details className={DETAILS_CLASS}><summary className={SUMMARY_CLASS}>최근 검토 이력</summary><div className={DETAILS_BODY_CLASS}>{configuration.history.length ? <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm">
      {configuration.history.map((entry) => <li key={entry.revision}>버전 {entry.revision} · {entry.status === 'reviewed' ? '검토 완료' : '미검토'}
        {' · '}{new Date(entry.changedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} · {entry.actorName ?? '시스템'}
        {entry.reason === 'goods_context_changed' || entry.reason === 'variant_context_changed' ? ' · 상품·옵션 변경으로 재검토 필요' : ''}
      </li>)}</ol> : <p className="text-sm text-muted-foreground">저장된 검토 이력이 없습니다.</p>}</div></details>
  </div>;
}

/** Independent domain editor for a saved product. It has no form of its own and no
 * named inputs, so inside the goods form it never reaches the goods submission; the
 * caller keeps Enter from submitting that form. */
export function GoodsKcPanel({ goodId,templateRequest,onTemplateApplied,refreshKey=0 }: {
  goodId: string;templateRequest?:GoodsKcTemplateRequest|null;onTemplateApplied?:(id:string)=>void;
  /** 기본 상품 저장 회차. 상품·옵션 저장이 KC 검토를 무효화할 수 있어 바뀔 때마다 서버 상태를 다시 읽는다. */
  refreshKey?: number;
}) {
  /* 고시 카드 안에 있어 기본 상품 저장 때 함께 다시 마운트된다. 불러온 설정과 입력 중인 KC는 폼 키 밖 provider에서 이어 받는다. */
  const workspace = useGoodWorkspaceSections();
  const readStash = workspace?.readKcPanelStash, rememberStash = workspace?.rememberKcPanel;
  const [resumed] = useState(() => readStash?.(goodId) ?? null);
  const [loaded, setLoaded] = useState<{ goodId: string; configuration?: AdminGoodsKc; error?: string } | null>(resumed?.configuration ? { goodId, configuration: resumed.configuration } : null);
  const [initialDraft] = useState(resumed?.draft ?? null);
  const remember = useCallback((changes: Partial<Omit<GoodsKcPanelStash, 'goodId'>>) => rememberStash?.(goodId, changes), [rememberStash, goodId]);
  const onDraftChange = useCallback((draft: NonNullable<GoodsKcPanelStash['draft']>) => remember({ draft }), [remember]);
  useEffect(() => { if (loaded?.goodId === goodId && loaded.configuration) remember({ configuration: loaded.configuration }); }, [loaded, goodId, remember]);
  const [notice, setNotice] = useState<{ goodId: string; message: string } | null>(null);
  const [refresh, setRefresh] = useState(0);
  // KC를 직접 저장하면 편집기를 새로 마운트해 저장된 모델로 시작한다. 기본 상품 저장으로 다시 읽을 때는
  // 마운트를 유지해 입력 중인 KC 내용을 지킨다(goodsKcEditorRefresh).
  const [savedEpoch, setSavedEpoch] = useState(0);
  const [seenRefreshKey, setSeenRefreshKey] = useState(refreshKey);
  // 다시 읽는 동안 이전 화면은 유지하되, 이전 KC 저장 안내는 새 상태와 어긋날 수 있어 지운다.
  if (seenRefreshKey !== refreshKey) { setSeenRefreshKey(refreshKey); setNotice(null); }
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    let canceled = false;
    startTransition(async () => {
      try {
        const result = await readGoodsKcAction(goodId);
        if (!canceled) setLoaded(result.ok ? { goodId, configuration: result.configuration } : { goodId, error: result.error });
      } catch { if (!canceled) setLoaded({ goodId, error: 'KC 검토를 불러오지 못했습니다.' }); }
    });
    return () => { canceled = true; };
  }, [goodId, refresh, refreshKey]);
  const visible = loaded?.goodId === goodId ? loaded : null;
  return <section className={`${GOOD_SUBPANEL_CLASS} text-sm`} aria-labelledby={`kc-review-${goodId}`} data-kc-panel="">
    <div className="flex flex-col gap-1"><h2 id={`kc-review-${goodId}`} className="text-base leading-snug font-medium">KC 정보</h2>
      <p className="text-sm text-muted-foreground">KC 대상이 아니면 상품 전체 KC 해당 없음으로 바로 검토를 끝내고, KC 대상이면 모델·옵션별로 제도와 근거를 입력합니다.
        신규 공개와 비공개 후 재공개에는 검토 완료가 필요하며, 기존 공개 미기록 상품은 자동 승인하거나 중지하지 않습니다.</p>
    </div>
    {notice?.goodId === goodId && <p className={`${GOOD_NOTE_CLASS} font-medium text-[var(--wc-success)]`} role="status">{notice.message}</p>}
    {!visible ? <p className="text-sm text-muted-foreground" role="status">KC 검토를 불러오는 중입니다…</p> : visible.error ? <p className="text-sm text-destructive" role="alert">{visible.error}</p>
      : visible.configuration ? <GoodsKcEditor key={`${goodId}:${refresh}:${savedEpoch}`} goodId={goodId} configuration={visible.configuration} templateRequest={templateRequest} onTemplateApplied={onTemplateApplied}
        initialDraft={refresh || savedEpoch ? null : initialDraft} onDraftChange={onDraftChange}
        onSaved={(configuration, message) => { remember({ draft: null }); setLoaded({ goodId, configuration }); setNotice({ goodId, message }); setSavedEpoch((value) => value + 1); }} /> : null}
    <button type="button" className={`${buttonVariants({ variant: 'outline' })} self-start`} data-slot="button" disabled={pending} onClick={() => { remember({ configuration: null, draft: null }); setLoaded(null); setRefresh((value) => value + 1); }}>저장된 KC 정보 다시 불러오기</button>
    <small className="text-xs text-muted-foreground">저장 실패 시 현재 입력은 유지됩니다. 내부 증빙 참조는 브라우저 자동복구 저장소에 보관하지 않으므로, 작업을 중단하기 전에 미검토로 저장해주세요.</small>
  </section>;
}
