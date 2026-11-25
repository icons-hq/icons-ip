import Link from 'next/link';
import { Plus } from 'lucide-react';
import { formatOrderDateTime } from '@/lib/orders';
import { GOODS_RELATIONS_PATH, GOODS_RELATION_KINDS, GOODS_RELATION_STATES, goodsRelationHref, relationCustomerView, relationListView, type GoodsRelationList } from '@/lib/admin/goods-relations';
import { AdminPageHeader, AdminStatusBadge } from '../console/AdminKit';
import { statusTone } from '@/lib/admin/status-tone';
import { AdminSelect } from '../console/AdminSelect';
import { ConsoleFilterField, ConsoleFilterPanel, ConsoleGrid, ConsolePagination } from '../console';
import { buttonVariants } from '../kit/ui/button';
import { CustomerServiceListSelect } from './CustomerServiceListControls';
import { GoodsRelationsExportButton } from '../GoodsRelationsExportButton';
import { goodsRelationsExportHref } from '@/lib/admin/goods-relations-export';
import { compactKstPeriod } from './GoodsAnnouncementsScreen';
import { kstDay } from '@/lib/admin/kst';

export function GoodsRelationsScreen({ data, adultGoodsHidden = false }: {
  data: GoodsRelationList;
  /** 성인(19금) 상품을 지금 모든 고객에게 숨겨 두었는가(기능 공개 관리). '고객 화면' 칸의 판정이 달라진다. */
  adultGoodsHidden?: boolean;
}) {
  const { rows, total, filters } = data; const href = goodsRelationHref(filters);
  return <section className="flex min-w-0 flex-col gap-4" data-admin-screen="goods-relations">
    <AdminPageHeader title="연관상품 관리" description="상품 상세에서 다른 상품을 소개합니다. 장바구니에 함께 담는 추가구성상품과는 다릅니다." actions={<Link className={buttonVariants()} data-slot="button" href={`${href}&create=1`}><Plus aria-hidden="true" />연관상품 등록</Link>} />
    <ConsoleFilterPanel action={GOODS_RELATIONS_PATH} hiddenFields={{ pageSize: String(filters.pageSize) }}
      statusFilter={{ label: '전시상태', name: 'state', value: filters.state, options: [{ value: 'all', label: '전체' }, ...GOODS_RELATION_STATES] }}
      search={{ label: '노출 제목·상품명·상품 자동코드', name: 'q', value: filters.query }} resetHref={GOODS_RELATIONS_PATH}>
      <ConsoleFilterField htmlFor="relation-filter-kind" label="연관상품 유형"><AdminSelect id="relation-filter-kind" name="kind" defaultValue={filters.kind} wrapperClassName="w-44"><option value="all">전체</option>{GOODS_RELATION_KINDS.map(kind => <option key={kind.value} value={kind.value}>{kind.label}</option>)}</AdminSelect></ConsoleFilterField>
    </ConsoleFilterPanel>
    <section className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground" aria-label="연관상품 목록"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-base leading-snug font-medium">연관상품 목록 <span className="text-sm font-normal text-muted-foreground">(총 <strong className="font-semibold text-foreground tabular-nums">{total.toLocaleString('ko-KR')}</strong>개)</span></h3><CustomerServiceListSelect label="연관상품 목록 수" value={String(filters.pageSize)} options={([20, 50, 100] as const).map(size => ({ value: String(size), label: `${size}개씩`, href: goodsRelationHref({ ...filters, pageSize: size }, 1) }))} /></div>
      <div className="flex justify-end"><GoodsRelationsExportButton key={goodsRelationsExportHref(filters)} href={goodsRelationsExportHref(filters)} total={total} /></div>
      {/* '고객 화면' 칸이 지금 고객에게 보이는지와 안 보이는 까닭을 줄마다 말한다(조건을 글로 설명하지 않는다). */}
      <ConsoleGrid caption="연관상품 목록" className="[&_table]:min-w-[1320px]" preferencesKey="goods-relations" columns={[{ key: 'title', label: '노출 제목', width: '168px' }, { key: 'kind', label: '유형', width: '140px' }, { key: 'representative', label: '대표 상품', width: '236px' }, { key: 'state', label: '전시상태', width: '96px' }, { key: 'customer', label: '고객 화면', width: '220px' }, { key: 'goods', label: '담은 상품', width: '116px' }, { key: 'period', label: '전시 기간', width: '240px' }, { key: 'updated', label: '수정일', width: '104px' }]}
        rows={rows.map(row => {
          const representative = row.goods.find(good => good.id === row.representativeGoodId)?.name;
          const customer = relationListView(relationCustomerView({ kind: row.kind, visual: Boolean(row.visual), state: row.state, representativeGoodId: row.representativeGoodId, goods: row.goods, adultGoodsHidden }));
          return { id: row.id, href: `${href}&edit=${row.id}`, cells: [row.title, `${GOODS_RELATION_KINDS.find(kind => kind.value === row.kind)?.label}${row.visual && row.kind === 'together' ? ' · 이미지형' : ''}`,
          /* 긴 상품명이 줄 높이를 흔들지 않게 한 줄로 줄이고 전체 이름은 말풍선에 둔다. */
          <span className="block w-0 min-w-full truncate" key="representative" title={representative}>{representative}</span>,
          <AdminStatusBadge key="state" tone={statusTone('goodsRelation', row.state)}>{GOODS_RELATION_STATES.find(state => state.value === row.state)?.label}</AdminStatusBadge>,
          <span className="flex min-w-0 flex-col items-start gap-1" key="customer"><AdminStatusBadge tone={statusTone('display', customer.shown ? 'active' : 'inactive')}>{customer.shown ? '보임' : '안 보임'}</AdminStatusBadge><small className="text-xs text-muted-foreground">{customer.detail}</small></span>,
          <span className="whitespace-nowrap tabular-nums" key="goods">{`${row.goods.length}개 · 공개 ${row.goods.filter(good => good.public).length}개`}</span>,
          <span className="whitespace-nowrap tabular-nums" key="period" title={`${row.startsAt ? formatOrderDateTime(row.startsAt) : '제한 없음'} ~ ${row.endsAt ? formatOrderDateTime(row.endsAt) : '제한 없음'}`}>{compactKstPeriod(row.startsAt, row.endsAt)}</span>,
          <span className="whitespace-nowrap tabular-nums" key="updated" title={row.updatedAt ? formatOrderDateTime(row.updatedAt) : undefined}>{row.updatedAt ? kstDay(new Date(row.updatedAt)).replaceAll('-', '.') : '—'}</span>] }; })} />
      <ConsolePagination page={filters.page} total={total} pageSize={filters.pageSize} hrefForPage={page => goodsRelationHref(filters, page)} />
    </section>
  </section>;
}
