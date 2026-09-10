import Link from 'next/link';
import type { ReactNode } from 'react';
import { AdminPageHeader, AdminSectionCard, AdminStatusBadge } from '../console/AdminKit';
import { ConsoleGrid } from '../console/ConsoleGrid';
import { IpDirectoryControls } from '../IpDirectoryControls';
import { IpIdentityForm } from '../IpIdentityForm';
import { IP_INDEX_PATH, IP_WORKSPACE_TABS, ipWorkspaceHref, newGoodForIpHref, type AdminIpWorkspaceData } from '@/lib/admin/ip-workspace';
import { ADMIN_VOCABULARY } from '@/lib/admin/vocabulary';

export function IpWorkspaceScreen({ data, children }: { data: AdminIpWorkspaceData; children?: ReactNode }) {
  const { ip, tab, related, relatedTotal } = data;
  const label = tab === 'goods' ? ADMIN_VOCABULARY.goods : tab === 'pools' ? '카드풀' : '이벤트';
  const relatedHref = tab === 'goods' ? `/admin/catalog/goods?ipId=${encodeURIComponent(ip.id)}` : tab === 'pools' ? '/admin/catalog/pools' : '/admin/catalog/events';
  return <section className="wc-admin-kit">
    <Link href={`${IP_INDEX_PATH}?vertical=${encodeURIComponent(ip.verticalKey)}`}>← 같은 버티컬의 IP 목록</Link>
    <AdminPageHeader title={ip.title} description={ip.id} actions={<AdminStatusBadge tone={ip.publishedAt && !ip.archivedAt ? 'success' : 'neutral'}>{ip.archivedAt ? '보관' : ip.publishedAt ? '공개' : '초안'}</AdminStatusBadge>} />
    <nav aria-label="IP 작업 탭" className="wc-admin-kit__actions" style={{ marginBottom: 24 }}>
      {IP_WORKSPACE_TABS.map((entry) => <Link key={entry.id} href={ipWorkspaceHref(ip.id, entry.id)}
        className="wc-admin-kit__button" aria-current={tab === entry.id ? 'page' : undefined}
        style={tab === entry.id ? { background: 'var(--wc-accent-tint)', color: 'var(--wc-ink)' } : undefined}>
        {entry.id === 'goods' ? ADMIN_VOCABULARY.goods : entry.label}
      </Link>)}
    </nav>
    {tab === 'basic' ? <>
      {children}
      {data.identity ? <IpIdentityForm identity={data.identity} /> : null}
    </> : tab === 'exposure' ? <IpDirectoryControls id={ip.id} directory={data.directory} /> : <AdminSectionCard title={`${label} ${relatedTotal}개`}>
      <div className="wc-admin-kit__actions" style={{ marginBottom: 20 }}>
        {tab === 'goods' && !ip.archivedAt ? <Link className="wc-admin-kit__button" href={newGoodForIpHref(ip.id)}>{ADMIN_VOCABULARY.goods} 등록</Link> : null}
        <Link href={relatedHref}>전체 {label} 목록</Link>
      </div>
      {relatedTotal > related.length ? <p className="wc-admin-kit__description">연결된 {label} 중 {related.length}개를 표시합니다.</p> : null}
      <ConsoleGrid caption={`${ip.title} ${label} 목록`} columns={[{ key: 'title', label: `${label}명` }, { key: 'id', label: 'ID' }, { key: 'detail', label: '정보' }]}
        rows={related.map((entry) => ({ id: entry.id, cells: [entry.title, entry.id, entry.detail] }))} emptyLabel={`연결된 ${label}이 없습니다.`} />
    </AdminSectionCard>}
  </section>;
}
