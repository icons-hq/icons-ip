import Image from 'next/image';
import Link from 'next/link';
import { Archive, ArrowUpRight, Boxes, ChevronDown, Eye, FilePen, Package, PackageMinus, PackageX, TriangleAlert } from 'lucide-react';
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
import { GOODS_LIST_PAGE_SIZE, GOODS_LIST_PAGE_SIZES, GOODS_LIST_SORT_OPTIONS, goodsListHref, goodEditorHref, goodPreviewHref, type AdminGoodSummary, type AdminGoodsListData } from '@/lib/admin/goods-list';
import { goodDetailHref } from '@/lib/goods-display';
import type { GoodsGroupIdentity } from '@/lib/admin/goods-groups';
import { GoodsInlinePrice, GoodsInlineSale, GoodsInlineStock } from '../GoodsInlineEdit';
import { GoodsIpBulkDiscount } from '../GoodsIpBulkDiscount';
import { kstDay } from '@/lib/admin/kst';

function priceLabel(min: number | null | undefined, max: number | null | undefined) {
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max)) return '가격 확인 필요';
  return min === max ? `${min!.toLocaleString('ko-KR')}원` : `${min!.toLocaleString('ko-KR')}~${max!.toLocaleString('ko-KR')}원`;
}

/* 기본 조회가 '보관 제외'라 그 칸도 둔다 — 어느 칸을 보고 있는지 항상 한 칸이 켜진다. */
const STATUS_ITEMS = [{ label: '보관 제외', status: 'active', icon: Package }, { label: '전체', status: 'all', icon: Boxes }, { label: '임시저장', status: 'draft', icon: FilePen }, { label: '전시중', status: 'published', icon: Eye }, { label: '보관', status: 'archived', icon: Archive }] as const;
/* 재고 건수는 상태 건수처럼 서버가 함께 세어 주지 않아 숫자 없이 조회 링크로 둔다. 다시 누르면 재고 조건을 푼다.
   MD가 매일 먼저 보는 칸이라 숫자가 없어도 항상 의미색으로 보인다(건수 카드는 숫자가 있을 때만 색이 켜진다). */
const STOCK_ITEMS = [
  { label: '품절 보기', stock: 'out_of_stock', tone: 'danger', Icon: PackageX, box: 'border-danger-border hover:bg-danger-soft', icon: 'bg-danger-soft text-destructive', text: 'text-destructive' },
  { label: '소량 재고 보기', stock: 'low', tone: 'warning', Icon: PackageMinus, box: 'border-warning-border hover:bg-warning-soft', icon: 'bg-warning-soft text-warning', text: 'text-warning' },
] as const;
/* 준비 사유는 고쳐야 할 일이다 — 파란 링크가 아니라 주의색으로 말한다. */
const REASON_LINK = 'inline-flex items-center gap-1 text-[0.8rem] leading-snug font-medium text-warning underline-offset-4 hover:underline';
/* 주 배지가 이미 말하는 사유(임시저장=초안, 보관)는 경고로 다시 적지 않는다. */
const REASONS_SAID_BY_BADGE: ReadonlySet<string> = new Set(['draft', 'archived']);
const SECONDARY = 'block text-xs leading-snug text-muted-foreground';
/* 같은 칸의 바로 수정 덮개(R11) 위에 남아야 하는 보조 링크. */
const SECONDARY_LINK = `${SECONDARY} relative z-[1] underline-offset-4 hover:text-foreground hover:underline`;
const GOOD_ID_LINK = 'block truncate text-xs text-muted-foreground tabular-nums underline-offset-4 hover:text-foreground hover:underline';
const MENU_ITEM = 'flex items-center rounded-md px-2 py-1.5 text-sm outline-none hover:bg-accent focus-visible:bg-accent';

/** 주 상태 배지 하나. 지금 고객이 살 수 있는지를 말하고, 전시·설정 준비 같은 세부는 `detail`로 내린다. */
type GoodsSaleStatus = { label: string; tone: AdminTone; detail: string | null; showsSaleValue: boolean };
function goodsSaleStatus(good: AdminGoodSummary, readiness: AdminGoodsReadiness): GoodsSaleStatus {
  if (good.archivedAt) return { label: '보관', tone: statusTone('publication', 'archived'), detail: null, showsSaleValue: false };
  if (!good.publishedAt) return { label: '임시저장', tone: statusTone('publication', 'draft'), detail: null, showsSaleValue: false };
  if (good.stock === 'soldout') return { label: '판매중지', tone: statusTone('operation', 'stopped'), detail: '전시중', showsSaleValue: true };
  if (readiness.state === 'ready' || readiness.state === 'review_required') {
    return { label: '판매중', tone: statusTone('operation', 'active'), detail: `전시중 · ${GOODS_READINESS_STATE_LABELS[readiness.state]}`, showsSaleValue: true };
  }
  const blockers = readiness.reasons.filter(reason => reason.kind === 'blocking');
  if (blockers.length === 1 && blockers[0].code === 'stock_unavailable') return { label: '품절', tone: statusTone('stock', 'soldout'), detail: '전시중', showsSaleValue: false };
  return { label: GOODS_READINESS_STATE_LABELS[readiness.state], tone: statusTone('readiness', readiness.state), detail: '전시중', showsSaleValue: false };
}

/** 표의 날짜는 같은 폭의 한 표기로 쓴다(2026.11.09, 한국 시각). */
const tableDate = (value: string | null | undefined) => value ? kstDay(new Date(value)).replaceAll('-', '.') : '—';

export function GoodsListScreen({ data, shippingRegionExpiry, canIssueMarketingLinks = false, bulkIdentity }: { data: AdminGoodsListData; shippingRegionExpiry?: ShippingRegionExpiryState; canIssueMarketingLinks?: boolean; bulkIdentity?: GoodsGroupIdentity }) {
  const { filters, goods, total, counts } = data;
  const pageSize = data.pageSize ?? filters.pageSize ?? GOODS_LIST_PAGE_SIZE;
  /* 바로 수정과 IP 전체 할인은 상품 관리 권한과 현재 로그인 세션이 확인된 경우에만 연다. */
  const inlineIdentity = canIssueMarketingLinks ? bulkIdentity : undefined;
  const filteredIp = filters.ipId ? data.ips.find(ip => ip.id === filters.ipId && !ip.archivedAt) : undefined;
  return <section className="flex min-w-0 flex-col gap-4" data-admin-screen="goods-list">
    {/* R21: 그룹상품 탭은 메뉴와 함께 숨겼다 — 전환할 탭이 하나뿐이라 탭 줄을 그리지 않는다(그룹상품 라우트·권한은 그대로). */}
    <ShippingRegionExpiryNotice state={shippingRegionExpiry} />
    <div aria-label="상품 조회 현황" className={ADMIN_COUNT_CARD_GRID_CLASS} data-goods-list="status" role="group">
      {STATUS_ITEMS.map(item => {
        return <AdminCountCard active={filters.status === item.status} count={counts ? counts[item.status] : null} current="page" href={goodsListHref({ ...filters, status: item.status }, 1)} icon={item.icon} key={item.status} label={item.label} />;
      })}
      {STOCK_ITEMS.map(item => {
        const active = filters.stock === item.stock;
        return <Link aria-current={active ? 'true' : undefined} aria-label={item.label} className={`flex min-w-0 items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors ${active ? 'border-primary bg-primary-soft ring-1 ring-primary' : `bg-card ${item.box}`}`} data-active={active || undefined} data-tone={item.tone} href={goodsListHref({ ...filters, stock: active ? 'all' : item.stock }, 1)} key={item.stock}>
          <span aria-hidden="true" className={`grid size-8 shrink-0 place-items-center rounded-lg ${item.icon}`}><item.Icon className="size-4" /></span>
          <span className={`truncate text-sm font-semibold ${item.text}`}>{item.label}</span>
        </Link>;
      })}
    </div>
    <GoodsListFiltersForm data={data} />
    <section aria-label="상품목록" className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3 className="text-base leading-snug font-semibold">상품목록 <span className="text-sm font-normal text-muted-foreground">(총 <strong className="font-semibold text-foreground tabular-nums">{total.toLocaleString('ko-KR')}</strong>개)</span></h3>
        <Link className={buttonVariants()} data-slot="button" href={`${goodsListHref(filters)}&create=1`}>상품 등록</Link>
        <Link className={buttonVariants({ variant: 'outline' })} data-slot="button" href="/admin/catalog/goods/import">상품 일괄등록·수정</Link>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <CustomerServiceListSelect label="상품 정렬" value={filters.sort ?? "created_desc"} options={GOODS_LIST_SORT_OPTIONS.map(option => ({ ...option, href: goodsListHref({ ...filters, sort: option.value }, 1) }))} />
          <CustomerServiceListSelect label="상품 목록수" value={String(pageSize)} options={GOODS_LIST_PAGE_SIZES.map(size => ({ value: String(size), label: `${size}개씩`, href: goodsListHref({ ...filters, pageSize: size }, 1) }))} />
          <details className="group/export relative" data-goods-list="export">
            <summary className={`${buttonVariants({ variant: 'outline' })} cursor-pointer list-none [&::-webkit-details-marker]:hidden`} data-slot="button">엑셀 일괄작업<ChevronDown aria-hidden="true" className="transition-transform group-open/export:rotate-180" /></summary>
            <div className="absolute top-full right-0 z-20 mt-1 flex w-56 flex-col gap-0.5 rounded-lg border bg-popover p-1 text-popover-foreground shadow-md">
              <Link className={MENU_ITEM} href="/admin/catalog/goods/import">엑셀 등록·수정</Link>
              <Link className={MENU_ITEM} href={goodsListHref(filters).replace('/catalog/goods?', '/catalog/goods/export?')}>현재 필터 전체 내보내기</Link>
            </div>
          </details>
        </div>
      </div>
      {inlineIdentity && filteredIp ? <GoodsIpBulkDiscount key={`${filteredIp.id}:${inlineIdentity.actorId}:${inlineIdentity.sessionId}`} ipId={filteredIp.id} ipTitle={filteredIp.title} identity={inlineIdentity} /> : null}
      {/* R11: 판매가·재고수량은 칸 어디를 눌러도 바로 수정이 열린다 — 값 버튼의 덮개가 감싼 칸을 기준 상자로 세운다(GoodsInlineEdit).
          좁은 화면에서는 열이 짜부라지지 않게 표가 1050px 아래로 줄지 않고 가로로 스크롤한다.
          칸 전체가 클릭 영역인 체크박스 열은 내용이 절대배치라 최소 폭을 준다.
          넓은 화면에서는 조회항목 설정을 일괄 변경 줄 오른쪽으로 올려 첫 화면에 상품이 더 보이게 한다. */}
      <MarketingLinksGoodsGrid key={`${goodsListHref(filters)}:${bulkIdentity?.actorId}:${bulkIdentity?.sessionId}`} canIssue={canIssueMarketingLinks} bulkIdentity={bulkIdentity} caption="상품 목록" preferencesKey="catalog-goods" className="[&_table]:min-w-[1088px] [&_thead_th:first-child]:min-w-10 xl:flex-row xl:flex-wrap xl:items-center xl:[&>.relative]:w-full xl:[&>[data-goods-bulk]]:min-w-0 xl:[&>[data-goods-bulk]]:flex-1 xl:[&>div:has(>[data-admin-kit=table-settings])]:ml-auto"
        emptyLabel={counts?.all === 0 ? '아직 등록한 상품이 없습니다. 위의 상품 등록을 눌러 첫 상품을 등록해주세요.' : '검색 조건에 맞는 상품이 없습니다.'}
        /* 1440 화면에서 끝 열까지 들어오는 폭이다. 긴 영문이 많은 상품번호는 맨 뒤로 뺐고, 상세 재고는 재고수량 칸 안에 접어 둔다. */
        columns={[
        { key: 'name', label: '상품명 · 판매자상품코드', width: '216px' }, { key: 'edit', label: '수정', width: '64px' }, { key: 'price', label: '판매가', align: 'end', width: '112px' },
        { key: 'readiness', label: '전시상태 · 판매 준비', width: '168px' }, { key: 'qty', label: '재고수량', align: 'end', width: '92px' },
        { key: 'ip', label: 'IP · 카테고리', width: '108px' }, { key: 'createdAt', label: '상품등록일', width: '100px' }, { key: 'updatedAt', label: '상품수정일', width: '100px' }, { key: 'goodId', label: '상품번호', width: '88px' },
      ]} rows={goods.map(good => {
        const readiness = good.readiness ?? unknownGoodsReadiness();
        const editable = Boolean(inlineIdentity) && !good.archivedAt;
        const qtyLabel = readiness.availableQty === null ? '확인 필요' : `${readiness.availableQty.toLocaleString('ko-KR')}개`;
        const sale = goodsSaleStatus(good, readiness);
        const saleBadge = <AdminStatusBadge tone={sale.tone}>{sale.label}</AdminStatusBadge>;
        /* 수량 강조는 고객에게 팔고 있는 상품에만 둔다. 임시저장·보관 상품의 0개는 처리할 일이 아니다. */
        const selling = Boolean(good.publishedAt && !good.archivedAt);
        const soldOut = selling && readiness.availableQty === 0;
        /* 안전재고 부족 경보(옵션 수량 기준)를 먼저, 없으면 소량 재고 표시를 쓴다 — 어휘는 '상세 재고'·판매상태 필터와 같다. */
        const lowStockLabel = !selling || soldOut ? null : good.lowStockOptionCount > 0 ? `부족 ${good.lowStockOptionCount}개 옵션` : good.stock === 'low' ? '소량 재고' : null;
        const qtyEmphasis = soldOut ? ' font-semibold text-destructive' : lowStockLabel ? ' font-semibold text-warning' : '';
        const lowStockBadge = lowStockLabel ? <AdminStatusBadge tone={statusTone('stock', 'low')}>{lowStockLabel}</AdminStatusBadge> : null;
        const price = <span className="whitespace-nowrap tabular-nums">{priceLabel(good.priceMin, good.priceMax)}</span>;
        const reasons = readiness.reasons.filter(reason => !REASONS_SAID_BY_BADGE.has(reason.code));
        const reasonLink = (reason: AdminGoodsReadiness['reasons'][number]) => <Link className={REASON_LINK} key={reason.code} href={goodEditorHref(filters, good.id, reason.target)}><TriangleAlert aria-hidden="true" className="size-3.5 shrink-0" />{reason.label} →</Link>;
        /* 상세 재고는 값 수정 덮개가 있는 칸에 함께 있어 덮개 위에 세운다. */
        const stockDetails = <details className="relative z-[1] text-xs font-normal" data-goods-list="stock-details"><summary className="cursor-pointer whitespace-nowrap text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">상세 재고</summary><dl className="mt-2 grid min-w-[9rem] gap-1 text-left text-sm whitespace-normal text-foreground">
          <dt className="text-xs text-muted-foreground">전체 할당 재고</dt><dd className="mb-1.5 tabular-nums">{good.stockQty.toLocaleString('ko-KR')}개</dd>
          <dt className="text-xs text-muted-foreground">사용 옵션 재고</dt><dd className="mb-1.5 tabular-nums">{good.activeStockQty.toLocaleString('ko-KR')}개</dd>
          <dt className="text-xs text-muted-foreground">안전재고</dt><dd className="mb-1.5">{good.lowStockOptionCount > 0 ? `부족 ${good.lowStockOptionCount}개 옵션` : '부족 경보 없음'}</dd>
          <dt className="text-xs text-muted-foreground">운영 상태</dt><dd>{readiness.operation === 'stopped' ? '판매 중지' : readiness.operation === 'active' ? '운영 중' : '확인 필요'}</dd>
        </dl></details>;
        return { id: good.id, href: goodEditorHref(filters, good.id), cells: [
          <span className="flex min-w-[12rem] items-center gap-2.5 whitespace-normal" key="identity">
            {good.imageUrl ? <Image className="size-[52px] shrink-0 rounded-md border object-cover" src={good.imageUrl} alt="" width={52} height={52} unoptimized /> : <span className="grid size-[52px] shrink-0 place-content-center rounded-md bg-muted text-center text-[11px] leading-tight font-normal text-muted-foreground" aria-label="대표 이미지 없음">이미지<br />없음</span>}
            <span className="flex min-w-0 flex-col gap-0.5"><strong className="line-clamp-2 font-medium">{good.name}</strong><small className="truncate text-xs font-normal text-muted-foreground">{good.code}</small></span>
          </span>,
          <Link key="edit" className={buttonVariants({ variant: 'outline', size: 'xs' })} data-slot="button" href={goodEditorHref(filters, good.id)}>수정</Link>,
          editable && inlineIdentity && typeof good.basePrice === 'number' && good.compareAtPrice == null && !good.activeDiscountEndsAt
            ? <GoodsInlinePrice key="price" goodId={good.id} basePrice={good.basePrice} identity={inlineIdentity} hasOptions={(good.activeVariantCount ?? 0) !== 1}
              display={price} valueText={priceLabel(good.priceMin, good.priceMax)} />
            : editable && typeof good.basePrice === 'number' && (good.compareAtPrice != null || good.activeDiscountEndsAt)
              ? <span key="price" className="grid justify-items-end gap-0.5 whitespace-normal">{price}
                {good.activeDiscountEndsAt
                  ? <small className={SECONDARY}>즉시할인 진행·예정 중(~{new Date(good.activeDiscountEndsAt).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })}) · 할인을 중지한 뒤 판매가를 바꿀 수 있습니다</small>
                  : <Link className={SECONDARY_LINK} href={`${goodEditorHref(filters, good.id)}#good-section-price`}>상품 할인 중 · 판매가는 상품 수정에서 변경</Link>}</span>
              : <span key="price">{price}</span>,
          /* 판매중·판매중지는 배지가 곧 값 버튼이고, 그 밖의 상태에서는 판매 값을 보조 줄에 둔다(임시저장은 아직 안 파는 상품이라 공개 시 값이라고 말한다).
             준비 사유는 하나면 바로 링크로, 여럿이면 건수 한 줄로 접어 줄 높이를 지킨다. */
          <div key="readiness" className="flex min-w-[9rem] flex-col items-start gap-0.5 whitespace-normal" data-goods-list="sale-status">
            {editable && inlineIdentity && sale.showsSaleValue ? <div className="-ml-1.5 w-full"><GoodsInlineSale compact goodId={good.id} stopped={good.stock === 'soldout'} identity={inlineIdentity} display={saleBadge} valueText={sale.label} /></div> : saleBadge}
            {sale.detail ? <small className={SECONDARY}>{sale.detail}</small> : null}
            {editable && inlineIdentity && !sale.showsSaleValue ? <div className="-ml-1.5 w-full"><GoodsInlineSale compact goodId={good.id} stopped={good.stock === 'soldout'} identity={inlineIdentity} valueText={`${good.publishedAt ? '판매상태 ' : '공개 시 '}${good.stock === 'soldout' ? '판매중지' : '판매중'}`} display={<span className="text-xs"><span className="text-muted-foreground">{good.publishedAt ? '판매상태 ' : '공개 시 '}</span>{good.stock === 'soldout' ? '판매중지' : '판매중'}</span>} /></div> : null}
            {reasons.length === 1 ? reasonLink(reasons[0]) : null}
            {reasons.length > 1 ? <details className="group/reasons text-[0.8rem] leading-snug" data-goods-list="reasons"><summary className="inline-flex cursor-pointer list-none items-center gap-1 font-medium text-warning underline-offset-4 hover:underline [&::-webkit-details-marker]:hidden"><TriangleAlert aria-hidden="true" className="size-3.5 shrink-0" />준비할 항목 {reasons.length}개<ChevronDown aria-hidden="true" className="size-3 shrink-0 transition-transform group-open/reasons:rotate-180" /></summary><div className="mt-1.5 flex flex-col gap-1">{reasons.map(reasonLink)}</div></details> : null}
          </div>,
          editable && good.inlineStock
            ? <span key="qty" className={`grid justify-items-end gap-0.5 whitespace-normal${qtyEmphasis}`}><GoodsInlineStock goodId={good.id} ipId={good.ipId} variantId={good.inlineStock.variantId} stockQty={good.inlineStock.stockQty} />
              {qtyLabel !== `${good.inlineStock.stockQty.toLocaleString('ko-KR')}개` ? <small className={`${SECONDARY} font-normal`}>판매 가능 {qtyLabel}</small> : null}{lowStockBadge}{stockDetails}</span>
            : editable && (good.activeVariantCount ?? 0) > 1
              ? <span key="qty" className={`grid justify-items-end gap-0.5 whitespace-normal${qtyEmphasis}`}>{qtyLabel}{lowStockBadge}<Link className={`${SECONDARY_LINK} font-normal`} href={goodEditorHref(filters, good.id, 'variants')}>옵션별 재고 수정</Link>{stockDetails}</span>
              : <span key="qty" className={`grid justify-items-end gap-0.5 whitespace-normal${qtyEmphasis}`}>{qtyLabel}{lowStockBadge}{stockDetails}</span>,
          <span key="category" className="flex flex-col gap-0.5">{good.ipTitle}<small className={SECONDARY}>{good.categoryName || '분류 미지정'}</small></span>,
          <span key="createdAt" className="whitespace-nowrap tabular-nums">{tableDate(good.createdAt)}</span>,
          <span key="updatedAt" className="whitespace-nowrap tabular-nums">{tableDate(good.updatedAt)}</span>,
          /* R15: 고객에게 보이는 상품은 고객 화면을 새 탭으로, 공개 전·보관·판매 제한 상품은 편집기 미리보기로 연다.
             보조 문구는 같은 행의 상태 칸(임시저장·보관·전시중)과 같은 사유로 쓴다. 전시 중인데 안 보이면 판매 제한·IP 비공개다.
             상품번호는 긴 영문 값이라 앞부분만 줄여 보이고 전체 값은 말풍선에 둔다(복사·브라우저 찾기는 전체 값 그대로). 주 색 링크는 첫 칸 하나만이라 흐린 글자다. */
          good.customerVisible
            ? <span key="goodId" className="inline-flex max-w-full items-center gap-0.5 text-muted-foreground"><a className={`${GOOD_ID_LINK} max-w-12`} title={good.id} data-goods-list="good-id" href={goodDetailHref(good.id)} target="_blank" rel="noopener noreferrer">{good.id}<span className="sr-only"> 고객 화면 새 탭으로 열기</span></a><ArrowUpRight aria-hidden="true" className="size-3.5 shrink-0" /></span>
            : <Link key="goodId" className={`${GOOD_ID_LINK} max-w-16`} title={good.id} data-goods-list="good-id" href={goodPreviewHref(filters, good.id)}>{good.id}<small className={`${SECONDARY} mt-0.5 whitespace-normal`}>{good.archivedAt ? '보관' : good.publishedAt ? '고객 화면 비노출' : '공개 전'} · 미리보기</small></Link>,
        ] };
      })} />
      <ConsolePagination page={filters.page} pageSize={pageSize} total={total} hrefForPage={page => goodsListHref(filters, page)} />
      <details className="group/help rounded-lg border bg-muted/40 px-4 py-3 text-sm" data-goods-list="help">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-medium [&::-webkit-details-marker]:hidden">목록 사용·재고수량·판매 준비 안내<ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform group-open/help:rotate-180" /></summary>
        <p className="mt-2 leading-relaxed text-muted-foreground">상품명 또는 수정 버튼을 눌러 상품 정보를 변경할 수 있습니다.{inlineIdentity ? ' 판매가·재고수량·판매상태는 목록에서 값을 눌러 바로 고칠 수 있습니다.' : ''} 표시한 수량은 예약판매 물량을 포함한 판매 가용 수량입니다. 판매상태 필터의 품절은 판매중지가 아닌 상품 중 사용 옵션의 할당 재고가 0인 상품이고, 판매중지는 수량과 관계없이 판매상태를 판매중지로 바꾼 상품입니다. 고객 화면에는 둘 다 품절로 보입니다. 설정 준비 완료는 실제 결제 성공을 보증하지 않습니다.{data.checkedAt ? <> 확인 시각: <time dateTime={data.checkedAt}>{new Date(data.checkedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</time>.</> : null}</p>
      </details>
    </section>
  </section>;
}
