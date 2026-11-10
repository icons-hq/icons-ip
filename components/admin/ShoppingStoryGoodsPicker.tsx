/* eslint-disable @next/next/no-img-element -- Verified catalog media and deterministic seed assets. */
'use client';
import { useEffect, useRef, useState } from 'react';
import { searchShoppingStoryGoodsAction } from '@/app/admin/shopping-story-actions';
import { DEFAULT_STORY_GOOD_FILTERS, STORY_GOOD_SORTS, storyGoodSelectionCapacity, validStoryGoodFilters, type StoryGoodCandidates, type StoryGoodFilters } from '@/lib/admin/shopping-story-picker';
import type { ShoppingStoryGoodOption } from '@/lib/admin/shopping-stories';
import { CustomerServiceDialog } from './screens/CustomerServiceDialog';
import { findGoodById, GOOD_URL_ERRORS } from '@/lib/admin/good-url';
import { GoodUrlAddField } from './GoodUrlAddField';
import { ConsolePagination } from '@/components/admin/console/ConsolePagination';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { AdminNotice } from '@/components/admin/console/AdminKit';

/* 관련상품 찾기 팝업(템플릿 룩, ADR-0028). 조회 조건·선택 유지·추가 한도 계약은 그대로다. */
const FIELD = 'flex min-w-0 flex-col gap-1.5 text-sm font-medium';
const CHECK = 'flex items-center gap-1.5 text-sm';

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
  return <CustomerServiceDialog title="관련상품 찾기" onClose={onClose} wide><div className="flex min-w-0 flex-col gap-4">
    <form onSubmit={event => { event.preventDefault(); void search(1, { query, filters }); }}>
      <fieldset disabled={pending} className="grid min-w-0 grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        <label className={FIELD}>검색 항목<NativeSelect className="w-full" value={filters.field} onChange={event => change('field', event.target.value as StoryGoodFilters['field'])}><option value="all">상품명·상품코드·내부 ID</option><option value="name">상품명</option><option value="code">상품코드</option><option value="id">내부 ID</option></NativeSelect></label>
        <label className={`${FIELD} lg:col-span-2`}>검색어<Input autoFocus value={query} maxLength={100} onChange={event => setQuery(event.target.value)} placeholder="검색어를 입력하세요" /></label>
        <label className={FIELD}>카테고리<NativeSelect className="w-full" value={filters.categoryId ?? ''} onChange={event => change('categoryId', event.target.value || null)}><option value="">전체 카테고리</option>{data?.categories.map(category => <option key={category.id} value={category.id}>{category.path}</option>)}</NativeSelect></label>
        <label className={FIELD}>공개 상태<NativeSelect className="w-full" value={filters.visibility} onChange={event => change('visibility', event.target.value as StoryGoodFilters['visibility'])}><option value="all">전체</option><option value="published">공개</option><option value="draft">공개 제외</option></NativeSelect></label>
        <label className={FIELD}>판매 가능 여부<NativeSelect className="w-full" value={filters.stock} onChange={event => change('stock', event.target.value as StoryGoodFilters['stock'])}><option value="all">전체</option><option value="available">판매 가능</option><option value="soldout">품절</option></NativeSelect></label>
        <label className={FIELD}>판매 방식<NativeSelect className="w-full" value={filters.saleType} onChange={event => change('saleType', event.target.value as StoryGoodFilters['saleType'])}><option value="all">전체</option><option value="stock">일반 판매</option><option value="preorder">예약 판매 옵션 포함</option></NativeSelect></label>
        <label className={FIELD}>리뷰<NativeSelect className="w-full" value={filters.reviews} onChange={event => change('reviews', event.target.value as StoryGoodFilters['reviews'])}><option value="all">전체</option><option value="with">리뷰 있음</option><option value="without">리뷰 없음</option></NativeSelect></label>
        <label className={FIELD}>최소 평점<NativeSelect className="w-full" value={filters.minRating} onChange={event => change('minRating', Number(event.target.value) as StoryGoodFilters['minRating'])}><option value="0">전체</option><option value="3">3점 이상</option><option value="4">4점 이상</option><option value="4.5">4.5점 이상</option></NativeSelect></label>
        <label className={FIELD}>최저 가격 (원)<Input type="number" min={0} max={100000000} step={1} value={filters.minPrice ?? ''} onChange={event => change('minPrice', event.target.value === '' ? null : Number(event.target.value))} /></label>
        <label className={FIELD}>최고 가격 (원)<Input type="number" min={0} max={100000000} step={1} value={filters.maxPrice ?? ''} onChange={event => change('maxPrice', event.target.value === '' ? null : Number(event.target.value))} /></label>
        <label className={FIELD}>정렬<NativeSelect className="w-full" value={filters.sort} onChange={event => change('sort', event.target.value as StoryGoodFilters['sort'])}>{Object.entries(STORY_GOOD_SORTS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</NativeSelect></label>
        <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-1"><label className={CHECK}><input type="checkbox" checked={filters.discounted} onChange={event => change('discounted', event.target.checked)} />할인 상품</label><label className={CHECK}><input type="checkbox" checked={filters.freeShipping} onChange={event => change('freeShipping', event.target.checked)} />무료배송</label></div>
        <div className="flex items-center justify-end gap-2 sm:col-span-2"><Button type="button" onClick={() => { setQuery(''); setFilters(DEFAULT_STORY_GOOD_FILTERS); void search(1, { query: '', filters: DEFAULT_STORY_GOOD_FILTERS }); }} variant="ghost">초기화</Button><Button type="submit" variant="soft">검색</Button></div>
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
    <details className="rounded-lg border px-3.5 py-2.5 text-xs leading-relaxed text-muted-foreground [&>p]:mt-2"><summary className="cursor-pointer font-medium text-foreground">검색·정렬 기준</summary><p>카테고리는 하위·추가 카테고리를 포함합니다. 가격은 현재 최저 옵션 판매가이며 할인은 현재 할인 옵션 또는 판매가보다 높은 비교가격이 있는 상품입니다. 무료배송은 최저 판매가 옵션 1개의 기본배송비 0원 기준입니다. 지역 추가배송비와 주문 전체 배송비는 주문 시 다시 계산합니다.</p><p>인기순은 찜 수, 판매순은 최근 30일 결제 승인 근거가 확인된 판매 수량이며 취소·반품 완료 주문을 제외합니다. 두 정렬은 서로의 지표를 동률 보조 기준으로 씁니다. 리뷰 수와 평점은 공개 리뷰 기준이며 동률이면 서로의 지표를 확인합니다. 마지막 동률은 등록일 최신순, 내부 ID순으로 표시합니다.</p></details>
    {error ? <AdminNotice role="alert" tone="danger">{error}</AdminNotice> : null}
    <div className="flex flex-wrap items-center gap-2.5 text-xs"><span className="min-w-60 flex-1" aria-live="polite">{pending ? '상품을 찾고 있습니다…' : `${data?.total.toLocaleString('ko-KR') ?? 0}개 검색됨`} · {picked.length}개 선택 / 추가 가능 {capacity}개</span><Button type="button" disabled={pending || !selectable.length} onClick={() => setPicked(current => pageSelected ? current.filter(good => !selectable.some(row => row.id === good.id)) : [...current, ...selectable.filter(good => !current.some(row => row.id === good.id)).slice(0, Math.max(0, capacity - current.length))])} size="sm" variant="outline">{pageSelected ? '현재 페이지 선택 해제' : '현재 페이지 선택'}</Button><Button disabled={!picked.length} type="button" onClick={() => setPicked([])} size="sm" variant="ghost">선택 비우기</Button></div>
    <ul className="flex flex-col" aria-busy={pending}>{data?.rows.map(good => {
      const already = existing.has(good.id), selected = picked.some(item => item.id === good.id);
      return <li className="flex items-center gap-3 border-t py-3 text-xs" key={good.id}><input type="checkbox" aria-label={`${good.name} 선택`} checked={already || selected} disabled={pending || already || (!selected && picked.length >= capacity)} onChange={() => toggle(good)} />{good.imageUrl ? <img className="block size-10 shrink-0 rounded-md bg-muted object-cover sm:size-12" src={good.imageUrl} alt="" /> : <span className="block size-10 shrink-0 rounded-md bg-muted sm:size-12" />}<div className="min-w-0 flex-1"><strong className="font-medium [overflow-wrap:anywhere]">{good.name}</strong><small className="mt-0.5 block leading-relaxed text-muted-foreground">{good.code} · {good.price.toLocaleString('ko-KR')}원{good.priceMax && good.priceMax > good.price ? '~' : ''} · {good.published ? good.soldOut ? '품절' : '공개' : '공개 제외'}{good.discounted ? ' · 할인' : ''}{good.freeShipping ? ' · 무료배송' : ''}{good.saleType === 'preorder' ? ' · 예약 판매' : ''}</small><small className="block leading-relaxed text-muted-foreground">찜 {good.wishCount.toLocaleString('ko-KR')} · 최근 30일 판매 {good.salesQuantity.toLocaleString('ko-KR')} · 리뷰 {good.reviewCount.toLocaleString('ko-KR')}{good.ratingAverage !== null ? ` · 평점 ${good.ratingAverage.toFixed(2)}` : ''}</small></div>{already ? <span className="shrink-0 text-[11px] text-muted-foreground">선택됨</span> : null}</li>;
    })}</ul>
    {!pending && data && !data.rows.length ? <p className="py-6 text-center text-sm text-muted-foreground">조건에 맞는 상품이 없습니다. 검색 조건을 변경해주세요.</p> : null}
    {data ? <ConsolePagination label="상품 검색 페이지" page={data.page} pageSize={data.pageSize} total={data.total} unit="개" disabled={pending} onPageChange={page => void search(page, applied)} /> : null}
    <div className="sticky bottom-0 flex flex-col gap-3 border-t bg-popover py-4 text-xs sm:flex-row sm:items-center sm:justify-between"><p className="text-muted-foreground">페이지와 검색 조건을 바꿔도 선택이 유지됩니다.</p><Button disabled={!picked.length || pending || picked.length > capacity} type="button" onClick={() => onAdd(picked)}>선택한 {picked.length}개 상품 추가</Button></div>
  </div></CustomerServiceDialog>;
}
