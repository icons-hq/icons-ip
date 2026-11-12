import Link from 'next/link';
import { Plus } from 'lucide-react';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { AdminNotice, AdminPageHeader, AdminStatusBadge } from '../console/AdminKit';
import { AdminSelect } from '../console/AdminSelect';
import { ConsoleFilterField, ConsoleFilterPanel } from '../console/ConsoleFilterPanel';
import { ConsoleGrid } from '../console/ConsoleGrid';
import { ConsoleListCard } from '../console/ConsoleListCard';
import { ConsolePagination } from '../console/ConsolePagination';
import { IP_INDEX_PATH, IP_INDEX_PAGE_SIZE, ipIndexHref, ipWorkspaceHref, type AdminIpIndexData } from '@/lib/admin/ip-workspace';
import { ADMIN_IP_PUBLISH_STATE_LABELS, adminIpPublishState } from '@/lib/admin/ip-publish';
import { statusTone } from '@/lib/admin/status-tone';

export function IpIndexScreen({ data, deletedId = null }: { data: AdminIpIndexData; deletedId?: string | null }) {
  const { filters, ips, total, verticals } = data;
  return <section className="flex min-w-0 flex-col gap-4">
    <AdminPageHeader title="IP" description="IP 분류별로 IP를 찾고 연결된 콘텐츠를 관리합니다."
      actions={<Link className={buttonVariants()} data-slot="button" href={`${IP_INDEX_PATH}?create=1`}><Plus aria-hidden="true" />IP 등록</Link>} />
    {deletedId ? <AdminNotice role="status" title="IP를 삭제했습니다" tone="success">
      내부 ID {deletedId}는 다시 발급하지 않습니다. 삭제한 내용은 감사 로그에 남았습니다.
    </AdminNotice> : null}
    <ConsoleFilterPanel action={IP_INDEX_PATH} search={{ name: 'q', label: 'IP 이름·ID', value: filters.query }}
      statusFilter={{ value: filters.status, options: [
        { value: 'active', label: '보관 제외' }, { value: 'all', label: '전체' },
        { value: 'draft', label: '초안' }, { value: 'published', label: '공개' }, { value: 'archived', label: '보관' },
      ] }}>
      <ConsoleFilterField htmlFor="ip-index-vertical" label="IP 분류">
        <AdminSelect defaultValue={filters.vertical} id="ip-index-vertical" name="vertical" wrapperClassName="w-40">
          <option value="">전체 분류</option>{verticals.map((vertical) => <option key={vertical.key} value={vertical.key}>{vertical.label}</option>)}
        </AdminSelect>
      </ConsoleFilterField>
    </ConsoleFilterPanel>
    <ConsoleListCard title="목록" total={total}>
    <ConsoleGrid caption="IP 목록" columns={[
      { key: 'title', label: 'IP 이름' }, { key: 'id', label: 'ID' }, { key: 'vertical', label: 'IP 분류' },
      { key: 'status', label: '게시 상태' }, { key: 'featured', label: '추천 IP' }, { key: 'position', label: '순번', align: 'end' },
    ]} rows={ips.map((ip) => ({ id: ip.id, href: ipWorkspaceHref(ip.id), cells: [
      ip.title, ip.id, verticals.find((vertical) => vertical.key === ip.verticalKey)?.label ?? ip.verticalKey,
      <AdminStatusBadge key="status" tone={statusTone('publication', adminIpPublishState(ip))}>{ADMIN_IP_PUBLISH_STATE_LABELS[adminIpPublishState(ip)]}</AdminStatusBadge>,
      ip.featured ? '지정' : '—', ip.sortOrder,
    ] }))} />
    <ConsolePagination page={filters.page} pageSize={IP_INDEX_PAGE_SIZE} total={total} hrefForPage={(page) => ipIndexHref(filters, page)} />
    </ConsoleListCard>
  </section>;
}
