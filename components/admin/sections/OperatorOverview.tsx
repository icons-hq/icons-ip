import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { MANAGER_ROLE_LABELS, type OperatorAccess } from '@/lib/admin/access';
import { visibleAdminNavGroups } from '@/lib/admin/navigation';
import type { AdminHomeAttention } from '@/lib/admin/home-attention';
import { AdminNavGroupIcon } from '../admin-nav-icons';
import { HomeAttention } from './HomeAttention';

/* 매니저 홈 — 권한으로 열 수 있는 화면을 메뉴 그룹별 링크 카드로 편다(ADR-0028 템플릿 룩). */
export function OperatorOverview({ role, access, attention }: {
  role: string; access: OperatorAccess; attention?: AdminHomeAttention;
}) {
  const groups = visibleAdminNavGroups(role, access).filter(group => group.id !== 'home' && group.id !== 'help');
  return <div className="flex min-w-0 flex-col gap-6" data-admin-home="operator">
    <section aria-labelledby="admin-operator-shortcuts-title" className="flex min-w-0 flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h2 className="text-lg leading-tight font-semibold tracking-tight" id="admin-operator-shortcuts-title">내 업무 바로가기</h2>
        <p className="text-sm text-muted-foreground">{access.managerRole ? MANAGER_ROLE_LABELS[access.managerRole] : '매니저'} 권한으로 이용할 수 있는 메뉴입니다.</p>
      </header>
      {groups.map(group => {
        return <section className="flex min-w-0 flex-col gap-2" key={group.id}>
          <h3 className="flex items-center gap-2 text-sm font-medium"><span aria-hidden="true" className="text-muted-foreground [&>svg]:size-4"><AdminNavGroupIcon groupId={group.id} /></span>{group.label}</h3>
          <nav aria-label={`${group.label} 바로가기`} className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {group.screens.filter(screen => screen.status === 'ready').map(screen => <Link
              className="group/shortcut flex min-h-11 min-w-0 items-center justify-between gap-2 rounded-xl bg-card px-4 py-3 text-sm font-medium text-card-foreground ring-1 ring-foreground/10 transition-colors hover:bg-muted"
              href={screen.href}
              key={screen.id}
            >
              <span className="min-w-0 truncate">{screen.label}</span>
              <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform group-hover/shortcut:translate-x-0.5 group-hover/shortcut:text-foreground" />
            </Link>)}
          </nav>
        </section>;
      })}
    </section>
    {attention ? <HomeAttention data={attention} /> : null}
  </div>;
}
