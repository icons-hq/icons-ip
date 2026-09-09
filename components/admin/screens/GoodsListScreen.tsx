import Link from 'next/link';
import { canSellAdminGood } from '@/lib/admin/goods-publish';
import { AdminPageHeader, AdminStatusBadge } from '../console/AdminKit';
import { ConsoleFilterPanel } from '../console/ConsoleFilterPanel';
import { ConsoleGrid } from '../console/ConsoleGrid';
import { ConsolePagination } from '../console/ConsolePagination';
import { ADMIN_VOCABULARY } from '@/lib/admin/vocabulary';
import {
  GOODS_LIST_PATH, GOODS_LIST_PAGE_SIZE, goodsListHref, goodEditorHref, type AdminGoodsListData,
} from '@/lib/admin/goods-list';

export function GoodsListScreen({ data }: { data: AdminGoodsListData }) {
  const { filters, goods, total, ips } = data;
  return <section className="wc-admin-kit">
    <AdminPageHeader title={`${ADMIN_VOCABULARY.goods} 목록`} description="상품명·상품코드·ID로 찾고, IP와 상태를 골라 관리합니다."
      actions={<><Link className="wc-admin-kit__button" href="/admin/catalog/goods/import">엑셀 등록·수정</Link><Link className="wc-admin-kit__button" href={goodsListHref(filters).replace('/catalog/goods?', '/catalog/goods/export?')}>엑셀 내보내기</Link><Link className="wc-admin-kit__button" href={`${goodsListHref(filters)}&create=1`}>{ADMIN_VOCABULARY.goods} 등록</Link></>} />
    <ConsoleFilterPanel action={GOODS_LIST_PATH} search={{ name: 'q', label: `${ADMIN_VOCABULARY.goods}명·${ADMIN_VOCABULARY.goodsCode}·ID`, value: filters.query }}
      statusFilter={{ value: filters.status, label: '게시 상태', options: [
        { value: 'active', label: '보관 제외' }, { value: 'all', label: '전체' },
        { value: 'draft', label: '초안' }, { value: 'published', label: '공개' }, { value: 'archived', label: '보관' },
      ] }}>
      <div className="admin-console-filter-field">
        <label className="admin-console-filter-label" htmlFor="goods-list-ip">IP</label>
        <select id="goods-list-ip" name="ipId" defaultValue={filters.ipId}>
          <option value="">전체 IP</option>
          {ips.map((ip) => <option key={ip.id} value={ip.id}>{ip.title}{ip.archivedAt ? ' · 보관' : ''}</option>)}
        </select>
      </div>
      <div className="admin-console-filter-field">
        <label className="admin-console-filter-label" htmlFor="goods-list-stock">재고 상태</label>
        <select id="goods-list-stock" name="stock" defaultValue={filters.stock}>
          <option value="all">전체 재고</option><option value="ok">재고 있음</option>
          <option value="low">소량</option><option value="soldout">품절·판매 중지</option>
        </select>
      </div>
    </ConsoleFilterPanel>
    <ConsoleGrid caption={`${ADMIN_VOCABULARY.goods} 목록`} columns={[
      { key: 'name', label: `${ADMIN_VOCABULARY.goods}명` }, { key: 'code', label: ADMIN_VOCABULARY.goodsCode },
      { key: 'ip', label: 'IP' }, { key: 'qty', label: '재고', align: 'end' },
      { key: 'stock', label: '재고 상태' }, { key: 'status', label: '게시 상태' }, { key: 'sale', label: '판매 가능' },
    ]} rows={goods.map((good) => ({ id: good.id, href: goodEditorHref(filters, good.id), cells: [
      good.name, <span key="code">{good.code}<small style={{ display: 'block', color: 'var(--wc-ink-tertiary)' }}>{good.id}</small></span>,
      good.ipTitle, `${good.stockQty.toLocaleString('ko-KR')}개`,
      good.stock === 'soldout' || good.stockQty === 0 ? '품절·판매 중지' : good.stock === 'low' ? '소량' : '재고 있음',
      <AdminStatusBadge key="status" tone={good.publishedAt && !good.archivedAt ? 'success' : 'neutral'}>{good.archivedAt ? '보관' : good.publishedAt ? '공개' : '초안'}</AdminStatusBadge>,
      canSellAdminGood(good) ? '판매 가능' : '판매 준비 중',
    ] }))} />
    <ConsolePagination page={filters.page} pageSize={GOODS_LIST_PAGE_SIZE} total={total} hrefForPage={(page) => goodsListHref(filters, page)} />
  </section>;
}
