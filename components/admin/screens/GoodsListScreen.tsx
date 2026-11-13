import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Archive, ArrowUpRight, Ban, Boxes, CalendarClock, CalendarX, ChevronDown, Eye, FilePen, Package, PackageMinus, PackageX, Plus, TriangleAlert } from 'lucide-react';
import { ShippingRegionExpiryNotice } from '../ShippingRegionExpiryNotice';
import type { ShippingRegionExpiryState } from '@/lib/admin/shipping-regions';
import { GOODS_READINESS_STATE_LABELS, unknownGoodsReadiness, type AdminGoodsReadiness } from '@/lib/admin/goods-readiness';
import { statusTone, type AdminTone } from '@/lib/admin/status-tone';
import { AdminStatusBadge } from '../console/AdminKit';
import { ADMIN_COUNT_CARD_GRID_CLASS, AdminCountCard } from '../console/AdminCountCard';
import { MarketingLinksGoodsGrid } from '../marketing/MarketingLinksGoodsGrid';
import { ConsolePagination } from '../console/ConsolePagination';
import { buttonVariants } from '../kit/ui/button';
import { GoodsListFiltersForm } from './GoodsListFiltersForm';
import { CustomerServiceListSelect } from './CustomerServiceListControls';
import { GOODS_LIST_PAGE_SIZE, GOODS_LIST_PAGE_SIZES, GOODS_LIST_SORT_OPTIONS, goodsListHref, goodsListIsNarrowed, goodEditorHref, goodPreviewHref, type AdminGoodSummary, type AdminGoodsListData } from '@/lib/admin/goods-list';
import { goodDetailHref } from '@/lib/goods-display';
import type { GoodsGroupIdentity } from '@/lib/admin/goods-groups';
import { GoodsInlineOptionStock, GoodsInlinePrice, GoodsInlineSale, GoodsInlineStock } from '../GoodsInlineEdit';
import { GoodsInlineDialogHost, GoodsInlineDialogNotice } from '../GoodsInlineDialogHost';
import { GoodsIpBulkDiscount } from '../GoodsIpBulkDiscount';
import { kstDay } from '@/lib/admin/kst';

function priceLabel(min: number | null | undefined, max: number | null | undefined) {
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max)) return '가격 확인 필요';
  return min === max ? `${min!.toLocaleString('ko-KR')}원` : `${min!.toLocaleString('ko-KR')}~${max!.toLocaleString('ko-KR')}원`;
}

/* 기본 조회가 '보관 제외'라 그 칸도 둔다 — 어느 칸을 보고 있는지 항상 한 칸이 켜진다. */
const STATUS_ITEMS = [{ label: '전체', status: 'all', icon: Boxes }, { label: '보관 제외', status: 'active', icon: Package }, { label: '초안', status: 'draft', icon: FilePen }, { label: '공개', status: 'published', icon: Eye }, { label: '보관', status: 'archived', icon: Archive }] as const;
/*
 * 판매 조건 칸(SHEET-036 — 스마트스토어 상단 건수처럼 판매대기·판매중지·판매종료를 더한다). 품절·소량 재고·판매중지는 판매상태 조건(stock),
 * 판매대기·판매종료는 판매기간 조건(salePeriod)으로 거른다. 숫자는 그 칸의 조건 축만 뺀 같은 검색 조건에서 서버가 센 값이라
 * 그 칸을 눌렀을 때의 목록 개수와 같다. 켜진 칸을 다시 누르면 그 조건을 푼다.
 */
const CONDITION_ITEMS = [
  { label: '판매대기 보기', axis: 'salePeriod', value: 'scheduled', tone: 'info', icon: CalendarClock },
  { label: '품절 보기', axis: 'stock', value: 'out_of_stock', tone: 'danger', icon: PackageX },
  { label: '소량 재고 보기', axis: 'stock', value: 'low', tone: 'warning', icon: PackageMinus },
  { label: '판매중지 보기', axis: 'stock', value: 'stopped', tone: 'danger', icon: Ban },
  { label: '판매종료 보기', axis: 'salePeriod', value: 'ended', tone: 'default', icon: CalendarX },
] as const;
/* 준비 사유는 고쳐야 할 일이다 — 파란 링크가 아니라 주의색으로 말한다. */
const REASON_LINK = 'inline-flex items-center gap-1 text-[0.8rem] leading-snug font-medium text-warning underline-offset-4 hover:underline';
/* 주 배지가 이미 말하는 사유(초안, 보관)는 경고로 다시 적지 않는다. */
const REASONS_SAID_BY_BADGE: ReadonlySet<string> = new Set(['draft', 'archived']);
const SECONDARY = 'block text-xs leading-snug text-muted-foreground';
/* 같은 칸의 바로 수정 덮개(R11) 위에 남아야 하는 보조 링크. */
const SECONDARY_LINK = `${SECONDARY} relative z-[1] underline-offset-4 hover:text-foreground hover:underline`;
/* 상품명도 수정 화면으로 간다. 주 색 링크는 첫 칸(상품번호) 하나라 글자색은 그대로 두고 밑줄만 보인다. */
const NAME_LINK = 'block min-w-0 truncate font-medium text-foreground underline-offset-4 hover:underline';
/* relative: 스크린리더 전용 글자가 잘린 글자 끝에 놓여 표 영역 밖으로 스크롤을 만들지 않게 이 칸을 기준으로 삼는다. */
const GOOD_ID_LINK = 'relative block truncate text-xs text-muted-foreground tabular-nums underline-offset-4 hover:text-foreground hover:underline';
/* 자동 표 배치는 줄바꿈 없는 글자 폭만큼 열을 넓힌다 — 폭을 0으로 두고 칸을 채우면 열 폭 안에서 말줄임된다. */
const FILL_CELL = 'w-0 min-w-full';
const MENU_ITEM = 'flex items-center rounded-md px-2 py-1.5 text-sm outline-none hover:bg-accent focus-visible:bg-accent';

/** 주 상태 배지 하나. 지금 고객이 살 수 있는지를 말하고, 전시·설정 준비 같은 세부는 `detail`로 내린다. */
type GoodsSaleStatus = { label: string; tone: AdminTone; detail: string | null; showsSaleValue: boolean };
function goodsSaleStatus(good: AdminGoodSummary, readiness: AdminGoodsReadiness): GoodsSaleStatus {
  if (good.archivedAt) return { label: '보관', tone: statusTone('publication', 'archived'), detail: null, showsSaleValue: false };
  if (!good.publishedAt) return { label: '초안', tone: statusTone('publication', 'draft'), detail: null, showsSaleValue: false };
  if (good.stock === 'soldout') return { label: '판매중지', tone: statusTone('operation', 'stopped'), detail: '공개', showsSaleValue: true };
  if (readiness.state === 'ready' || readiness.state === 'review_required') {
    return { label: '판매중', tone: statusTone('operation', 'active'), detail: `공개 · ${GOODS_READINESS_STATE_LABELS[readiness.state]}`, showsSaleValue: true };
  }
  const blockers = readiness.reasons.filter(reason => reason.kind === 'blocking');
  if (blockers.length === 1 && blockers[0].code === 'stock_unavailable') return { label: '품절', tone: statusTone('stock', 'soldout'), detail: '공개', showsSaleValue: false };
  return { label: GOODS_READINESS_STATE_LABELS[readiness.state], tone: statusTone('readiness', readiness.state), detail: '공개', showsSaleValue: false };
}

/** 표의 날짜는 같은 폭의 한 표기로 쓴다(2026.11.09, KST). */
const tableDate = (value: string | null | undefined) => value ? kstDay(new Date(value)).replaceAll('-', '.') : '—';

export function GoodsListScreen({ data, shippingRegionExpiry, canIssueMarketingLinks = false, bulkIdentity }: { data: AdminGoodsListData; shippingRegionExpiry?: ShippingRegionExpiryState; canIssueMarketingLinks?: boolean; bulkIdentity?: GoodsGroupIdentity }) {
  const { filters, goods, total, counts, stockCounts, saleStateCounts } = data;
  /* 품절·소량 재고는 재고 건수(stockCounts), 판매대기·판매중지·판매종료는 판매 조건 건수(saleStateCounts)에서 읽는다. 못 읽으면 '집계 없음'. */
  const conditionCount = (value: (typeof CONDITION_ITEMS)[number]['value']) => {
    switch (value) {
      case 'out_of_stock': case 'low': return stockCounts ? stockCounts[value] : null;
      default: return saleStateCounts ? saleStateCounts[value] : null;
    }
  };
  const pageSize = data.pageSize ?? filters.pageSize ?? GOODS_LIST_PAGE_SIZE;
  /* 바로 수정과 IP 전체 할인은 상품 관리 권한과 현재 로그인 세션이 확인된 경우에만 연다. */
  const inlineIdentity = canIssueMarketingLinks ? bulkIdentity : undefined;
  const filteredIp = filters.ipId ? data.ips.find(ip => ip.id === filters.ipId && !ip.archivedAt) : undefined;
  /* 옵션별 재고·할인 중지 후 변경 창은 표 밖(이 화면 수준)에서 연다. 표의 선택자·칸 굵기가 창에 걸리지 않고,
     저장 뒤 그 상품이 현재 페이지에서 빠져도(필터·정렬) 창과 결과가 남는다(GoodsInlineDialogHost). */
  return <section className="relative flex min-w-0 flex-col gap-4" data-admin-screen="goods-list"><GoodsInlineDialogHost identity={inlineIdentity}>
    {/* R21: 그룹상품 탭은 메뉴와 함께 숨겼다 — 전환할 탭이 하나뿐이라 탭 줄을 그리지 않는다(그룹상품 라우트·권한은 그대로).
        등록·일괄 작업은 다른 화면처럼 오른쪽 위다. 넓은 화면에서는 셸 제목 줄의 빈자리에 올려 표가 밀리지 않게 한다. */}
    <div className="flex flex-wrap items-center gap-2 lg:absolute lg:right-0 lg:bottom-full lg:mb-4 print:hidden" data-goods-list="actions">
      <Link className={buttonVariants()} data-slot="button" href={`${goodsListHref(filters)}&create=1`}><Plus aria-hidden="true" />상품 등록</Link>
      <Link className={buttonVariants({ variant: 'outline' })} data-slot="button" href="/admin/catalog/goods/import">상품 일괄등록·수정</Link>
      <details className="group/export relative" data-goods-list="export">
        <summary className={`${buttonVariants({ variant: 'outline' })} cursor-pointer list-none [&::-webkit-details-marker]:hidden`} data-slot="button">엑셀 일괄작업<ChevronDown aria-hidden="true" className="transition-transform group-open/export:rotate-180" /></summary>
        <div className="absolute top-full right-0 z-20 mt-1 flex w-56 flex-col gap-0.5 rounded-lg border bg-popover p-1 text-popover-foreground shadow-md">
          <Link className={MENU_ITEM} href="/admin/catalog/goods/import">엑셀 등록·수정</Link>
          <Link className={MENU_ITEM} href={goodsListHref(filters).replace('/catalog/goods?', '/catalog/goods/export?')}>현재 필터 전체 내보내기</Link>
        </div>
      </details>
    </div>
    <ShippingRegionExpiryNotice state={shippingRegionExpiry} />
    <div className="flex min-w-0 flex-col gap-1.5">
      <div aria-describedby="goods-list-stock-basis" aria-label="상품 조회 현황" className={`${ADMIN_COUNT_CARD_GRID_CLASS} [&>*]:py-1.5`} data-goods-list="status" role="group">
        {STATUS_ITEMS.map(item => {
          return <AdminCountCard active={filters.status === item.status} count={counts ? counts[item.status] : null} current="page" href={goodsListHref({ ...filters, status: item.status }, 1)} icon={item.icon} key={item.status} label={item.label} />;
        })}
        {CONDITION_ITEMS.map(item => {
          const active = item.axis === 'stock' ? filters.stock === item.value : (filters.salePeriod ?? 'all') === item.value;
          const count = conditionCount(item.value);
          const href = item.axis === 'stock'
            ? goodsListHref({ ...filters, stock: active ? 'all' : item.value }, 1)
            : goodsListHref({ ...filters, salePeriod: active ? 'all' : item.value }, 1);
          return <AdminCountCard active={active} count={count} href={href} icon={item.icon} key={item.value} label={item.label} tone={item.tone} />;
        })}
      </div>
      {/* 소량 재고에는 수량 임계치가 없다(판매상태 값, goods.stock). 몇 개부터 소량인지 묻기 전에 답하도록 칸 바로 아래에 둔다. */}
      <p className="text-xs leading-snug text-muted-foreground" data-goods-list="stock-basis" id="goods-list-stock-basis">품절: 판매중지가 아닌 상품 중 사용 옵션 재고 0개 · 소량 재고: 판매상태를 소량 재고로 지정하고 재고가 남은 상품(수량으로 자동 분류하지 않습니다) · 판매중지: 판매상태를 판매중지로 바꾼 상품 · 판매대기·판매종료: 판매기간 시작 전·종료 후</p>
    </div>
    <GoodsListFiltersForm data={data} />
    {/* 모두 저장된 창의 결과 문구. 그 상품이 이 목록에서 빠졌는지 보려고 지금 목록의 상품 URL을 넘긴다. */}
    <GoodsInlineDialogNotice listedGoodIds={goods.map(good => good.id)} />
    {/* 넓은 화면에서는 목록 제목·정렬과 일괄 변경·조회항목 설정이 한 줄이다(표 ConsoleGrid의 뿌리를 contents로 풀어 이 줄에 참여시킨다). 폭이 모자라면 두 줄로 내려간다. */}
    <section aria-label="상품목록" className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground xl:flex-row xl:flex-wrap xl:items-center xl:gap-y-2">
      <div className="flex flex-wrap items-center gap-2 xl:flex-none">
        <h2 className="mr-1 text-base leading-snug font-semibold">상품목록 <span className="text-sm font-normal text-muted-foreground">(총 <strong className="font-semibold text-foreground tabular-nums">{total.toLocaleString('ko-KR')}</strong>개)</span></h2>
        <CustomerServiceListSelect label="상품 정렬" value={filters.sort ?? "created_desc"} options={GOODS_LIST_SORT_OPTIONS.map(option => ({ ...option, href: goodsListHref({ ...filters, sort: option.value }, 1) }))} />
        <CustomerServiceListSelect label="상품 목록수" value={String(pageSize)} options={GOODS_LIST_PAGE_SIZES.map(size => ({ value: String(size), label: `${size}개씩`, href: goodsListHref({ ...filters, pageSize: size }, 1) }))} />
      </div>
      {inlineIdentity && filteredIp ? <div className="min-w-0 xl:order-first xl:w-full"><GoodsIpBulkDiscount key={`${filteredIp.id}:${inlineIdentity.actorId}:${inlineIdentity.sessionId}`} ipId={filteredIp.id} ipTitle={filteredIp.title} identity={inlineIdentity} /></div> : null}
      {/* R11: 판매가·재고수량은 칸 어디를 눌러도 바로 수정이 열린다 — 값 버튼의 덮개가 감싼 칸을 기준 상자로 세운다(GoodsInlineEdit).
          좁은 화면에서는 열이 짜부라지지 않게 표가 1050px 아래로 줄지 않고 가로로 스크롤한다.
          칸 전체가 클릭 영역인 체크박스 열은 내용이 절대배치라 최소 폭을 준다. 데이터 칸의 좌우 여백은 8px로 줄여 그만큼 긴 값에 나눠 주고, 칸을 덮는 값 버튼은 덮개가 칸 전체를 받으므로 낮춰 줄 높이를 지킨다.
          넓은 화면의 도구 줄: 뿌리를 contents로 풀어 작업 막대 줄(조회항목 설정을 직접 품은 div)이 목록 제목 옆으로 오고, 표는 다음 줄 전체를 쓴다.
          '한 번에 최대 100개'는 일괄 변경 팝업에서도 말하므로 이 줄에서는 스크린리더에만 남긴다. 선택하면 생기는 '선택 해제' 자리는 조회항목 설정을 잠시 비켜 만든다 — 체크 순간 줄이 두 단이 되어 표가 밀리지 않게. */}
      <MarketingLinksGoodsGrid key={`${goodsListHref(filters)}:${bulkIdentity?.actorId}:${bulkIdentity?.sessionId}`} canIssue={canIssueMarketingLinks} bulkIdentity={bulkIdentity} caption="상품 목록" preferencesKey="catalog-goods" className="[&_table]:min-w-[1090px] [&_thead_th:first-child]:min-w-10 [&_td[data-align]]:px-2 [&_th[data-align]]:px-2 [&_[data-inline-edit=cell]_button]:min-h-6 xl:contents xl:[&>.relative]:w-full xl:[&>div:has(>[data-admin-kit=table-settings])]:flex-auto xl:[&_[data-goods-bulk]>div>small]:sr-only xl:[&_[data-admin-kit=table-settings]_button]:h-7 xl:[&_[data-admin-kit=table-settings]_button]:text-[0.8rem] xl:max-2xl:[&:has(tr[data-state=selected])_[data-admin-kit=table-settings]]:hidden"
        emptyLabel={counts?.all === 0 && !goodsListIsNarrowed(filters) ? '아직 등록한 상품이 없습니다. 위의 상품 등록을 눌러 첫 상품을 등록해주세요.' : '검색 조건에 맞는 상품이 없습니다.'}
        /* 1440 화면에서 끝 열까지 들어오는 폭이다. 첫 열은 시스템 순번 상품번호(S36-009)이고 수정 화면으로 간다.
           긴 영문이 많은 상품 URL은 맨 뒤로 뺐고(앞부분은 읽히는 폭), 상세 재고는 재고수량 칸 안에 접어 둔다. 상품명은 숨길 수 없다.
           판매가 칸은 금액(1,234,567원까지)과 수정 연필이 값 버튼 안에 들어오는 폭이다(admin-visual-qa 글자 잘림). 그만큼 전시상태 칸을
           줄이고 날짜 칸은 실측 최소 폭(93px)으로 둬 1440 화면에서 표가 가로로 넘치지 않는다(T22g·QA2 수정 A2 통합). */
        columns={[
        { key: 'productNo', label: '상품번호', width: '64px' },
        { key: 'name', label: '상품명 · 판매자상품코드', width: '192px', required: true }, { key: 'edit', label: '수정', width: '56px' }, { key: 'price', label: '판매가', align: 'end', width: '112px' },
        { key: 'readiness', label: '전시상태 · 판매 준비', width: '176px' }, { key: 'qty', label: '재고수량', align: 'end', width: '84px' },
        { key: 'ip', label: 'IP · 카테고리', width: '92px' }, { key: 'createdAt', label: '상품등록일', width: '93px' }, { key: 'updatedAt', label: '상품수정일', width: '93px' }, { key: 'goodId', label: '상품 URL', width: '88px' },
      ]} rows={goods.map(good => {
        const readiness = good.readiness ?? unknownGoodsReadiness();
        const editable = Boolean(inlineIdentity) && !good.archivedAt;
        const qtyLabel = readiness.availableQty === null ? '확인 필요' : `${readiness.availableQty.toLocaleString('ko-KR')}개`;
        const sale = goodsSaleStatus(good, readiness);
        const saleBadge = <AdminStatusBadge tone={sale.tone}>{sale.label}</AdminStatusBadge>;
        /* 수량 강조는 고객에게 팔고 있는 상품에만 둔다. 초안·보관 상품의 0개는 처리할 일이 아니다. */
        const selling = Boolean(good.publishedAt && !good.archivedAt);
        const soldOut = selling && readiness.availableQty === 0;
        /* 안전재고 부족 경보(옵션 수량 기준)를 먼저, 없으면 소량 재고 표시를 쓴다 — 어휘는 '상세 재고'·판매상태 필터와 같다. */
        const lowStockLabel = !selling || soldOut ? null : good.lowStockOptionCount > 0 ? `부족 ${good.lowStockOptionCount}개 옵션` : good.stock === 'low' ? '소량 재고' : null;
        const qtyEmphasis = soldOut ? ' font-semibold text-destructive' : lowStockLabel ? ' font-semibold text-warning' : '';
        const lowStockBadge = lowStockLabel ? <AdminStatusBadge tone={statusTone('stock', 'low')}>{lowStockLabel}</AdminStatusBadge> : null;
        const priceText = priceLabel(good.priceMin, good.priceMax);
        const price = <span className="whitespace-nowrap tabular-nums">{priceText}</span>;
        /* 값 버튼은 열을 넓히지 못해 가격 범위가 한 줄이면 옆 칸을 덮는다 — '~' 뒤에서 두 줄로 나눠 그린다. */
        const inlinePrice = priceText.includes('~')
          ? <span className="tabular-nums">{priceText.split('~').map((part, index) => <span className="inline-block" key={part}>{index ? part : `${part}~`}</span>)}</span>
          : price;
        const reasons = readiness.reasons.filter(reason => !REASONS_SAID_BY_BADGE.has(reason.code));
        const reasonLink = (reason: AdminGoodsReadiness['reasons'][number]) => <Link className={REASON_LINK} key={reason.code} href={goodEditorHref(filters, good.id, reason.target)}><TriangleAlert aria-hidden="true" className="size-3.5 shrink-0" />{reason.label} →</Link>;
        /* 상세 재고는 값 수정 덮개가 있는 칸에 함께 있어 덮개 위에 세운다. */
        const stockDetails = (extra?: ReactNode) => <details className="relative z-[1] text-xs font-normal" data-goods-list="stock-details"><summary className="inline-flex min-h-6 cursor-pointer items-center justify-end whitespace-nowrap text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">상세 재고</summary><dl className="mt-2 grid min-w-[9rem] gap-1 text-left text-sm whitespace-normal text-foreground">
          <dt className="text-xs text-muted-foreground">전체 할당 재고</dt><dd className="mb-1.5 tabular-nums">{good.stockQty.toLocaleString('ko-KR')}개</dd>
          <dt className="text-xs text-muted-foreground">사용 옵션 재고</dt><dd className="mb-1.5 tabular-nums">{good.activeStockQty.toLocaleString('ko-KR')}개</dd>
          <dt className="text-xs text-muted-foreground">안전재고</dt><dd className="mb-1.5">{good.lowStockOptionCount > 0 ? `부족 ${good.lowStockOptionCount}개 옵션` : '부족 경보 없음'}</dd>
          <dt className="text-xs text-muted-foreground">운영 상태</dt><dd>{readiness.operation === 'stopped' ? '판매 중지' : readiness.operation === 'active' ? '운영 중' : '확인 필요'}</dd>
        </dl>{extra}</details>;
        /* 사유가 둘째 줄을 쓰면 전시 여부만 앞에 남긴다(설정 준비 상태는 사유가 말한다) — 칸이 두 줄을 넘지 않게. */
        const saleDetail = sale.detail && reasons.length ? '공개' : sale.detail;
        const editorHref = goodEditorHref(filters, good.id);
        return { id: good.id, href: editorHref, hrefTabStop: false, cells: [
          /* 상품번호(첫 칸)는 표가 수정 화면 링크로 감싼다. 서버가 번호를 아직 싣지 않으면 '—'다. */
          <span className="tabular-nums" data-goods-list="product-no" key="productNo">{good.productNo ?? '—'}</span>,
          /* 상품명은 한 줄로 줄이고 전체 이름은 말풍선에 둔다 — 줄 높이가 고르게 유지되어 첫 화면에 상품이 더 보인다. */
          <span className="flex items-center gap-2.5" key="identity">
            {good.imageUrl ? <Image className="size-11 shrink-0 rounded-md border object-cover" src={good.imageUrl} alt="" width={44} height={44} unoptimized /> : <span className="grid size-11 shrink-0 place-content-center rounded-md bg-muted text-center text-[11px] leading-tight font-normal text-muted-foreground" aria-label="대표 이미지 없음">이미지<br />없음</span>}
            <span className="flex w-0 min-w-0 flex-1 flex-col gap-0.5"><Link className={NAME_LINK} href={editorHref} title={good.name}>{good.name}</Link><small className="truncate text-xs font-normal text-muted-foreground" title={good.code}>{good.code}</small></span>
          </span>,
          <Link key="edit" className={buttonVariants({ variant: 'outline', size: 'xs' })} data-slot="button" href={editorHref} tabIndex={-1}>수정</Link>,
          /* 판매가 칸(A9·1027T-025·TKT-033): 할인이 없으면 바로 고친다. 진행·예정 즉시할인(기간)이나 기간 없는 즉시할인(정가 표시)이 있으면
             같은 칸이 '할인 중지 후 변경' 창을 연다 — 같은 부품이라 할인이 멈춰 목록이 새로 그려져도 창이 남는다. 기간 없는 즉시할인 상품의
             판매가는 할인 전 판매가(정가 표시)이고, 창이 그 즉시할인도 함께 멈춘다. */
          editable && inlineIdentity && typeof good.basePrice === 'number'
            ? <GoodsInlinePrice key="price" goodId={good.id} goodName={good.name} goodCode={good.code || null}
              basePrice={good.compareAtPrice != null && good.compareAtPrice > good.basePrice ? good.compareAtPrice : good.basePrice}
              instantDiscount={good.compareAtPrice != null && good.compareAtPrice > good.basePrice}
              identity={inlineIdentity} hasOptions={(good.activeVariantCount ?? 0) !== 1}
              discountEndsAt={good.activeDiscountEndsAt ?? null} display={inlinePrice} valueText={priceText} />
            : editable && typeof good.basePrice === 'number' && good.compareAtPrice != null
              ? <span key="price" className="grid justify-items-end gap-0.5 whitespace-normal">{price}
                <Link className={SECONDARY_LINK} href={`${goodEditorHref(filters, good.id)}#good-section-price`}
                  title={good.activeDiscountEndsAt ? `상품 할인·즉시할인 진행·예정 중(~${tableDate(good.activeDiscountEndsAt)}) · 판매가는 상품 수정에서 변경` : '상품 할인 중 · 판매가는 상품 수정에서 변경'}>상품 할인 중</Link></span>
              : <span key="price">{price}</span>,
          /* 칸은 두 줄이다. 첫 줄은 주 배지(판매중·판매중지는 배지가 곧 값 버튼)와, 그 밖의 상태의 판매 값(초안은 아직 안 파는 상품이라 공개 시 값이라고 말한다).
             둘째 줄은 전시 여부와 준비 사유다. 사유는 하나면 바로 링크로, 여럿이면 건수 한 줄로 접는다. 판매 값의 연필은 배지 옆 자리가 모자라 뺀다(값 위에 커서를 올리면 테두리가 보인다). */
          <div key="readiness" className="flex min-w-0 flex-col items-start gap-0.5 whitespace-normal" data-goods-list="sale-status">
            <div className="flex w-full min-w-0 flex-wrap items-center gap-x-0.5">
              {editable && inlineIdentity && sale.showsSaleValue ? <div className="-ml-1.5 w-full"><GoodsInlineSale compact goodId={good.id} stopped={good.stock === 'soldout'} identity={inlineIdentity} display={saleBadge} valueText={sale.label} /></div> : saleBadge}
              {editable && inlineIdentity && !sale.showsSaleValue ? <div className="min-w-0 [&_[data-inline-edit=value]_svg]:hidden"><GoodsInlineSale compact goodId={good.id} stopped={good.stock === 'soldout'} identity={inlineIdentity} valueText={`${good.publishedAt ? '판매상태 ' : '공개 시 '}${good.stock === 'soldout' ? '판매중지' : '판매중'}`} display={<span className="text-xs whitespace-nowrap"><span className="text-muted-foreground">{good.publishedAt ? '판매상태 ' : '공개 시 '}</span>{good.stock === 'soldout' ? '판매중지' : '판매중'}</span>} /></div> : null}
            </div>
            {saleDetail || reasons.length ? <div className="flex min-w-0 flex-wrap items-center gap-x-1.5">
              {saleDetail ? <small className={SECONDARY}>{saleDetail}</small> : null}
              {reasons.length === 1 ? reasonLink(reasons[0]) : null}
              {reasons.length > 1 ? <details className="group/reasons text-[0.8rem] leading-snug" data-goods-list="reasons"><summary className="inline-flex min-h-5 cursor-pointer list-none items-center gap-1 font-medium text-warning underline-offset-4 hover:underline [&::-webkit-details-marker]:hidden"><TriangleAlert aria-hidden="true" className="size-3.5 shrink-0" />준비할 항목 {reasons.length}개<ChevronDown aria-hidden="true" className="size-3 shrink-0 transition-transform group-open/reasons:rotate-180" /></summary><div className="mt-1.5 flex flex-col gap-1">{reasons.map(reasonLink)}</div></details> : null}
            </div> : null}
          </div>,
          /* 재고 칸도 두 줄이다. 옵션이 하나면 칸에서 바로, 여럿이면 칸이 옵션별 재고 창을 연다(1014-106·107). 옵션을 읽지 못한 상품만
             상세 재고 안의 상품 수정 링크로 고친다. */
          editable && good.inlineStock
            ? <span key="qty" className={`grid justify-items-end gap-0.5 whitespace-normal${qtyEmphasis}`}><GoodsInlineStock goodId={good.id} ipId={good.ipId} variantId={good.inlineStock.variantId} stockQty={good.inlineStock.stockQty} goodName={good.name} />
              {qtyLabel !== `${good.inlineStock.stockQty.toLocaleString('ko-KR')}개` ? <small className={`${SECONDARY} font-normal`}>판매 가능 {qtyLabel}</small> : null}{lowStockBadge}{stockDetails()}</span>
            : editable && good.inlineOptions && good.inlineOptions.length > 1
              ? <span key="qty" className={`grid justify-items-end gap-0.5 whitespace-normal${qtyEmphasis}`}><GoodsInlineOptionStock goodId={good.id} ipId={good.ipId} goodName={good.name} goodCode={good.code || null}
                options={good.inlineOptions} display={qtyLabel} editorHref={goodEditorHref(filters, good.id, 'variants')} />{lowStockBadge}{stockDetails()}</span>
              : editable && (good.activeVariantCount ?? 0) > 1
                ? <span key="qty" className={`grid justify-items-end gap-0.5 whitespace-normal${qtyEmphasis}`}>{qtyLabel}{lowStockBadge}{stockDetails(<Link className={`${SECONDARY_LINK} mt-2 text-left font-normal`} href={goodEditorHref(filters, good.id, 'variants')}>옵션별 재고 수정</Link>)}</span>
                : <span key="qty" className={`grid justify-items-end gap-0.5 whitespace-normal${qtyEmphasis}`}>{qtyLabel}{lowStockBadge}{stockDetails()}</span>,
          <span key="category" className={`flex flex-col gap-0.5 ${FILL_CELL}`}><span className="truncate" title={good.ipTitle}>{good.ipTitle}</span><small className={`${SECONDARY} truncate`} title={good.categoryName || undefined}>{good.categoryName || '분류 미지정'}</small></span>,
          <span key="createdAt" className="whitespace-nowrap tabular-nums">{tableDate(good.createdAt)}</span>,
          <span key="updatedAt" className="whitespace-nowrap tabular-nums">{tableDate(good.updatedAt)}</span>,
          /* R15: 고객에게 보이는 상품은 고객 화면을 새 탭으로, 공개 전·보관·판매 제한 상품은 편집기 미리보기로 연다.
             보조 문구는 같은 행의 상태 칸(초안·보관·공개)과 같은 사유로 쓴다. 전시 중인데 안 보이면 판매 제한·IP 비공개다.
             상품 URL은 긴 영문 값이라 열 폭만큼 앞부분을 보이고 전체 값은 말풍선에 둔다(복사·브라우저 찾기는 전체 값 그대로). 주 색 링크는 첫 칸 하나만이라 흐린 글자다. */
          good.customerVisible
            ? <span key="goodId" className={`flex items-center gap-0.5 text-muted-foreground ${FILL_CELL}`}><a className={`${GOOD_ID_LINK} min-w-0 flex-1`} title={good.id} data-goods-list="good-id" href={goodDetailHref(good.id)} target="_blank" rel="noopener noreferrer">{good.id}<span className="sr-only"> 고객 화면 새 탭으로 열기</span></a><ArrowUpRight aria-hidden="true" className="size-3.5 shrink-0" /></span>
            : <Link key="goodId" className={`${GOOD_ID_LINK} ${FILL_CELL}`} title={good.id} data-goods-list="good-id" href={goodPreviewHref(filters, good.id)}>{good.id}<small className={`${SECONDARY} mt-0.5 truncate`}>{good.archivedAt ? '보관' : good.publishedAt ? '고객 화면 비노출' : '공개 전'} · 미리보기</small></Link>,
        ] };
      })} />
      <div className="flex w-full min-w-0 flex-col gap-3 xl:mt-1">
      <ConsolePagination page={filters.page} pageSize={pageSize} total={total} hrefForPage={page => goodsListHref(filters, page)} />
      <details className="group/help rounded-lg border bg-muted/40 px-4 py-3 text-sm" data-goods-list="help">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-medium [&::-webkit-details-marker]:hidden">목록 사용·재고수량·판매 준비 안내<ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform group-open/help:rotate-180" /></summary>
        <p className="mt-2 leading-relaxed text-muted-foreground">상품번호는 시스템이 등록 순서대로 매기는 바뀌지 않는 번호이고, 상품 URL은 고객 화면 주소 끝의 영문 값입니다. 상품번호·상품 URL은 쉼표나 공백으로 구분해 여러 개를 조회할 수 있고, 전체 검색에는 영문명·검색 키워드·ERP 품명·바코드도 포함됩니다. 상품번호·상품명 또는 수정 버튼을 눌러 상품 정보를 변경하고, 상품 URL을 누르면 고객 화면(공개 전 상품은 미리보기)을 엽니다.{inlineIdentity ? ' 판매가·재고수량·판매상태는 목록에서 값을 눌러 바로 고칠 수 있습니다. 옵션이 여러 개인 상품은 재고수량 칸이 옵션별 재고 창을, 즉시할인(기간 포함)이 걸려 있거나 예정된 상품은 판매가 칸이 할인 중지 후 변경 창을 엽니다.' : ''} 표시한 수량은 예약판매 물량을 포함한 판매 가용 수량입니다. 판매상태 필터의 품절은 판매중지가 아닌 상품 중 사용 옵션의 할당 재고가 0인 상품이고, 판매중지는 수량과 관계없이 판매상태를 판매중지로 바꾼 상품입니다. 고객 화면에는 둘 다 품절로 보입니다. 소량 재고는 판매상태를 소량 재고로 지정하고 재고가 남은 상품이며, 수량으로 자동 분류하지 않습니다. 옵션별 안전재고 기준 이하 경고는 재고수량 칸에 부족 N개 옵션으로 표시되고 소량 재고 건수에는 들어가지 않습니다. 품절·소량 재고·판매중지 건수는 판매상태 조건과 페이지를, 판매대기·판매종료 건수는 판매기간 조건과 페이지를 제외한 같은 검색 조건으로 계산합니다. 설정 준비 완료는 실제 결제 성공을 보증하지 않습니다.{data.checkedAt ? <> 확인 시각: <time dateTime={data.checkedAt}>{new Date(data.checkedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</time>.</> : null}</p>
      </details>
      </div>
    </section>
  </GoodsInlineDialogHost></section>;
}
