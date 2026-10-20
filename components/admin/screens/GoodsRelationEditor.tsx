'use client';
/* eslint-disable @next/next/no-img-element -- Stored catalog previews keep the original aspect ratio. */
import Link from 'next/link';
import { useEffect, useState, useTransition, type FormEvent } from 'react';
import { saveGoodsRelationAction } from '@/app/admin/goods-relation-actions';
import { GOODS_RELATIONS_PATH, GOODS_RELATION_KINDS, goodsRelationDraft, relationDefaultTitle, relationLimit, type GoodsRelationDraft, type GoodsRelationGood, type GoodsRelationKind, type GoodsRelationValues } from '@/lib/admin/goods-relations';
import { relationVisualDraft } from '@/lib/good-relation-visual';
import { publicMediaUrl } from '@/lib/media';
import { AdminPageHeader } from '../console/AdminKit';
import { GoodsRelationProductPicker } from './GoodsRelationProductPicker';
import { CustomerServiceDialog } from './CustomerServiceDialog';
import { GoodsRelationVisualEditor } from '../GoodsRelationVisualEditor';
import { RelationImageMap } from '@/components/shop/RelationImageMap';

export function GoodsRelationEditor({ initial, backHref }: { initial: GoodsRelationDraft; backHref: string }) {
  const [draft, setDraft] = useState(initial); const [baseline, setBaseline] = useState(JSON.stringify(initial));
  const [pending, startTransition] = useTransition(); const [picker, setPicker] = useState(false); const [preview, setPreview] = useState(false);
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [savedId, setSavedId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false), [previewPoint, setPreviewPoint] = useState<string | null>(null), [mobilePreview, setMobilePreview] = useState(false);
  const [previewGoodId, setPreviewGoodId] = useState<string | null>(null);
  const [retry, setRetry] = useState<{ id: string; revision: number; operationId: string; values: GoodsRelationValues } | null>(null);
  const blocked = pending || uploading || !!retry;
  const otherComposition = draft.kind === 'other_composition';
  const visual = otherComposition ? null : draft.visual ?? null, limit = relationLimit(draft.kind, Boolean(visual));
  const dirty = JSON.stringify(draft) !== baseline;
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const update = (value: Partial<GoodsRelationDraft>) => { setDraft(current => ({ ...current, ...value })); setNotice(''); };
  function withoutCompositionLabel(good: GoodsRelationGood): GoodsRelationGood {
    const next = { ...good }; delete next.compositionLabel; return next;
  }
  function changeKind(kind: GoodsRelationKind) {
    update({ kind, title: draft.title === relationDefaultTitle(draft.kind) ? relationDefaultTitle(kind) : draft.title,
      goods: draft.goods.map(withoutCompositionLabel),
      visual: kind === 'similar' || kind === 'other_composition' ? null : kind === 'codi' ? visual ?? relationVisualDraft() : visual });
    setPreviewGoodId(null); setPreviewPoint(null);
  }
  function move(index: number, direction: -1 | 1) {
    const goods = [...draft.goods]; const target = index + direction;
    if (target < 0 || target >= goods.length) return;
    [goods[index], goods[target]] = [goods[target], goods[index]]; update({ goods }); setNotice(`${goods[target].name}을 ${target + 1}번째로 이동했습니다. 저장하면 반영됩니다.`);
  }
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (pending || uploading) return;
    // Save the native date/time values displayed in the submitted form before
    // the pending render can replace them with the previous controlled value.
    const form = new FormData(event.currentTarget);
    const period = retry ? { startsAt: draft.startsAt, endsAt: draft.endsAt } : { startsAt: String(form.get('startsAt') ?? ''), endsAt: String(form.get('endsAt') ?? '') };
    setDraft(current => ({ ...current, ...period }));
    setError(''); setNotice(''); setSavedId(null);
    const request = retry ?? { id: draft.id, revision: draft.revision, operationId: crypto.randomUUID(), values: { kind: draft.kind, title: draft.title,
      representativeGoodId: draft.representativeGoodId, enabled: draft.enabled, startsAt: period.startsAt || null, endsAt: period.endsAt || null, goodIds: draft.goods.map(good => good.id), visual,
      ...(otherComposition ? { compositionLabels: draft.goods.flatMap(good => { const label = good.compositionLabel?.trim(); return label ? [{ goodId: good.id, label }] : []; }) } : {}) } };
    startTransition(async () => {
      try {
        const result = await saveGoodsRelationAction(request);
        if ('error' in result) { setError(result.error); setSavedId(result.savedId ?? null); setRetry(result.retrySameOperation ? request : null); }
        else { const next = goodsRelationDraft(result.saved); setRetry(null); setDraft(next); setBaseline(JSON.stringify(next)); setNotice('연관상품을 저장하고 저장된 편성을 다시 확인했습니다.'); }
      } catch { setError('저장 결과를 확인하지 못했습니다. 입력을 고정했습니다. 같은 요청으로 결과를 확인해주세요.'); setRetry(request); }
    });
  }
  const available = draft.goods.filter(good => good.public);
  const representative = draft.goods.find(good => good.id === draft.representativeGoodId);
  const previewGood = otherComposition
    ? available.find(good => good.id === previewGoodId) ?? available.find(good => good.id === draft.representativeGoodId) ?? available[0]
    : representative;
  const previewGoods = available.filter(good => good.id !== previewGood?.id);
  const previewVisible = otherComposition ? !!previewGood && previewGoods.length > 0 : !!representative?.public && available.length >= 2;
  return <section className="wc-admin-kit wc-admin-kit__screen admin-goods-relations">
    <AdminPageHeader title={draft.revision ? '연관상품 수정' : '연관상품 등록'} description="상품을 함께 제안할 목록·이미지와 상세페이지 노출 조건을 설정합니다." />
    <form className="admin-relation-editor" onSubmit={save} aria-busy={pending}>
      <fieldset disabled={blocked}>
        <legend>연관상품 편성</legend>
        <div className="admin-relation-field"><span>유형</span><div className="admin-relation-inline">{GOODS_RELATION_KINDS.map(kind => <label key={kind.value}><input type="radio" name="relationKind" checked={draft.kind === kind.value} onChange={() => changeKind(kind.value)} />{kind.label}</label>)}<p>{draft.kind === 'together' && !visual ? '목록형은 대표 상품의 상세에만 구성 상품을 제안합니다.' : '구성 상품 각각의 상세에서 나머지 상품을 제안합니다.'}</p></div></div>
        {draft.kind === 'together' ? <div className="admin-relation-field"><span>표시 방식</span><div className="admin-relation-inline"><label><input type="radio" name="relationPresentation" checked={!visual} onChange={() => update({ visual: null })} />목록형</label><label><input type="radio" name="relationPresentation" checked={!!visual} onChange={() => update({ visual: relationVisualDraft() })} />이미지형</label><p>이미지형은 2~5개 상품을 연결하고 모든 구성 상품의 상세에 표시합니다. 목록형으로 바꾸면 이미지와 태그 연결을 제거합니다.</p></div></div> : null}
        <div className="admin-relation-field"><label htmlFor="relation-title">노출 제목</label><div><input id="relation-title" value={draft.title} required maxLength={15} onChange={event => update({ title: event.target.value })} /><small>{[...draft.title].length} / 15자 · 공개 상세에 표시되는 제목</small></div></div>
        <div className="admin-relation-field"><span>상품 구성</span><div>
          <div className="admin-relation-toolbar"><span>대표 포함 {draft.goods.length}개 / 2~{limit}개</span><button className="btn btn-sm" type="button" onClick={() => setPicker(true)}>상품찾기</button><button className="btn btn-sm btn-ghost" type="button" onClick={() => setPreview(true)}>노출 미리보기</button></div>
          <p>대표 상품을 선택하고 위·아래 버튼으로 노출 순서를 바꿉니다. 상세를 보고 있는 상품 자체는 목록에서 제외됩니다.</p>
          <div className="admin-relation-table"><table><caption>구성 상품과 노출 순서</caption><thead><tr><th>순서</th><th>대표</th><th>상품</th><th>공개 상태</th>{otherComposition ? <th>구성 표시값</th> : null}<th>순서·해제</th></tr></thead><tbody>{draft.goods.map((good, index) => <tr key={good.id}>
            <td>{index + 1}</td><td><input type="radio" name="relationRepresentative" aria-label={`${good.name} 대표 상품`} checked={good.id === draft.representativeGoodId} onChange={() => update({ representativeGoodId: good.id })} /></td>
            <td><div className="admin-relation-good">{good.imagePath ? <img src={publicMediaUrl(good.imagePath) ?? ''} alt="" /> : <span className="admin-relation-good__placeholder">이미지</span>}<span>{good.name}<small>{good.code} · {good.id}</small></span></div></td><td>{good.public ? '공개' : '비노출'}</td>
            {otherComposition ? <td><input className="admin-relation-composition-label" aria-label={`${good.name} 구성 표시값`} value={good.compositionLabel ?? ''}
              placeholder="예: 300mL, 2개 세트" onChange={event => update({ goods: draft.goods.map(item => item.id === good.id ? { ...item, compositionLabel: [...event.target.value].slice(0, 40).join('') } : item) })} />
              <small>{[...(good.compositionLabel ?? '')].length} / 40자 · 선택 입력</small></td> : null}
            <td><div className="admin-relation-row-actions"><button type="button" aria-label={`${good.name} 위로`} disabled={index === 0} onClick={() => move(index, -1)}>위로</button><button type="button" aria-label={`${good.name} 아래로`} disabled={index === draft.goods.length - 1} onClick={() => move(index, 1)}>아래로</button><button type="button" aria-label={`${good.name} 해제`} onClick={() => { const goods = draft.goods.filter(item => item.id !== good.id); update({ goods, representativeGoodId: good.id === draft.representativeGoodId ? goods[0]?.id ?? '' : draft.representativeGoodId, visual: visual ? { ...visual, hotspots: visual.hotspots.filter(point => point.goodId !== good.id) } : null }); }}>해제</button></div></td>
          </tr>)}</tbody></table>{!draft.goods.length ? <p>상품찾기에서 대표 상품과 함께 보여줄 상품을 선택해주세요.</p> : null}</div>
          {otherComposition ? <p className="muted">현재 공개 상품 {available.length}개. 대표는 관리용이며 비노출이어도 다른 공개 상품끼리 표시됩니다. 상품과 IP가 공개·미보관이고 판매 제한이 없는 상품이 2개 이상이어야 표시됩니다. 구성 표시값은 이름·옵션에서 자동으로 만들지 않습니다.</p>
            : <p className="muted">현재 공개 상품 {available.length}개. 상품과 IP가 공개·미보관이고 판매 제한이 없어야 표시됩니다. 대표 상품을 포함해 공개 상품이 2개 미만이면 편성 전체가 숨겨집니다.</p>}
        </div></div>
        {visual ? <div className="admin-relation-field"><span>{draft.kind === 'codi' ? '코디 이미지·설명' : '편성 이미지·설명'}</span><GoodsRelationVisualEditor value={visual} goods={draft.goods} kind={draft.kind} disabled={blocked} onChange={next => update({ visual: next })} onBusyChange={setUploading} /></div> : null}
        <div className="admin-relation-field"><span>전시 여부</span><div className="admin-relation-inline"><label><input type="radio" name="relationEnabled" checked={draft.enabled} onChange={() => update({ enabled: true })} />전시</label><label><input type="radio" name="relationEnabled" checked={!draft.enabled} onChange={() => update({ enabled: false })} />전시중지</label></div></div>
        <div className="admin-relation-field"><span>노출 기간</span><div><div className="admin-relation-period"><label>시작일시<input name="startsAt" type="datetime-local" value={draft.startsAt ?? ''} onChange={event => update({ startsAt: event.target.value })} /></label><label>종료일시<input name="endsAt" type="datetime-local" value={draft.endsAt ?? ''} onChange={event => update({ endsAt: event.target.value })} /></label></div><p>한국 시각 기준입니다. 시작 시각부터 표시하고 종료 시각에는 내려갑니다. 비워 둔 경계는 제한하지 않습니다.</p></div></div>
      </fieldset>
      <div className="admin-relation-savebar"><div>{error ? <p role="alert">{error}</p> : null}{notice ? <p role="status">{notice}</p> : null}{savedId || error.includes('다른 운영자') ? <Link href={`${GOODS_RELATIONS_PATH}?edit=${savedId ?? draft.id}&reload=${draft.revision}`}>최신 편성 다시 열기</Link> : null}<small>{draft.revision ? `저장 버전 ${draft.revision}` : '신규 편성'}{dirty ? ' · 저장하지 않은 변경사항' : ''}</small></div><div><button className="btn" type="submit" disabled={pending || uploading}>{pending ? '저장 중…' : retry ? '같은 요청으로 결과 확인' : '저장'}</button><Link className="btn btn-ghost" href={backHref} onClick={event => { if (blocked || dirty && !window.confirm('저장하지 않은 변경사항이 있습니다. 목록으로 이동할까요?')) event.preventDefault(); }}>목록</Link></div></div>
    </form>
    {picker ? <GoodsRelationProductPicker value={draft.goods} limit={limit} onClose={() => setPicker(false)} onApply={goods => {
      const previous = new Map(draft.goods.map(good => [good.id, good]));
      const selected = goods.map(good => otherComposition ? { ...good, compositionLabel: previous.get(good.id)?.compositionLabel ?? null } : withoutCompositionLabel(good));
      update({ goods: selected, representativeGoodId: goods.some(good => good.id === draft.representativeGoodId) ? draft.representativeGoodId : goods[0]?.id ?? '', visual: visual ? { ...visual, hotspots: visual.hotspots.filter(point => goods.some(good => good.id === point.goodId)) } : null }); setPicker(false);
    }} /> : null}
    {preview ? <CustomerServiceDialog title="연관상품 노출 미리보기" onClose={() => setPreview(false)} wide><div className="admin-relation-preview"><div className="admin-relation-inline"><button type="button" aria-pressed={!mobilePreview} onClick={() => setMobilePreview(false)}>PC</button><button type="button" aria-pressed={mobilePreview} onClick={() => setMobilePreview(true)}>모바일</button></div>
      {otherComposition && available.length ? <label className="admin-relation-preview__current">미리볼 상품 상세<select value={previewGood?.id ?? ''} onChange={event => setPreviewGoodId(event.target.value)}>{available.map(good => <option key={good.id} value={good.id}>{good.name}</option>)}</select></label> : null}
      <div className="admin-relation-preview__surface" data-mobile={mobilePreview}><p>{otherComposition ? `${previewGood?.name ?? '공개 상품'} 상세에 표시` : draft.kind === 'together' && !visual ? `${representative?.name ?? '대표 상품'} 상세에 표시` : '구성 상품 각각의 상세에 표시'}</p>{!otherComposition || previewVisible ? <h3>{draft.title}</h3> : null}{!previewVisible ? <p>{otherComposition ? '현재 상세에서 보여줄 다른 공개 상품이 없어 편성이 숨겨집니다.' : '대표 상품을 포함해 공개 가능한 상품이 2개 이상이어야 표시됩니다.'}</p> : <>
      {visual?.imagePath && publicMediaUrl(visual.imagePath) ? <><RelationImageMap key={visual.imagePath} src={publicMediaUrl(visual.imagePath)!} alt={visual.alt || '편성 이미지'} selectedId={previewPoint} onSelect={setPreviewPoint} points={visual.hotspots.flatMap(point => { const good = available.find(item => item.id === point.goodId); return good ? [{ ...point, name: good.name }] : []; })} /><p>{visual.description}</p>{previewPoint ? <p aria-live="polite">{available.find(good => good.id === previewPoint)?.name}</p> : null}</> : null}
      <ul>{previewGoods.map(good => <li key={good.id}>{good.name}{otherComposition && good.compositionLabel?.trim() ? <small>{good.compositionLabel.trim()}</small> : null}</li>)}</ul></>}
      <small>{otherComposition ? '선택한 공개 상품 상세의 현재 입력 미리보기입니다. 다른 구성 표시 설정·활성·기간과 저장 시점의 상품 공개 상태에 따라 실제 노출이 달라집니다.' : '대표 상품 상세의 현재 입력 미리보기입니다. 활성·기간과 저장 시점의 상품 공개 상태에 따라 실제 노출이 달라집니다.'}</small></div></div></CustomerServiceDialog> : null}
  </section>;
}
