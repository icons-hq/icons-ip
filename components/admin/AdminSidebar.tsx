'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useBrowserStoredValue, writeBrowserStoredValue } from '@/components/admin/catalog/browser-store';
import { signOutAdminAction } from '@/app/admin/session-actions';
import { Icon } from '@/components/ui/Icon';
import {
  ADMIN_NAV_COLLAPSED_KEY,
  ADMIN_NAV_TIER_KEY,
  adminGroupForPath,
  adminNavGroupsForView,
  adminNavTierValue,
  isAdminNavShowingAll,
  isNavGroupCollapsed,
  parseCollapsedNavGroups,
  serializeCollapsedNavGroups,
  toggleCollapsedNavGroup,
  type AdminNavGroup,
  type AdminScreen,
} from '@/lib/admin/navigation';

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
  /* 보기 상태는 브라우저에만 남는다 — 운영자 개인 취향이지 계정 설정이 아니다.
     서버 렌더와 하이드레이션은 저장값 없이 같은 화면(기본 메뉴)에서 시작한다. */
  const showAll = isAdminNavShowingAll(useBrowserStoredValue(ADMIN_NAV_TIER_KEY));
  const collapsedIds = parseCollapsedNavGroups(useBrowserStoredValue(ADMIN_NAV_COLLAPSED_KEY));
  const activeGroupId = adminGroupForPath(pathname)?.id ?? null;
  const groups = adminNavGroupsForView(role, { showAll, activeGroupId });

  return (
    <aside className="admin-sidebar">
      <Link aria-label="ICONS Admin 홈" className="brand admin-brand" href="/" style={{ fontSize: 19 }}>
        <span className="dot" />
        <span className="admin-nav-label">
          ICONS <span style={{ color: 'var(--dim)', fontWeight: 500 }}>Admin</span>
        </span>
      </Link>
      <button
        aria-pressed={showAll}
        className="admin-nav-tier-toggle"
        onClick={() => writeBrowserStoredValue(ADMIN_NAV_TIER_KEY, adminNavTierValue(!showAll))}
        title={showAll ? '기본 메뉴만 보기' : '전체 메뉴 보기'}
        type="button"
      >
        <Icon name={showAll ? 'chevronUp' : 'chevronDown'} size={16} />
        <span className="admin-nav-label">{showAll ? '전체 메뉴' : '기본 메뉴'}</span>
      </button>
      <nav className="admin-nav">
        {groups.map((group) => {
          const collapsed = isNavGroupCollapsed(collapsedIds, group.id, activeGroupId);
          return (
          <div key={group.id} className="admin-nav-group" data-collapsed={collapsed || undefined}>
            <NavGroupLabel
              collapsed={collapsed}
              group={group}
              /* 지금 보고 있는 그룹은 접는 단추를 아예 주지 않는다 — 접으면 현재 위치가 사라진다. */
              lockedOpen={group.id === activeGroupId}
              onToggle={() => writeBrowserStoredValue(
                ADMIN_NAV_COLLAPSED_KEY,
                serializeCollapsedNavGroups(toggleCollapsedNavGroup(collapsedIds, group.id)),
              )}
            />
            {collapsed ? null : group.screens.map((screen) => {
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
          );
        })}
      </nav>
      <div className="admin-sidebar-foot">
        <Link aria-label="사이트로 돌아가기" className="admin-nav-item" href="/" title="사이트로 돌아가기">
          <Icon name="arrow" size={18} style={{ transform: 'rotate(180deg)' }} />
          <span className="admin-nav-label">사이트로 돌아가기</span>
        </Link>
        {/* 로그아웃은 사이드바 발치에 둔다 — 어드민 안에서 끝나야 다시 들어오는 길을 잃지 않는다. */}
        <form action={signOutAdminAction}>
          <button aria-label="로그아웃" className="admin-nav-item" title="로그아웃" type="submit">
            <Icon name="signOut" size={18} />
            <span className="admin-nav-label">로그아웃</span>
          </button>
        </form>
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

/*
 * 그룹 머리. 접을 수 있으면 단추, 아니면 그냥 라벨이다 — 눌러도 아무 일 없는 단추를
 * 두면 「고장난 건가」가 된다.
 */
function NavGroupLabel({
  collapsed,
  group,
  lockedOpen,
  onToggle,
}: {
  collapsed: boolean;
  group: AdminNavGroup;
  lockedOpen: boolean;
  onToggle: () => void;
}) {
  if (lockedOpen) {
    return <p className="admin-nav-group-label">{group.label}</p>;
  }

  return (
    <button
      aria-expanded={!collapsed}
      className="admin-nav-group-label admin-nav-group-toggle"
      onClick={onToggle}
      title={collapsed ? `${group.label} 펼치기` : `${group.label} 접기`}
      type="button"
    >
      <span className="admin-nav-label">{group.label}</span>
      <Icon name={collapsed ? 'chevronRight' : 'chevronDown'} size={14} />
    </button>
  );
}
