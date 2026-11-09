import Link from 'next/link';
import { Plus } from 'lucide-react';
import { formatOrderDateTime } from '@/lib/orders';
import { GOODS_RELATIONS_PATH, GOODS_RELATION_KINDS, GOODS_RELATION_STATES, goodsRelationHref, type GoodsRelationList } from '@/lib/admin/goods-relations';
import { AdminPageHeader, AdminStatusBadge } from '../console/AdminKit';
import { statusTone } from '@/lib/admin/status-tone';
import { AdminSelect } from '../console/AdminSelect';
import { ConsoleFilterField, ConsoleFilterPanel, ConsoleGrid, ConsolePagination } from '../console';
import { buttonVariants } from '../kit/ui/button';
import { CustomerServiceListSelect } from './CustomerServiceListControls';
import { GoodsRelationsExportButton } from '../GoodsRelationsExportButton';
import { goodsRelationsExportHref } from '@/lib/admin/goods-relations-export';
import { compactKstPeriod } from './GoodsAnnouncementsScreen';

export function GoodsRelationsScreen({ data }: { data: GoodsRelationList }) {
  const { rows, total, filters } = data; const href = goodsRelationHref(filters);
  return <section className="flex min-w-0 flex-col gap-4" data-admin-screen="goods-relations">
    <AdminPageHeader title="연관상품 관리" actions={<Link className={buttonVariants()} data-slot="button" href={`${href}&create=1`}><Plus aria-hidden="true" />연관상품 등록</Link>} />
    <ConsoleFilterPanel action={GOODS_RELATIONS_PATH} hiddenFields={{ pageSize: String(filters.pageSize) }}
      statusFilter={{ label: '전시상태', name: 'state', value: filters.state, options: [{ value: 'all', label: '전체' }, ...GOODS_RELATION_STATES] }}
      search={{ label: '제목·상품명·코드·번호', name: 'q', value: filters.query }} resetHref={GOODS_RELATIONS_PATH}>
      <ConsoleFilterField htmlFor="relation-filter-kind" label="연관상품 유형"><AdminSelect id="relation-filter-kind" name="kind" defaultValue={filters.kind} wrapperClassName="w-44"><option value="all">전체</option>{GOODS_RELATION_KINDS.map(kind => <option key={kind.value} value={kind.value}>{kind.label}</option>)}</AdminSelect></ConsoleFilterField>
    </ConsoleFilterPanel>
    <section className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground" aria-label="연관상품 목록"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-base leading-snug font-medium">연관상품 목록 <span className="text-sm font-normal text-muted-foreground">(총 <strong className="font-semibold text-foreground tabular-nums">{total.toLocaleString('ko-KR')}</strong>개)</span></h3><CustomerServiceListSelect label="연관상품 목록 수" value={String(filters.pageSize)} options={([20, 50, 100] as const).map(size => ({ value: String(size), label: `${size}개씩`, href: goodsRelationHref({ ...filters, pageSize: size }, 1) }))} /></div>
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between"><span className="text-sm text-muted-foreground">편성 제목을 누르면 구성 상품·대표·순서·기간을 수정할 수 있습니다.</span><GoodsRelationsExportButton key={goodsRelationsExportHref(filters)} href={goodsRelationsExportHref(filters)} total={total} /></div>
      <ConsoleGrid caption="연관상품 편성 목록" className="[&_table]:min-w-[1100px]" preferencesKey="goods-relations" columns={[{ key: 'title', label: '노출 제목', width: '168px' }, { key: 'kind', label: '유형', width: '140px' }, { key: 'representative', label: '대표 상품', width: '236px' }, { key: 'state', label: '전시상태', width: '96px' }, { key: 'goods', label: '구성 상품', width: '116px' }, { key: 'period', label: '노출 기간', width: '240px' }, { key: 'updated', label: '수정일', width: '104px' }]}
        rows={rows.map(row => ({ id: row.id, href: `${href}&edit=${row.id}`, cells: [row.title, `${GOODS_RELATION_KINDS.find(kind => kind.value === row.kind)?.label}${row.visual && row.kind === 'together' ? ' · 이미지형' : ''}`,
          row.goods.find(good => good.id === row.representativeGoodId)?.name,
          <AdminStatusBadge key="state" tone={statusTone('goodsRelation', row.state)}>{GOODS_RELATION_STATES.find(state => state.value === row.state)?.label}</AdminStatusBadge>,
          <span className="whitespace-nowrap tabular-nums" key="goods">{`${row.goods.length}개 · 공개 ${row.goods.filter(good => good.public).length}개`}</span>,
          <span className="whitespace-nowrap tabular-nums" key="period" title={`${row.startsAt ? formatOrderDateTime(row.startsAt) : '제한 없음'} ~ ${row.endsAt ? formatOrderDateTime(row.endsAt) : '제한 없음'}`}>{compactKstPeriod(row.startsAt, row.endsAt)}</span>,
          <span className="whitespace-nowrap tabular-nums" key="updated" title={row.updatedAt ? formatOrderDateTime(row.updatedAt) : undefined}>{row.updatedAt ? new Date(row.updatedAt).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' }) : '—'}</span>] }))} />
      <ConsolePagination page={filters.page} total={total} pageSize={filters.pageSize} hrefForPage={page => goodsRelationHref(filters, page)} />
    </section><p className="text-sm text-muted-foreground">전시중이고 공개 가능한 상품이 2개 이상일 때 표시됩니다. 다른 구성은 대표 상품이 비공개여도 공개 상품끼리 표시하며, 다른 유형은 대표 상품도 공개되어야 합니다. 추가구성상품과 별도로 관리하며 구매 수량·장바구니에는 영향을 주지 않습니다.</p>
  </section>;
}
