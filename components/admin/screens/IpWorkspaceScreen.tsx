import Link from 'next/link';
import type { ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { AdminSectionCard, AdminStatusBadge } from '../console/AdminKit';
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
    {/* 어느 IP인지가 이 화면의 머리다 — 이름을 크게, 게시 상태는 이름 바로 옆에 두고 바꾸는 곳으로 가는 길을 함께 둔다. */}
    <header className="flex flex-wrap items-center gap-x-3 gap-y-2" data-admin-kit="page-header">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {ip.imageUrl ? <img alt="" aria-hidden="true" className="h-12 w-20 shrink-0 rounded-md border object-cover" src={ip.imageUrl} /> : null}
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl leading-tight font-bold tracking-tight text-foreground">{ip.title}</h2>
          <AdminStatusBadge tone={statusTone('publication', adminIpPublishState(ip))}>{ADMIN_IP_PUBLISH_STATE_LABELS[adminIpPublishState(ip)]}</AdminStatusBadge>
        </div>
        <p className="text-sm text-muted-foreground">{ip.id}</p>
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <Link className={buttonVariants({ variant: 'outline' })} data-slot="button" href={`${IP_INDEX_PATH}?vertical=${encodeURIComponent(ip.verticalKey)}`}>IP 목록</Link>
        <Link className={buttonVariants({ variant: 'outline' })} data-slot="button" href={`${ipWorkspaceHref(ip.id, 'basic')}#ip-publish`}>게시 상태 변경</Link>
      </div>
    </header>
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
