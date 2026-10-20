/* eslint-disable @next/next/no-img-element -- Catalog media paths are verified by the artwork pipeline. */
'use client';
import Link from 'next/link';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveShoppingStoryAction } from '@/app/admin/shopping-story-actions';
import { ADMIN_SHOPPING_STORIES_PATH, normalizeShoppingStoryInput, storyIsoToKst, storyKstToIso, type AdminShoppingStory, type ShoppingStoryEditorInput, type ShoppingStoryGoodOption, type ShoppingStorySaveRequest } from '@/lib/admin/shopping-stories';
import { storyCharacterLength, type PublicShoppingStorySection } from '@/lib/shopping-stories';
import { sanitizeShoppingStoryContent } from '@/lib/shopping-stories-content';
import { ShoppingStoryContent } from '@/components/stories/ShoppingStoryContent';
import { ShoppingStoryBodyEditor } from '../ShoppingStoryBodyEditor';
import { ShoppingStoryGoodsPicker } from '../ShoppingStoryGoodsPicker';
import { CustomerServiceDialog } from './CustomerServiceDialog';
import { AdminPageHeader } from '../console/AdminKit';

const EMPTY: ShoppingStoryEditorInput = { title: '', bodyHtml: '', startsAt: null, endsAt: null, sections: [] };
function move<T>(items: T[], index: number, direction: number) { const result = [...items]; const target = index + direction; if (target < 0 || target >= items.length) return items; [result[index], result[target]] = [result[target], result[index]]; return result; }
export function ShoppingStoryEditorScreen({ accountId, draftId, initial }: { accountId: string; draftId: string; initial: AdminShoppingStory | null }) {
  const router = useRouter(); const [values, setValues] = useState<ShoppingStoryEditorInput>(() => initial ? { title: initial.title, bodyHtml: initial.bodyHtml, startsAt: initial.startsAt, endsAt: initial.endsAt, sections: initial.sections } : EMPTY);
  const [revision, setRevision] = useState(initial?.revision ?? 0), [goods, setGoods] = useState(initial?.goods ?? []), [error, setError] = useState(''), [notice, setNotice] = useState(''), [pending, startTransition] = useTransition();
  const [start, setStart] = useState(storyIsoToKst(initial?.startsAt ?? null)), [end, setEnd] = useState(storyIsoToKst(initial?.endsAt ?? null));
  const [preview, setPreview] = useState<'off' | 'desktop' | 'mobile'>('off'), [searchSection, setSearchSection] = useState<string | null>(null);
  const [latest, setLatest] = useState<AdminShoppingStory | null>(null);
  const [retry, setRetry] = useState<ShoppingStorySaveRequest | null>(null); const blocked = pending || !!retry;
  const count = values.sections.reduce((total, section) => total + section.goodIds.length, 0);
  const content = useMemo(() => sanitizeShoppingStoryContent(values.bodyHtml), [values.bodyHtml]);
  const previewSections: PublicShoppingStorySection[] = values.sections.map(section => ({ ...section, goods: section.goodIds.flatMap(id => { const good = goods.find(row => row.id === id); return good && !good.archived && good.published ? [{ id: good.id, name: good.name, price: good.price, priceMax: good.priceMax, compareAtPrice: good.compareAtPrice, showDiscountRate: good.showDiscountRate, imageBackground: good.imageBackground, badge: good.badge, soldOut: good.soldOut }] : []; }) }));
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
    if ((start && !startsAt) || (end && !endsAt)) { setError('전시기간을 올바른 한국 시각으로 입력해주세요.'); return; }
    const current = { ...values, startsAt, endsAt }; const normalized = normalizeShoppingStoryInput(current);
    if (!normalized.ok) { setError(normalized.error); return; }
    const request = retry ?? { id: draftId, expectedRevision: revision, operationId: crypto.randomUUID(), values: current };
    startTransition(async () => {
      const result = await saveShoppingStoryAction(request);
      if (!result.ok) { setRetry(result.retrySameOperation ? request : null); setError(result.error); if (result.latestStory) setLatest(result.latestStory); if (result.savedId) router.replace(`${ADMIN_SHOPPING_STORIES_PATH}/${result.savedId}`); return; }
      setRetry(null); setRevision(result.story.revision); setValues({ title: result.story.title, bodyHtml: result.story.bodyHtml, startsAt: result.story.startsAt, endsAt: result.story.endsAt, sections: result.story.sections }); setGoods(result.story.goods); setLatest(null);
      setNotice(`저장한 내용을 다시 확인했습니다.${result.warnings.length ? ` ${result.warnings.join(' ')}` : ''}`);
      if (!initial) router.replace(`${ADMIN_SHOPPING_STORIES_PATH}/${draftId}`); router.refresh();
    });
  }
  return <section className="wc-admin-kit wc-admin-kit__screen admin-story-editor">
    <AdminPageHeader title={initial ? '쇼핑스토리 수정' : '쇼핑스토리 등록'} actions={<Link className="btn btn-sm btn-ghost" href={ADMIN_SHOPPING_STORIES_PATH}>목록</Link>} />
    <fieldset disabled={blocked} className="admin-story-editor__fields">
      <section className="admin-story-panel"><h2>기본 정보</h2><label>스토리 제목 <span>{storyCharacterLength(values.title)} / 50</span><input value={values.title} onChange={event => setValues(current => ({ ...current, title: event.target.value }))} placeholder="쇼핑스토리 제목을 입력하세요" aria-required="true" /></label>
        <div className="admin-story-period"><label>전시 시작일시 (한국 시각)<input type="datetime-local" value={start} onChange={event => setStart(event.target.value)} /></label><label>전시 종료일시 (한국 시각)<input type="datetime-local" value={end} onChange={event => setEnd(event.target.value)} /></label></div><p className="admin-story-help">시작을 비우면 즉시, 종료를 비우면 무기한 전시됩니다. 전시를 중지하려면 종료 시각을 지정하세요.</p>
      </section>
      <section className="admin-story-panel"><h2>상세 본문</h2><ShoppingStoryBodyEditor accountId={accountId} value={values.bodyHtml} onChange={bodyHtml => setValues(current => ({ ...current, bodyHtml }))} disabled={blocked} /><p className="admin-story-help">본문 첫 이미지와 텍스트가 목록의 대표이미지·설명이 됩니다. 이미지를 넣지 않으면 텍스트 카드로 노출됩니다.</p></section>
      <section className="admin-story-panel"><div className="admin-story-list-heading"><h2>관련상품 <small>{values.sections.length} / 10개 섹션 · 전체 {count} / 300개 상품</small></h2><button type="button" disabled={values.sections.length >= 10} onClick={() => setValues(current => ({ ...current, sections: [...current.sections, { id: crypto.randomUUID(), title: '', imageShape: 'square', goodIds: [] }] }))}>섹션 추가</button></div>
        {!values.sections.length ? <p className="admin-story-help">관련상품 없이 스토리만 등록할 수 있습니다.</p> : null}
        {values.sections.map((section, index) => <section key={section.id} className="admin-story-goods-section" aria-label={`관련상품 섹션 ${index + 1}`}>
          <div className="admin-story-section-heading"><strong>{index + 1}</strong><label>섹션 제목<input value={section.title} placeholder="최대 13자" onChange={event => setValues(current => ({ ...current, sections: current.sections.map(item => item.id === section.id ? { ...item, title: event.target.value } : item) }))} /></label>
            <label>상품 이미지<select value={section.imageShape} onChange={event => setValues(current => ({ ...current, sections: current.sections.map(item => item.id === section.id ? { ...item, imageShape: event.target.value as 'square' | 'portrait' } : item) }))}><option value="square">정사각형</option><option value="portrait">세로 직사각형</option></select></label>
            <button type="button" disabled={index === 0} aria-label={`섹션 ${index + 1} 위로`} onClick={() => setValues(current => ({ ...current, sections: move(current.sections, index, -1) }))}>↑</button><button type="button" disabled={index === values.sections.length - 1} aria-label={`섹션 ${index + 1} 아래로`} onClick={() => setValues(current => ({ ...current, sections: move(current.sections, index, 1) }))}>↓</button><button type="button" onClick={() => setValues(current => ({ ...current, sections: current.sections.filter(item => item.id !== section.id) }))}>섹션 삭제</button>
          </div>
          <div className="admin-story-actions"><button type="button" disabled={section.goodIds.length >= 200 || count >= 300} onClick={() => setSearchSection(section.id)}>상품 찾기</button><span>{section.goodIds.length} / 200개</span></div>
          <ol className="admin-story-selected-goods">{section.goodIds.map((id, goodIndex) => { const good = goods.find(row => row.id === id); return <li key={id}><span>{goodIndex + 1}</span>{good?.imageUrl ? <img src={good.imageUrl} alt="" /> : <span className="admin-story-good-placeholder" />}<div><strong>{good?.name ?? id}</strong><small>{good?.code ?? id} · {(good?.price ?? 0).toLocaleString('ko-KR')}원{good?.archived ? ' · 보관됨 (공개 제외)' : !good?.published ? ' · 비공개' : good.soldOut ? ' · 품절' : ''}</small></div>
            <button type="button" disabled={goodIndex === 0} aria-label={`${good?.name ?? id} 위로`} onClick={() => setValues(current => ({ ...current, sections: current.sections.map(item => item.id === section.id ? { ...item, goodIds: move(item.goodIds, goodIndex, -1) } : item) }))}>↑</button><button type="button" disabled={goodIndex === section.goodIds.length - 1} aria-label={`${good?.name ?? id} 아래로`} onClick={() => setValues(current => ({ ...current, sections: current.sections.map(item => item.id === section.id ? { ...item, goodIds: move(item.goodIds, goodIndex, 1) } : item) }))}>↓</button><button type="button" onClick={() => setValues(current => ({ ...current, sections: current.sections.map(item => item.id === section.id ? { ...item, goodIds: item.goodIds.filter(value => value !== id) } : item) }))}>제거</button></li>; })}</ol>
        </section>)}<p className="admin-story-help">같은 상품은 한 번만 선택할 수 있습니다. 비공개·보관된 상품과 공개되지 않은 IP의 상품은 공개 화면에서 제외되며 품절 상품은 품절 표시와 함께 보입니다.</p>
      </section>
    </fieldset>
    {error ? <p className="admin-story-error" role="alert">{error}</p> : null}{notice ? <p role="status">{notice}</p> : null}
    {latest ? <aside className="admin-story-conflict"><h2>최신 저장 내용 확인</h2><p>현재 저장된 제목: {latest.title} · 버전 {latest.revision}</p><Link href={`${ADMIN_SHOPPING_STORIES_PATH}/${draftId}`} target="_blank" rel="noopener noreferrer">저장 내용 별도 창에서 확인 ↗</Link><button type="button" onClick={() => { setRevision(latest.revision); setLatest(null); setError('현재 입력을 유지했습니다. 최신 내용을 확인했다면 저장해주세요.'); }}>최신 버전 기준으로 현재 입력 유지</button></aside> : null}
    <div className="admin-story-editor__footer"><button type="button" onClick={() => setPreview('desktop')}>PC 미리보기</button><button type="button" onClick={() => setPreview('mobile')}>모바일 미리보기</button><button type="button" className="btn btn-primary" disabled={pending || !!latest} onClick={save}>{pending ? '저장 중…' : retry ? '같은 요청으로 저장 결과 확인' : '저장'}</button></div>
    {preview !== 'off' ? <CustomerServiceDialog title={`${preview === 'mobile' ? '모바일' : 'PC'} 스토리 미리보기`} onClose={() => setPreview('off')} wide><div className="admin-story-dialog-content"><p className="admin-story-help">현재 입력 기준입니다. 상품의 판매가·공개 상태는 불러온 시점 기준이며 공개 요청마다 다시 확인합니다.</p><div className="admin-story-preview" data-device={preview}><ShoppingStoryContent title={values.title} bodyHtml={values.bodyHtml} imagePaths={content.imagePaths} sections={previewSections} /></div></div></CustomerServiceDialog> : null}
    {searchSection ? <ShoppingStoryGoodsPicker existingIds={values.sections.flatMap(section => section.goodIds)} sectionCount={values.sections.find(section => section.id === searchSection)?.goodIds.length ?? 0} onAdd={addGoods} onClose={() => setSearchSection(null)} /> : null}
  </section>;
}
