import Image from 'next/image';
import Link from 'next/link';
import { ArrowUpRight, ChevronDown } from 'lucide-react';
import { ShippingRegionExpiryNotice } from '../ShippingRegionExpiryNotice';
import type { ShippingRegionExpiryState } from '@/lib/admin/shipping-regions';
import { GOODS_READINESS_STATE_LABELS, unknownGoodsReadiness } from '@/lib/admin/goods-readiness';
import { AdminStatusBadge } from '../console/AdminKit';
import { MarketingLinksGoodsGrid } from '../marketing/MarketingLinksGoodsGrid';
import { ConsolePagination } from '../console/ConsolePagination';
import { buttonVariants } from '../kit/ui/button';
import { GoodsListFiltersForm } from './GoodsListFiltersForm';
import { CustomerServiceListSelect } from './CustomerServiceListControls';
import { GOODS_LIST_PAGE_SIZE, GOODS_LIST_PAGE_SIZES, GOODS_LIST_SORT_OPTIONS, goodsListHref, goodEditorHref, goodPreviewHref, type AdminGoodsListData } from '@/lib/admin/goods-list';
import { goodDetailHref } from '@/lib/goods-display';
import type { GoodsGroupIdentity } from '@/lib/admin/goods-groups';
import { GoodsInlinePrice, GoodsInlineSale, GoodsInlineStock } from '../GoodsInlineEdit';
import { GoodsIpBulkDiscount } from '../GoodsIpBulkDiscount';

function priceLabel(min: number | null | undefined, max: number | null | undefined) {
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max)) return '가격 확인 필요';
  return min === max ? `${min!.toLocaleString('ko-KR')}원` : `${min!.toLocaleString('ko-KR')}~${max!.toLocaleString('ko-KR')}원`;
}

const STATUS_ITEMS = [{ label: '전체', status: 'all' }, { label: '임시저장', status: 'draft' }, { label: '전시중', status: 'published' }, { label: '보관', status: 'archived' }] as const;
const SECONDARY = 'block text-xs leading-snug text-muted-foreground';
/* 같은 칸의 바로 수정 덮개(R11) 위에 남아야 하는 보조 링크. */
const SECONDARY_LINK = `${SECONDARY} relative z-[1] underline-offset-4 hover:text-foreground hover:underline`;
const MENU_ITEM = 'flex items-center rounded-md px-2 py-1.5 text-sm outline-none hover:bg-accent focus-visible:bg-accent';

export function GoodsListScreen({ data, shippingRegionExpiry, canIssueMarketingLinks = false, bulkIdentity }: { data: AdminGoodsListData; shippingRegionExpiry?: ShippingRegionExpiryState; canIssueMarketingLinks?: boolean; bulkIdentity?: GoodsGroupIdentity }) {
  const { filters, goods, total, counts } = data;
  const pageSize = data.pageSize ?? filters.pageSize ?? GOODS_LIST_PAGE_SIZE;
  /* 바로 수정과 IP 전체 할인은 상품 관리 권한과 현재 로그인 세션이 확인된 경우에만 연다. */
  const inlineIdentity = canIssueMarketingLinks ? bulkIdentity : undefined;
  const filteredIp = filters.ipId ? data.ips.find(ip => ip.id === filters.ipId && !ip.archivedAt) : undefined;
  return <section className="flex min-w-0 flex-col gap-4" data-admin-screen="goods-list">
    {/* R21: 그룹상품 탭은 메뉴와 함께 숨겼다 — 전환할 탭이 하나뿐이라 탭 줄을 그리지 않는다(그룹상품 라우트·권한은 그대로). */}
    <ShippingRegionExpiryNotice state={shippingRegionExpiry} />
    <div aria-label="상품 조회 현황" className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-goods-list="status" role="group">
      {STATUS_ITEMS.map(item => {
        const count = counts ? counts[item.status].toLocaleString('ko-KR') : null;
        return <Link
          aria-current={filters.status === item.status ? 'page' : undefined}
          aria-label={`${item.label} ${count === null ? '집계 없음' : `${count}건`}`}
          className="flex min-w-0 flex-col gap-1 rounded-lg border bg-card px-3 py-2.5 transition-colors hover:bg-accent aria-[current=page]:border-primary aria-[current=page]:ring-1 aria-[current=page]:ring-primary"
          href={goodsListHref({ ...filters, status: item.status }, 1)}
          key={item.status}
        >
          <span className="text-xs text-muted-foreground">{item.label}</span>
          <strong className="text-xl leading-tight font-semibold tabular-nums">{count ?? '—'}<small className="ml-0.5 text-xs font-normal text-muted-foreground">{count === null ? '집계 없음' : '건'}</small></strong>
        </Link>;
      })}
    </div>
    <GoodsListFiltersForm data={data} />
    <section aria-label="상품목록" className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-base leading-snug font-medium">상품목록 <span className="text-sm font-normal text-muted-foreground">(총 <strong className="font-semibold text-foreground tabular-nums">{total.toLocaleString('ko-KR')}</strong>개)</span></h3>
        <div className="flex flex-wrap items-center gap-2">
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
      <div className="flex flex-wrap items-center gap-2">
        <Link className={buttonVariants()} data-slot="button" href={`${goodsListHref(filters)}&create=1`}>상품 등록</Link>
        <Link className={buttonVariants({ variant: 'outline' })} data-slot="button" href="/admin/catalog/goods/import">상품 일괄등록·수정</Link>
        <p className="text-sm text-muted-foreground">상품명 또는 수정 버튼을 눌러 상품 정보를 변경할 수 있습니다.{inlineIdentity ? ' 판매가·재고수량·판매상태는 목록에서 값을 눌러 바로 고칠 수 있습니다.' : ''}</p>
      </div>
      {inlineIdentity && filteredIp ? <GoodsIpBulkDiscount key={`${filteredIp.id}:${inlineIdentity.actorId}:${inlineIdentity.sessionId}`} ipId={filteredIp.id} ipTitle={filteredIp.title} identity={inlineIdentity} /> : null}
      {/* R11: 판매가·재고수량은 칸 어디를 눌러도 바로 수정이 열린다 — 값 버튼의 덮개가 감싼 칸을 기준 상자로 세운다(GoodsInlineEdit).
          좁은 화면에서는 열이 짜부라지지 않게 표가 1050px 아래로 줄지 않고 가로로 스크롤한다.
          칸 전체가 클릭 영역인 체크박스 열은 내용이 절대배치라 최소 폭을 준다. */}
      <MarketingLinksGoodsGrid key={`${goodsListHref(filters)}:${bulkIdentity?.actorId}:${bulkIdentity?.sessionId}`} canIssue={canIssueMarketingLinks} bulkIdentity={bulkIdentity} caption="상품 목록" preferencesKey="catalog-goods" className="[&_table]:min-w-[1050px] [&_thead_th:first-child]:min-w-10" columns={[
        { key: 'name', label: '상품명 · 판매자상품코드', width: '280px' }, { key: 'goodId', label: '상품번호', width: '160px' }, { key: 'edit', label: '수정', width: '76px' }, { key: 'price', label: '판매가', align: 'end', width: '130px' },
        { key: 'readiness', label: '전시상태 · 판매 준비', width: '220px' }, { key: 'qty', label: '재고수량', align: 'end', width: '100px' },
        { key: 'ip', label: 'IP · 카테고리' }, { key: 'createdAt', label: '상품등록일', width: '130px' }, { key: 'updatedAt', label: '상품수정일', width: '130px' }, { key: 'details', label: '추가 정보' },
      ]} rows={goods.map(good => {
        const readiness = good.readiness ?? unknownGoodsReadiness();
        const editable = Boolean(inlineIdentity) && !good.archivedAt;
        const qtyLabel = readiness.availableQty === null ? '확인 필요' : `${readiness.availableQty.toLocaleString('ko-KR')}개`;
        const price = <span className="whitespace-nowrap tabular-nums">{priceLabel(good.priceMin, good.priceMax)}</span>;
        return { id: good.id, href: goodEditorHref(filters, good.id), cells: [
          <span className="flex min-w-[13.75rem] items-center gap-2.5 whitespace-normal" key="identity">
            {good.imageUrl ? <Image className="size-[52px] shrink-0 rounded-md border object-cover" src={good.imageUrl} alt="" width={52} height={52} unoptimized /> : <span className="grid size-[52px] shrink-0 place-content-center rounded-md bg-muted text-center text-[11px] leading-tight font-normal text-muted-foreground" aria-label="대표 이미지 없음">이미지<br />없음</span>}
            <span className="flex min-w-0 flex-col gap-0.5"><strong className="font-medium">{good.name}</strong><small className="text-xs font-normal text-muted-foreground">{good.code}</small></span>
          </span>,
          /* R15: 고객에게 보이는 상품은 고객 화면을 새 탭으로, 공개 전·보관·판매 제한 상품은 편집기 미리보기로 연다.
             보조 문구는 같은 행의 상태 배지(임시저장·보관·전시중)와 같은 사유로 쓴다. 전시 중인데 안 보이면 판매 제한·IP 비공개다. */
          good.customerVisible
            ? <a key="goodId" className="inline-flex items-center gap-0.5 font-medium underline-offset-4 hover:underline" data-goods-list="good-id" href={goodDetailHref(good.id)} target="_blank" rel="noopener noreferrer">{good.id}<span className="sr-only"> 고객 화면 새 탭으로 열기</span><ArrowUpRight aria-hidden="true" className="size-3.5 shrink-0" /></a>
            : <Link key="goodId" className="flex flex-col gap-0.5 font-medium underline-offset-4 hover:underline" data-goods-list="good-id" href={goodPreviewHref(filters, good.id)}>{good.id}<small className={SECONDARY}>{good.archivedAt ? '보관' : good.publishedAt ? '고객 화면 비노출' : '공개 전'} · 미리보기</small></Link>,
          <Link key="edit" className={buttonVariants({ variant: 'outline', size: 'xs' })} data-slot="button" href={goodEditorHref(filters, good.id)}>수정</Link>,
          editable && inlineIdentity && typeof good.basePrice === 'number' && good.compareAtPrice == null && !good.activeDiscountEndsAt
            ? <GoodsInlinePrice key="price" goodId={good.id} basePrice={good.basePrice} identity={inlineIdentity} hasOptions={(good.activeVariantCount ?? 0) !== 1}
              display={price} />
            : editable && typeof good.basePrice === 'number' && (good.compareAtPrice != null || good.activeDiscountEndsAt)
              ? <span key="price" className="grid justify-items-end gap-0.5 whitespace-normal">{price}
                {good.activeDiscountEndsAt
                  ? <small className={SECONDARY}>즉시할인 진행·예정 중(~{new Date(good.activeDiscountEndsAt).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })}) · 할인을 중지한 뒤 판매가를 바꿀 수 있습니다</small>
                  : <Link className={SECONDARY_LINK} href={`${goodEditorHref(filters, good.id)}#good-section-price`}>상품 할인 중 · 판매가는 상품 수정에서 변경</Link>}</span>
              : <span key="price">{price}</span>,
          <div key="readiness" className="flex min-w-[10.5rem] flex-col gap-1.5 whitespace-normal">
            <div className="flex flex-wrap items-center gap-1.5"><AdminStatusBadge tone={good.publishedAt && !good.archivedAt ? 'success' : 'neutral'}>{good.archivedAt ? '보관' : good.publishedAt ? '전시중' : '임시저장'}</AdminStatusBadge>
              <span className="text-sm">{GOODS_READINESS_STATE_LABELS[readiness.state]}</span></div>
            {editable && inlineIdentity ? <GoodsInlineSale goodId={good.id} stopped={good.stock === 'soldout'} identity={inlineIdentity} /> : null}
            {readiness.reasons.slice(0, 2).map(reason => <Link className="text-sm underline-offset-4 hover:underline" key={reason.code} href={goodEditorHref(filters, good.id, reason.target)}>{reason.label} →</Link>)}
            {readiness.reasons.length > 2 ? <details className="text-sm"><summary className="cursor-pointer text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">사유 {readiness.reasons.length - 2}개 더 보기</summary><div className="mt-1.5 flex flex-col gap-1">{readiness.reasons.slice(2).map(reason => <Link className="underline-offset-4 hover:underline" key={reason.code} href={goodEditorHref(filters, good.id, reason.target)}>{reason.label} →</Link>)}</div></details> : null}
          </div>,
          editable && good.inlineStock
            ? <span key="qty" className="grid justify-items-end gap-0.5 whitespace-normal"><GoodsInlineStock goodId={good.id} ipId={good.ipId} variantId={good.inlineStock.variantId} stockQty={good.inlineStock.stockQty} />
              {qtyLabel !== `${good.inlineStock.stockQty.toLocaleString('ko-KR')}개` ? <small className={SECONDARY}>판매 가능 {qtyLabel}</small> : null}</span>
            : editable && (good.activeVariantCount ?? 0) > 1
              ? <span key="qty" className="grid justify-items-end gap-0.5 whitespace-normal">{qtyLabel}<Link className={SECONDARY_LINK} href={goodEditorHref(filters, good.id, 'variants')}>옵션별 재고 수정</Link></span>
              : qtyLabel,
          <span key="category" className="flex flex-col gap-0.5">{good.ipTitle}<small className={SECONDARY}>{good.categoryName || '분류 미지정'}</small></span>,
          <span key="createdAt" className="tabular-nums">{good.createdAt ? new Date(good.createdAt).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' }) : '—'}</span>,
          <span key="updatedAt" className="tabular-nums">{good.updatedAt ? new Date(good.updatedAt).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' }) : '—'}</span>,
          <details key="details" className="text-sm"><summary className="cursor-pointer whitespace-nowrap underline-offset-4 hover:underline">상세 재고</summary><dl className="mt-2 grid min-w-[9rem] gap-1 whitespace-normal">
            <dt className="text-xs text-muted-foreground">전체 할당 재고</dt><dd className="mb-1.5 tabular-nums">{good.stockQty.toLocaleString('ko-KR')}개</dd>
            <dt className="text-xs text-muted-foreground">사용 옵션 재고</dt><dd className="mb-1.5 tabular-nums">{good.activeStockQty.toLocaleString('ko-KR')}개</dd>
            <dt className="text-xs text-muted-foreground">안전재고</dt><dd className="mb-1.5">{good.lowStockOptionCount > 0 ? `부족 ${good.lowStockOptionCount}개 옵션` : '부족 경보 없음'}</dd>
            <dt className="text-xs text-muted-foreground">운영 상태</dt><dd>{readiness.operation === 'stopped' ? '판매 중지' : readiness.operation === 'active' ? '운영 중' : '확인 필요'}</dd>
          </dl></details>,
        ] };
      })} />
      <ConsolePagination page={filters.page} pageSize={pageSize} total={total} hrefForPage={page => goodsListHref(filters, page)} />
      <details className="group/help rounded-lg border bg-muted/40 px-4 py-3 text-sm" data-goods-list="help">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-medium [&::-webkit-details-marker]:hidden">재고수량·판매 준비 안내<ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform group-open/help:rotate-180" /></summary>
        <p className="mt-2 leading-relaxed text-muted-foreground">표시한 수량은 예약판매 물량을 포함한 판매 가용 수량입니다. 판매상태 필터의 품절은 판매중지가 아닌 상품 중 사용 옵션의 할당 재고가 0인 상품이고, 판매중지는 수량과 관계없이 판매상태를 판매중지로 바꾼 상품입니다. 고객 화면에는 둘 다 품절로 보입니다. 설정 준비 완료는 실제 결제 성공을 보증하지 않습니다.{data.checkedAt ? <> 확인 시각: <time dateTime={data.checkedAt}>{new Date(data.checkedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</time>.</> : null}</p>
      </details>
    </section>
  </section>;
}
