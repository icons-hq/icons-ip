import Link from 'next/link';
import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { AdminSelect } from '../console/AdminSelect';
import { consoleDatePresets, isConsoleDateRangeActive } from '../console/date-presets';
import { Button, buttonVariants } from '../kit/ui/button';
import { Input } from '../kit/ui/input';
import { GOODS_READINESS_REASONS } from '@/lib/admin/goods-readiness';
import { GOODS_LIST_DATE_FIELDS, GOODS_LIST_PATH, GOODS_LIST_SEARCH_FIELDS, GOODS_LIST_STOCK_OPTIONS, goodsListHref, type AdminGoodsListData } from '@/lib/admin/goods-list';

/*
 * 상품 조회 조건(스마트스토어 상품 조회/수정의 행 구성 그대로). 모양만 kit 카드·입력·버튼(ADR-0028)이고,
 * 조건 이름·URL 계약(GET 폼)·순서는 바뀌지 않는다.
 */
const PRESET = 'inline-flex h-7 items-center rounded-md px-2.5 text-[0.8rem] font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground aria-[current=true]:bg-background aria-[current=true]:text-primary-soft-foreground aria-[current=true]:shadow-sm';
const CHOICE = 'inline-flex min-h-7 cursor-pointer items-center gap-2 text-sm';
/* 넓은 화면에서는 버튼 자리를 뺀 나머지를 다섯 칸이 나눠 쓴다. 칸이 좁아지면 다음 줄로 내려간다. */
const SELECT = 'w-full sm:w-40 lg:w-auto lg:max-w-44 lg:min-w-32 lg:flex-1';
const QUERY_HINT = '상품번호는 쉼표나 공백으로 구분해 여러 개를 조회할 수 있습니다. 전체 검색에는 영문명·검색 키워드도 포함됩니다.';

function SearchRow({ label, children, className = '' }: { label: ReactNode; children: ReactNode; className?: string }) {
  return <div className={`grid gap-2 border-b py-2 sm:grid-cols-[5rem_minmax(0,1fr)] sm:items-center sm:gap-4 ${className}`} data-goods-search="row">
    <div className="text-sm font-medium">{label}</div>
    <div className="min-w-0">{children}</div>
  </div>;
}

export function GoodsListFiltersForm({ data }: { data: AdminGoodsListData }) {
  const { filters, ips, categories = [], origins = [] } = data;
  /* 접힌 조건이 걸려 있으면 펼쳐 둔다 — 안 보이는 조건이 목록을 거르면 안 된다. 전시상태는 위 건수 칸이 현재 값을 보여 주므로 뺀다. */
  const hasDetails = Boolean(filters.originId || filters.from || filters.to || [filters.payment, filters.saleType, filters.image, filters.restriction].some(value => value && value !== 'all'));
  return <form action={GOODS_LIST_PATH} method="get" className="flex min-w-0 flex-col rounded-xl border bg-card px-4 text-card-foreground" aria-label="상품 검색 조건" data-goods-search="form">
    <input type="hidden" name="sort" value={filters.sort ?? 'created_desc'} />
    <input type="hidden" name="pageSize" value={data.pageSize ?? filters.pageSize ?? 20} />
    <SearchRow label={<label htmlFor="goods-list-query">검색어</label>}>
      {/* 넓은 화면에서는 검색 대상과 입력 칸이 한 줄이다 — 첫 화면에 상품이 더 보인다. */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <fieldset className="flex flex-wrap gap-x-4 gap-y-1"><legend className="sr-only">검색 대상</legend>
          {GOODS_LIST_SEARCH_FIELDS.map(item => <label className={CHOICE} key={item.value}><input type="radio" name="field" value={item.value} defaultChecked={(filters.field ?? 'all') === item.value} />{item.label}</label>)}
        </fieldset>
        <Input className="min-w-60 flex-1 basis-60 sm:max-w-xl" id="goods-list-query" type="search" name="q" maxLength={100} defaultValue={filters.query} aria-describedby="goods-list-query-hint" placeholder="상품명, 상품번호, 판매자상품코드, ERP 코드" title={QUERY_HINT} />
      </div>
    </SearchRow>
    {/* 자주 쓰는 조건만 첫 화면에 둔다(판매상태·카테고리 한 줄). 나머지는 아래 상세검색에 접혀 있어도 같은 폼으로 제출된다. 넓은 화면에서는 오른쪽 끝을 상세검색·초기화·검색 자리로 비워 둔다. */}
    <SearchRow className="lg:border-b-0 lg:pr-56" label={<label htmlFor="goods-list-stock">판매상태</label>}><div className="flex flex-wrap items-center gap-2">
      <AdminSelect id="goods-list-stock" name="stock" defaultValue={filters.stock} wrapperClassName={SELECT}>{GOODS_LIST_STOCK_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</AdminSelect>
      <AdminSelect aria-label="판매기간" id="goods-list-sale-period" name="salePeriod" defaultValue={filters.salePeriod ?? 'all'} wrapperClassName={SELECT}><option value="all">전체 판매기간</option><option value="scheduled">판매대기 (시작 전)</option><option value="ended">판매기간 종료</option></AdminSelect>
      <AdminSelect aria-label="판매 준비 상태" id="goods-list-readiness" name="readiness" defaultValue={filters.readiness} wrapperClassName={SELECT}><option value="all">전체 준비 상태</option><option value="review_required">확인할 상품 전체</option><option value="ready">설정 준비 완료</option>{Object.entries(GOODS_READINESS_REASONS).map(([code, reason]) => <option key={code} value={code}>{reason.label}</option>)}</AdminSelect>
      <AdminSelect aria-label="카테고리" id="goods-list-category" name="categoryId" defaultValue={filters.categoryId} wrapperClassName={SELECT}><option value="">전체 카테고리</option>{categories.map(category => <option key={category.id} value={category.id}>{'　'.repeat(Math.max(0, category.depth - 1))}{category.name}{category.archivedAt ? ' · 보관' : ''}</option>)}</AdminSelect>
      <AdminSelect aria-label="연결 IP" id="goods-list-ip" name="ipId" defaultValue={filters.ipId} wrapperClassName={SELECT}><option value="">전체 IP</option>{ips.map(ip => <option key={ip.id} value={ip.id}>{ip.title}{ip.archivedAt ? ' · 보관' : ''}</option>)}</AdminSelect>
    </div></SearchRow>
    {/* [상세검색][초기화][검색]은 넓은 화면에서 위 줄 오른쪽 끝에 얹어 카드 높이를 줄인다(바닥 줄이 없다). 펼쳐도 같은 자리이고, 읽는 순서는 상세 조건 뒤다. */}
    <div className="relative" data-goods-search="footer">
    <details className="group/advanced" data-goods-search="advanced" open={hasDetails}>
      <summary className={`${buttonVariants({ variant: 'ghost', size: 'sm' })} my-2 w-fit cursor-pointer list-none lg:absolute lg:right-[7.75rem] lg:bottom-full lg:my-0 lg:mb-2.5 [&::-webkit-details-marker]:hidden`} data-slot="button">상세검색 <ChevronDown aria-hidden="true" className="transition-transform group-open/advanced:rotate-180" /></summary>
      <div className="border-t">
      <SearchRow label="전시상태"><fieldset className="flex flex-wrap gap-x-5 gap-y-1 sm:pt-1"><legend className="sr-only">전시상태</legend>
        {[{ value: 'active', label: '보관 제외' }, { value: 'all', label: '전체' }, { value: 'draft', label: '임시저장' }, { value: 'published', label: '전시중' }, { value: 'archived', label: '보관' }].map(item => <label className={CHOICE} key={item.value}><input type="radio" name="status" value={item.value} defaultChecked={filters.status === item.value} />{item.label}</label>)}
      </fieldset></SearchRow>
      <SearchRow label={<label htmlFor="goods-list-date-field">기간</label>}><div className="flex flex-wrap items-center gap-2">
        <AdminSelect id="goods-list-date-field" name="dateField" defaultValue={filters.dateField ?? 'created'} wrapperClassName="w-36">{GOODS_LIST_DATE_FIELDS.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}</AdminSelect>
        <div aria-label="조회기간 빠른 선택" className="inline-flex flex-wrap rounded-lg bg-muted p-0.5" role="group">{consoleDatePresets().map(preset => <Link aria-current={isConsoleDateRangeActive(preset.range, filters) ? 'true' : undefined} className={PRESET} key={preset.id} href={goodsListHref({ ...filters, ...preset.range }, 1)}>{preset.label}</Link>)}<Link aria-current={!filters.from && !filters.to ? 'true' : undefined} className={PRESET} href={goodsListHref({ ...filters, from: null, to: null }, 1)}>전체</Link></div>
        <div className="flex min-w-0 items-center gap-1.5"><label><span className="sr-only">시작일</span><Input className="w-36" type="date" name="from" defaultValue={filters.from ?? ''} /></label><span aria-hidden="true" className="text-muted-foreground">~</span><label><span className="sr-only">종료일</span><Input className="w-36" type="date" name="to" defaultValue={filters.to ?? ''} /></label></div>
      </div></SearchRow>
      <div className="grid gap-2 py-3 sm:grid-cols-[5rem_minmax(0,1fr)] sm:gap-4"><span className="text-sm font-medium sm:pt-1.5">상세검색</span><div className="grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:max-w-3xl">
        <AdminSelect aria-label="출고지" id="goods-list-origin" name="originId" defaultValue={filters.originId ?? ''}><option value="">전체 출고지</option>{origins.map(origin => <option key={origin.id} value={origin.id}>{origin.name}{origin.active ? '' : ' · 사용 안 함'}</option>)}</AdminSelect>
        <AdminSelect aria-label="결제수단" id="goods-list-payment" name="payment" defaultValue={filters.payment ?? 'all'}><option value="all">전체 결제수단</option><option value="card">카드 결제 가능</option><option value="bank">무통장입금 가능</option><option value="none">결제수단 없음</option></AdminSelect>
        <AdminSelect aria-label="상품 유형" name="saleType" defaultValue={filters.saleType ?? 'all'}><option value="all">전체 상품 유형</option><option value="stock">일반 재고 상품</option><option value="preorder">예약판매 옵션 포함</option></AdminSelect>
        <AdminSelect aria-label="판매 제한" name="restriction" defaultValue={filters.restriction ?? 'all'}><option value="all">전체 판매 제한</option><option value="none">제한 없음</option><option value="adult">성인 상품</option></AdminSelect>
        <AdminSelect aria-label="대표 이미지" id="goods-list-image" name="image" defaultValue={filters.image ?? 'all'}><option value="all">대표 이미지 전체</option><option value="with">이미지 등록</option><option value="without">이미지 미등록</option></AdminSelect>
      </div></div>
      </div>
    </details>
    {/* 검색어 안내는 입력 칸의 설명(스크린리더)·말풍선과 아래 목록 안내에 있다 — 화면 줄을 차지하지 않는다. */}
    <p className="sr-only" id="goods-list-query-hint">{QUERY_HINT}</p>
    <div className="absolute top-1.5 right-0 flex gap-2 lg:top-auto lg:bottom-full lg:mb-2"><Link className={buttonVariants({ variant: 'ghost' })} data-slot="button" href={GOODS_LIST_PATH}>초기화</Link><Button type="submit" variant="soft">검색</Button></div>
    </div>
  </form>;
}
