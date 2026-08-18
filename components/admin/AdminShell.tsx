'use client';

import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { adminScreenForPath } from '@/lib/admin/navigation';
import { AdminSidebar } from './AdminSidebar';
import { Header } from './Header';

export function AdminShell({
  admin,
  badges,
  children,
}: {
  admin: { id: string; email: string | null; role: string };
  /** 사이드바 배지 슬롯. 후속 이슈(미답변 문의 수 등)가 채운다. */
  badges?: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const screen = adminScreenForPath(pathname);

  return (
    <div className={collapsed ? 'admin-shell collapsed' : 'admin-shell'}>
      <AdminSidebar collapsed={collapsed} onCollapsedChange={setCollapsed} role={admin.role} />
      <div className="admin-main">
        <Header admin={admin} title={screen?.label ?? '어드민'} />
        {badges}
        <main className="admin-content">
          {/* key로 화면 전환마다 진입 애니메이션을 다시 태운다 */}
          <div key={pathname} className="rise">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
