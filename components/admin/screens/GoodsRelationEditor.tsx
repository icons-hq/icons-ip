'use client';
/* eslint-disable @next/next/no-img-element -- Stored catalog previews keep the original aspect ratio. */
import Link from 'next/link';
import { useEffect, useState, useTransition, type FormEvent } from 'react';
import { saveGoodsRelationAction } from '@/app/admin/goods-relation-actions';
import { GOODS_RELATIONS_PATH, GOODS_RELATION_KINDS, goodsRelationDraft, relationDefaultTitle, relationLimit, type GoodsRelationDraft, type GoodsRelationGood, type GoodsRelationKind, type GoodsRelationValues } from '@/lib/admin/goods-relations';
import { relationVisualDraft } from '@/lib/good-relation-visual';
import { publicMediaUrl } from '@/lib/media';
import { AdminPageHeader, AdminStatusBadge } from '../console/AdminKit';
import { statusTone } from '@/lib/admin/status-tone';
import { AdminSelect } from '../console/AdminSelect';
import { Button, buttonVariants } from '../kit/ui/button';
import { Input } from '../kit/ui/input';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '../kit/ui/table';
import { GoodsRelationProductPicker } from './GoodsRelationProductPicker';
import { CustomerServiceDialog } from './CustomerServiceDialog';
import { GoodsRelationVisualEditor } from '../GoodsRelationVisualEditor';
import { RelationImageMap } from '@/components/shop/RelationImageMap';

/* 스마트스토어 연관상품 등록의 행 구성(라벨 | 입력)을 kit 카드 안에 그린다(템플릿 룩, ADR-0028). */
const ROW = 'grid gap-3 border-b px-4 py-4 last:border-b-0 sm:grid-cols-[9.5rem_minmax(0,1fr)] sm:gap-6 sm:px-5';
const ROW_LABEL = 'text-sm font-medium sm:pt-1.5';
const INLINE = 'flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2';
const CHOICE = 'inline-flex cursor-pointer items-center gap-2 text-sm';
const NOTE = 'text-sm text-muted-foreground';
const DEVICE = 'text-muted-foreground hover:bg-transparent aria-pressed:bg-background aria-pressed:text-primary-soft-foreground aria-pressed:shadow-sm';

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
  return <section className="flex min-w-0 flex-col gap-4" data-admin-screen="goods-relation-editor">
    <AdminPageHeader title={draft.revision ? '연관상품 수정' : '연관상품 등록'} description="상품을 함께 제안할 목록·이미지와 상세페이지 노출 조건을 설정합니다." />
    <form className="flex min-w-0 flex-col gap-4" onSubmit={save} aria-busy={pending}>
      <fieldset className="min-w-0 rounded-xl border bg-card text-card-foreground" disabled={blocked}>
        {/* 테두리 상자 안의 제목: legend가 테두리에 걸치지 않도록 띄워서 상자 안에 둔다. */}
        <legend className="float-left w-full border-b px-4 py-3.5 text-base leading-snug font-medium sm:px-5">연관상품 편성</legend>
        <div className="clear-both">
        <div className={ROW}><span className={ROW_LABEL}>유형</span><div className={INLINE}>{GOODS_RELATION_KINDS.map(kind => <label className={CHOICE} key={kind.value}><input type="radio" name="relationKind" checked={draft.kind === kind.value} onChange={() => changeKind(kind.value)} />{kind.label}</label>)}<p className={`basis-full ${NOTE}`}>{draft.kind === 'together' && !visual ? '목록형은 대표 상품의 상세에만 구성 상품을 제안합니다.' : '구성 상품 각각의 상세에서 나머지 상품을 제안합니다.'}</p></div></div>
        {draft.kind === 'together' ? <div className={ROW}><span className={ROW_LABEL}>표시 방식</span><div className={INLINE}><label className={CHOICE}><input type="radio" name="relationPresentation" checked={!visual} onChange={() => update({ visual: null })} />목록형</label><label className={CHOICE}><input type="radio" name="relationPresentation" checked={!!visual} onChange={() => update({ visual: relationVisualDraft() })} />이미지형</label><p className={`basis-full ${NOTE}`}>이미지형은 2~5개 상품을 연결하고 모든 구성 상품의 상세에 표시합니다. 목록형으로 바꾸면 이미지와 태그 연결을 제거합니다.</p></div></div> : null}
        <div className={ROW}><label className={ROW_LABEL} htmlFor="relation-title">노출 제목</label><div className="flex min-w-0 flex-col gap-1.5"><Input className="sm:max-w-md" id="relation-title" value={draft.title} required maxLength={15} onChange={event => update({ title: event.target.value })} /><small className="text-xs text-muted-foreground">{[...draft.title].length} / 15자 · 공개 상세에 표시되는 제목</small></div></div>
        <div className={ROW}><span className={ROW_LABEL}>상품 구성</span><div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2"><span className="text-sm tabular-nums">대표 포함 {draft.goods.length}개 / 2~{limit}개</span><Button size="sm" type="button" onClick={() => setPicker(true)} variant="soft">상품찾기</Button><Button size="sm" variant="outline" type="button" onClick={() => setPreview(true)}>노출 미리보기</Button></div>
          <p className={NOTE}>대표 상품을 선택하고 위·아래 버튼으로 노출 순서를 바꿉니다. 상세를 보고 있는 상품 자체는 목록에서 제외됩니다.</p>
          <div className="relative max-h-[510px] min-w-0 overflow-auto rounded-lg border bg-card [&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-10 [&_thead_th]:bg-muted"><table className="w-full min-w-[720px] caption-top text-sm" data-slot="table"><caption className="px-2 py-2 text-left text-sm text-muted-foreground">구성 상품과 노출 순서</caption><TableHeader><TableRow><TableHead>순서</TableHead><TableHead>대표</TableHead><TableHead>상품</TableHead><TableHead>공개 상태</TableHead>{otherComposition ? <TableHead>구성 표시값</TableHead> : null}<TableHead>순서·해제</TableHead></TableRow></TableHeader><TableBody>{draft.goods.map((good, index) => <TableRow key={good.id}>
            <TableCell className="tabular-nums">{index + 1}</TableCell><TableCell><input type="radio" name="relationRepresentative" aria-label={`${good.name} 대표 상품`} checked={good.id === draft.representativeGoodId} onChange={() => update({ representativeGoodId: good.id })} /></TableCell>
            <TableCell className="whitespace-normal"><div className="flex min-w-48 items-center gap-3">{good.imagePath ? <img className="size-12 shrink-0 rounded-md bg-muted object-contain" src={publicMediaUrl(good.imagePath) ?? ''} alt="" /> : <span className="grid size-12 shrink-0 place-items-center rounded-md bg-muted text-[10px] text-muted-foreground">이미지</span>}<span className="flex min-w-0 flex-col gap-0.5">{good.name}<small className="text-xs text-muted-foreground wrap-anywhere">{good.code} · {good.id}</small></span></div></TableCell><TableCell><AdminStatusBadge tone={statusTone('display', good.public ? 'active' : 'inactive')}>{good.public ? '공개' : '비노출'}</AdminStatusBadge></TableCell>
            {otherComposition ? <TableCell><div className="flex min-w-[11.25rem] flex-col gap-1"><Input aria-label={`${good.name} 구성 표시값`} value={good.compositionLabel ?? ''}
              placeholder="예: 300mL, 2개 세트" onChange={event => update({ goods: draft.goods.map(item => item.id === good.id ? { ...item, compositionLabel: [...event.target.value].slice(0, 40).join('') } : item) })} />
              <small className="text-xs text-muted-foreground">{[...(good.compositionLabel ?? '')].length} / 40자 · 선택 입력</small></div></TableCell> : null}
            <TableCell><div className="flex items-center gap-1"><Button size="xs" variant="outline" type="button" aria-label={`${good.name} 위로`} disabled={index === 0} onClick={() => move(index, -1)}>위로</Button><Button size="xs" variant="outline" type="button" aria-label={`${good.name} 아래로`} disabled={index === draft.goods.length - 1} onClick={() => move(index, 1)}>아래로</Button><Button size="xs" variant="outline" type="button" aria-label={`${good.name} 해제`} onClick={() => { const goods = draft.goods.filter(item => item.id !== good.id); update({ goods, representativeGoodId: good.id === draft.representativeGoodId ? goods[0]?.id ?? '' : draft.representativeGoodId, visual: visual ? { ...visual, hotspots: visual.hotspots.filter(point => point.goodId !== good.id) } : null }); }}>해제</Button></div></TableCell>
          </TableRow>)}</TableBody></table>{!draft.goods.length ? <p className="px-3 py-6 text-center text-sm text-muted-foreground">상품찾기에서 대표 상품과 함께 보여줄 상품을 선택해주세요.</p> : null}</div>
          {otherComposition ? <p className={NOTE}>현재 공개 상품 {available.length}개. 대표는 관리용이며 비노출이어도 다른 공개 상품끼리 표시됩니다. 상품과 IP가 공개·미보관이고 판매 제한이 없는 상품이 2개 이상이어야 표시됩니다. 구성 표시값은 이름·옵션에서 자동으로 만들지 않습니다.</p>
            : <p className={NOTE}>현재 공개 상품 {available.length}개. 상품과 IP가 공개·미보관이고 판매 제한이 없어야 표시됩니다. 대표 상품을 포함해 공개 상품이 2개 미만이면 편성 전체가 숨겨집니다.</p>}
        </div></div>
        {visual ? <div className={ROW}><span className={ROW_LABEL}>{draft.kind === 'codi' ? '코디 이미지·설명' : '편성 이미지·설명'}</span><GoodsRelationVisualEditor value={visual} goods={draft.goods} kind={draft.kind} disabled={blocked} onChange={next => update({ visual: next })} onBusyChange={setUploading} /></div> : null}
        <div className={ROW}><span className={ROW_LABEL}>전시 여부</span><div className={INLINE}><label className={CHOICE}><input type="radio" name="relationEnabled" checked={draft.enabled} onChange={() => update({ enabled: true })} />전시</label><label className={CHOICE}><input type="radio" name="relationEnabled" checked={!draft.enabled} onChange={() => update({ enabled: false })} />전시중지</label></div></div>
        <div className={ROW}><span className={ROW_LABEL}>노출 기간</span><div className="flex min-w-0 flex-col gap-2"><div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap"><label className="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-muted-foreground">시작일시<Input className="sm:w-56" name="startsAt" type="datetime-local" value={draft.startsAt ?? ''} onChange={event => update({ startsAt: event.target.value })} /></label><label className="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-muted-foreground">종료일시<Input className="sm:w-56" name="endsAt" type="datetime-local" value={draft.endsAt ?? ''} onChange={event => update({ endsAt: event.target.value })} /></label></div><p className={NOTE}>한국 시각 기준입니다. 시작 시각부터 표시하고 종료 시각에는 내려갑니다. 비워 둔 경계는 제한하지 않습니다.</p></div></div>
        </div>
      </fieldset>
      <div className="sticky bottom-0 z-10 flex flex-col gap-4 rounded-xl border bg-background p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between print:static" data-relation="savebar"><div className="flex min-w-0 flex-col gap-1.5 text-sm">{error ? <p className="text-destructive" role="alert">{error}</p> : null}{notice ? <p className="text-success" role="status">{notice}</p> : null}{savedId || error.includes('다른 운영자') ? <Link className="w-fit underline underline-offset-4" href={`${GOODS_RELATIONS_PATH}?edit=${savedId ?? draft.id}&reload=${draft.revision}`}>최신 편성 다시 열기</Link> : null}<small className="text-xs text-muted-foreground">{draft.revision ? `저장 버전 ${draft.revision}` : '신규 편성'}{dirty ? ' · 저장하지 않은 변경사항' : ''}</small></div><div className="flex shrink-0 flex-wrap justify-end gap-2"><Button type="submit" disabled={pending || uploading}>{pending ? '저장 중…' : retry ? '같은 요청으로 결과 확인' : '저장'}</Button><Link className={buttonVariants({ variant: 'outline' })} data-slot="button" href={backHref} onClick={event => { if (blocked || dirty && !window.confirm('저장하지 않은 변경사항이 있습니다. 목록으로 이동할까요?')) event.preventDefault(); }}>목록</Link></div></div>
    </form>
    {picker ? <GoodsRelationProductPicker value={draft.goods} limit={limit} onClose={() => setPicker(false)} onApply={goods => {
      const previous = new Map(draft.goods.map(good => [good.id, good]));
      const selected = goods.map(good => otherComposition ? { ...good, compositionLabel: previous.get(good.id)?.compositionLabel ?? null } : withoutCompositionLabel(good));
      update({ goods: selected, representativeGoodId: goods.some(good => good.id === draft.representativeGoodId) ? draft.representativeGoodId : goods[0]?.id ?? '', visual: visual ? { ...visual, hotspots: visual.hotspots.filter(point => goods.some(good => good.id === point.goodId)) } : null }); setPicker(false);
    }} /> : null}
    {preview ? <CustomerServiceDialog title="연관상품 노출 미리보기" onClose={() => setPreview(false)} wide><div className="flex flex-col gap-4 text-sm leading-relaxed"><div className="inline-flex w-fit rounded-lg bg-muted p-0.5"><Button className={DEVICE} size="sm" variant="ghost" type="button" aria-pressed={!mobilePreview} onClick={() => setMobilePreview(false)}>PC</Button><Button className={DEVICE} size="sm" variant="ghost" type="button" aria-pressed={mobilePreview} onClick={() => setMobilePreview(true)}>모바일</Button></div>
      {otherComposition && available.length ? <label className="flex max-w-md flex-col gap-2 text-sm font-medium">미리볼 상품 상세<AdminSelect value={previewGood?.id ?? ''} onChange={event => setPreviewGoodId(event.target.value)} wrapperClassName="w-full">{available.map(good => <option key={good.id} value={good.id}>{good.name}</option>)}</AdminSelect></label> : null}
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4 rounded-xl border p-4 data-[mobile=true]:w-[390px] data-[mobile=true]:max-w-full" data-mobile={mobilePreview} data-relation-preview="surface"><p className="text-muted-foreground">{otherComposition ? `${previewGood?.name ?? '공개 상품'} 상세에 표시` : draft.kind === 'together' && !visual ? `${representative?.name ?? '대표 상품'} 상세에 표시` : '구성 상품 각각의 상세에 표시'}</p>{!otherComposition || previewVisible ? <h3 className="text-base font-medium">{draft.title}</h3> : null}{!previewVisible ? <p>{otherComposition ? '현재 상세에서 보여줄 다른 공개 상품이 없어 편성이 숨겨집니다.' : '대표 상품을 포함해 공개 가능한 상품이 2개 이상이어야 표시됩니다.'}</p> : <>
      {visual?.imagePath && publicMediaUrl(visual.imagePath) ? <><RelationImageMap key={visual.imagePath} src={publicMediaUrl(visual.imagePath)!} alt={visual.alt || '편성 이미지'} selectedId={previewPoint} onSelect={setPreviewPoint} points={visual.hotspots.flatMap(point => { const good = available.find(item => item.id === point.goodId); return good ? [{ ...point, name: good.name }] : []; })} /><p>{visual.description}</p>{previewPoint ? <p aria-live="polite">{available.find(good => good.id === previewPoint)?.name}</p> : null}</> : null}
      <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0">{previewGoods.map(good => <li className="rounded-lg border p-4" key={good.id}>{good.name}{otherComposition && good.compositionLabel?.trim() ? <small className="mt-1.5 block text-xs text-muted-foreground wrap-anywhere">{good.compositionLabel.trim()}</small> : null}</li>)}</ul></>}
      <small className="text-xs text-muted-foreground">{otherComposition ? '선택한 공개 상품 상세의 현재 입력 미리보기입니다. 다른 구성 표시 설정·활성·기간과 저장 시점의 상품 공개 상태에 따라 실제 노출이 달라집니다.' : '대표 상품 상세의 현재 입력 미리보기입니다. 활성·기간과 저장 시점의 상품 공개 상태에 따라 실제 노출이 달라집니다.'}</small></div></div></CustomerServiceDialog> : null}
  </section>;
}
