import Link from 'next/link';
import { MANAGER_ROLE_LABELS, type OperatorAccess } from '@/lib/admin/access';
import { visibleAdminNavGroups } from '@/lib/admin/navigation';
import type { AdminHomeAttention } from '@/lib/admin/home-attention';
import { HomeAttention } from './HomeAttention';

export function OperatorOverview({ role, access, attention }: {
  role: string; access: OperatorAccess; attention?: AdminHomeAttention;
}) {
  const groups = visibleAdminNavGroups(role, access).filter(group => group.id !== 'home' && group.id !== 'help');
  return <section className="admin-overview">
    <section className="card wc-admin-kit wc-admin-kit__card admin-overview-panel">
      <header className="admin-overview-panel__heading"><div>
        <h2 className="admin-overview-panel__title">내 업무 바로가기</h2>
        <p className="admin-overview-panel__description">{access.managerRole ? MANAGER_ROLE_LABELS[access.managerRole] : '매니저'} 권한으로 이용할 수 있는 메뉴입니다.</p>
      </div></header>
      {groups.map(group => <section key={group.id}>
        <h3>{group.label}</h3>
        <nav aria-label={`${group.label} 바로가기`} className="admin-overview-reports">
          {group.screens.filter(screen => screen.status === 'ready').map(screen => <Link key={screen.id} className="btn btn-sm btn-ghost" href={screen.href}>{screen.label}</Link>)}
        </nav>
      </section>)}
    </section>
    {attention ? <HomeAttention data={attention} /> : null}
  </section>;
}
