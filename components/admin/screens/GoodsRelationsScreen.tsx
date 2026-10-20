import Link from 'next/link';
import { formatOrderDateTime } from '@/lib/orders';
import { GOODS_RELATIONS_PATH, GOODS_RELATION_KINDS, GOODS_RELATION_STATES, goodsRelationHref, type GoodsRelationList } from '@/lib/admin/goods-relations';
import { AdminPageHeader, AdminStatusBadge } from '../console/AdminKit';
import { ConsoleFilterPanel, ConsoleGrid, ConsolePagination } from '../console';
import { CustomerServiceListSelect } from './CustomerServiceListControls';
import { GoodsRelationsExportButton } from '../GoodsRelationsExportButton';
import { goodsRelationsExportHref } from '@/lib/admin/goods-relations-export';

export function GoodsRelationsScreen({ data }: { data: GoodsRelationList }) {
  const { rows, total, filters } = data; const href = goodsRelationHref(filters);
  return <section className="wc-admin-kit wc-admin-kit__screen admin-cs-console admin-goods-relations">
    <AdminPageHeader title="연관상품 관리" actions={<Link className="wc-admin-kit__button wc-admin-kit__button--primary" href={`${href}&create=1`}>연관상품 등록</Link>} />
    <ConsoleFilterPanel action={GOODS_RELATIONS_PATH} hiddenFields={{ pageSize: String(filters.pageSize) }}
      statusFilter={{ label: '전시상태', name: 'state', value: filters.state, options: [{ value: 'all', label: '전체' }, ...GOODS_RELATION_STATES] }}
      search={{ label: '제목·상품명·코드·번호', name: 'q', value: filters.query }} resetHref={GOODS_RELATIONS_PATH}>
      <div className="admin-console-filter-field"><label className="admin-console-filter-label" htmlFor="relation-filter-kind">연관상품 유형</label><select id="relation-filter-kind" name="kind" defaultValue={filters.kind}><option value="all">전체</option>{GOODS_RELATION_KINDS.map(kind => <option key={kind.value} value={kind.value}>{kind.label}</option>)}</select></div>
    </ConsoleFilterPanel>
    <section className="admin-cs-results" aria-label="연관상품 목록"><div className="admin-cs-results__header"><h3>연관상품 목록 <span>(총 <strong>{total.toLocaleString('ko-KR')}</strong>개)</span></h3><CustomerServiceListSelect label="연관상품 목록 수" value={String(filters.pageSize)} options={([20, 50, 100] as const).map(size => ({ value: String(size), label: `${size}개씩`, href: goodsRelationHref({ ...filters, pageSize: size }, 1) }))} /></div>
      <div className="admin-cs-results__toolbar"><span>편성 제목을 누르면 구성 상품·대표·순서·기간을 수정할 수 있습니다.</span><GoodsRelationsExportButton key={goodsRelationsExportHref(filters)} href={goodsRelationsExportHref(filters)} total={total} /></div>
      <ConsoleGrid caption="연관상품 편성 목록" preferencesKey="goods-relations" columns={[{ key: 'title', label: '노출 제목', width: '180px' }, { key: 'kind', label: '유형', width: '180px' }, { key: 'representative', label: '대표 상품', width: '250px' }, { key: 'state', label: '전시상태' }, { key: 'goods', label: '구성 상품' }, { key: 'period', label: '노출 기간', width: '270px' }, { key: 'updated', label: '수정일', width: '160px' }]}
        rows={rows.map(row => ({ id: row.id, href: `${href}&edit=${row.id}`, cells: [row.title, `${GOODS_RELATION_KINDS.find(kind => kind.value === row.kind)?.label}${row.visual && row.kind === 'together' ? ' · 이미지형' : ''}`,
          row.goods.find(good => good.id === row.representativeGoodId)?.name,
          <AdminStatusBadge key="state" tone={row.state === 'active' ? 'success' : row.state === 'scheduled' ? 'warning' : 'neutral'}>{GOODS_RELATION_STATES.find(state => state.value === row.state)?.label}</AdminStatusBadge>,
          `${row.goods.length}개 · 공개 ${row.goods.filter(good => good.public).length}개`, `${row.startsAt ? formatOrderDateTime(row.startsAt) : '제한 없음'} ~ ${row.endsAt ? formatOrderDateTime(row.endsAt) : '제한 없음'}`, row.updatedAt ? formatOrderDateTime(row.updatedAt) : '—'] }))} />
      <ConsolePagination page={filters.page} total={total} pageSize={filters.pageSize} hrefForPage={page => goodsRelationHref(filters, page)} />
    </section><p className="admin-cs-help">전시중이고 공개 가능한 상품이 2개 이상일 때 표시됩니다. 다른 구성은 대표 상품이 비공개여도 공개 상품끼리 표시하며, 다른 유형은 대표 상품도 공개되어야 합니다. 추가구성상품과 별도로 관리하며 구매 수량·장바구니에는 영향을 주지 않습니다.</p>
  </section>;
}
