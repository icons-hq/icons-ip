'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { AdminSectionCard } from '../console/AdminKit';
import { CategoryDisplayGoodsPicker } from '../CategoryDisplayGoodsPicker';
import { CategoryDisplayArtwork } from '../CategoryDisplayArtwork';
import { CategoryDisplayPreview } from '../CategoryDisplayPreview';
import { CategoryDisplayTree } from '../CategoryDisplayTree';
import { previewCategoryDisplayAction, reloadCategoryDisplayAction, saveCategoryDisplayAction, type CategoryDisplaySaveResult } from '@/app/admin/category-display-actions';
import { parseCategoryDisplayValues, type CategoryDisplayDirectory, type CategoryDisplayPage, type CategoryDisplaySnapshot, type CategoryDisplayValues } from '@/lib/category-display';
import type { StoryGoodCandidate } from '@/lib/admin/shopping-story-picker';
import type { ShopListQuery } from '@/lib/shop-catalog';
import { categoryDisplayHref } from '@/lib/routes';
import { createClient } from '@/lib/supabase/client';
import { inquiryDraftSessionId } from '@/lib/admin/inquiry-drafts';

type Slot = 'main' | 'recommend' | 'video';
function SelectedGoods({ ids, names, disabled, onChange }: { ids: string[]; names: Map<string, string>; disabled: boolean; onChange: (ids: string[]) => void }) {
  const [page, setPage] = useState(1), currentPage = Math.min(page, Math.max(1, Math.ceil(ids.length / 20)));
  function move(index: number, delta: number) { const next = [...ids], target = index + delta; if (target < 0 || target >= ids.length) return; [next[index], next[target]] = [next[target], next[index]]; onChange(next); }
  return <><ol className="admin-category-display__selected" start={(currentPage - 1) * 20 + 1}>{ids.slice((currentPage - 1) * 20, currentPage * 20).map((id, offset) => {
    const index = (currentPage - 1) * 20 + offset;
    return <li key={id}><span>{names.get(id) ?? id}<small>{names.has(id) ? id : '저장된 상품'}</small></span><div>
      <button type="button" aria-label={`${names.get(id) ?? id} 위로`} disabled={disabled || index === 0} onClick={() => move(index, -1)}>↑</button>
      <button type="button" aria-label={`${names.get(id) ?? id} 아래로`} disabled={disabled || index === ids.length - 1} onClick={() => move(index, 1)}>↓</button>
      <button type="button" disabled={disabled} onClick={() => onChange(ids.filter(value => value !== id))}>해제</button>
    </div></li>;
  })}</ol>{ids.length > 20 ? <nav aria-label="연결한 상품 페이지"><button type="button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>이전</button><span>{currentPage} / {Math.ceil(ids.length / 20)}</span><button type="button" disabled={currentPage * 20 >= ids.length} onClick={() => setPage(currentPage + 1)}>다음</button></nav> : null}</>;
}

export function CategoryDisplayScreen({ directory, initial, actorId, sessionId }: { directory: CategoryDisplayDirectory; initial: CategoryDisplaySnapshot | null; actorId: string; sessionId: string | null }) {
  return <section className="wc-admin-kit wc-admin-kit__screen admin-category-display">
    <p className="wc-admin-kit__description">상품분류와 독립된 전시분류를 만들고, 상품과 상단 배너·동영상·추천상품을 구성합니다.</p>
    <CategoryDisplayTree key={`tree:${initial?.category.id ?? 'new'}:${actorId}:${sessionId}`} initial={directory} selectedId={initial?.category.id ?? null} actorId={actorId} sessionId={sessionId} />
    {initial ? <CategoryDisplayEditor key={`${initial.category.id}:${actorId}:${sessionId}`} directory={directory} initial={initial} actorId={actorId} sessionId={sessionId} />
      : <AdminSectionCard title="전시 상품 구성"><p>전시분류를 만든 뒤 연결할 상품과 상단 콘텐츠를 구성해주세요.</p></AdminSectionCard>}
  </section>;
}
function CategoryDisplayEditor({ directory, initial, actorId, sessionId }: { directory: CategoryDisplayDirectory; initial: CategoryDisplaySnapshot; actorId: string; sessionId: string | null }) {
  const [stored, setStored] = useState(initial), [values, setValues] = useState(initial.values), [names, setNames] = useState(new Map<string, string>());
  const [picker, setPicker] = useState<Slot | null>(null), [pending, setPending] = useState(false), [uncertain, setUncertain] = useState(false), [conflict, setConflict] = useState(false), [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState({ pc: false, mobile: false }), [message, setMessage] = useState(''), [error, setError] = useState(false);
  const [preview, setPreview] = useState<CategoryDisplayPage | null>(null), [previewBusy, setPreviewBusy] = useState(false), [previewMessage, setPreviewMessage] = useState(''), [mobile, setMobile] = useState(true);
  const request = useRef<{ values: CategoryDisplayValues; revision: number; id: string } | null>(null), alive = useRef(true), blockedRef = useRef(false), previewTicket = useRef(0);
  const dirty = JSON.stringify(values) !== JSON.stringify(stored.values), locked = pending || uncertain || conflict || blocked;
  useEffect(() => {
    alive.current = true;
    const subscription = createClient().auth.onAuthStateChange((_event, session) => {
      if (session?.user.id !== actorId || sessionId !== null && inquiryDraftSessionId(session.access_token) !== sessionId) { blockedRef.current = true; setBlocked(true); setPicker(null); previewTicket.current += 1; }
    }).data.subscription;
    return () => { alive.current = false; previewTicket.current += 1; subscription.unsubscribe(); };
  }, [actorId, sessionId]);
  useEffect(() => {
    if (!dirty && !uncertain) return;
    const prevent = (event: BeforeUnloadEvent) => event.preventDefault();
    const navigate = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest('a[href]') as HTMLAnchorElement | null : null;
      if (!link || link.hasAttribute('download') || link.target && link.target !== '_self') return;
      const destination = new URL(link.href, window.location.href);
      if (destination.pathname === window.location.pathname && destination.search === window.location.search && destination.origin === window.location.origin) return;
      if (!window.confirm('저장하지 않은 입력을 두고 이동할까요?')) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener('beforeunload', prevent); document.addEventListener('click', navigate, true);
    return () => { window.removeEventListener('beforeunload', prevent); document.removeEventListener('click', navigate, true); };
  }, [dirty, uncertain]);
  function change<K extends keyof CategoryDisplayValues>(key: K, value: CategoryDisplayValues[K]) { if (!locked && !blockedRef.current) setValues(current => ({ ...current, [key]: value })); }
  function banner<K extends keyof CategoryDisplayValues['banner']>(key: K, value: CategoryDisplayValues['banner'][K]) { if (!locked && !blockedRef.current) setValues(current => ({ ...current, banner: { ...current.banner, [key]: value } })); }
  function choose(ids: string[], rows: StoryGoodCandidate[]) {
    if (locked) return;
    setNames(current => new Map([...current, ...rows.map(row => [row.id, row.name] as const)]));
    if (picker === 'main') change('goodIds', ids);
    if (picker === 'recommend') change('recommendations', { ...values.recommendations, goodIds: ids });
    if (picker === 'video') change('video', { ...values.video, goodId: ids[0] ?? null });
    setPicker(null);
  }
  async function save() {
    if (pending || conflict || blocked || busy.pc || busy.mobile) return;
    const parsed = parseCategoryDisplayValues(values);
    if (!request.current && !parsed) { setMessage('입력값을 확인해주세요. 켠 배너에는 PC 이미지, 영상에는 상품 선택이 필요합니다.'); setError(true); return; }
    request.current ??= { values: parsed!, revision: stored.revision, id: crypto.randomUUID() };
    setPending(true); setMessage('');
    let result: CategoryDisplaySaveResult;
    try { result = await saveCategoryDisplayAction(initial.category.id, request.current.values, request.current.revision, request.current.id, actorId); }
    catch { result = { error: '저장 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.', uncertain: true }; }
    if (!alive.current || blockedRef.current) return;
    setPending(false);
    if ('error' in result) { setMessage(result.error); setError(true); setUncertain(Boolean(result.uncertain)); setConflict(Boolean(result.conflict)); if (!result.uncertain) request.current = null; return; }
    setStored(result.snapshot); setValues(result.snapshot.values); setUncertain(false); setConflict(false); request.current = null; setMessage('저장했습니다. 공개 전시를 확인해주세요.'); setError(false);
  }
  async function reload() {
    if (pending || uncertain || blocked || busy.pc || busy.mobile || (dirty && !window.confirm('현재 입력을 버리고 최신 저장본을 불러올까요?'))) return;
    setPending(true); setMessage('');
    let result: CategoryDisplaySaveResult;
    try { result = await reloadCategoryDisplayAction(initial.category.id); }
    catch { result = { error: '최신 저장본을 불러오지 못했습니다. 입력은 유지됩니다. 다시 조회해주세요.' }; }
    if (!alive.current || blockedRef.current) return;
    setPending(false);
    if ('error' in result) { setMessage(result.error); setError(true); return; }
    setStored(result.snapshot); setValues(result.snapshot.values); setConflict(false); setPreview(null); request.current = null; setMessage('최신 저장본을 불러왔습니다.'); setError(false);
  }
  async function showPreview(query: ShopListQuery = { displayCategory: initial.category.id, view: 'all', ips: [], types: [], priceMin: null, priceMax: null, sort: 'recommended' }) {
    if (blocked || busy.pc || busy.mobile) return;
    const token = ++previewTicket.current; setPreviewBusy(true); setPreviewMessage('');
    try {
      const result = await previewCategoryDisplayAction(initial.category.id, values, query, actorId);
      if (!alive.current || blockedRef.current || token !== previewTicket.current) return;
      if ('error' in result) setPreviewMessage(result.error); else { setPreview(result.page); if (!result.page) setPreviewMessage('현재 카테고리가 공개되어 있지 않아 공개 미리보기를 표시할 수 없습니다.'); }
    } catch { if (token === previewTicket.current) setPreviewMessage('미리보기를 불러오지 못했습니다. 입력은 유지됩니다.'); }
    finally { if (alive.current && token === previewTicket.current) setPreviewBusy(false); }
  }
  return <div>
    {blocked ? <p role="alert">로그인 상태가 바뀌었습니다. 이 화면을 새로 열어주세요.</p> : null}
    <div className="admin-category-display__layout"><form onSubmit={event => { event.preventDefault(); void save(); }}>
      <AdminSectionCard title={directory.categories.find(category => category.id === stored.category.id)?.name ?? stored.category.name}><fieldset disabled={locked}>
        <label><input type="checkbox" checked={values.enabled} onChange={event => change('enabled', event.target.checked)} /> 카테고리 전시 사용</label>
        <p>전시 목록만 바뀌며 상품의 카테고리·ERP 정보는 바뀌지 않습니다.</p>
        {!directory.categories.find(category => category.id === stored.category.id)?.publicEnabled ? <p>고객 카테고리 활성 상태 또는 전시분류의 보관 상태 때문에 현재 공개되지 않습니다.</p> : null}
        <label>상품 연결 방식<select value={values.mode} onChange={event => change('mode', event.target.value as CategoryDisplayValues['mode'])}><option value="categories">카테고리 단위로 연결</option><option value="manual">개별상품 단위로 연결</option></select></label>
        {values.mode === 'categories' ? <fieldset><legend>연결할 상품분류 · 최대 10개</legend>{directory.sourceCategories.map(category => <label key={category.id}><input type="checkbox" checked={values.categoryIds.includes(category.id)} disabled={!values.categoryIds.includes(category.id) && values.categoryIds.length >= 10}
          onChange={() => change('categoryIds', values.categoryIds.includes(category.id) ? values.categoryIds.filter(id => id !== category.id) : [...values.categoryIds, category.id])} />{category.name}</label>)}</fieldset>
          : <><p>선택 {values.goodIds.length.toLocaleString()} / 1,000개</p><button type="button" onClick={() => setPicker('main')}>상품 선택</button><SelectedGoods ids={values.goodIds} names={names} disabled={locked} onChange={ids => change('goodIds', ids)} /></>}
      </fieldset></AdminSectionCard>
      <AdminSectionCard title="상단 배너"><fieldset disabled={locked}><label><input type="checkbox" checked={values.banner.enabled} onChange={event => banner('enabled', event.target.checked)} /> 배너 표시</label>
        <CategoryDisplayArtwork label="PC 배너 이미지" actorId={actorId} path={values.banner.imagePath} disabled={locked} onChange={path => banner('imagePath', path)} onBusy={pc => setBusy(current => ({ ...current, pc }))} />
        <CategoryDisplayArtwork label="모바일 배너 이미지" actorId={actorId} path={values.banner.mobileImagePath} disabled={locked} onChange={path => banner('mobileImagePath', path)} onBusy={mobile => setBusy(current => ({ ...current, mobile }))} />
        <label>제목 · 40자<input value={values.banner.title} maxLength={80} onChange={event => banner('title', event.target.value)} /></label>
        <label>내용 · 150자, 3줄<textarea value={values.banner.content} maxLength={300} rows={3} onChange={event => banner('content', event.target.value)} /></label>
        <label>이동할 스토어 내부 경로 · 비우면 링크 없음<input value={values.banner.linkPath ?? ''} placeholder="/shop" onChange={event => banner('linkPath', event.target.value || null)} /></label>
        <label>이미지 딤<select value={values.banner.imageDim} onChange={event => banner('imageDim', event.target.value as CategoryDisplayValues['banner']['imageDim'])}><option value="none">적용 안함</option><option value="white">흰색</option><option value="black">검정색</option></select></label>
        <label>글자색<select value={values.banner.textColor} onChange={event => banner('textColor', event.target.value as 'white' | 'black')}><option value="white">흰색</option><option value="black">검정색</option></select></label>
        <label><input type="checkbox" checked={values.banner.altEnabled} onChange={event => banner('altEnabled', event.target.checked)} /> 이미지 대체텍스트 설정</label>
        {values.banner.altEnabled ? <><label>대체 제목 · 40자<input value={values.banner.altTitle} maxLength={80} onChange={event => banner('altTitle', event.target.value)} /></label><label>대체 내용 · 150자, 3줄<textarea value={values.banner.altContent} maxLength={300} rows={3} onChange={event => banner('altContent', event.target.value)} /></label></> : null}
      </fieldset></AdminSectionCard>
      <AdminSectionCard title="상단 동영상"><fieldset disabled={locked}><label><input type="checkbox" checked={values.video.enabled} onChange={event => change('video', { ...values.video, enabled: event.target.checked })} /> 동영상 표시</label>
        <p>선택한 공개 상품의 현재 동영상을 표시합니다. 상품에서 영상을 교체하거나 해제하면 여기도 함께 반영됩니다. 현재 영상이 없으면 동영상 영역이 표시되지 않습니다.</p>
        <button type="button" onClick={() => setPicker('video')}>상품 선택</button>{values.video.goodId ? <SelectedGoods ids={[values.video.goodId]} names={names} disabled={locked} onChange={ids => change('video', { ...values.video, goodId: ids[0] ?? null })} /> : null}
      </fieldset></AdminSectionCard>
      <AdminSectionCard title="상단 추천상품"><fieldset disabled={locked}><label><input type="checkbox" checked={values.recommendations.enabled} onChange={event => change('recommendations', { ...values.recommendations, enabled: event.target.checked })} /> 추천상품 표시</label>
        <label>제목 · 15자<input value={values.recommendations.title} maxLength={30} onChange={event => change('recommendations', { ...values.recommendations, title: event.target.value })} /></label>
        <label>표시 개수<select value={values.recommendations.itemCount} onChange={event => change('recommendations', { ...values.recommendations, itemCount: Number(event.target.value) })}>{Array.from({ length: 10 }, (_, index) => index + 3).map(count => <option key={count} value={count}>{count}개</option>)}</select></label>
        <p>후보 {values.recommendations.goodIds.length} / 100개</p><button type="button" onClick={() => setPicker('recommend')}>추천상품 선택</button>
        <SelectedGoods ids={values.recommendations.goodIds} names={names} disabled={locked} onChange={goodIds => change('recommendations', { ...values.recommendations, goodIds })} />
      </fieldset></AdminSectionCard>
      <div className="admin-category-display__save">{message ? <p role={error ? 'alert' : 'status'}>{message}</p> : null}
        <button type="submit" disabled={pending || blocked || conflict || busy.pc || busy.mobile}>{pending ? '저장 중…' : uncertain ? '같은 요청 결과 확인' : '이 카테고리 전시 적용하기'}</button>
        <button type="button" disabled={pending || uncertain || blocked || busy.pc || busy.mobile} onClick={() => { void reload(); }}>최신 저장본 불러오기</button>
        <Link href={categoryDisplayHref(initial.category.id)} target="_blank">공개 전시 보기</Link>
      </div>
    </form><aside className="admin-category-display__preview"><h2>저장 전 미리보기</h2><p>현재 공개 가능한 상품의 첫 20개를 확인합니다. 입력을 바꾼 뒤 미리보기를 갱신해주세요.</p>
      <div className="admin-category-display__preview-controls"><button type="button" disabled={blocked || previewBusy || busy.pc || busy.mobile} onClick={() => { void showPreview(); }}>{previewBusy ? '불러오는 중…' : '미리보기 갱신'}</button><button type="button" aria-pressed={mobile} onClick={() => setMobile(true)}>모바일</button><button type="button" aria-pressed={!mobile} onClick={() => setMobile(false)}>PC</button></div>
      {previewMessage ? <p role="status">{previewMessage}</p> : null}{preview ? <CategoryDisplayPreview page={preview} mobile={mobile} onQueryChange={query => { void showPreview(query); }} /> : null}
    </aside></div>
    {picker ? <CategoryDisplayGoodsPicker key={picker} selected={picker === 'main' ? values.goodIds : picker === 'recommend' ? values.recommendations.goodIds : values.video.goodId ? [values.video.goodId] : []}
      limit={picker === 'main' ? 1000 : picker === 'recommend' ? 100 : 1} onlyPublished={picker === 'video'} onApply={choose} onClose={() => setPicker(null)} /> : null}
  </div>;
}
