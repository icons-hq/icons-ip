'use client';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { saveDetailPresentationAction, type DetailSaveResult } from '@/app/admin/product-detail-presentation-actions';
import { AdminPageHeader, AdminSectionCard } from '../console/AdminKit';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { DETAIL_MODULE_KEYS, PRODUCT_DETAIL_PRESENTATION_PATH, type DetailBanner, type DetailModules, type DetailPresentation, type DetailPresentationSnapshot, type DetailSection } from '@/lib/product-detail-presentation';

export interface DetailTargetOption { id: string; title: string; archived?: boolean }
/* 상품상세 표시 설정(템플릿 룩, ADR-0028). 링크 탭은 셸의 콘솔 전환과 같은 모양이다. */
const TABS = 'inline-flex max-w-full items-center self-start overflow-x-auto rounded-lg bg-muted p-0.5';
const TAB = 'inline-flex h-7 shrink-0 items-center rounded-md px-2.5 text-[0.8rem] font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:bg-background aria-[current=page]:text-foreground aria-[current=page]:shadow-sm';
const CHECK = 'flex items-start gap-2.5 text-sm [&>input]:mt-0.5';
const CHECK_TEXT = 'flex flex-col gap-1 leading-normal';
const CHECK_HINT = 'text-sm font-normal text-muted-foreground';
const LEGEND = 'mb-2.5 text-sm font-medium';
const CHOICES = 'flex flex-wrap gap-x-4 gap-y-2.5';
const CHOICE = 'flex items-center gap-2 text-sm';
const COUNTED = 'flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-2 text-sm font-medium';
const NOTE = 'text-sm leading-relaxed text-muted-foreground [&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-4';
const moduleCopy: Record<keyof DetailModules, { title: string; text: string }> = {
  reviewSummary: { title: '상단 리뷰 요약', text: '공개 리뷰 전체의 4·5점 비율과 4점 이상 리뷰를 표시합니다. 사진·평점·최신순으로 최대 10개를 보여줍니다.' },
  similar: { title: '자동 유사상품 추천', text: '같은 공개 하위 분류, 같은 IP의 상품을 순서대로 추천합니다. 5개 이상일 때 최대 30개를 표시하며 수동 유사상품 편성이 있으면 자동 추천은 숨깁니다.' },
  together: { title: '자동 함께구매 추천', text: '직전 30일에 실제 같은 주문으로 구매한 상품을 추천합니다. 결제 확정과 취소·반품을 반영하며 5개 이상일 때 최대 30개를 표시합니다. 수동 함께 구매 편성이 우선합니다.' },
  categoryPopular: { title: '카테고리 인기상품', text: '공개된 최하위 대표 분류에서 직전 30일 판매수량·현재 찜 수 순으로 최대 12개를 보여줍니다. 대분류만 지정된 상품에서는 숨깁니다.' },
  storePopular: { title: '스토어 인기상품', text: '스토어 전체의 직전 30일 판매수량·현재 찜 수 순으로 최대 12개를 보여줍니다. 판매·찜 근거가 없는 상품으로 채우지 않습니다.' },
};
export function DetailPresentationScreen({ snapshot, section, goods, categories }: {
  snapshot: DetailPresentationSnapshot; section: DetailSection; goods: DetailTargetOption[]; categories: DetailTargetOption[];
}) {
  return <section className="flex min-w-0 flex-col gap-4">
    <AdminPageHeader title="상품상세 표시 설정" description="상세 상단 문구와 리뷰, 실제 상품·구매 데이터를 사용하는 자동 추천을 설정합니다." />
    <nav aria-label="상품상세 설정 종류" className={TABS}>
      <Link className={TAB} href={PRODUCT_DETAIL_PRESENTATION_PATH} aria-current={section === 'banner' ? 'page' : undefined}>상단 띠배너</Link>
      <Link className={TAB} href={`${PRODUCT_DETAIL_PRESENTATION_PATH}?tab=modules`} aria-current={section === 'modules' ? 'page' : undefined}>리뷰·자동 추천</Link>
      <Link className={TAB} href={`${PRODUCT_DETAIL_PRESENTATION_PATH}?tab=otherComposition`} aria-current={section === 'otherComposition' ? 'page' : undefined}>다른 구성 추천</Link>
      <Link className={TAB} href="/admin/display/settings">공통·상품목록 설정</Link>
      <Link className={TAB} href="/admin/display/detail/experience">구매·탐색 설정</Link>
      <Link className={TAB} href="/admin/display/detail/media">대표미디어 설정</Link>
      <Link className={TAB} href="/admin/display/detail/reviews">BEST 리뷰 설정</Link>
    </nav>
    <DetailForm key={section} snapshot={snapshot} section={section} goods={goods} categories={categories} />
  </section>;
}
function DetailForm({ snapshot, section, goods, categories }: {
  snapshot: DetailPresentationSnapshot; section: DetailSection; goods: DetailTargetOption[]; categories: DetailTargetOption[];
}) {
  const [values, setValues] = useState(snapshot.values);
  const [revision, setRevision] = useState(snapshot.revisions[section]);
  const [pending, setPending] = useState(false), [uncertain, setUncertain] = useState(false);
  const [message, setMessage] = useState(''), [error, setError] = useState(false);
  const request = useRef<{ values: DetailPresentation[DetailSection]; revision: number; id: string } | null>(null);
  const banner = values.banner;
  function changeBanner<K extends keyof DetailBanner>(key: K, value: DetailBanner[K]) { setValues(current => ({ ...current, banner: { ...current.banner, [key]: value } })); }
  async function save() {
    if (pending) return;
    const normalized = section === 'banner' ? { ...banner, title: banner.title.trim(), text: banner.text.trim(),
      startsOn: banner.periodEnabled ? banner.startsOn : null, endsOn: banner.periodEnabled ? banner.endsOn : null,
      goodIds: banner.targetType === 'goods' ? banner.goodIds : [], categoryIds: banner.targetType === 'categories' ? banner.categoryIds : [] } : values[section];
    request.current ??= { values: normalized, revision, id: crypto.randomUUID() };
    setPending(true); setMessage('');
    let result: DetailSaveResult;
    try { result = await saveDetailPresentationAction(section, request.current.values, request.current.revision, request.current.id); }
    catch { result = { error: '저장 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.', uncertain: true }; }
    setPending(false);
    if ('error' in result) {
      setMessage(result.error); setError(true); setUncertain(Boolean(result.uncertain));
      if (!result.uncertain) request.current = null;
    } else {
      setValues(current => ({ ...current, [section]: result.values })); setRevision(result.revision);
      request.current = null; setUncertain(false); setError(false); setMessage('저장했습니다. 공개 상품상세에도 적용되었습니다.');
    }
  }
  return <form className="flex min-w-0 flex-col gap-4" onSubmit={event => { event.preventDefault(); void save(); }}>
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,440px)]">
      <AdminSectionCard title={section === 'banner' ? '상단 띠배너' : section === 'otherComposition' ? '다른 구성 추천' : '리뷰·자동 추천'}>
        <fieldset disabled={pending || uncertain} className="grid min-w-0 gap-5">
          {section === 'banner' ? <>
            <label className={CHECK}><input type="checkbox" checked={banner.enabled} onChange={event => changeBanner('enabled', event.target.checked)} /><span className={CHECK_TEXT}>상단 띠배너 노출<small className={CHECK_HINT}>상품 대표이미지 위에 표시합니다. 노출하려면 제목과 설명을 모두 입력해주세요.</small></span></label>
            <fieldset className="min-w-0"><legend className={LEGEND}>배너 스타일</legend><div className={CHOICES}>{(['light', 'dark'] as const).map(style => <label className={CHOICE} key={style}><input type="radio" name="bannerStyle" checked={banner.style === style} onChange={() => changeBanner('style', style)} />{style === 'light' ? '라이트' : '다크'}</label>)}</div></fieldset>
            <label className={COUNTED}>혜택 제목 <span className="ml-auto text-xs font-normal text-muted-foreground tabular-nums">{[...banner.title].length} / 10자</span><Input aria-label="혜택 제목" className="basis-full" value={banner.title} onChange={event => changeBanner('title', event.target.value)} placeholder="예: 단독 이벤트" /></label>
            <label className={COUNTED}>혜택 설명 <span className="ml-auto text-xs font-normal text-muted-foreground tabular-nums">{[...banner.text].length} / 20자</span><Input aria-label="혜택 설명" className="basis-full" value={banner.text} onChange={event => changeBanner('text', event.target.value)} placeholder="구체적인 혜택 내용을 입력하세요" /></label>
            <label className={CHECK}><input type="checkbox" checked={banner.periodEnabled} onChange={event => changeBanner('periodEnabled', event.target.checked)} /><span className={CHECK_TEXT}>노출 기간 설정<small className={CHECK_HINT}>한국 시각 시작일 00:00부터 종료일 전체에 노출합니다.</small></span></label>
            {banner.periodEnabled ? <div className="flex flex-col gap-3 sm:flex-row"><label className="flex min-w-0 flex-1 flex-col gap-2 text-sm font-medium">시작일<Input aria-label="배너 시작일" type="date" min="2000-01-01" max="2099-12-31" value={banner.startsOn ?? ''} onChange={event => changeBanner('startsOn', event.target.value || null)} /></label><label className="flex min-w-0 flex-1 flex-col gap-2 text-sm font-medium">종료일<Input aria-label="배너 종료일" type="date" min="2000-01-01" max="2099-12-31" value={banner.endsOn ?? ''} onChange={event => changeBanner('endsOn', event.target.value || null)} /></label></div> : null}
            <fieldset className="min-w-0"><legend className={LEGEND}>배너 노출 대상</legend><div className={CHOICES}>{([['all', '전체 상품'], ['goods', '개별 상품'], ['categories', '카테고리']] as const).map(([type, label]) => <label className={CHOICE} key={type}><input type="radio" name="targetType" checked={banner.targetType === type} onChange={() => changeBanner('targetType', type)} />{label}</label>)}</div></fieldset>
            {banner.targetType === 'goods' ? <DetailTargetPicker name="상품" options={goods} selected={banner.goodIds} limit={200} onChange={ids => changeBanner('goodIds', ids)} /> : null}
            {banner.targetType === 'categories' ? <><p className="text-sm text-muted-foreground">최대 10개 카테고리의 하위 상품을 포함합니다. 대표·추가 분류에 적용하며 비공개·보관 분류의 상품에는 표시하지 않습니다.</p><DetailTargetPicker name="카테고리" options={categories} selected={banner.categoryIds} limit={10} onChange={ids => changeBanner('categoryIds', ids)} /></> : null}
          </> : section === 'otherComposition' ? <label className={CHECK}><input type="checkbox" checked={values.otherComposition.enabled} onChange={event => setValues(current => ({ ...current, otherComposition: { enabled: event.target.checked } }))} /><span className={CHECK_TEXT}>다른 구성 추천 표시<small className={CHECK_HINT}>운영자가 연결한 다른 용량·구성·향 등의 상품을 리뷰 요약 아래에 표시합니다. 현재 상품 외에 공개 가능한 상품이 없으면 숨깁니다.</small></span></label> : DETAIL_MODULE_KEYS.map(key => <label key={key} className={CHECK}><input type="checkbox" checked={values.modules[key]} onChange={event => setValues(current => ({ ...current, modules: { ...current.modules, [key]: event.target.checked } }))} /><span className={CHECK_TEXT}>{moduleCopy[key].title}<small className={CHECK_HINT}>{moduleCopy[key].text}</small></span></label>)}
        </fieldset>
        {section === 'modules' ? <p className={NOTE}>수동 <Link href="/admin/catalog/related-goods">연관상품 편성</Link>은 해당 편성의 노출·기간을 따릅니다. 자동 추천을 꺼도 수동 편성은 유지됩니다. 일반 리뷰 탭과 필수 상품·배송 정보는 항상 유지됩니다.</p> : null}
        {section === 'otherComposition' ? <p className={NOTE}><Link href="/admin/catalog/related-goods?kind=other_composition">다른 구성 상품 편성</Link>에서 상품과 표시값을 연결합니다. 대표 상품이 비공개여도 공개된 구성 상품은 서로 표시됩니다. 이 설정은 다른 연관상품이나 구매 옵션을 바꾸지 않습니다.</p> : null}
      </AdminSectionCard>
      <aside className="flex w-full min-w-0 max-w-[440px] flex-col gap-1 rounded-xl border bg-card p-5 text-sm lg:max-w-none" aria-label="상품상세 저장 전 미리보기"><h2 className="text-base font-medium">저장 전 미리보기</h2><p className="mb-3 text-xs text-muted-foreground">표시 위치를 확인하는 예시입니다.</p>
        {section === 'banner' ? <div className="overflow-hidden rounded-lg border pb-4">
          {banner.enabled && banner.title.trim() && banner.text.trim() ? <div className="flex flex-wrap gap-x-3 gap-y-1.5 bg-muted px-4 py-3.5 text-[13px] [overflow-wrap:anywhere] data-[style=dark]:bg-foreground data-[style=dark]:text-background" data-style={banner.style}><strong className="font-semibold">{banner.title}</strong><span>{banner.text}</span></div> : null}
          <div className="grid aspect-square place-items-center bg-muted text-muted-foreground">대표이미지</div><h3 className="mx-4 mt-3 font-medium">상품명</h3><p className="mx-4 mt-3">가격·옵션·구매 영역</p>
          <small className="mx-4 mt-3 block leading-relaxed text-muted-foreground">선택 대상·노출 기간·현재 공개 상태는 저장 후 실제 상품상세에서 확인합니다.</small>
        </div> : <div className="grid gap-2 text-[13px] [&>div]:rounded-lg [&>div]:border [&>div]:p-4 [&_small]:mt-1.5 [&_small]:block [&_small]:text-muted-foreground"><div>상품 대표이미지·구매 영역</div>{values.modules.reviewSummary ? <div>4점 이상 리뷰 비율·리뷰 카드</div> : null}{values.otherComposition.enabled ? <div>다른 구성도 살펴보세요<small>공개된 다른 구성 상품과 선택적 구성 표시값</small></div> : null}<div>수동 연관상품 편성</div>{DETAIL_MODULE_KEYS.filter(key => key !== 'reviewSummary' && values.modules[key]).map(key => <div key={key}>{moduleCopy[key].title}<small>현재 노출 가능한 후보가 있을 때 표시</small></div>)}<div>상세정보·리뷰·문의·배송 안내</div></div>}
      </aside>
    </div>
    <div className="flex flex-col items-stretch justify-end gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-center">{message ? <p className={`text-sm sm:mr-auto ${error ? 'text-destructive' : 'text-[var(--wc-success)]'}`} role={error ? 'alert' : 'status'}>{message}</p> : null}<Button type="submit" disabled={pending}>{pending ? '저장 중…' : uncertain ? '같은 요청 결과 확인' : '설정 저장'}</Button></div>
    <p className={NOTE}>띠배너, 리뷰·자동 추천, 다른 구성 추천은 각각 저장합니다. 후보가 없거나 조건에 맞지 않는 영역은 공개 화면에서 숨깁니다.</p>
  </form>;
}
function DetailTargetPicker({ name, options, selected, limit, onChange }: { name: string; options: DetailTargetOption[]; selected: string[]; limit: number; onChange: (ids: string[]) => void }) {
  const [query, setQuery] = useState(''), [page, setPage] = useState(1);
  const matches = options.filter(option => (!option.archived || selected.includes(option.id)) && `${option.title} ${option.id}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const pageCount = Math.max(1, Math.ceil(matches.length / 20));
  const currentPage = Math.min(page, pageCount), rows = matches.slice((currentPage - 1) * 20, currentPage * 20);
  return <section className="flex min-w-0 flex-col gap-2.5 border-t pt-4" aria-label={`${name} 대상 선택`}>
    <label className="flex min-w-0 flex-col gap-2 text-sm font-medium">{name} 검색<Input aria-label={`${name} 대상 검색`} value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} placeholder="이름 또는 코드" /></label>
    <p className="text-sm text-muted-foreground tabular-nums">조회 {matches.length}개 · 선택 {selected.length} / {limit}개</p>
    <div className="max-h-[300px] overflow-auto rounded-lg border">{rows.map(option => <label className="flex items-start gap-2.5 border-b p-2.5 text-sm last:border-b-0 [&>input]:mt-0.5" key={option.id}><input type="checkbox" aria-label={`${option.title} 대상 선택`} checked={selected.includes(option.id)} disabled={!selected.includes(option.id) && (selected.length >= limit || option.archived)} onChange={() => onChange(selected.includes(option.id) ? selected.filter(id => id !== option.id) : [...selected, option.id])} /><span className="min-w-0 [overflow-wrap:anywhere]">{option.title}{option.archived ? ' (보관)' : ''}<small className="mt-1 block text-[11px] text-muted-foreground">{option.id}</small></span></label>)}{!rows.length ? <p className="p-4 text-center text-sm text-muted-foreground">조회된 {name}이 없습니다.</p> : null}</div>
    <nav className="flex items-center justify-center gap-3 text-xs" aria-label={`${name} 선택 페이지`}><Button type="button" onClick={() => setPage(currentPage - 1)} disabled={currentPage <= 1} size="sm" variant="outline">이전</Button><span className="tabular-nums">{currentPage} / {pageCount}</span><Button type="button" onClick={() => setPage(currentPage + 1)} disabled={currentPage >= pageCount} size="sm" variant="outline">다음</Button></nav>
    {selected.length ? <details className="rounded-lg border px-3 py-2.5 text-sm"><summary className="cursor-pointer font-medium">선택한 {name} {selected.length}개</summary><ul className="mt-2 max-h-60 overflow-auto">{selected.map(id => <li className="flex items-center justify-between gap-2.5 py-1.5 [overflow-wrap:anywhere]" key={id}><span className="min-w-0">{options.find(option => option.id === id)?.title ?? id}</span><Button className="shrink-0" type="button" aria-label={`${options.find(option => option.id === id)?.title ?? id} 대상 해제`} onClick={() => onChange(selected.filter(current => current !== id))} size="xs" variant="outline">해제</Button></li>)}</ul></details> : null}
  </section>;
}
