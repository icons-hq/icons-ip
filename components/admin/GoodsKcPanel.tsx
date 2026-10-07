'use client';

import { useEffect, useState, useTransition } from 'react';
import type { GoodsKcTemplateRequest } from './useGoodsKcTemplate';
import { readGoodsKcAction, saveGoodsKcAction } from '@/app/admin/goods-kc-actions';
import { GoodsKcDisclosure } from '@/components/shop/GoodsKcDisclosure';
import {
  GOODS_KC_EVIDENCE_LABELS, MAX_GOODS_KC_MODELS, emptyGoodsKcModel, goodsKcReviewProblems, planGoodsKcProductNotApplicable,
  goodsKcProductNotApplicableNote, goodsKcSoleNotApplicable, publicGoodsKcDisclosures, kcModelFromTemplate,
  type AdminGoodsKc, type GoodsKcModelInput, type GoodsKcVariant,
} from '@/lib/admin/goods-kc';
import {
  GOODS_KC_BUSINESS_LABELS, GOODS_KC_FAMILY_LABELS, GOODS_KC_SCHEME_LABELS, goodsKcNeedsIdentifier, goodsKcSchemeAllowed,
  type GoodsKcFamily, type GoodsKcScheme,
} from '@/lib/goods-kc';

function ModelFields({ model, index, variants, disabled, onChange, onRemove }: {
  model: GoodsKcModelInput; index: number; variants: readonly GoodsKcVariant[]; disabled: boolean;
  onChange: (model: GoodsKcModelInput) => void; onRemove: () => void;
}) {
  const label = `모델 ${index + 1}`;
  // 해당 없음은 제품군·제도·적용 옵션만 필수다. 나머지 칸은 보이는 라벨과 접근 가능한 이름 모두에 선택으로 표시한다.
  const hint = model.scheme === 'not_applicable' ? ' (선택)' : '';
  function field(key: 'productCategory' | 'modelName' | 'businessName' | 'identifier', title: string, limit = 200) {
    const optional = key === 'identifier' ? '' : hint;
    return <label>{title}{optional}<input aria-label={`${label} ${title}${optional}`} value={model[key]} maxLength={limit} disabled={disabled}
      onChange={(event) => onChange({ ...model, [key]: event.target.value })} /></label>;
  }
  const needsNumber = model.scheme && goodsKcNeedsIdentifier(model.scheme);
  return <fieldset className="wc-admin-kit col" disabled={disabled} style={{ gap: 14, padding: 16, border: '1px solid var(--line)', borderRadius: 8 }}>
    <legend>{label}{model.modelName ? ` · ${model.modelName}` : ''}</legend>
    <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12 }}>
      <label>제품군<select aria-label={`${label} 제품군`} value={model.family} onChange={(event) => {
        const family = event.target.value as GoodsKcModelInput['family'];
        onChange({ ...model, family, scheme: model.scheme && family && goodsKcSchemeAllowed(family, model.scheme) ? model.scheme : '' });
      }}><option value="">미선택</option>{Object.entries(GOODS_KC_FAMILY_LABELS).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
      <label>적용 제도<select aria-label={`${label} 적용 제도`} value={model.scheme} onChange={(event) => onChange({ ...model, scheme: event.target.value as GoodsKcModelInput['scheme'] })}>
        <option value="">미선택</option>{Object.entries(GOODS_KC_SCHEME_LABELS).filter(([value]) => model.family && goodsKcSchemeAllowed(model.family, value as GoodsKcScheme))
          .map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
      {field('productCategory', '품목 분류')}{field('modelName', '모델명')}
      <label>사업자 구분{hint}<select aria-label={`${label} 사업자 구분${hint}`} value={model.businessRole} onChange={(event) => onChange({ ...model, businessRole: event.target.value as GoodsKcModelInput['businessRole'] })}>
        <option value="">미선택</option>{Object.entries(GOODS_KC_BUSINESS_LABELS).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
      {field('businessName', '사업자명')}
      {(needsNumber || model.identifier) ? field('identifier', model.scheme === 'safety_certification' ? '안전인증번호' : '인증·신고번호', 100) : null}
    </div>
    {model.scheme && !needsNumber && <p className="muted">이 제도에는 공통 인증·신고번호를 요구하지 않습니다. 실제 원본 자료는 아래 근거 참조에 연결해주세요.</p>}
    <fieldset style={{ border: 0, padding: 0, margin: 0 }}><legend>적용 옵션</legend>
      <div className="col" style={{ gap: 6 }}>{variants.map((variant) => <label key={variant.id} className="row" style={{ gap: 8 }}>
        <input type="checkbox" checked={model.variantIds.includes(variant.id)} aria-label={`${label} 적용 옵션 ${variant.name}`}
          onChange={(event) => onChange({ ...model, variantIds: event.target.checked ? [...model.variantIds, variant.id] : model.variantIds.filter((id) => id !== variant.id) })} />
        <span>{variant.name} <small className="muted">{variant.code}{variant.active ? '' : ' · 사용 중지'}</small></span>
      </label>)}{model.variantIds.filter((id) => !variants.some((variant) => variant.id === id)).map((id) => <label key={id} className="row" style={{ gap: 8 }}>
        <input type="checkbox" checked aria-label={`${label} 삭제된 옵션 연결 해제`} onChange={() => onChange({ ...model, variantIds: model.variantIds.filter((value) => value !== id) })} />
        <span>삭제된 옵션 · 연결을 해제하고 다시 선택해주세요. <small>{id}</small></span>
      </label>)}</div>
    </fieldset>
    <label>고객 안내{hint}<textarea aria-label={`${label} 고객 안내${hint}`} rows={2} maxLength={1000} value={model.publicNote}
      onChange={(event) => onChange({ ...model, publicNote: event.target.value })} /></label>
    <details open><summary>내부 검토 근거{hint} · 고객에게 공개되지 않습니다</summary>
      <div className="col" style={{ gap: 12, marginTop: 12 }}>
        <label>적용 판단 사유<textarea aria-label={`${label} 적용 판단 사유`} rows={3} maxLength={2000} value={model.basis}
          onChange={(event) => onChange({ ...model, basis: event.target.value })} /></label>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12 }}>
          {Object.entries(GOODS_KC_EVIDENCE_LABELS).map(([key, text]) => <label key={key}>{text}
            <input aria-label={`${label} ${text}`} value={model.evidence[key as keyof GoodsKcModelInput['evidence']]} maxLength={500}
              onChange={(event) => onChange({ ...model, evidence: { ...model.evidence, [key]: event.target.value } })} />
          </label>)}
        </div>
        <small className="muted">실제 원본 자료를 찾을 수 있는 사내 문서번호나 접근 제한 문서 주소를 입력하세요. 이 입력으로 인증을 발급하거나 원본의 진위를 자동 확인하지 않습니다.</small>
      </div>
    </details>
    <button type="button" className="btn btn-ghost" onClick={onRemove}>이 모델 입력 제거</button>
  </fieldset>;
}

export const GOODS_KC_NOT_APPLICABLE_ATTESTATION = '이 상품은 KC 안전인증·안전확인·공급자적합성확인·안전기준준수 대상이 아님을 확인했습니다.';

/** "상품 전체 KC 해당 없음": one confirmation and one action replace the model
 * list with a single not-applicable model covering every active option, then
 * save it as reviewed through the same attested save contract. */
function ProductNotApplicable({ variants, models, disabled, onNoteChange, onComplete }: {
  variants: readonly GoodsKcVariant[]; models: readonly GoodsKcModelInput[]; disabled: boolean;
  onNoteChange: (publicNote: string) => void; onComplete: (models: GoodsKcModelInput[]) => void;
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
  return <fieldset className="col" disabled={disabled} style={{ gap: 10, padding: 16, border: '1px solid var(--line)', borderRadius: 8 }}>
    <legend>상품 전체 KC 해당 없음</legend>
    <p className="muted" style={{ margin: 0 }}>{active.length
      ? `KC 대상이 아닌 상품은 확인 체크 후 바로 검토를 끝낼 수 있습니다. 사용 중인 옵션 ${active.length}개가 모두 연결되고, 모델·사업자·판단 근거는 입력하지 않아도 됩니다.`
      : '사용 중인 옵션이 없습니다. 옵션을 저장한 뒤 해당 없음으로 검토를 완료할 수 있습니다.'}</p>
    <label className="row" style={{ gap: 8, alignItems: 'flex-start' }}><input type="checkbox" checked={confirmed} disabled={!active.length}
      onChange={(event) => setConfirmed(event.target.checked)} /><span>{GOODS_KC_NOT_APPLICABLE_ATTESTATION}</span></label>
    <details><summary>고객 안내 추가 (선택)</summary>
      <textarea aria-label="해당 없음 고객 안내" rows={2} maxLength={1000} value={note} style={{ marginTop: 8, width: '100%' }}
        onChange={(event) => (sole ? onNoteChange : setDraftNote)(event.target.value)} />
    </details>
    <div><button type="button" className="btn" disabled={!active.length || !confirmed} onClick={complete}>해당 없음으로 검토 완료</button></div>
  </fieldset>;
}

export function GoodsKcEditor({ goodId, configuration, onSaved, templateRequest, onTemplateApplied }: {
  goodId: string; configuration: AdminGoodsKc; onSaved: (configuration: AdminGoodsKc, message: string) => void;
  templateRequest?:GoodsKcTemplateRequest|null;onTemplateApplied?:(id:string)=>void;
}) {
  const [models, setModels] = useState(configuration.models);
  const [attested, setAttested] = useState(false);
  const [templateFamily, setTemplateFamily] = useState<GoodsKcFamily>('living');
  const [templateScheme, setTemplateScheme] = useState<GoodsKcScheme>('safety_certification');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
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
    <p className="muted" style={{ margin: 0 }}>KC 대상 상품은 아래에서 모델별로 제도·번호·근거를 입력합니다.</p>
    {models.map((model, index) => <ModelFields key={index} model={model} index={index} variants={configuration.variants} disabled={pending || readOnly}
      onChange={(next) => change(models.map((item, position) => position === index ? next : item))}
      onRemove={() => change(models.filter((_, position) => position !== index))} />)}
    {!readOnly && <div className="col" style={{ gap: 10 }}>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label>KC 유형 틀<select aria-label="추가할 KC 제품군" value={templateFamily} disabled={pending} onChange={(event) => {
          const family = event.target.value as GoodsKcFamily;
          setTemplateFamily(family); if (!goodsKcSchemeAllowed(family, templateScheme)) setTemplateScheme('not_applicable');
        }}>{Object.entries(GOODS_KC_FAMILY_LABELS).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
        <label>제도<select aria-label="추가할 KC 제도" value={templateScheme} disabled={pending} onChange={(event) => setTemplateScheme(event.target.value as GoodsKcScheme)}>
          {Object.entries(GOODS_KC_SCHEME_LABELS).filter(([value]) => goodsKcSchemeAllowed(templateFamily, value as GoodsKcScheme))
            .map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
        <button type="button" className="btn btn-ghost" disabled={pending || models.length >= MAX_GOODS_KC_MODELS}
          onClick={() => change([...models, { ...emptyGoodsKcModel(), family: templateFamily, scheme: templateScheme }])}>유형 틀로 모델 추가</button>
      </div>
      <small className="muted">유형 틀은 제품군·제도만 채웁니다. 모델·옵션·번호·사업자·증빙은 새로 입력하며, 기존 고시 프리셋의 7개 항목은 그대로 유지합니다.</small>
    </div>}
    {problems.length > 0 && !readOnly && <div><strong>검토 완료 전 확인</strong><ul>{problems.map((problem, index) => <li key={index}>{problem}</li>)}</ul></div>}
    {models.length > 0 && problems.length === 0 && <GoodsKcDisclosure title="고객 고시 미리보기" disclosures={publicGoodsKcDisclosures(models, configuration.variants)} />}
    {!readOnly && <>
      <label className="row" style={{ gap: 8, alignItems: 'flex-start' }}><input type="checkbox" checked={attested} disabled={pending || problems.length > 0}
        onChange={(event) => setAttested(event.target.checked)} />
        <span>원본 근거와 실제 모델·사업자·대상 옵션이 일치하고, 해당 제도의 필수 사항을 확인했습니다.</span>
      </label>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => save('unreviewed')}>{pending ? '저장 중…' : '미검토로 저장'}</button>
        <button type="button" className="btn" disabled={pending || !attested || problems.length > 0} onClick={() => save('reviewed')}>KC 검토 완료</button>
      </div>
    </>}
  </>;
  return <div className="col" style={{ gap: 16 }}>
    <p role="status">{dirty?'KC 미검토 초안 · 미저장':configuration.status === 'reviewed' ? notApplicableReviewed ? '상품 전체 KC 해당 없음으로 검토 완료' : 'KC 검토 완료' : configuration.publishedAt ? '기존 공개 · KC 미기록' : 'KC 미검토'}
      {!dirty && configuration.reviewedAt ? ` · ${configuration.reviewerName ?? '운영자'} · ${new Date(configuration.reviewedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}` : ''}</p>
    {readOnly && <p className="muted">{configuration.archivedAt ? '보관된 상품은 복원한 뒤 검토할 수 있습니다.' : 'KC 정보를 수정하려면 먼저 상품을 비공개로 전환해주세요.'}</p>}
    {notApplicableReviewed ? <>
      <p className="muted" style={{ margin: 0 }}>사용 중인 옵션 {linked}개가 모두 해당 없음으로 연결되어 있습니다. 확인 체크를 다시 누르지 않아도 됩니다.
        {readOnly ? ' 모델 상세는 아래에서 확인할 수 있습니다.' : ' 고객 안내를 고치거나 KC 대상으로 바꾸려면 아래 모델 상세를 펼쳐주세요.'}
        {configuration.models[0].publicNote ? ` 고객 안내: ${configuration.models[0].publicNote}` : ''}</p>
      <details open={dirty || undefined}><summary>모델 상세 보기·고치기</summary>
        <div className="col" style={{ gap: 16, marginTop: 12 }}>{modelDetails}</div>
      </details>
    </> : <>
      <ProductNotApplicable variants={configuration.variants} models={models} disabled={pending || readOnly}
        onNoteChange={(publicNote) => change([{ ...models[0], publicNote }])} onComplete={completeNotApplicable} />
      {modelDetails}
    </>}
    {error && <p role="alert">{error}</p>}
    <details><summary>최근 검토 이력</summary>{configuration.history.length ? <ol>
      {configuration.history.map((entry) => <li key={entry.revision}>버전 {entry.revision} · {entry.status === 'reviewed' ? '검토 완료' : '미검토'}
        {' · '}{new Date(entry.changedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} · {entry.actorName ?? '시스템'}
        {entry.reason === 'goods_context_changed' || entry.reason === 'variant_context_changed' ? ' · 상품·옵션 변경으로 재검토 필요' : ''}
      </li>)}</ol> : <p className="muted">저장된 검토 이력이 없습니다.</p>}</details>
  </div>;
}

/** Independent domain editor. Mount outside the main goods form, after the
 * goods draft and its actual option identifiers have been saved. */
export function GoodsKcPanel({ goodId,templateRequest,onTemplateApplied,refreshKey=0 }: {
  goodId: string;templateRequest?:GoodsKcTemplateRequest|null;onTemplateApplied?:(id:string)=>void;
  /** 기본 상품 저장 회차. 상품·옵션 저장이 KC 검토를 무효화할 수 있어 바뀔 때마다 서버 상태를 다시 읽는다. */
  refreshKey?: number;
}) {
  const [loaded, setLoaded] = useState<{ goodId: string; configuration?: AdminGoodsKc; error?: string } | null>(null);
  const [notice, setNotice] = useState<{ goodId: string; message: string } | null>(null);
  const [refresh, setRefresh] = useState(0);
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
  return <section className="card col wc-admin-kit" aria-labelledby={`kc-review-${goodId}`} style={{ padding: 18, gap: 16 }}>
    <div><h2 id={`kc-review-${goodId}`} style={{ margin: 0, fontSize: 18 }}>KC 정보</h2>
      <p className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>KC 대상이 아니면 상품 전체 KC 해당 없음으로 바로 검토를 끝내고, KC 대상이면 모델·옵션별로 제도와 근거를 입력합니다.
        신규 공개와 비공개 후 재공개에는 검토 완료가 필요하며, 기존 공개 미기록 상품은 자동 승인하거나 중지하지 않습니다.</p>
    </div>
    {notice?.goodId === goodId && <p role="status">{notice.message}</p>}
    {!visible ? <p role="status">KC 검토를 불러오는 중입니다…</p> : visible.error ? <p role="alert">{visible.error}</p>
      : visible.configuration ? <GoodsKcEditor key={`${goodId}:${visible.configuration.revision}:${refresh}`} goodId={goodId} configuration={visible.configuration} templateRequest={templateRequest} onTemplateApplied={onTemplateApplied}
        onSaved={(configuration, message) => { setLoaded({ goodId, configuration }); setNotice({ goodId, message }); }} /> : null}
    <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => { setLoaded(null); setRefresh((value) => value + 1); }}>저장된 KC 정보 다시 불러오기</button>
    <small className="muted">저장 실패 시 현재 입력은 유지됩니다. 내부 증빙 참조는 브라우저 자동복구 저장소에 보관하지 않으므로, 작업을 중단하기 전에 미검토로 저장해주세요.</small>
  </section>;
}
