'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { adminGroupForPath, adminScreenForPath } from '@/lib/admin/navigation';
import { AdminSidebar } from './AdminSidebar';
import { Header } from './Header';
import { AdminPreferencesProvider } from './console/AdminPreferences';
import { OperationsDock } from './OperationsDock';
import { NO_OPERATOR_ACCESS, type OperatorAccess } from '@/lib/admin/access';

export function AdminShell({
  admin,
  badges,
  children,
}: {
  admin: { id: string; email: string | null; role: string; operatorAccess?: OperatorAccess };
  /** 사이드바 배지 슬롯. 후속 이슈(미답변 문의 수 등)가 채운다. */
  badges?: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const currentPath = search ? `${pathname}?${search}` : pathname;
  const [collapsed, setCollapsed] = useState(false);
  const screen = adminScreenForPath(currentPath);
  const group = adminGroupForPath(currentPath);
  const isChat = screen?.id === 'inquiry-chat';
  const title = pathname === '/admin/catalog/goods' && searchParams.get('create') !== '1' && searchParams.get('goodId')
    ? '상품 수정' : screen?.label ?? '판매자센터';

  return (
    <AdminPreferencesProvider accountId={admin.id || admin.email || admin.role}>
    <div className={`admin-shell wc-root wc-admin${collapsed ? ' collapsed' : ''}${isChat ? ' admin-shell--chat' : ''}`}>
      <AdminSidebar
        accountId={admin.id || admin.email || admin.role}
        currentPath={currentPath}
        collapsed={collapsed}
        onCollapsedChange={setCollapsed}
        role={admin.role}
        operatorAccess={admin.operatorAccess ?? NO_OPERATOR_ACCESS}
      />
      <div className="wc-admin__main">
        <Header admin={admin} next={currentPath} title={title} groupLabel={group?.label} immersive={isChat} />
        {!isChat && badges}
        <main className="admin-content">
          {/* key로 화면 전환마다 진입 애니메이션을 다시 태운다 */}
          <div key={pathname} className="rise">
            {children}
          </div>
        </main>
      </div>
      <OperationsDock accountId={admin.id} access={admin.operatorAccess} />
    </div>
    </AdminPreferencesProvider>
  );
}
