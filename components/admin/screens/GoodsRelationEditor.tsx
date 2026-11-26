'use client';
/* eslint-disable @next/next/no-img-element -- Stored catalog previews keep the original aspect ratio. */
import Link from 'next/link';
import { useState, useTransition, type FormEvent } from 'react';
import { saveGoodsRelationAction } from '@/app/admin/goods-relation-actions';
import { adminConfirm } from '@/lib/admin/confirm';
import {
  GOODS_RELATIONS_PATH, GOODS_RELATION_KINDS, RELATION_LEAVE_UNKNOWN, RELATION_SAVE_UNKNOWN, goodsRelationDraft, relationCustomerView, relationDefaultTitle, relationDraftState,
  relationGoodStatus, relationLimit, relationLimitBlock, relationLossText, relationPeriodReadback, relationReadback, relationShownGoods, relationVisualError,
  type GoodsRelationDraft, type GoodsRelationGood, type GoodsRelationKind, type GoodsRelationValues,
} from '@/lib/admin/goods-relations';
import { relationVisualDraft, type GoodsRelationVisual } from '@/lib/good-relation-visual';
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
import { GoodReadback } from '../GoodEditorParts';
import { useAdminLeaveGuard } from '../useAdminLeaveGuard';
import { RelationImageMap } from '@/components/shop/RelationImageMap';

/* 스마트스토어 연관상품 등록의 행 구성(라벨 | 입력)을 kit 카드 안에 그린다(템플릿 룩, ADR-0028). */
const ROW = 'grid gap-3 border-b px-4 py-4 last:border-b-0 sm:grid-cols-[9.5rem_minmax(0,1fr)] sm:gap-6 sm:px-5';
const ROW_LABEL = 'text-sm font-medium sm:pt-1.5';
const INLINE = 'flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2';
const CHOICE = 'inline-flex cursor-pointer items-center gap-2 text-sm has-disabled:cursor-not-allowed has-disabled:text-muted-foreground';
const NOTE = 'text-sm text-muted-foreground';
const DEVICE = 'text-muted-foreground hover:bg-transparent aria-pressed:bg-background aria-pressed:text-primary-soft-foreground aria-pressed:shadow-sm';

/** 유형·표시 방식을 바꾸거나 이미지를 버릴 때 함께 사라지는 입력. */
function visualLoss(visual: GoodsRelationVisual | null) {
  return visual ? { image: Boolean(visual.imagePath), tags: visual.hotspots.length, text: Boolean(visual.alt.trim() || visual.description.trim()) } : {};
}
function withoutCompositionLabel(good: GoodsRelationGood): GoodsRelationGood {
  const next = { ...good }; delete next.compositionLabel; return next;
}

export function GoodsRelationEditor({ initial, backHref, adultGoodsHidden = false }: {
  initial: GoodsRelationDraft; backHref: string;
  /** 성인(19금) 상품을 지금 모든 고객에게 숨겨 두었는가(기능 공개 관리). 판매 제한 상품의 표시와 결과 한 줄이 달라진다. */
  adultGoodsHidden?: boolean;
}) {
  const [draft, setDraft] = useState(initial); const [baseline, setBaseline] = useState(JSON.stringify(initial));
  const [pending, startTransition] = useTransition(); const [picker, setPicker] = useState(false); const [preview, setPreview] = useState(false);
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [savedId, setSavedId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false), [previewPoint, setPreviewPoint] = useState<string | null>(null), [mobilePreview, setMobilePreview] = useState(false);
  const [previewGoodId, setPreviewGoodId] = useState<string | null>(null);
  const [retry, setRetry] = useState<{ id: string; revision: number; operationId: string; values: GoodsRelationValues } | null>(null);
  const [conflict, setConflict] = useState(false);
  /* 전시 기간이 지났는지·올해인지는 화면을 연 시각으로 본다(그리는 동안 시계를 읽지 않는다). */
  const [openedAt] = useState(() => Date.now());
  const blocked = pending || uploading || !!retry;
  const otherComposition = draft.kind === 'other_composition';
  const visual = otherComposition ? null : draft.visual ?? null, limit = relationLimit(draft.kind, Boolean(visual));
  const dirty = JSON.stringify(draft) !== baseline;
  /* 저장을 보내는 중·이미지를 올리는 중에는 떠나지 못하게 막는다. 저장 결과를 모르는 동안에는 막지 않고 묻는다 —
     연결이 돌아오지 않을 때 [목록]을 눌러도 아무 일도 없으면 나갈 길이 없다(칸은 그대로 잠가 둔다). */
  useAdminLeaveGuard({ dirty: dirty || Boolean(retry), blocked: pending || uploading, message: retry ? RELATION_LEAVE_UNKNOWN : undefined });
  const update = (value: Partial<GoodsRelationDraft>) => { setDraft(current => ({ ...current, ...value })); setNotice(''); };

  /* 유형을 바꾼 뒤의 이미지: 유사·다른 구성은 이미지를 쓰지 않고, 코디는 늘 이미지가 있다. */
  const visualAfter = (kind: GoodsRelationKind) => kind === 'similar' || kind === 'other_composition' ? null : kind === 'codi' ? visual ?? relationVisualDraft() : visual;
  /* 담은 상품이 한도를 넘는 유형·표시 방식은 고를 때 막고 몇 개를 빼야 하는지 적는다(화면 규칙 5). */
  const kindBlock = (kind: typeof GOODS_RELATION_KINDS[number]) => kind.value === draft.kind ? null
    : relationLimitBlock(kind.label, relationLimit(kind.value, Boolean(visualAfter(kind.value))), draft.goods.length);
  const imageBlock = visual ? null : relationLimitBlock('이미지형', relationLimit('together', true), draft.goods.length);

  function changeKind(kind: GoodsRelationKind) {
    const target = GOODS_RELATION_KINDS.find(item => item.value === kind);
    if (!target || kind === draft.kind || kindBlock(target)) return;
    const nextVisual = visualAfter(kind);
    const apply = () => {
      update({ kind, title: draft.title === relationDefaultTitle(draft.kind) ? relationDefaultTitle(kind) : draft.title, goods: draft.goods.map(withoutCompositionLabel), visual: nextVisual });
      setPreviewGoodId(null); setPreviewPoint(null);
    };
    /* 사라지는 입력이 있을 때만 묻는다(화면 규칙 7). 구성 표시값은 다른 구성 상품에서만 쓰는 값이다. */
    const lost = relationLossText({ ...visualLoss(nextVisual ? null : visual), labels: otherComposition ? draft.goods.filter(good => good.compositionLabel?.trim()).length : 0 });
    if (!lost) { apply(); return; }
    void adminConfirm({ title: `유형을 '${target.label}'으로 바꿀까요?`, message: lost, confirmLabel: '바꾸기' }).then(ok => { if (ok) apply(); });
  }
  function changePresentation(image: boolean) {
    if (image === Boolean(visual)) return;
    if (image) { if (!imageBlock) update({ visual: relationVisualDraft() }); return; }
    const lost = relationLossText(visualLoss(visual));
    if (!lost) { update({ visual: null }); return; }
    void adminConfirm({ title: '목록형으로 바꿀까요?', message: lost, confirmLabel: '바꾸기' }).then(ok => { if (ok) update({ visual: null }); });
  }
  function addGood(good: GoodsRelationGood) {
    setDraft(current => {
      const other = current.kind === 'other_composition';
      if (current.goods.some(item => item.id === good.id) || current.goods.length >= relationLimit(current.kind, !other && Boolean(current.visual))) return current;
      return { ...current, goods: [...current.goods, other ? { ...good, compositionLabel: null } : withoutCompositionLabel(good)], representativeGoodId: current.representativeGoodId || good.id };
    });
    setNotice('');
  }
  function removeGood(id: string) {
    const good = draft.goods.find(item => item.id === id);
    if (!good) return;
    const apply = () => {
      setDraft(current => {
        const goods = current.goods.filter(item => item.id !== id);
        return { ...current, goods, representativeGoodId: id === current.representativeGoodId ? goods[0]?.id ?? '' : current.representativeGoodId,
          visual: current.visual ? { ...current.visual, hotspots: current.visual.hotspots.filter(point => point.goodId !== id) } : null };
      });
      setNotice('');
    };
    const lost = relationLossText({ tags: visual?.hotspots.some(point => point.goodId === id) ? 1 : 0, labels: otherComposition && good.compositionLabel?.trim() ? 1 : 0 });
    if (!lost) { apply(); return; }
    void adminConfirm({ title: '이 상품을 뺄까요?', message: `${good.name}: ${lost}`, confirmLabel: '빼기' }).then(ok => { if (ok) apply(); });
  }
  function move(index: number, direction: -1 | 1) {
    const goods = [...draft.goods]; const target = index + direction;
    if (target < 0 || target >= goods.length) return;
    [goods[index], goods[target]] = [goods[target], goods[index]]; update({ goods }); setNotice(`'${goods[target].name}' 순서를 ${target + 1}번째로 옮겼습니다.`);
  }
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (pending || uploading) return;
    // Save the native date/time values displayed in the submitted form before
    // the pending render can replace them with the previous controlled value.
    const form = new FormData(event.currentTarget);
    const period = retry ? { startsAt: draft.startsAt, endsAt: draft.endsAt } : { startsAt: String(form.get('startsAt') ?? ''), endsAt: String(form.get('endsAt') ?? '') };
    setDraft(current => ({ ...current, ...period }));
    setError(''); setNotice(''); setSavedId(null); setConflict(false);
    const request = retry ?? { id: draft.id, revision: draft.revision, operationId: crypto.randomUUID(), values: { kind: draft.kind, title: draft.title,
      representativeGoodId: draft.representativeGoodId, enabled: draft.enabled, startsAt: period.startsAt || null, endsAt: period.endsAt || null, goodIds: draft.goods.map(good => good.id), visual,
      ...(otherComposition ? { compositionLabels: draft.goods.flatMap(good => { const label = good.compositionLabel?.trim(); return label ? [{ goodId: good.id, label }] : []; }) } : {}) } };
    startTransition(async () => {
      try {
        const result = await saveGoodsRelationAction(request);
        if ('error' in result) { setError(result.error); setSavedId(result.savedId ?? null); setConflict(Boolean(result.conflict)); setRetry(result.retrySameOperation ? request : null); }
        else { const next = goodsRelationDraft(result.saved); setRetry(null); setDraft(next); setBaseline(JSON.stringify(next)); setNotice('연관상품을 저장했습니다.'); }
      } catch { setError(RELATION_SAVE_UNKNOWN); setRetry(request); }
    });
  }

  /* 고객에게 보이는 상품(성인 인증 고객까지 넣은 가장 넓은 범위). 미리보기와 결과 한 줄이 같은 목록을 쓴다. */
  const shown = relationShownGoods(draft.goods, adultGoodsHidden);
  const representative = draft.goods.find(good => good.id === draft.representativeGoodId);
  const previewGood = otherComposition
    ? shown.find(good => good.id === previewGoodId) ?? shown.find(good => good.id === draft.representativeGoodId) ?? shown[0]
    : representative;
  const previewGoods = shown.filter(good => good.id !== previewGood?.id);
  const audience = { kind: draft.kind, visual: Boolean(visual), representativeGoodId: draft.representativeGoodId, goods: draft.goods, adultGoodsHidden };
  const periodReadback = relationPeriodReadback(draft, openedAt);
  const unsaved = dirty || !draft.revision;
  /* 저장 막대의 결과 한 줄: 지금 저장하면 고객에게 보이는가. 새 연관상품의 기본값 '전시중지'도 여기서 알린다. 저장할 수 없는 입력이면 그것부터 말한다. */
  const visualProblem = relationVisualError(draft.kind, visual);
  const readback = draft.goods.length < 2 ? '상품을 2개 이상 담아야 저장할 수 있습니다.' : periodReadback.invalid ? periodReadback.text : visualProblem
    ?? relationReadback(relationCustomerView({ ...audience, state: relationDraftState(draft, openedAt) }), { kind: draft.kind, unsaved, startText: periodReadback.startText });
  /* 미리보기는 전시 여부·기간과 상관없이 담은 상품만으로 그린다. 그릴 것이 없으면 그 까닭을 적는다. */
  const content = relationCustomerView({ ...audience, state: 'active' });

  return <section className="flex min-w-0 flex-col gap-4" data-admin-screen="goods-relation-editor">
    <AdminPageHeader title={draft.revision ? '연관상품 수정' : '연관상품 등록'} />
    <form className="flex min-w-0 flex-col gap-4" onSubmit={save} aria-busy={pending}>
      <fieldset className="min-w-0 rounded-xl border bg-card text-card-foreground" disabled={blocked}>
        {/* 테두리 상자 안의 제목: legend가 테두리에 걸치지 않도록 띄워서 상자 안에 둔다. */}
        <legend className="float-left w-full border-b px-4 py-3.5 text-base leading-snug font-medium sm:px-5">연관상품</legend>
        <div className="clear-both">
        <div className={ROW}><span className={ROW_LABEL}>유형</span><div className={INLINE}>
          {GOODS_RELATION_KINDS.map(kind => <label className={CHOICE} key={kind.value}><input type="radio" name="relationKind" checked={draft.kind === kind.value} disabled={Boolean(kindBlock(kind))} onChange={() => changeKind(kind.value)} />{kind.label}</label>)}
          {GOODS_RELATION_KINDS.flatMap(kind => { const block = kindBlock(kind); return block ? [<p className={`basis-full ${NOTE}`} key={kind.value}>{block}</p>] : []; })}
        </div></div>
        {draft.kind === 'together' ? <div className={ROW}><span className={ROW_LABEL}>표시 방식</span><div className={INLINE}>
          <label className={CHOICE}><input type="radio" name="relationPresentation" checked={!visual} onChange={() => changePresentation(false)} />목록형</label>
          <label className={CHOICE}><input type="radio" name="relationPresentation" checked={!!visual} disabled={Boolean(imageBlock)} onChange={() => changePresentation(true)} />이미지형</label>
          {imageBlock ? <p className={`basis-full ${NOTE}`}>{imageBlock}</p> : null}
        </div></div> : null}
        <div className={ROW}><label className={ROW_LABEL} htmlFor="relation-title">노출 제목</label><div className="flex min-w-0 flex-col gap-1.5"><Input className="sm:max-w-md" id="relation-title" value={draft.title} required maxLength={15} onChange={event => update({ title: event.target.value })} /><small className="text-xs text-muted-foreground">{[...draft.title].length} / 15자 · 고객 화면에 보이는 제목</small></div></div>
        <div className={ROW}><span className={ROW_LABEL}>상품</span><div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2"><span className="text-sm tabular-nums">{draft.goods.length}개 담음 (2개부터 {limit}개까지)</span><Button size="sm" type="button" onClick={() => setPicker(true)} variant="soft">상품 고르기</Button><Button size="sm" variant="outline" type="button" onClick={() => setPreview(true)}>고객 화면 미리보기</Button></div>
          <div className="relative max-h-[510px] min-w-0 overflow-auto rounded-lg border bg-card [&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-10 [&_thead_th]:bg-muted"><table className="w-full min-w-[720px] caption-top text-sm" data-slot="table"><caption className="px-2 py-2 text-left text-sm text-muted-foreground">담은 상품과 순서</caption><TableHeader><TableRow><TableHead>순서</TableHead><TableHead>대표</TableHead><TableHead>상품</TableHead><TableHead>상품 전시상태</TableHead>{otherComposition ? <TableHead>구성 표시값 (선택)</TableHead> : null}<TableHead>순서·빼기</TableHead></TableRow></TableHeader><TableBody>{draft.goods.map((good, index) => { const status = relationGoodStatus(good, adultGoodsHidden); return <TableRow key={good.id}>
            <TableCell className="tabular-nums">{index + 1}</TableCell><TableCell><input type="radio" name="relationRepresentative" aria-label={`${good.name} 대표 상품`} checked={good.id === draft.representativeGoodId} onChange={() => update({ representativeGoodId: good.id })} /></TableCell>
            <TableCell className="whitespace-normal"><div className="flex min-w-48 items-center gap-3">{good.imagePath ? <img className="size-12 shrink-0 rounded-md bg-muted object-contain" src={publicMediaUrl(good.imagePath) ?? ''} alt="" /> : <span className="grid size-12 shrink-0 place-items-center rounded-md bg-muted text-[10px] text-muted-foreground">이미지</span>}<span className="flex min-w-0 flex-col gap-0.5">{good.name}<small className="text-xs text-muted-foreground wrap-anywhere">{good.code}</small></span></div></TableCell>
            {/* '공개'는 상품과 IP가 공개됐는지만 본다. 판매 제한(19금) 상품은 누구에게 보이는지를 따로 적는다. */}
            <TableCell><span className="flex flex-col items-start gap-1"><AdminStatusBadge tone={statusTone('publication', status.status)}>{status.label}</AdminStatusBadge>{status.note ? <small className="text-xs text-muted-foreground">{status.note}</small> : null}</span></TableCell>
            {otherComposition ? <TableCell><div className="flex min-w-[11.25rem] flex-col gap-1"><Input aria-label={`${good.name} 구성 표시값`} value={good.compositionLabel ?? ''}
              placeholder="예: 300mL, 2개 세트" onChange={event => update({ goods: draft.goods.map(item => item.id === good.id ? { ...item, compositionLabel: [...event.target.value].slice(0, 40).join('') } : item) })} />
              <small className="text-xs text-muted-foreground">{[...(good.compositionLabel ?? '')].length} / 40자</small></div></TableCell> : null}
            <TableCell><div className="flex items-center gap-1"><Button size="xs" variant="outline" type="button" aria-label={`${good.name} 위로`} disabled={index === 0} onClick={() => move(index, -1)}>위로</Button><Button size="xs" variant="outline" type="button" aria-label={`${good.name} 아래로`} disabled={index === draft.goods.length - 1} onClick={() => move(index, 1)}>아래로</Button><Button size="xs" variant="outline" type="button" aria-label={`${good.name} 빼기`} onClick={() => removeGood(good.id)}>빼기</Button></div></TableCell>
          </TableRow>; })}</TableBody></table>{!draft.goods.length ? <p className="px-3 py-6 text-center text-sm text-muted-foreground">[상품 고르기]로 함께 보여 줄 상품을 2개 이상 담아 주세요.</p> : null}</div>
        </div></div>
        {visual ? <div className={ROW}><span className={ROW_LABEL}>이미지·설명</span><GoodsRelationVisualEditor value={visual} goods={draft.goods} kind={draft.kind} disabled={blocked} onChange={next => update({ visual: next })} onBusyChange={setUploading} /></div> : null}
        <div className={ROW}><span className={ROW_LABEL}>전시 여부</span><div className={INLINE}><label className={CHOICE}><input type="radio" name="relationEnabled" checked={draft.enabled} onChange={() => update({ enabled: true })} />전시</label><label className={CHOICE}><input type="radio" name="relationEnabled" checked={!draft.enabled} onChange={() => update({ enabled: false })} />전시중지</label></div></div>
        <div className={ROW}><span className={ROW_LABEL}>전시 기간</span><div className="flex min-w-0 flex-col gap-2"><div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap"><label className="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-muted-foreground">시작 (KST)<Input className="sm:w-56" name="startsAt" type="datetime-local" value={draft.startsAt ?? ''} onChange={event => update({ startsAt: event.target.value })} /></label><label className="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-muted-foreground">종료 (KST)<Input className="sm:w-56" name="endsAt" type="datetime-local" value={draft.endsAt ?? ''} onChange={event => update({ endsAt: event.target.value })} /></label></div>
          {periodReadback.invalid ? <p className="text-sm text-destructive" role="alert">{periodReadback.text}</p> : <GoodReadback className="w-fit">{periodReadback.text}</GoodReadback>}</div></div>
        </div>
      </fieldset>
      <div className="sticky bottom-0 z-10 flex flex-col gap-4 rounded-xl border bg-background p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between print:static" data-relation="savebar"><div className="flex min-w-0 flex-col gap-1.5 text-sm">{error ? <p className="text-destructive" role="alert">{error}</p> : null}{notice ? <p className="text-success" role="status">{notice}</p> : null}
        {/* 다른 사람이 먼저 바꿨는지는 문구가 아니라 서버가 돌려준 값으로 안다. */}
        {savedId || conflict ? <Link className="w-fit underline underline-offset-4" href={`${GOODS_RELATIONS_PATH}?edit=${savedId ?? draft.id}&reload=${draft.revision}`}>최신 내용 다시 열기</Link> : null}
        <p className="text-foreground" data-relation="readback">{readback}</p>
        {dirty ? <small className="text-xs text-muted-foreground">저장하지 않은 변경이 있습니다.</small> : null}</div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2"><Button type="submit" disabled={pending || uploading}>{pending ? '저장 중…' : retry ? '저장됐는지 확인' : '저장'}</Button><Link className={buttonVariants({ variant: 'outline' })} data-slot="button" href={backHref}>목록</Link></div></div>
    </form>
    {picker ? <GoodsRelationProductPicker value={draft.goods} limit={limit} adultGoodsHidden={adultGoodsHidden} onAdd={addGood} onRemove={good => removeGood(good.id)} onClose={() => setPicker(false)} /> : null}
    {preview ? <CustomerServiceDialog title="고객 화면 미리보기" onClose={() => setPreview(false)} wide><div className="flex flex-col gap-4 text-sm leading-relaxed"><div className="inline-flex w-fit rounded-lg bg-muted p-0.5"><Button className={DEVICE} size="sm" variant="ghost" type="button" aria-pressed={!mobilePreview} onClick={() => setMobilePreview(false)}>PC</Button><Button className={DEVICE} size="sm" variant="ghost" type="button" aria-pressed={mobilePreview} onClick={() => setMobilePreview(true)}>모바일</Button></div>
      {otherComposition && shown.length ? <label className="flex max-w-md flex-col gap-2 text-sm font-medium">미리 볼 상품 상세<AdminSelect value={previewGood?.id ?? ''} onChange={event => setPreviewGoodId(event.target.value)} wrapperClassName="w-full">{shown.map(good => <option key={good.id} value={good.id}>{good.name}</option>)}</AdminSelect></label> : null}
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4 rounded-xl border p-4 data-[mobile=true]:w-[390px] data-[mobile=true]:max-w-full" data-mobile={mobilePreview} data-relation-preview="surface">{!content.shown ? <p>{relationReadback(content, { kind: draft.kind, unsaved, startText: null })}</p> : <>
      <p className="text-muted-foreground">{otherComposition ? `${previewGood?.name ?? '공개 상품'} 상세에 보이는 모습` : draft.kind === 'together' && !visual ? `${representative?.name ?? '대표 상품'} 상세에 보이는 모습` : '담은 상품 각각의 상세에 보이는 모습'}</p><h3 className="text-base font-medium">{draft.title}</h3>
      {visual?.imagePath && publicMediaUrl(visual.imagePath) ? <><RelationImageMap key={visual.imagePath} src={publicMediaUrl(visual.imagePath)!} alt={visual.alt || '연관상품 이미지'} selectedId={previewPoint} onSelect={setPreviewPoint} points={visual.hotspots.flatMap(point => { const good = shown.find(item => item.id === point.goodId); return good ? [{ ...point, name: good.name }] : []; })} /><p>{visual.description}</p>{previewPoint ? <p aria-live="polite">{shown.find(good => good.id === previewPoint)?.name}</p> : null}</> : null}
      <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0">{previewGoods.map(good => <li className="rounded-lg border p-4" key={good.id}>{good.name}{otherComposition && good.compositionLabel?.trim() ? <small className="mt-1.5 block text-xs text-muted-foreground wrap-anywhere">{good.compositionLabel.trim()}</small> : null}{good.visibility === 'restricted' ? <small className="mt-1.5 block text-xs text-muted-foreground">{relationGoodStatus(good, adultGoodsHidden).note}</small> : null}</li>)}</ul>
      <small className="text-xs text-muted-foreground">{readback}</small></>}</div></div></CustomerServiceDialog> : null}
  </section>;
}
