import Image from 'next/image';
import Link from 'next/link';
import { ShippingRegionExpiryNotice } from '../ShippingRegionExpiryNotice';
import type { ShippingRegionExpiryState } from '@/lib/admin/shipping-regions';
import { GOODS_READINESS_STATE_LABELS, unknownGoodsReadiness } from '@/lib/admin/goods-readiness';
import { AdminStatusBadge } from '../console/AdminKit';
import { MarketingLinksGoodsGrid } from '../marketing/MarketingLinksGoodsGrid';
import { ConsolePagination } from '../console/ConsolePagination';
import { GoodsListFiltersForm } from './GoodsListFiltersForm';
import { CustomerServiceListSelect } from './CustomerServiceListControls';
import { Icon } from '@/components/ui/Icon';
import { ADMIN_VOCABULARY as V } from '@/lib/admin/vocabulary';
import { GOODS_LIST_PAGE_SIZE, GOODS_LIST_PAGE_SIZES, GOODS_LIST_SORT_OPTIONS, goodsListHref, goodEditorHref, type AdminGoodsListData } from '@/lib/admin/goods-list';
import type { GoodsGroupIdentity } from '@/lib/admin/goods-groups';

function priceLabel(min: number | null | undefined, max: number | null | undefined) {
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max)) return '가격 확인 필요';
  return min === max ? `${min!.toLocaleString('ko-KR')}원` : `${min!.toLocaleString('ko-KR')}~${max!.toLocaleString('ko-KR')}원`;
}

export function GoodsListScreen({ data, shippingRegionExpiry, canIssueMarketingLinks = false, bulkIdentity }: { data: AdminGoodsListData; shippingRegionExpiry?: ShippingRegionExpiryState; canIssueMarketingLinks?: boolean; bulkIdentity?: GoodsGroupIdentity }) {
  const { filters, goods, total, counts } = data;
  const pageSize = data.pageSize ?? filters.pageSize ?? GOODS_LIST_PAGE_SIZE;
  return <section className="wc-admin-kit wc-admin-kit__screen admin-goods-worklist">
    <nav className="admin-goods-worklist__tabs" aria-label="상품 관리 화면"><span aria-current="page">전체 상품 조회/수정</span><Link href="/admin/catalog/groups">{V.goodsGroups}</Link></nav>
    <ShippingRegionExpiryNotice state={shippingRegionExpiry} />
    <div className="admin-goods-worklist__status-strip" aria-label="상품 조회 현황">
      {([{ label: '전체', status: 'all' }, { label: '임시저장', status: 'draft' }, { label: '전시중', status: 'published' }, { label: '보관', status: 'archived' }] as const).map(item => <Link key={item.status} aria-current={filters.status === item.status ? 'page' : undefined} href={goodsListHref({ ...filters, status: item.status }, 1)}><span className="admin-goods-worklist__status-icon"><Icon name={item.status === 'all' ? 'grid' : item.status === 'published' ? 'shop' : item.status === 'draft' ? 'clock' : 'bag'} size={24} /></span><span>{item.label}<strong>{counts ? counts[item.status].toLocaleString('ko-KR') : '—'}<small>{counts ? '건' : '집계 없음'}</small></strong></span></Link>)}
    </div>
    <GoodsListFiltersForm data={data} />
    <section className="admin-goods-worklist__results" aria-label="상품목록">
      <div className="admin-goods-worklist__result-header"><h3>상품목록 <span>(총 <strong>{total.toLocaleString('ko-KR')}</strong>개)</span></h3><div className="admin-goods-worklist__result-controls"><CustomerServiceListSelect label="상품 정렬" value={filters.sort ?? "created_desc"} options={GOODS_LIST_SORT_OPTIONS.map(option => ({ ...option, href: goodsListHref({ ...filters, sort: option.value }, 1) }))} /><CustomerServiceListSelect label="상품 목록수" value={String(pageSize)} options={GOODS_LIST_PAGE_SIZES.map(size => ({ value: String(size), label: `${size}개씩`, href: goodsListHref({ ...filters, pageSize: size }, 1) }))} /><details className="admin-goods-worklist__export"><summary>엑셀 일괄작업</summary><div><Link href="/admin/catalog/goods/import">엑셀 등록·수정</Link><Link href={goodsListHref(filters).replace('/catalog/goods?', '/catalog/goods/export?')}>현재 필터 전체 내보내기</Link></div></details></div></div>
      <div className="admin-goods-worklist__toolbar"><Link className="wc-admin-kit__button" href={`${goodsListHref(filters)}&create=1`}>상품 등록</Link><Link className="wc-admin-kit__button" href="/admin/catalog/goods/import">상품 일괄등록·수정</Link><p>상품명 또는 수정 버튼을 눌러 상품 정보를 변경할 수 있습니다.</p></div>
    <MarketingLinksGoodsGrid key={`${goodsListHref(filters)}:${bulkIdentity?.actorId}:${bulkIdentity?.sessionId}`} canIssue={canIssueMarketingLinks} bulkIdentity={bulkIdentity} caption="상품 목록" preferencesKey="catalog-goods" columns={[
      { key: 'name', label: '상품명 · 판매자상품코드', width: '280px' }, { key: 'edit', label: '수정', width: '76px' }, { key: 'price', label: '판매가', align: 'end', width: '130px' },
      { key: 'readiness', label: '전시상태 · 판매 준비', width: '220px' }, { key: 'qty', label: '재고수량', align: 'end', width: '100px' },
      { key: 'ip', label: 'IP · 카테고리' }, { key: 'createdAt', label: '상품등록일', width: '130px' }, { key: 'updatedAt', label: '상품수정일', width: '130px' }, { key: 'details', label: '추가 정보' },
    ]} rows={goods.map(good => {
      const readiness = good.readiness ?? unknownGoodsReadiness();
      return { id: good.id, href: goodEditorHref(filters, good.id), cells: [
        <span className="admin-goods-worklist__identity" key="identity">
          {good.imageUrl ? <Image src={good.imageUrl} alt="" width={52} height={52} unoptimized /> : <span className="admin-goods-worklist__image-empty" aria-label="대표 이미지 없음">이미지<br />없음</span>}
          <span><strong>{good.name}</strong><small>{good.code}</small></span>
        </span>,
        <Link key="edit" className="admin-goods-worklist__edit" href={goodEditorHref(filters, good.id)}>수정</Link>,
        <span key="price" className="admin-goods-worklist__price">{priceLabel(good.priceMin, good.priceMax)}</span>,
        <div key="readiness" className="admin-goods-worklist__readiness">
          <div><AdminStatusBadge tone={good.publishedAt && !good.archivedAt ? 'success' : 'neutral'}>{good.archivedAt ? '보관' : good.publishedAt ? '전시중' : '임시저장'}</AdminStatusBadge>
            <span>{GOODS_READINESS_STATE_LABELS[readiness.state]}</span></div>
          {readiness.reasons.slice(0, 2).map(reason => <Link key={reason.code} href={goodEditorHref(filters, good.id, reason.target)}>{reason.label} →</Link>)}
          {readiness.reasons.length > 2 ? <details><summary>사유 {readiness.reasons.length - 2}개 더 보기</summary>{readiness.reasons.slice(2).map(reason => <Link key={reason.code} href={goodEditorHref(filters, good.id, reason.target)}>{reason.label} →</Link>)}</details> : null}
        </div>,
        readiness.availableQty === null ? '확인 필요' : `${readiness.availableQty.toLocaleString('ko-KR')}개`,
        <span key="category">{good.ipTitle}<small className="admin-goods-worklist__secondary">{good.categoryName || '분류 미지정'}</small></span>,
        <span key="createdAt">{good.createdAt ? new Date(good.createdAt).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' }) : '—'}</span>,
        <span key="updatedAt">{good.updatedAt ? new Date(good.updatedAt).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' }) : '—'}</span>,
        <details key="details"><summary>상세 재고·ID</summary><dl className="admin-goods-worklist__details">
          <dt>전체 할당 재고</dt><dd>{good.stockQty.toLocaleString('ko-KR')}개</dd>
          <dt>사용 옵션 재고</dt><dd>{good.activeStockQty.toLocaleString('ko-KR')}개</dd>
          <dt>안전재고</dt><dd>{good.lowStockOptionCount > 0 ? `부족 ${good.lowStockOptionCount}개 옵션` : '부족 경보 없음'}</dd>
          <dt>운영 상태</dt><dd>{readiness.operation === 'stopped' ? '판매 중지' : readiness.operation === 'active' ? '운영 중' : '확인 필요'}</dd>
          <dt>상품번호</dt><dd>{good.id}</dd>
        </dl></details>,
      ] };
    })} />
    <ConsolePagination page={filters.page} pageSize={pageSize} total={total} hrefForPage={page => goodsListHref(filters, page)} />
      <details className="admin-goods-worklist__help"><summary>재고수량·판매 준비 안내</summary><p>표시한 수량은 예약판매 물량을 포함한 판매 가용 수량입니다. 재고 필터는 사용 옵션의 할당 재고 기준이며, 설정 준비 완료는 실제 결제 성공을 보증하지 않습니다.{data.checkedAt ? <> 확인 시각: <time dateTime={data.checkedAt}>{new Date(data.checkedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</time>.</> : null}</p></details>
    </section>
  </section>;
}
