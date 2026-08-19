'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from '@/components/ui/Icon';
import { visibleAdminNavGroups, type AdminScreen } from '@/lib/admin/navigation';

function isScreenActive(screen: AdminScreen, pathname: string): boolean {
  if (screen.href === '/admin') return pathname === '/admin';
  return pathname === screen.href || pathname.startsWith(`${screen.href}/`);
}

export function AdminSidebar({
  collapsed,
  onCollapsedChange,
  role,
}: {
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  role: string;
}) {
  const pathname = usePathname();
  const groups = visibleAdminNavGroups(role);

  return (
    <aside className="admin-sidebar">
      <Link aria-label="ICONS Admin 홈" className="brand admin-brand" href="/" style={{ fontSize: 19 }}>
        <span className="dot" />
        <span className="admin-nav-label">
          ICONS <span style={{ color: 'var(--dim)', fontWeight: 500 }}>Admin</span>
        </span>
      </Link>
      <nav className="admin-nav">
        {groups.map((group) => (
          <div key={group.id} className="admin-nav-group">
            <p className="admin-nav-group-label">{group.label}</p>
            {group.screens.map((screen) => {
              const label = screen.status === 'planned' ? `${screen.label} · 준비 중` : screen.label;
              /* 준비 중 화면은 라우트가 아직 없다. 링크로 걸면 404가 나므로
               * 자리만 보여 주고 클릭은 막는다 — 후속 이슈가 상태를 ready로 바꾼다. */
              if (screen.status === 'planned') {
                return (
                  <span
                    key={screen.id}
                    aria-disabled="true"
                    className="admin-nav-item admin-nav-item-planned"
                    title={`${screen.label} — 준비 중`}
                  >
                    <Icon name={group.icon} size={18} />
                    <span className="admin-nav-label">{label}</span>
                  </span>
                );
              }
              return (
                <Link
                  key={screen.id}
                  aria-current={isScreenActive(screen, pathname) ? 'page' : undefined}
                  aria-label={screen.label}
                  className={isScreenActive(screen, pathname) ? 'admin-nav-item on' : 'admin-nav-item'}
                  href={screen.href}
                  title={screen.label}
                >
                  <Icon name={group.icon} size={18} />
                  <span className="admin-nav-label">{screen.label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="admin-sidebar-foot">
        <Link aria-label="사이트로 돌아가기" className="admin-nav-item" href="/" title="사이트로 돌아가기">
          <Icon name="arrow" size={18} style={{ transform: 'rotate(180deg)' }} />
          <span className="admin-nav-label">사이트로 돌아가기</span>
        </Link>
        <button
          aria-expanded={!collapsed}
          aria-label={collapsed ? '사이드바 펼치기' : '사이드바 접기'}
          className="admin-nav-item admin-collapse-btn"
          onClick={() => onCollapsedChange(!collapsed)}
          title={collapsed ? '펼치기' : '접기'}
          type="button"
        >
          <Icon name={collapsed ? 'chevronRight' : 'chevronLeft'} size={18} />
          <span className="admin-nav-label">접기</span>
        </button>
      </div>
    </aside>
  );
}
