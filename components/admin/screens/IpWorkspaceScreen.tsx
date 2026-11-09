import Link from 'next/link';
import type { ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { AdminPageHeader, AdminSectionCard, AdminStatusBadge } from '../console/AdminKit';
import { ConsoleGrid } from '../console/ConsoleGrid';
import { IpDirectoryControls } from '../IpDirectoryControls';
import { IpIdentityForm } from '../IpIdentityForm';
import { IP_INDEX_PATH, IP_WORKSPACE_TABS, ipWorkspaceHref, newGoodForIpHref, type AdminIpWorkspaceData } from '@/lib/admin/ip-workspace';
import { ADMIN_VOCABULARY } from '@/lib/admin/vocabulary';
import { ADMIN_IP_PUBLISH_STATE_LABELS, adminIpPublishState } from '@/lib/admin/ip-publish';
import { statusTone } from '@/lib/admin/status-tone';

/* 작업 탭은 셸의 콘솔 전환과 같은 모양(muted 바탕 위 현재 탭만 흰 바탕)이다. */
const TAB_CLASS = 'inline-flex h-7 shrink-0 items-center rounded-md px-3 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 aria-[current=page]:bg-background aria-[current=page]:text-primary-soft-foreground aria-[current=page]:shadow-sm';

export function IpWorkspaceScreen({ data, children }: { data: AdminIpWorkspaceData; children?: ReactNode }) {
  const { ip, tab, related, relatedTotal } = data;
  const label = tab === 'goods' ? ADMIN_VOCABULARY.goods : tab === 'pools' ? '카드풀' : '이벤트';
  const relatedHref = tab === 'goods' ? `/admin/catalog/goods?ipId=${encodeURIComponent(ip.id)}` : tab === 'pools' ? '/admin/catalog/pools' : '/admin/catalog/events';
  return <section className="flex min-w-0 flex-col gap-6">
    <Link className="w-fit text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" href={`${IP_INDEX_PATH}?vertical=${encodeURIComponent(ip.verticalKey)}`}>← IP 목록</Link>
    <AdminPageHeader title={ip.title} description={ip.id} actions={<AdminStatusBadge tone={statusTone('publication', adminIpPublishState(ip))}>{ADMIN_IP_PUBLISH_STATE_LABELS[adminIpPublishState(ip)]}</AdminStatusBadge>} />
    <nav aria-label="IP 작업 탭" className="flex w-fit max-w-full items-center overflow-x-auto rounded-lg bg-muted p-0.5">
      {IP_WORKSPACE_TABS.map((entry) => <Link key={entry.id} href={ipWorkspaceHref(ip.id, entry.id)}
        className={TAB_CLASS} aria-current={tab === entry.id ? 'page' : undefined}>
        {entry.id === 'goods' ? ADMIN_VOCABULARY.goods : entry.label}
      </Link>)}
    </nav>
    {tab === 'basic' ? <div className="flex min-w-0 flex-col gap-4">
      {children}
      {data.identity ? <IpIdentityForm identity={data.identity} /> : null}
    </div> : tab === 'exposure' ? <IpDirectoryControls id={ip.id} directory={data.directory} /> : <AdminSectionCard title={`${label} ${relatedTotal}개`}>
      <div className="flex flex-wrap items-center gap-2">
        {tab === 'goods' && !ip.archivedAt ? <Link className={buttonVariants()} data-slot="button" href={newGoodForIpHref(ip.id)}><Plus aria-hidden="true" />{ADMIN_VOCABULARY.goods} 등록</Link> : null}
        <Link className={buttonVariants({ variant: 'outline' })} data-slot="button" href={relatedHref}>전체 {label} 목록</Link>
      </div>
      {relatedTotal > related.length ? <p className="text-sm text-muted-foreground">연결된 {label} 중 {related.length}개를 표시합니다.</p> : null}
      <ConsoleGrid caption={`${ip.title} ${label} 목록`} columns={[{ key: 'title', label: `${label}명` }, { key: 'id', label: 'ID' }, { key: 'detail', label: '정보' }]}
        rows={related.map((entry) => ({ id: entry.id, cells: [entry.title, entry.id, entry.detail] }))} emptyLabel={`연결된 ${label}이 없습니다.`} />
    </AdminSectionCard>}
  </section>;
}
