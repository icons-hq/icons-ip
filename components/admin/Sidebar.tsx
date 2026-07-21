import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import type { AdminSection } from './Admin';

const NAV_ITEMS: { id: AdminSection; label: string; icon: string }[] = [
  { id: 'overview', label: '개요', icon: 'grid' },
  { id: 'orders', label: '주문', icon: 'bag' },
  { id: 'ip', label: 'IP', icon: 'ip' },
  { id: 'good', label: '굿즈', icon: 'shop' },
  { id: 'card', label: '카드', icon: 'card' },
  { id: 'pool', label: '카드풀', icon: 'card' },
  { id: 'policy', label: '발급 정책', icon: 'card' },
  { id: 'game', label: '게임', icon: 'event' },
  { id: 'event', label: '이벤트', icon: 'event' },
  { id: 'ticket', label: '티켓 회차', icon: 'event' },
  { id: 'curations', label: '홈 큐레이션', icon: 'grid' },
  { id: 'notifications', label: '공지 발송', icon: 'bell' },
  { id: 'moderation', label: '모더레이션', icon: 'shield' },
  { id: 'members', label: '회원', icon: 'user' },
  { id: 'roles', label: '역할', icon: 'user' },
];

export function Sidebar({
  active,
  collapsed,
  onCollapsedChange,
  onSectionChange,
  showRoles,
}: {
  active: AdminSection;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onSectionChange: (section: AdminSection) => void;
  showRoles: boolean;
}) {
  return (
    <aside className="admin-sidebar">
      <Link aria-label="ICONS Admin 홈" className="brand admin-brand" href="/" style={{ fontSize: 19 }}>
        <span className="dot" />
        <span className="admin-nav-label">
          ICONS <span style={{ color: 'var(--dim)', fontWeight: 500 }}>Admin</span>
        </span>
      </Link>
      <nav className="admin-nav">
        {NAV_ITEMS.filter((item) => item.id !== 'roles' || showRoles).map((item) => (
          <button
            key={item.id}
            aria-current={active === item.id ? 'true' : undefined}
            aria-label={item.label}
            className={active === item.id ? 'admin-nav-item on' : 'admin-nav-item'}
            onClick={() => onSectionChange(item.id)}
            title={item.label}
            type="button"
          >
            <Icon name={item.icon} size={18} />
            <span className="admin-nav-label">{item.label}</span>
          </button>
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
