import Link from 'next/link';
import { formatOrderDateTime } from '@/lib/orders';
import { goodsAnnouncementHref, GOODS_ANNOUNCEMENTS_PATH, GOODS_ANNOUNCEMENT_CATEGORIES, GOODS_ANNOUNCEMENT_DEVICES, GOODS_ANNOUNCEMENT_STATES, type GoodsAnnouncementListData } from '@/lib/admin/goods-announcements';
import { AdminPageHeader, AdminStatusBadge } from '../console/AdminKit';
import { ConsoleFilterPanel, ConsoleGrid, ConsolePagination } from '../console';
import { CustomerServiceListSelect } from './CustomerServiceListControls';

export function GoodsAnnouncementsScreen({ data }: { data: GoodsAnnouncementListData }) {
  const { rows, total, filters } = data; const href = goodsAnnouncementHref(filters);
  return <section className="wc-admin-kit wc-admin-kit__screen admin-cs-console admin-goods-announcements">
    <AdminPageHeader title="상품공지사항 관리" actions={<Link className="wc-admin-kit__button wc-admin-kit__button--primary" href={`${href}&create=1`}>상품공지사항 등록</Link>} />
    <ConsoleFilterPanel action={GOODS_ANNOUNCEMENTS_PATH} hiddenFields={{ pageSize: String(filters.pageSize) }} dateRange={{ label: '공지등록일', from: filters.from, to: filters.to, presetHref: range => goodsAnnouncementHref({ ...filters, ...range }, 1) }}
      statusFilter={{ label: '전시상태', name: 'state', value: filters.state, options: [{ value: 'all', label: '전체' }, ...GOODS_ANNOUNCEMENT_STATES] }}
      search={{ label: '검색어', name: 'q', value: filters.query, fieldName: 'field', fieldValue: filters.field, fields: [{ value: 'title', label: '공지 제목' }, { value: 'reference', label: '공지번호' }] }} resetHref={GOODS_ANNOUNCEMENTS_PATH}>
      <div className="admin-console-filter-field"><label className="admin-console-filter-label" htmlFor="announcement-filter-category">공지 분류</label><select id="announcement-filter-category" name="category" defaultValue={filters.category}><option value="all">전체</option>{GOODS_ANNOUNCEMENT_CATEGORIES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div>
    </ConsoleFilterPanel>
    <section className="admin-cs-results" aria-label="상품공지사항 목록"><div className="admin-cs-results__header"><h3>상품공지사항 목록 <span>(총 <strong>{total.toLocaleString('ko-KR')}</strong>개)</span></h3><CustomerServiceListSelect label="상품공지사항 목록 수" value={String(filters.pageSize)} options={([20, 50, 100] as const).map(size => ({ value: String(size), label: `${size}개씩`, href: goodsAnnouncementHref({ ...filters, pageSize: size }, 1) }))} /></div>
      <div className="admin-cs-results__toolbar"><Link className="btn btn-sm btn-ghost" href={`${href}&create=1`}>상품공지사항 등록</Link><span>공지 제목을 누르면 저장된 내용과 적용 상품을 수정할 수 있습니다.</span></div>
      <ConsoleGrid caption="상품공지사항 목록" preferencesKey="goods-announcements" columns={[
        { key: 'title', label: '공지 제목', width: '260px' }, { key: 'reference', label: '공지번호', width: '90px' }, { key: 'category', label: '분류' }, { key: 'state', label: '전시상태' },
        { key: 'device', label: '노출 화면' }, { key: 'goods', label: '적용 상품' }, { key: 'period', label: '전시 기간', width: '220px' }, { key: 'created', label: '등록일', width: '150px' }, { key: 'updated', label: '수정일', width: '150px' },
      ]} rows={rows.map(row => ({ id: row.id, href: `${href}&edit=${row.id}`, cells: [
        <span key="title">{row.important ? <strong className="admin-announcement-important">중요</strong> : null}{row.title}</span>, row.reference,
        GOODS_ANNOUNCEMENT_CATEGORIES.find(item => item.value === row.category)?.label,
        <AdminStatusBadge key="state" tone={row.state === 'shown' ? 'success' : row.state === 'waiting' ? 'warning' : 'neutral'}>{GOODS_ANNOUNCEMENT_STATES.find(item => item.value === row.state)?.label}</AdminStatusBadge>,
        GOODS_ANNOUNCEMENT_DEVICES.find(item => item.value === row.device)?.label, row.allGoods ? '전체 상품' : `${row.goodCount}개 상품`,
        `${row.startsAt ? formatOrderDateTime(row.startsAt) : '제한 없음'} ~ ${row.endsAt ? formatOrderDateTime(row.endsAt) : '제한 없음'}`,
        row.createdAt ? formatOrderDateTime(row.createdAt) : '—', row.updatedAt ? formatOrderDateTime(row.updatedAt) : '—',
      ] }))} />
      <ConsolePagination page={filters.page} total={total} pageSize={filters.pageSize} hrefForPage={page => goodsAnnouncementHref(filters, page)} />
    </section>
    <p className="admin-cs-help">공지 기간은 한국 시각 기준입니다. 전시중인 공지도 상품과 IP가 공개되어 있고 노출 화면·적용 상품 조건이 맞을 때 표시됩니다. 공지 저장은 고객 알림을 발송하지 않습니다.</p>
  </section>;
}
