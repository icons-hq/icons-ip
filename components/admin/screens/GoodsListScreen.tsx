import Image from 'next/image';
import Link from 'next/link';
import { GOODS_READINESS_REASONS, GOODS_READINESS_STATE_LABELS, unknownGoodsReadiness } from '@/lib/admin/goods-readiness';
import { AdminPageHeader, AdminStatusBadge } from '../console/AdminKit';
import { ConsoleFilterPanel } from '../console/ConsoleFilterPanel';
import { ConsoleGrid } from '../console/ConsoleGrid';
import { ConsolePagination } from '../console/ConsolePagination';
import { AdminSelect } from '../console/AdminSelect';
import { GOODS_LIST_PATH, GOODS_LIST_PAGE_SIZE, goodsListHref, goodEditorHref, type AdminGoodsListData } from '@/lib/admin/goods-list';

function priceLabel(min: number | null | undefined, max: number | null | undefined) {
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max)) return '가격 확인 필요';
  return min === max ? `${min!.toLocaleString('ko-KR')}원` : `${min!.toLocaleString('ko-KR')}~${max!.toLocaleString('ko-KR')}원`;
}

export function GoodsListScreen({ data }: { data: AdminGoodsListData }) {
  const { filters, goods, total, ips, categories = [] } = data;
  return <section className="wc-admin-kit wc-admin-kit__screen admin-goods-worklist">
    <AdminPageHeader title="상품 목록" description="상품과 판매 준비 사유를 확인하고 필요한 작업으로 이동합니다."
      actions={<><Link className="wc-admin-kit__button wc-admin-kit__button--primary" href={`${goodsListHref(filters)}&create=1`}>상품 등록</Link>
        <details className="admin-goods-worklist__export"><summary>엑셀 작업</summary><div>
          <Link href="/admin/catalog/goods/import">엑셀 등록·수정</Link>
          <Link href={goodsListHref(filters).replace('/catalog/goods?', '/catalog/goods/export?')}>현재 필터 전체 내보내기</Link>
        </div></details></>} />
    <p className="wc-admin-kit__description">상품명·영문명·상품코드·옵션코드·ID·검색 키워드·ERP 코드·ERP 품명·바코드로 검색합니다.</p>
    <ConsoleFilterPanel action={GOODS_LIST_PATH} search={{ name: 'q', label: '상품 검색', value: filters.query }}
      statusFilter={{ value: filters.status, label: '게시 상태', options: [
        { value: 'active', label: '보관 제외' }, { value: 'all', label: '전체' },
        { value: 'draft', label: '초안' }, { value: 'published', label: '공개' }, { value: 'archived', label: '보관' },
      ] }}>
      <div className="admin-console-filter-field"><label className="admin-console-filter-label" htmlFor="goods-list-ip">IP</label>
        <AdminSelect id="goods-list-ip" name="ipId" defaultValue={filters.ipId}><option value="">전체 IP</option>
          {ips.map(ip => <option key={ip.id} value={ip.id}>{ip.title}{ip.archivedAt ? ' · 보관' : ''}</option>)}
        </AdminSelect></div>
      <div className="admin-console-filter-field"><label className="admin-console-filter-label" htmlFor="goods-list-category">카테고리 · 하위 포함</label>
        <AdminSelect id="goods-list-category" name="categoryId" defaultValue={filters.categoryId}><option value="">전체 카테고리</option>
          {categories.map(category => <option key={category.id} value={category.id}>{'　'.repeat(Math.max(0, category.depth - 1))}{category.name}{category.archivedAt ? ' · 보관' : ''}</option>)}
        </AdminSelect></div>
      <div className="admin-console-filter-field"><label className="admin-console-filter-label" htmlFor="goods-list-stock">재고 상태</label>
        <AdminSelect id="goods-list-stock" name="stock" defaultValue={filters.stock}>
          <option value="all">전체 재고</option><option value="ok">재고 있음</option><option value="low">소량</option><option value="soldout">품절·판매 중지</option>
        </AdminSelect></div>
      <div className="admin-console-filter-field"><label className="admin-console-filter-label" htmlFor="goods-list-readiness">판매 준비</label>
        <AdminSelect id="goods-list-readiness" name="readiness" defaultValue={filters.readiness}>
          <option value="all">전체 준비 상태</option><option value="review_required">확인할 상품 전체</option><option value="ready">설정 준비 완료</option>
          {Object.entries(GOODS_READINESS_REASONS).map(([code, reason]) => <option key={code} value={code}>{reason.label}</option>)}
        </AdminSelect></div>
    </ConsoleFilterPanel>
    <p className="wc-admin-kit__description">가용 수량은 예약판매 물량을 포함합니다. 재고 필터는 사용 옵션의 할당 재고 기준입니다. 설정 준비 완료는 실제 결제 성공을 보증하지 않습니다.
      {data.checkedAt ? <> 확인 시각: <time dateTime={data.checkedAt}>{new Date(data.checkedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} KST</time>.</> : null}</p>
    <ConsoleGrid caption="상품 목록" columns={[
      { key: 'name', label: '상품명 · 상품코드' }, { key: 'price', label: '옵션 판매가', align: 'end' },
      { key: 'readiness', label: '게시 · 판매 준비' }, { key: 'qty', label: '판매 가용 수량', align: 'end' },
      { key: 'ip', label: 'IP · 카테고리' }, { key: 'details', label: '추가 정보' },
    ]} rows={goods.map(good => {
      const readiness = good.readiness ?? unknownGoodsReadiness();
      return { id: good.id, href: goodEditorHref(filters, good.id), cells: [
        <span className="admin-goods-worklist__identity" key="identity">
          {good.imageUrl ? <Image src={good.imageUrl} alt="" width={52} height={52} unoptimized /> : <span className="admin-goods-worklist__image-empty" aria-label="대표 이미지 없음">이미지<br />없음</span>}
          <span><strong>{good.name}</strong><small>{good.code}</small></span>
        </span>,
        <span key="price" className="admin-goods-worklist__price">{priceLabel(good.priceMin, good.priceMax)}</span>,
        <div key="readiness" className="admin-goods-worklist__readiness">
          <div><AdminStatusBadge tone={good.publishedAt && !good.archivedAt ? 'success' : 'neutral'}>{good.archivedAt ? '보관' : good.publishedAt ? '공개' : '초안'}</AdminStatusBadge>
            <span>{GOODS_READINESS_STATE_LABELS[readiness.state]}</span></div>
          {readiness.reasons.slice(0, 2).map(reason => <Link key={reason.code} href={goodEditorHref(filters, good.id, reason.target)}>{reason.label} →</Link>)}
          {readiness.reasons.length > 2 ? <details><summary>사유 {readiness.reasons.length - 2}개 더 보기</summary>{readiness.reasons.slice(2).map(reason => <Link key={reason.code} href={goodEditorHref(filters, good.id, reason.target)}>{reason.label} →</Link>)}</details> : null}
        </div>,
        readiness.availableQty === null ? '확인 필요' : `${readiness.availableQty.toLocaleString('ko-KR')}개`,
        <span key="category">{good.ipTitle}<small className="admin-goods-worklist__secondary">{good.categoryName || '분류 미지정'}</small></span>,
        <details key="details"><summary>상세 재고·ID</summary><dl className="admin-goods-worklist__details">
          <dt>전체 할당 재고</dt><dd>{good.stockQty.toLocaleString('ko-KR')}개</dd>
          <dt>사용 옵션 재고</dt><dd>{good.activeStockQty.toLocaleString('ko-KR')}개</dd>
          <dt>안전재고</dt><dd>{good.lowStockOptionCount > 0 ? `부족 ${good.lowStockOptionCount}개 옵션` : '부족 경보 없음'}</dd>
          <dt>운영 상태</dt><dd>{readiness.operation === 'stopped' ? '판매 중지' : readiness.operation === 'active' ? '운영 중' : '확인 필요'}</dd>
          <dt>내부 ID</dt><dd>{good.id}</dd>
        </dl></details>,
      ] };
    })} />
    <ConsolePagination page={filters.page} pageSize={GOODS_LIST_PAGE_SIZE} total={total} hrefForPage={page => goodsListHref(filters, page)} />
  </section>;
}
