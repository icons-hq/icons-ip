import Link from 'next/link';
import { AdminSelect } from '../console/AdminSelect';
import { consoleDatePresets, isConsoleDateRangeActive } from '../console/date-presets';
import { GOODS_READINESS_REASONS } from '@/lib/admin/goods-readiness';
import { GOODS_LIST_DATE_FIELDS, GOODS_LIST_PATH, GOODS_LIST_SEARCH_FIELDS, goodsListHref, type AdminGoodsListData } from '@/lib/admin/goods-list';

export function GoodsListFiltersForm({ data }: { data: AdminGoodsListData }) {
  const { filters, ips, categories = [], origins = [] } = data;
  const hasDetails = Boolean(filters.originId || [filters.payment, filters.saleType, filters.image, filters.restriction].some(value => value && value !== 'all'));
  return <form action={GOODS_LIST_PATH} method="get" className="admin-goods-search" aria-label="상품 검색 조건">
    <input type="hidden" name="sort" value={filters.sort ?? 'created_desc'} />
    <input type="hidden" name="pageSize" value={data.pageSize ?? filters.pageSize ?? 20} />
    <div className="admin-goods-search__row admin-goods-search__row--query">
      <label htmlFor="goods-list-query">검색어</label>
      <div className="admin-goods-search__content">
        <fieldset className="admin-goods-search__choices"><legend className="sr-only">검색 대상</legend>
          {GOODS_LIST_SEARCH_FIELDS.map(item => <label key={item.value}><input type="radio" name="field" value={item.value} defaultChecked={(filters.field ?? 'all') === item.value} />{item.label}</label>)}
        </fieldset>
        <input id="goods-list-query" type="search" name="q" maxLength={100} defaultValue={filters.query} aria-describedby="goods-list-query-hint" placeholder="상품명, 상품번호, 판매자상품코드, ERP 코드" />
        <p id="goods-list-query-hint">상품번호는 쉼표나 공백으로 구분해 여러 개를 조회할 수 있습니다. 전체 검색에는 영문명·검색 키워드도 포함됩니다.</p>
      </div>
    </div>
    <div className="admin-goods-search__row"><span>전시상태</span><fieldset className="admin-goods-search__choices"><legend className="sr-only">전시상태</legend>
      {[{ value: 'active', label: '보관 제외' }, { value: 'all', label: '전체' }, { value: 'draft', label: '임시저장' }, { value: 'published', label: '전시중' }, { value: 'archived', label: '보관' }].map(item => <label key={item.value}><input type="radio" name="status" value={item.value} defaultChecked={filters.status === item.value} />{item.label}</label>)}
    </fieldset></div>
    <div className="admin-goods-search__row"><label htmlFor="goods-list-stock">판매상태</label><div className="admin-goods-search__content admin-goods-search__selects">
      <AdminSelect id="goods-list-stock" name="stock" defaultValue={filters.stock}><option value="all">전체</option><option value="ok">판매중</option><option value="low">소량 재고</option><option value="soldout">품절·판매 중지</option></AdminSelect>
      <AdminSelect aria-label="판매기간" id="goods-list-sale-period" name="salePeriod" defaultValue={filters.salePeriod ?? 'all'}><option value="all">전체 판매기간</option><option value="scheduled">판매대기 (시작 전)</option><option value="ended">판매기간 종료</option></AdminSelect>
      <AdminSelect aria-label="판매 준비 상태" id="goods-list-readiness" name="readiness" defaultValue={filters.readiness}><option value="all">전체 준비 상태</option><option value="review_required">확인할 상품 전체</option><option value="ready">설정 준비 완료</option>{Object.entries(GOODS_READINESS_REASONS).map(([code, reason]) => <option key={code} value={code}>{reason.label}</option>)}</AdminSelect>
    </div></div>
    <div className="admin-goods-search__row"><label htmlFor="goods-list-category">카테고리</label><div className="admin-goods-search__content admin-goods-search__selects">
      <AdminSelect id="goods-list-category" name="categoryId" defaultValue={filters.categoryId}><option value="">전체 카테고리</option>{categories.map(category => <option key={category.id} value={category.id}>{'　'.repeat(Math.max(0, category.depth - 1))}{category.name}{category.archivedAt ? ' · 보관' : ''}</option>)}</AdminSelect>
      <AdminSelect aria-label="연결 IP" id="goods-list-ip" name="ipId" defaultValue={filters.ipId}><option value="">전체 IP</option>{ips.map(ip => <option key={ip.id} value={ip.id}>{ip.title}{ip.archivedAt ? ' · 보관' : ''}</option>)}</AdminSelect>
    </div></div>
    <div className="admin-goods-search__row"><label htmlFor="goods-list-date-field">기간</label><div className="admin-goods-search__period">
      <AdminSelect id="goods-list-date-field" name="dateField" defaultValue={filters.dateField ?? 'created'}>{GOODS_LIST_DATE_FIELDS.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}</AdminSelect>
      <div className="admin-goods-search__presets" aria-label="조회기간 빠른 선택">{consoleDatePresets().map(preset => <Link key={preset.id} className={isConsoleDateRangeActive(preset.range, filters) ? 'on' : undefined} href={goodsListHref({ ...filters, ...preset.range }, 1)}>{preset.label}</Link>)}<Link className={!filters.from && !filters.to ? 'on' : undefined} href={goodsListHref({ ...filters, from: null, to: null }, 1)}>전체</Link></div>
      <div className="admin-goods-search__dates"><label><span className="sr-only">시작일</span><input type="date" name="from" defaultValue={filters.from ?? ''} /></label><span aria-hidden="true">~</span><label><span className="sr-only">종료일</span><input type="date" name="to" defaultValue={filters.to ?? ''} /></label></div>
    </div></div>
    <details className="admin-goods-search__advanced" open={hasDetails}>
      <summary>상세검색 <span aria-hidden="true">⌄</span></summary>
      <div className="admin-goods-search__row"><span>상세검색</span><div className="admin-goods-search__content admin-goods-search__advanced-fields">
        <AdminSelect aria-label="출고지" id="goods-list-origin" name="originId" defaultValue={filters.originId ?? ''}><option value="">전체 출고지</option>{origins.map(origin => <option key={origin.id} value={origin.id}>{origin.name}{origin.active ? '' : ' · 사용 안 함'}</option>)}</AdminSelect>
        <AdminSelect aria-label="결제수단" id="goods-list-payment" name="payment" defaultValue={filters.payment ?? 'all'}><option value="all">전체 결제수단</option><option value="card">카드 결제 가능</option><option value="bank">무통장입금 가능</option><option value="none">결제수단 없음</option></AdminSelect>
        <AdminSelect aria-label="상품 유형" name="saleType" defaultValue={filters.saleType ?? 'all'}><option value="all">전체 상품 유형</option><option value="stock">일반 재고 상품</option><option value="preorder">예약판매 옵션 포함</option></AdminSelect>
        <AdminSelect aria-label="판매 제한" name="restriction" defaultValue={filters.restriction ?? 'all'}><option value="all">전체 판매 제한</option><option value="none">제한 없음</option><option value="adult">성인 상품</option></AdminSelect>
        <AdminSelect aria-label="대표 이미지" id="goods-list-image" name="image" defaultValue={filters.image ?? 'all'}><option value="all">대표 이미지 전체</option><option value="with">이미지 등록</option><option value="without">이미지 미등록</option></AdminSelect>
      </div></div>
    </details>
    <div className="admin-goods-search__actions"><button className="wc-admin-kit__button wc-admin-kit__button--primary" type="submit">검색</button><Link className="wc-admin-kit__button" href={GOODS_LIST_PATH}>초기화</Link></div>
  </form>;
}
