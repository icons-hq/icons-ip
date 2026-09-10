'use client';

import { useEffect, useState, useTransition } from 'react';
import { readGoodsKcAction, saveGoodsKcAction } from '@/app/admin/goods-kc-actions';
import { GoodsKcDisclosure } from '@/components/shop/GoodsKcDisclosure';
import {
  GOODS_KC_EVIDENCE_LABELS, MAX_GOODS_KC_MODELS, emptyGoodsKcModel, goodsKcReviewProblems, publicGoodsKcDisclosures,
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
  function field(key: 'productCategory' | 'modelName' | 'businessName' | 'identifier', title: string, limit = 200) {
    return <label>{title}<input aria-label={`${label} ${title}`} value={model[key]} maxLength={limit} disabled={disabled}
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
      <label>사업자 구분<select aria-label={`${label} 사업자 구분`} value={model.businessRole} onChange={(event) => onChange({ ...model, businessRole: event.target.value as GoodsKcModelInput['businessRole'] })}>
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
    <label>고객 안내<textarea aria-label={`${label} 고객 안내`} rows={2} maxLength={1000} value={model.publicNote}
      onChange={(event) => onChange({ ...model, publicNote: event.target.value })} /></label>
    <details open><summary>내부 검토 근거 · 고객에게 공개되지 않습니다</summary>
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

export function GoodsKcEditor({ goodId, configuration, onSaved }: {
  goodId: string; configuration: AdminGoodsKc; onSaved: (configuration: AdminGoodsKc, message: string) => void;
}) {
  const [models, setModels] = useState(configuration.models);
  const [attested, setAttested] = useState(false);
  const [templateFamily, setTemplateFamily] = useState<GoodsKcFamily>('living');
  const [templateScheme, setTemplateScheme] = useState<GoodsKcScheme>('safety_certification');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const readOnly = Boolean(configuration.publishedAt || configuration.archivedAt);
  const problems = goodsKcReviewProblems(models, configuration.variants);
  function change(next: GoodsKcModelInput[]) { setModels(next); setAttested(false); }
  function save(status: 'unreviewed' | 'reviewed') {
    setError(null);
    startTransition(async () => {
      try {
        const result = await saveGoodsKcAction(goodId, { models, status, expectedRevision: configuration.revision,
          expectedContextFingerprint: configuration.contextFingerprint, attested: status === 'reviewed' && attested });
        if (result.ok) onSaved(result.configuration, result.message); else setError(result.error);
      } catch { setError('KC 정보를 저장하지 못했습니다. 입력은 유지되므로 다시 시도해주세요.'); }
    });
  }
  return <div className="col" style={{ gap: 16 }}>
    <p role="status">{configuration.status === 'reviewed' ? 'KC 검토 완료' : configuration.publishedAt ? '기존 공개 · KC 미기록' : 'KC 미검토'}
      {configuration.reviewedAt ? ` · ${configuration.reviewerName ?? '운영자'} · ${new Date(configuration.reviewedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}` : ''}</p>
    {readOnly && <p className="muted">{configuration.archivedAt ? '보관된 상품은 복원한 뒤 검토할 수 있습니다.' : 'KC 정보를 수정하려면 먼저 상품을 비공개로 전환해주세요.'}</p>}
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
export function GoodsKcPanel({ goodId }: { goodId: string }) {
  const [loaded, setLoaded] = useState<{ goodId: string; configuration?: AdminGoodsKc; error?: string } | null>(null);
  const [notice, setNotice] = useState<{ goodId: string; message: string } | null>(null);
  const [refresh, setRefresh] = useState(0);
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
  }, [goodId, refresh]);
  const visible = loaded?.goodId === goodId ? loaded : null;
  return <section className="card col wc-admin-kit" aria-labelledby={`kc-review-${goodId}`} style={{ padding: 18, borderRadius: 10, gap: 16 }}>
    <div><h2 id={`kc-review-${goodId}`} style={{ margin: 0, fontSize: 18 }}>KC 정보 · 모델별 검토</h2>
      <p className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>실제 상품의 적용 제도와 근거를 모델·옵션별로 확인합니다. 미검토와 근거가 있는 해당 없음은 다릅니다.
        신규 공개와 비공개 후 재공개에는 검토 완료가 필요하며, 기존 공개 미기록 상품은 자동 승인하거나 중지하지 않습니다.</p>
    </div>
    {notice?.goodId === goodId && <p role="status">{notice.message}</p>}
    {!visible ? <p role="status">KC 검토를 불러오는 중입니다…</p> : visible.error ? <p role="alert">{visible.error}</p>
      : visible.configuration ? <GoodsKcEditor key={`${goodId}:${visible.configuration.revision}:${refresh}`} goodId={goodId} configuration={visible.configuration}
        onSaved={(configuration, message) => { setLoaded({ goodId, configuration }); setNotice({ goodId, message }); }} /> : null}
    <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => { setLoaded(null); setRefresh((value) => value + 1); }}>저장된 KC 정보 다시 불러오기</button>
    <small className="muted">저장 실패 시 현재 입력은 유지됩니다. 내부 증빙 참조는 브라우저 자동복구 저장소에 보관하지 않으므로, 작업을 중단하기 전에 미검토로 저장해주세요.</small>
  </section>;
}
