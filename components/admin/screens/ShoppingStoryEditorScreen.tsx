/* eslint-disable @next/next/no-img-element -- Catalog media paths are verified by the artwork pipeline. */
'use client';
import Link from 'next/link';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveShoppingStoryAction } from '@/app/admin/shopping-story-actions';
import { ADMIN_SHOPPING_STORIES_PATH, SHOPPING_STORY_STATE_LABELS, normalizeShoppingStoryInput, storyIsoToKst, storyKstToIso, type AdminShoppingStory, type ShoppingStoryEditorInput, type ShoppingStoryGoodOption, type ShoppingStorySaveRequest } from '@/lib/admin/shopping-stories';
import { storyCharacterLength, type PublicShoppingStorySection } from '@/lib/shopping-stories';
import { sanitizeShoppingStoryContent } from '@/lib/shopping-stories-content';
import { ShoppingStoryContent } from '@/components/stories/ShoppingStoryContent';
import { ShoppingStoryBodyEditor } from '../ShoppingStoryBodyEditor';
import { ShoppingStoryGoodsPicker } from '../ShoppingStoryGoodsPicker';
import { DisplayGoodVisibilityNote } from '../DisplayGoodVisibility';
import { displayGoodVisibility, hiddenDisplayGoodsNotice } from '@/lib/admin/good-visibility';
import { ArrowDown, ArrowLeft, ArrowUp, ExternalLink, Plus, Search } from 'lucide-react';
import { CustomerServiceDialog } from './CustomerServiceDialog';
import { AdminNotice, AdminStatusBadge } from '../console/AdminKit';
import { AdminPageHeading } from '../console/admin-shell-title';
import { useAdminLeaveGuard } from '../useAdminLeaveGuard';
import { statusTone } from '@/lib/admin/status-tone';
import { Button, buttonVariants } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';

/* 쇼핑스토리 편집(템플릿 룩, ADR-0028). 입력 묶음은 kit 카드 모양이고 저장 흐름(같은 요청 재확인·충돌 확인)은 그대로다. */
const PANEL = 'flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-4 text-sm text-card-foreground sm:p-6';
const PANEL_TITLE = 'text-base font-semibold text-foreground';
const FIELD = 'flex min-w-0 flex-col gap-2 text-sm font-medium';
const HELP = 'text-xs leading-relaxed text-muted-foreground';

const EMPTY: ShoppingStoryEditorInput = { title: '', bodyHtml: '', startsAt: null, endsAt: null, sections: [] };
/** 저장 전후를 비교할 입력. startsAt·endsAt은 저장할 때 시작·종료 칸에서 만들므로 칸의 값을 본다. */
function storyInputs(values: ShoppingStoryEditorInput, start: string, end: string) { return JSON.stringify({ title: values.title, bodyHtml: values.bodyHtml, sections: values.sections, start, end }); }
function move<T>(items: T[], index: number, direction: number) { const result = [...items]; const target = index + direction; if (target < 0 || target >= items.length) return items; [result[index], result[target]] = [result[target], result[index]]; return result; }
export function ShoppingStoryEditorScreen({ accountId, draftId, initial }: { accountId: string; draftId: string; initial: AdminShoppingStory | null }) {
  const router = useRouter(); const [values, setValues] = useState<ShoppingStoryEditorInput>(() => initial ? { title: initial.title, bodyHtml: initial.bodyHtml, startsAt: initial.startsAt, endsAt: initial.endsAt, sections: initial.sections } : EMPTY);
  const [revision, setRevision] = useState(initial?.revision ?? 0), [goods, setGoods] = useState(initial?.goods ?? []), [error, setError] = useState(''), [notice, setNotice] = useState(''), [pending, startTransition] = useTransition();
  const [start, setStart] = useState(storyIsoToKst(initial?.startsAt ?? null)), [end, setEnd] = useState(storyIsoToKst(initial?.endsAt ?? null));
  const [preview, setPreview] = useState<'off' | 'desktop' | 'mobile'>('off'), [searchSection, setSearchSection] = useState<string | null>(null);
  const [latest, setLatest] = useState<AdminShoppingStory | null>(null);
  const [retry, setRetry] = useState<ShoppingStorySaveRequest | null>(null); const blocked = pending || !!retry;
  const [savedInputs, setSavedInputs] = useState(() => storyInputs(values, start, end));
  useAdminLeaveGuard({ dirty: !!retry || storyInputs(values, start, end) !== savedInputs });
  const count = values.sections.reduce((total, section) => total + section.goodIds.length, 0);
  const content = useMemo(() => sanitizeShoppingStoryContent(values.bodyHtml), [values.bodyHtml]);
  const previewSections: PublicShoppingStorySection[] = values.sections.map(section => ({ ...section, goods: section.goodIds.flatMap(id => { const good = goods.find(row => row.id === id); return good && !good.archived && good.published ? [{ id: good.id, name: good.name, price: good.price, priceMax: good.priceMax, compareAtPrice: good.compareAtPrice, showDiscountRate: good.showDiscountRate, imageBackground: good.imageBackground, badge: good.badge, soldOut: good.soldOut }] : []; }) }));
  /* 미리보기·공개 화면에서 빠지는 관련상품(초안·IP 초안·성인(19금)·보관됨·찾을 수 없음)을 이름과 이유로 알린다(QA1 MD). */
  const hiddenNotice = hiddenDisplayGoodsNotice(values.sections.flatMap(section => section.goodIds).flatMap(id => { const good = goods.find(row => row.id === id), visibility = displayGoodVisibility(good); return visibility === 'public' ? [] : [{ name: good?.name ?? id, visibility }]; }));
  function addGoods(selected: ShoppingStoryGoodOption[]) {
    const section = values.sections.find(item => item.id === searchSection);
    const existing = new Set(values.sections.flatMap(item => item.goodIds));
    const unique = selected.filter((good, index) => !existing.has(good.id) && selected.findIndex(item => item.id === good.id) === index);
    if (!section || section.goodIds.length + unique.length > 200 || count + unique.length > 300) return;
    setGoods(items => [...items, ...unique.filter(good => !items.some(item => item.id === good.id))]);
    setValues(current => ({ ...current, sections: current.sections.map(item => item.id === searchSection ? { ...item, goodIds: [...item.goodIds, ...unique.map(good => good.id)] } : item) }));
    setSearchSection(null);
  }
  function save() {
    setError(''); setNotice('');
    const startsAt = start ? storyKstToIso(start) : null, endsAt = end ? storyKstToIso(end) : null;
    if ((start && !startsAt) || (end && !endsAt)) { setError('전시기간을 올바른 KST으로 입력해주세요.'); return; }
    const current = { ...values, startsAt, endsAt }; const normalized = normalizeShoppingStoryInput(current);
    if (!normalized.ok) { setError(normalized.error); return; }
    const request = retry ?? { id: draftId, expectedRevision: revision, operationId: crypto.randomUUID(), values: current };
    startTransition(async () => {
      const result = await saveShoppingStoryAction(request);
      if (!result.ok) { setRetry(result.retrySameOperation ? request : null); setError(result.error); if (result.latestStory) setLatest(result.latestStory); if (result.savedId) router.replace(`${ADMIN_SHOPPING_STORIES_PATH}/${result.savedId}`); return; }
      const savedValues = { title: result.story.title, bodyHtml: result.story.bodyHtml, startsAt: result.story.startsAt, endsAt: result.story.endsAt, sections: result.story.sections };
      setRetry(null); setRevision(result.story.revision); setValues(savedValues); setSavedInputs(storyInputs(savedValues, start, end)); setGoods(result.story.goods); setLatest(null);
      setNotice(`저장한 내용을 다시 확인했습니다.${result.warnings.length ? ` ${result.warnings.join(' ')}` : ''}`);
      if (!initial) router.replace(`${ADMIN_SHOPPING_STORIES_PATH}/${draftId}`); router.refresh();
    });
  }
  return <section className="flex min-w-0 flex-col gap-4 [&_:is(input,select,textarea,button,summary,a)]:scroll-mb-24">
    {/* 셸 제목은 메뉴 이름(쇼핑스토리)이라 목록과 같다 — 머리가 수정·등록 화면임을 말하고, 어느 글인지와 전시 상태를 옆에 둔다. */}
    <header className="flex flex-wrap items-center gap-2" data-admin-kit="page-header">
      <AdminPageHeading title={initial ? '쇼핑스토리 수정' : '쇼핑스토리 등록'} />
      {initial?.title ? <span className="min-w-0 truncate text-sm text-muted-foreground" title={initial.title}>{initial.title}</span> : null}
      {initial ? <AdminStatusBadge tone={statusTone('story', initial.state)}>{SHOPPING_STORY_STATE_LABELS[initial.state]}</AdminStatusBadge> : null}
      <Link className={`${buttonVariants({ size: 'sm', variant: 'outline' })} ml-auto`} data-slot="button" href={ADMIN_SHOPPING_STORIES_PATH}><ArrowLeft aria-hidden="true" />목록으로</Link>
    </header>
    <fieldset disabled={blocked} className="flex min-w-0 flex-col gap-4">
      <section className={PANEL}><h2 className={PANEL_TITLE}>기본 정보</h2><label className={FIELD}><span>스토리 제목 <span className="text-xs font-normal text-muted-foreground tabular-nums">{storyCharacterLength(values.title)} / 50</span></span><Input value={values.title} onChange={event => setValues(current => ({ ...current, title: event.target.value }))} placeholder="쇼핑스토리 제목을 입력하세요" aria-required="true" /></label>
        <div className="flex flex-col gap-4 sm:flex-row sm:gap-6 [&>label]:flex-1"><label className={FIELD}>전시 시작일시 (KST)<Input type="datetime-local" value={start} onChange={event => setStart(event.target.value)} /></label><label className={FIELD}>전시 종료일시 (KST)<Input type="datetime-local" value={end} onChange={event => setEnd(event.target.value)} /></label></div><p className={HELP}>시작을 비우면 즉시, 종료를 비우면 무기한 전시됩니다. 전시를 중지하려면 종료 시각을 지정하세요.</p>
      </section>
      <section className={PANEL}><h2 className={PANEL_TITLE}>상세 본문</h2><ShoppingStoryBodyEditor accountId={accountId} value={values.bodyHtml} onChange={bodyHtml => setValues(current => ({ ...current, bodyHtml }))} disabled={blocked} /><p className={HELP}>본문 첫 이미지와 텍스트가 목록의 대표이미지·설명이 됩니다. 이미지를 넣지 않으면 텍스트 카드로 노출됩니다.</p></section>
      <section className={PANEL}><div className="flex flex-wrap items-center justify-between gap-3"><h2 className={PANEL_TITLE}>관련상품 <small className="ml-2 text-xs font-normal text-muted-foreground tabular-nums">{values.sections.length} / 10개 섹션 · 전체 {count} / 300개 상품</small></h2><Button type="button" disabled={values.sections.length >= 10} onClick={() => setValues(current => ({ ...current, sections: [...current.sections, { id: crypto.randomUUID(), title: '', imageShape: 'square', goodIds: [] }] }))} size="sm" variant="outline"><Plus aria-hidden="true" />섹션 추가</Button></div>
        {!values.sections.length ? <p className={HELP}>관련상품 없이 스토리만 등록할 수 있습니다.</p> : null}
        {values.sections.map((section, index) => <section key={section.id} className="flex min-w-0 flex-col gap-3 rounded-lg border p-4" aria-label={`관련상품 섹션 ${index + 1}`}>
          <div className="flex flex-wrap items-end gap-2"><strong className="self-center text-sm font-semibold tabular-nums">{index + 1}</strong><label className={`${FIELD} min-w-[50%] flex-1`}>섹션 제목<Input value={section.title} placeholder="최대 13자" onChange={event => setValues(current => ({ ...current, sections: current.sections.map(item => item.id === section.id ? { ...item, title: event.target.value } : item) }))} /></label>
            <label className={FIELD}>상품 이미지<NativeSelect value={section.imageShape} onChange={event => setValues(current => ({ ...current, sections: current.sections.map(item => item.id === section.id ? { ...item, imageShape: event.target.value as 'square' | 'portrait' } : item) }))}><option value="square">정사각형</option><option value="portrait">세로 직사각형</option></NativeSelect></label>
            <Button type="button" disabled={index === 0} aria-label={`섹션 ${index + 1} 위로`} onClick={() => setValues(current => ({ ...current, sections: move(current.sections, index, -1) }))} size="icon" variant="outline"><ArrowUp aria-hidden="true" /></Button><Button type="button" disabled={index === values.sections.length - 1} aria-label={`섹션 ${index + 1} 아래로`} onClick={() => setValues(current => ({ ...current, sections: move(current.sections, index, 1) }))} size="icon" variant="outline"><ArrowDown aria-hidden="true" /></Button><Button type="button" onClick={() => setValues(current => ({ ...current, sections: current.sections.filter(item => item.id !== section.id) }))} variant="destructive">섹션 삭제</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 text-xs"><Button type="button" disabled={section.goodIds.length >= 200 || count >= 300} onClick={() => setSearchSection(section.id)} size="sm" variant="outline"><Search aria-hidden="true" />상품 찾기</Button><span className="text-muted-foreground tabular-nums">{section.goodIds.length} / 200개</span></div>
          <ol className="flex flex-col">{section.goodIds.map((id, goodIndex) => { const good = goods.find(row => row.id === id); return <li className="flex flex-wrap items-center gap-3 border-t py-3 text-xs sm:flex-nowrap" key={id}><span className="text-muted-foreground tabular-nums">{goodIndex + 1}</span>{good?.imageUrl ? <img className="block size-12 shrink-0 rounded-md bg-muted object-cover" src={good.imageUrl} alt="" /> : <span className="block size-12 shrink-0 rounded-md bg-muted" />}<div className="min-w-0 flex-1"><strong className="font-medium [overflow-wrap:anywhere]">{good?.name ?? id}</strong><small className="mt-0.5 block leading-relaxed text-muted-foreground">{good?.code ?? id} · {(good?.price ?? 0).toLocaleString('ko-KR')}원{good && !good.archived && good.published && good.soldOut ? ' · 품절' : ''}</small><DisplayGoodVisibilityNote visibility={displayGoodVisibility(good)} /></div>
            <Button type="button" disabled={goodIndex === 0} aria-label={`${good?.name ?? id} 위로`} onClick={() => setValues(current => ({ ...current, sections: current.sections.map(item => item.id === section.id ? { ...item, goodIds: move(item.goodIds, goodIndex, -1) } : item) }))} size="icon-sm" variant="ghost"><ArrowUp aria-hidden="true" /></Button><Button type="button" disabled={goodIndex === section.goodIds.length - 1} aria-label={`${good?.name ?? id} 아래로`} onClick={() => setValues(current => ({ ...current, sections: current.sections.map(item => item.id === section.id ? { ...item, goodIds: move(item.goodIds, goodIndex, 1) } : item) }))} size="icon-sm" variant="ghost"><ArrowDown aria-hidden="true" /></Button><Button type="button" onClick={() => setValues(current => ({ ...current, sections: current.sections.map(item => item.id === section.id ? { ...item, goodIds: item.goodIds.filter(value => value !== id) } : item) }))} size="sm" variant="ghost">제거</Button></li>; })}</ol>
        </section>)}<p className={HELP}>같은 상품은 한 번만 선택할 수 있습니다. 초안·보관된 상품, 공개되지 않은 IP의 상품, 성인(19금) 상품은 공개 화면에서 제외되며(목록에 이유 표시) 품절 상품은 품절 표시와 함께 보입니다.</p>
      </section>
    </fieldset>
    {latest ? <aside className="flex flex-col items-start gap-2 rounded-xl border bg-muted/40 p-5 text-sm"><h2 className={PANEL_TITLE}>최신 저장 내용 확인</h2><p>현재 저장된 제목: {latest.title} · 버전 {latest.revision}</p><Link className="inline-flex items-center gap-1 underline underline-offset-4" href={`${ADMIN_SHOPPING_STORIES_PATH}/${draftId}`} target="_blank" rel="noopener noreferrer">저장 내용 별도 창에서 확인 <ExternalLink aria-hidden="true" className="size-3.5" /></Link><Button className="mt-1" type="button" onClick={() => { setRevision(latest.revision); setLatest(null); setError('현재 입력을 유지했습니다. 최신 내용을 확인했다면 저장해주세요.'); }} variant="outline">최신 버전 기준으로 현재 입력 유지</Button></aside> : null}
    {/* 저장은 상품 수정과 같이 바닥 오른쪽 끝이다 — 셸 여백까지 밀어 폭 전체에 붙이고 윗선 하나로 본문과 가른다(둥근 상자가 본문 칸 모서리에 겹치지 않는다). */}
    <div className="sticky bottom-0 z-10 -mx-4 -mb-4 flex flex-wrap items-center justify-end gap-2 border-t bg-background px-4 py-2 sm:gap-2.5 md:-mx-6 md:-mb-6 md:px-6 md:py-3 print:hidden [&>button]:flex-1 sm:[&>button]:flex-none" data-admin-savebar="">
      {/* 저장 결과는 누른 [저장] 바로 위 막대에 보인다 — 폼 맨 아래 안내는 스크롤해야 보였다(QA1 MD). */}
      {error ? <p className="w-full text-sm text-destructive" data-story-save-message="error" role="alert">{error}</p> : notice ? <p className="w-full text-sm text-success" data-story-save-message="saved" role="status">{notice}</p> : null}<Button type="button" onClick={() => setPreview('desktop')} variant="outline">PC 미리보기</Button><Button type="button" onClick={() => setPreview('mobile')} variant="outline">모바일 미리보기</Button><Button type="button" disabled={pending || !!latest} onClick={save}>{pending ? '저장 중…' : retry ? '같은 요청으로 저장 결과 확인' : '저장'}</Button></div>
    {preview !== 'off' ? <CustomerServiceDialog title={`${preview === 'mobile' ? '모바일' : 'PC'} 스토리 미리보기`} onClose={() => setPreview('off')} wide><div className="flex flex-col gap-3"><p className={HELP}>현재 입력 기준입니다. 상품의 판매가·공개 상태는 불러온 시점 기준이며 공개 요청마다 다시 확인합니다.</p>{hiddenNotice ? <AdminNotice tone="warning"><span data-display-hidden-goods="">{hiddenNotice} 미리보기에도 보이지 않습니다.</span></AdminNotice> : null}<div className="mx-auto w-full max-w-[848px] rounded-lg border bg-background p-4 data-[device=mobile]:w-[375px] data-[device=mobile]:max-w-full" data-device={preview} data-story-preview=""><ShoppingStoryContent title={values.title} bodyHtml={values.bodyHtml} imagePaths={content.imagePaths} sections={previewSections} /></div></div></CustomerServiceDialog> : null}
    {searchSection ? <ShoppingStoryGoodsPicker existingIds={values.sections.flatMap(section => section.goodIds)} sectionCount={values.sections.find(section => section.id === searchSection)?.goodIds.length ?? 0} onAdd={addGoods} onClose={() => setSearchSection(null)} /> : null}
  </section>;
}
