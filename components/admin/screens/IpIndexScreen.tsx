import Link from 'next/link';
import { AdminPageHeader, AdminStatusBadge } from '../console/AdminKit';
import { ConsoleFilterPanel } from '../console/ConsoleFilterPanel';
import { ConsoleGrid } from '../console/ConsoleGrid';
import { ConsolePagination } from '../console/ConsolePagination';
import { IP_INDEX_PATH, IP_INDEX_PAGE_SIZE, ipIndexHref, ipWorkspaceHref, type AdminIpIndexData } from '@/lib/admin/ip-workspace';

export function IpIndexScreen({ data }: { data: AdminIpIndexData }) {
  const { filters, ips, total, verticals } = data;
  return <section className="wc-admin-kit">
    <AdminPageHeader title="IP" description="버티컬에서 IP를 찾고 연결된 콘텐츠를 관리합니다."
      actions={<Link className="wc-admin-kit__button" href={`${IP_INDEX_PATH}?create=1`}>IP 등록</Link>} />
    <ConsoleFilterPanel action={IP_INDEX_PATH} search={{ name: 'q', label: 'IP 이름·ID', value: filters.query }}
      statusFilter={{ value: filters.status, options: [
        { value: 'active', label: '보관 제외' }, { value: 'all', label: '전체' },
        { value: 'draft', label: '초안' }, { value: 'published', label: '공개' }, { value: 'archived', label: '보관' },
      ] }}>
      <div className="admin-console-filter-field"><label className="admin-console-filter-label" htmlFor="ip-index-vertical">버티컬</label>
        <select id="ip-index-vertical" name="vertical" defaultValue={filters.vertical}>
          <option value="">전체 버티컬</option>{verticals.map((vertical) => <option key={vertical.key} value={vertical.key}>{vertical.label}</option>)}
        </select>
      </div>
    </ConsoleFilterPanel>
    <ConsoleGrid caption="IP 목록" columns={[
      { key: 'title', label: 'IP 이름' }, { key: 'id', label: 'ID' }, { key: 'vertical', label: '버티컬' },
      { key: 'status', label: '게시 상태' }, { key: 'featured', label: '피처드' }, { key: 'position', label: '순번' },
    ]} rows={ips.map((ip) => ({ id: ip.id, href: ipWorkspaceHref(ip.id), cells: [
      ip.title, ip.id, verticals.find((vertical) => vertical.key === ip.verticalKey)?.label ?? ip.verticalKey,
      <AdminStatusBadge key="status" tone={ip.publishedAt && !ip.archivedAt ? 'success' : 'neutral'}>{ip.archivedAt ? '보관' : ip.publishedAt ? '공개' : '초안'}</AdminStatusBadge>,
      ip.featured ? '지정' : '—', ip.sortOrder,
    ] }))} />
    <ConsolePagination page={filters.page} pageSize={IP_INDEX_PAGE_SIZE} total={total} hrefForPage={(page) => ipIndexHref(filters, page)} />
  </section>;
}
