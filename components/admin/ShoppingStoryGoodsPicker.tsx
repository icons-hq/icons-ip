/* eslint-disable @next/next/no-img-element -- Verified catalog media and deterministic seed assets. */
'use client';
import { useEffect, useRef, useState } from 'react';
import { searchShoppingStoryGoodsAction } from '@/app/admin/shopping-story-actions';
import { DEFAULT_STORY_GOOD_FILTERS, STORY_GOOD_SORTS, storyGoodSelectionCapacity, validStoryGoodFilters, type StoryGoodCandidates, type StoryGoodFilters } from '@/lib/admin/shopping-story-picker';
import type { ShoppingStoryGoodOption } from '@/lib/admin/shopping-stories';
import { CustomerServiceDialog } from './screens/CustomerServiceDialog';
import { findGoodById, GOOD_URL_ERRORS } from '@/lib/admin/good-url';
import { GoodUrlAddField } from './GoodUrlAddField';

type Search = { query: string; filters: StoryGoodFilters };
export function ShoppingStoryGoodsPicker({ existingIds, sectionCount, onAdd, onClose }: {
  existingIds: string[]; sectionCount: number; onAdd: (goods: ShoppingStoryGoodOption[]) => void; onClose: () => void;
}) {
  const [query, setQuery] = useState(''), [filters, setFilters] = useState<StoryGoodFilters>(DEFAULT_STORY_GOOD_FILTERS);
  const [applied, setApplied] = useState<Search>({ query: '', filters: DEFAULT_STORY_GOOD_FILTERS });
  const [data, setData] = useState<StoryGoodCandidates | null>(null), [pending, setPending] = useState(true), [error, setError] = useState('');
  const [picked, setPicked] = useState<ShoppingStoryGoodOption[]>([]); const request = useRef(0);
  const existing = new Set(existingIds), capacity = storyGoodSelectionCapacity(existingIds, sectionCount);
  function change<K extends keyof StoryGoodFilters>(key: K, value: StoryGoodFilters[K]) { setFilters(current => ({ ...current, [key]: value })); }
  useEffect(() => {
    let mounted = true;
    void searchShoppingStoryGoodsAction('', 1, DEFAULT_STORY_GOOD_FILTERS).then(result => {
      if (!mounted) return;
      if (result.ok) setData(result.data); else setError(result.error);
      setPending(false);
    }).catch(() => { if (mounted) { setError('관련상품을 불러오지 못했습니다. 다시 검색해주세요.'); setPending(false); } });
    return () => { mounted = false; request.current += 1; };
  }, []);
  async function search(page: number, next: Search) {
    if (!validStoryGoodFilters(next.filters)) { setError('가격 범위와 검색 조건을 다시 확인해주세요.'); return; }
    const token = ++request.current; setPending(true); setError('');
    try {
      const result = await searchShoppingStoryGoodsAction(next.query, page, next.filters);
      if (request.current !== token) return;
      if (result.ok) { setData(result.data); setApplied(next); } else setError(result.error);
    } catch { if (request.current === token) setError('관련상품을 불러오지 못했습니다. 선택은 유지됩니다. 다시 검색해주세요.'); }
    finally { if (request.current === token) setPending(false); }
  }
  function toggle(good: ShoppingStoryGoodOption) {
    setPicked(current => current.some(item => item.id === good.id) ? current.filter(item => item.id !== good.id)
      : current.length < capacity && !existing.has(good.id) ? [...current, good] : current);
  }
  const selectable = data?.rows.filter(good => !existing.has(good.id)) ?? [];
  const pageSelected = selectable.length > 0 && selectable.every(good => picked.some(item => item.id === good.id));
  return <CustomerServiceDialog title="관련상품 찾기" onClose={onClose} wide><div className="admin-story-dialog-content admin-story-picker">
    <form onSubmit={event => { event.preventDefault(); void search(1, { query, filters }); }}>
      <fieldset disabled={pending} className="admin-story-picker__filters">
        <label>검색 항목<select value={filters.field} onChange={event => change('field', event.target.value as StoryGoodFilters['field'])}><option value="all">상품명·상품코드·내부 ID</option><option value="name">상품명</option><option value="code">상품코드</option><option value="id">내부 ID</option></select></label>
        <label className="admin-story-picker__query">검색어<input autoFocus value={query} maxLength={100} onChange={event => setQuery(event.target.value)} placeholder="검색어를 입력하세요" /></label>
        <label>카테고리<select value={filters.categoryId ?? ''} onChange={event => change('categoryId', event.target.value || null)}><option value="">전체 카테고리</option>{data?.categories.map(category => <option key={category.id} value={category.id}>{category.path}</option>)}</select></label>
        <label>공개 상태<select value={filters.visibility} onChange={event => change('visibility', event.target.value as StoryGoodFilters['visibility'])}><option value="all">전체</option><option value="published">공개</option><option value="draft">공개 제외</option></select></label>
        <label>판매 가능 여부<select value={filters.stock} onChange={event => change('stock', event.target.value as StoryGoodFilters['stock'])}><option value="all">전체</option><option value="available">판매 가능</option><option value="soldout">품절</option></select></label>
        <label>판매 방식<select value={filters.saleType} onChange={event => change('saleType', event.target.value as StoryGoodFilters['saleType'])}><option value="all">전체</option><option value="stock">일반 판매</option><option value="preorder">예약 판매 옵션 포함</option></select></label>
        <label>리뷰<select value={filters.reviews} onChange={event => change('reviews', event.target.value as StoryGoodFilters['reviews'])}><option value="all">전체</option><option value="with">리뷰 있음</option><option value="without">리뷰 없음</option></select></label>
        <label>최소 평점<select value={filters.minRating} onChange={event => change('minRating', Number(event.target.value) as StoryGoodFilters['minRating'])}><option value="0">전체</option><option value="3">3점 이상</option><option value="4">4점 이상</option><option value="4.5">4.5점 이상</option></select></label>
        <label>최저 가격 (원)<input type="number" min={0} max={100000000} step={1} value={filters.minPrice ?? ''} onChange={event => change('minPrice', event.target.value === '' ? null : Number(event.target.value))} /></label>
        <label>최고 가격 (원)<input type="number" min={0} max={100000000} step={1} value={filters.maxPrice ?? ''} onChange={event => change('maxPrice', event.target.value === '' ? null : Number(event.target.value))} /></label>
        <label>정렬<select value={filters.sort} onChange={event => change('sort', event.target.value as StoryGoodFilters['sort'])}>{Object.entries(STORY_GOOD_SORTS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <div className="admin-story-picker__checks"><label><input type="checkbox" checked={filters.discounted} onChange={event => change('discounted', event.target.checked)} />할인 상품</label><label><input type="checkbox" checked={filters.freeShipping} onChange={event => change('freeShipping', event.target.checked)} />무료배송</label></div>
        <div className="admin-story-picker__submit"><button type="button" onClick={() => { setQuery(''); setFilters(DEFAULT_STORY_GOOD_FILTERS); void search(1, { query: '', filters: DEFAULT_STORY_GOOD_FILTERS }); }}>초기화</button><button className="btn btn-primary" type="submit">검색</button></div>
      </fieldset>
    </form>
    <GoodUrlAddField disabled={pending} onAdd={async id => {
      if (existing.has(id) || picked.some(item => item.id === id)) return { ok: false, message: GOOD_URL_ERRORS.exists };
      if (picked.length >= capacity) return { ok: false, message: `더 추가할 수 없습니다. 추가 가능 ${capacity}개를 확인해주세요.` };
      const good = await findGoodById(id, async page => {
        const result = await searchShoppingStoryGoodsAction(id, page, { ...DEFAULT_STORY_GOOD_FILTERS, field: 'id' });
        if (!result.ok) throw new Error(result.error);
        return result.data;
      });
      if (!good) return { ok: false, message: GOOD_URL_ERRORS.notFound };
      setPicked(current => current.some(item => item.id === good.id) ? current : [...current, good]);
      return { ok: true, message: `'${good.name}' 상품을 선택했습니다. 선택한 상품 추가를 눌러 반영해주세요.` };
    }} />
    <details className="admin-story-picker__help"><summary>검색·정렬 기준</summary><p>카테고리는 하위·추가 카테고리를 포함합니다. 가격은 현재 최저 옵션 판매가이며 할인은 현재 할인 옵션 또는 판매가보다 높은 비교가격이 있는 상품입니다. 무료배송은 최저 판매가 옵션 1개의 기본배송비 0원 기준입니다. 지역 추가배송비와 주문 전체 배송비는 주문 시 다시 계산합니다.</p><p>인기순은 찜 수, 판매순은 최근 30일 결제 승인 근거가 확인된 판매 수량이며 취소·반품 완료 주문을 제외합니다. 두 정렬은 서로의 지표를 동률 보조 기준으로 씁니다. 리뷰 수와 평점은 공개 리뷰 기준이며 동률이면 서로의 지표를 확인합니다. 마지막 동률은 등록일 최신순, 내부 ID순으로 표시합니다.</p></details>
    {error ? <p className="admin-story-error" role="alert">{error}</p> : null}
    <div className="admin-story-picker__selection"><span aria-live="polite">{pending ? '상품을 찾고 있습니다…' : `${data?.total.toLocaleString('ko-KR') ?? 0}개 검색됨`} · {picked.length}개 선택 / 추가 가능 {capacity}개</span><button type="button" disabled={pending || !selectable.length} onClick={() => setPicked(current => pageSelected ? current.filter(good => !selectable.some(row => row.id === good.id)) : [...current, ...selectable.filter(good => !current.some(row => row.id === good.id)).slice(0, Math.max(0, capacity - current.length))])}>{pageSelected ? '현재 페이지 선택 해제' : '현재 페이지 선택'}</button><button disabled={!picked.length} type="button" onClick={() => setPicked([])}>선택 비우기</button></div>
    <ul className="admin-story-search-results" aria-busy={pending}>{data?.rows.map(good => {
      const already = existing.has(good.id), selected = picked.some(item => item.id === good.id);
      return <li key={good.id}><input type="checkbox" aria-label={`${good.name} 선택`} checked={already || selected} disabled={pending || already || (!selected && picked.length >= capacity)} onChange={() => toggle(good)} />{good.imageUrl ? <img src={good.imageUrl} alt="" /> : <span className="admin-story-good-placeholder" />}<div><strong>{good.name}</strong><small>{good.code} · {good.price.toLocaleString('ko-KR')}원{good.priceMax && good.priceMax > good.price ? '~' : ''} · {good.published ? good.soldOut ? '품절' : '공개' : '공개 제외'}{good.discounted ? ' · 할인' : ''}{good.freeShipping ? ' · 무료배송' : ''}{good.saleType === 'preorder' ? ' · 예약 판매' : ''}</small><small>찜 {good.wishCount.toLocaleString('ko-KR')} · 최근 30일 판매 {good.salesQuantity.toLocaleString('ko-KR')} · 리뷰 {good.reviewCount.toLocaleString('ko-KR')}{good.ratingAverage !== null ? ` · 평점 ${good.ratingAverage.toFixed(2)}` : ''}</small></div>{already ? <span>선택됨</span> : null}</li>;
    })}</ul>
    {!pending && data && !data.rows.length ? <p className="admin-story-help">조건에 맞는 상품이 없습니다. 검색 조건을 변경해주세요.</p> : null}
    {data ? <nav className="admin-story-pagination" aria-label="상품 검색 페이지"><button disabled={pending || data.page <= 1} type="button" onClick={() => void search(data.page - 1, applied)}>이전</button><span>{data.page} / {Math.max(1, Math.ceil(data.total / data.pageSize))}</span><button disabled={pending || data.page * data.pageSize >= data.total} type="button" onClick={() => void search(data.page + 1, applied)}>다음</button></nav> : null}
    <div className="admin-story-picker__footer"><p>페이지와 검색 조건을 바꿔도 선택이 유지됩니다.</p><button className="btn btn-primary" disabled={!picked.length || pending || picked.length > capacity} type="button" onClick={() => onAdd(picked)}>선택한 {picked.length}개 상품 추가</button></div>
  </div></CustomerServiceDialog>;
}
