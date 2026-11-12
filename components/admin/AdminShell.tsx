'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, type CSSProperties, type ReactNode } from 'react';
import { ADMIN_CONSOLES, adminConsoleForPath, adminConsoleHomeHref, adminConsoleWindowName, adminDetailTitleForPath, adminGroupConsoles, adminGroupForPath, adminScreenForPath } from '@/lib/admin/navigation';
import { SidebarInset, SidebarProvider } from '@/components/admin/kit/ui/sidebar';
import { TooltipProvider } from '@/components/admin/kit/ui/tooltip';
import { AdminSidebar } from './AdminSidebar';
import { Header } from './Header';
import { AdminPreferencesProvider } from './console/AdminPreferences';
import { AdminShellTitleProvider } from './console/admin-shell-title';
import { AdminNavigationBody, AdminNavigationIndicators, AdminNavigationPendingProvider } from './console/AdminNavigationPending';
import { AdminScreenSkeleton } from './console/AdminScreenSkeleton';
import { useAdminDocumentTitle } from './console/useAdminDocumentTitle';
import { AdminKitPortalHost } from './kit/portal-container';
import { OperationsDock } from './OperationsDock';
import { AdminInquiryNotifier } from './AdminInquiryNotifier';
import { AdminNumberWheelGuard } from './AdminNumberWheelGuard';
import { hasAdminCapability, NO_OPERATOR_ACCESS, type OperatorAccess } from '@/lib/admin/access';
import { adminNavigationAccountId, type SavedAdminNavigation } from '@/lib/admin/navigation-preferences';

/*
 * 어드민 셸 — kit Sidebar 대시보드 배치(ADR-0028 ②). 셸 루트(.wc-admin)는 kit 부품이 아니라 콘솔 토큰
 * (admin-kit.css · wc-admin.css)이 여기서 시작해 아래로 이어진다. 사이드바 접힘은 kit의 `sidebar_state`
 * 쿠키에 남고, 레이아웃이 그 값을 `sidebarDefaultOpen`으로 넘겨 첫 화면부터 같은 폭으로 그린다.
 */
export function AdminShell({
  admin,
  children,
  initialNavigation,
  sidebarDefaultOpen = true,
}: {
  admin: { id: string; email: string | null; role: string; operatorAccess?: OperatorAccess };
  children: ReactNode;
  /** 지난번 열린 메뉴 그룹·즐겨찾기(계정별 쿠키). 첫 HTML부터 같은 모양으로 그린다. */
  initialNavigation?: SavedAdminNavigation | null;
  /** 지난번 사이드바 접힘 상태(`sidebar_state` 쿠키). */
  sidebarDefaultOpen?: boolean;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const currentPath = search ? `${pathname}?${search}` : pathname;
  /* 칸(쇼핑·카드·게임)은 경로가 정한다. route group(`(shell)`·`(content)`)은 레이아웃 묶음일 뿐이라 IP·이벤트·티켓 회차도 쇼핑 칸이다. */
  const consoleId = adminConsoleForPath(pathname);
  const consoleInfo = ADMIN_CONSOLES.find((item) => item.id === consoleId) ?? ADMIN_CONSOLES[0];
  const screen = adminScreenForPath(currentPath);
  const group = adminGroupForPath(currentPath);
  const isChat = screen?.id === 'inquiry-chat';
  const isHome = pathname === '/admin';
  const access = admin.operatorAccess ?? NO_OPERATOR_ACCESS;
  /* R2(D2①): 새 1:1 문의 PC 알림은 쇼핑 칸의 문의 담당(cs.manage)에게만. 켜고 끄기는 업무 도구 '알림'에 둔다. */
  const inquiryNotifications = consoleId === 'shopping' && Boolean(admin.id) && hasAdminCapability(access, 'cs.manage');
  /* 전환 링크는 그 콘솔에서 볼 수 있는 화면이 있을 때만 만든다. */
  const consoles = ADMIN_CONSOLES.map((item) => ({ ...item, href: adminConsoleHomeHref(item.id, admin.role, access) }))
    .filter((item): item is typeof item & { href: string } => Boolean(item.href));
  /* 쇼핑 밖 칸으로 가는 링크는 이름 붙은 새 창으로 연다. 같은 칸을 다시 누르면 열려 있는 그 창을 다시 쓴다. */
  const consoleLinks = consoles.length > 1
    ? consoles.map((item) => ({ ...item, current: item.id === consoleId, target: item.newWindow && item.id !== consoleId ? adminConsoleWindowName(item.id) : undefined }))
    : [];
  /* 쇼핑 밖 칸은 경로 첫 칸이 칸 이름이라, 그 칸 전용 메뉴 그룹 이름(카드 운영·게임 운영)을 다시 적지 않는다. */
  const groupLabel = group && consoleId !== 'shopping' && adminGroupConsoles(group).every((id) => id === consoleId) ? undefined : group?.label;
  const title = pathname === '/admin/catalog/goods' && searchParams.get('create') !== '1' && searchParams.get('goodId')
    ? '상품 수정'
    : pathname === '/admin/catalog/ips' && searchParams.get('create') === '1' ? 'IP 등록'
      : adminDetailTitleForPath(pathname) ?? screen?.label ?? '판매자센터';
  const accountId = adminNavigationAccountId(admin);
  /* WCAG 2.4.2 — 탭 제목으로 화면을 구분한다(서버 메타데이터 없이 셸 제목 하나를 쓴다). */
  useAdminDocumentTitle(title);

  return (
    <AdminPreferencesProvider accountId={accountId}>
    <AdminKitPortalHost>
    <TooltipProvider delay={300}>
    <AdminNavigationPendingProvider currentPath={currentPath}>
    <div className={`admin-shell wc-admin${isChat ? ' admin-shell--chat' : ''}`} data-admin-console={consoleId}>
      {/* WCAG 2.4.1 — 메뉴를 건너뛰어 본문으로 간다. 키보드 포커스를 받을 때만 보인다. */}
      <a className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground" href="#admin-main">본문으로 건너뛰기</a>
      <SidebarProvider defaultOpen={sidebarDefaultOpen} style={{ '--sidebar-width': '15.5rem' } as CSSProperties}>
        <AdminSidebar
          accountId={accountId}
          console={consoleId}
          currentPath={currentPath}
          homeHref={consoles.find((item) => item.id === consoleId)?.href ?? '/admin'}
          initialNavigation={initialNavigation}
          operatorAccess={access}
          role={admin.role}
        />
        <SidebarInset className={`print:m-0! print:rounded-none! print:shadow-none! ${isChat ? 'h-svh min-h-0 overflow-hidden md:h-[calc(100svh-1rem)] print:h-auto! print:overflow-visible!' : 'min-w-0'}`}>
          <Header
            admin={admin}
            consoles={consoleLinks}
            groupLabel={groupLabel}
            next={currentPath}
            root={consoleId === 'shopping' ? undefined : { label: consoleInfo.title, href: consoles.find((item) => item.id === consoleId)?.href ?? '/admin' }}
            title={title}
            tools={<OperationsDock accountId={admin.id} access={admin.operatorAccess} inquiryNotifications={inquiryNotifications} />}
          />
          <AdminNavigationIndicators />
          {/* 본문만 main 랜드마크다(상단 막대는 그 밖의 banner). */}
          <main id="admin-main" tabIndex={-1} className={`admin-content flex min-w-0 flex-1 flex-col outline-none ${isChat ? 'min-h-0 overflow-hidden print:overflow-visible' : 'gap-4 p-4 md:p-6 print:p-0'}`}>
            {isChat || isHome ? <h1 className="sr-only">{title}</h1> : (
              <div className="admin-page-context flex flex-wrap items-end justify-between gap-2 print:hidden">
                <h1 className="text-2xl font-bold tracking-tight text-foreground">{title}</h1>
              </div>
            )}
            {/* 화면이 여러 덩어리를 나란히 돌려줘도(접이 카드 + 목록 등) 카드 사이 간격은 같다. */}
            <AdminNavigationBody className={`min-w-0${isChat ? ' min-h-0 flex-1' : ' flex flex-col gap-4'}`}>
              {/*
               * 경계는 화면 바깥 한 곳에만 둔다(화면별 loading.tsx 없음). 메뉴 이동은 전환이라 이미 보인 경계의 fallback이 나오지 않아
               * 이전 화면이 남고, 골격은 새로고침·직접 진입에서만 보인다. 이 위에 key를 달면 경계가 리셋되어 fallback이 되돌아온다.
               */}
              <Suspense fallback={<AdminScreenSkeleton kind={isChat ? 'chat' : isHome ? 'home' : 'list'} />}>
                {/* 홈·상담처럼 h1을 감춘 화면은 화면 머리가 제목을 보여 준다. */}
                <AdminShellTitleProvider title={isChat || isHome ? '' : title}>{children}</AdminShellTitleProvider>
              </Suspense>
            </AdminNavigationBody>
          </main>
        </SidebarInset>
      </SidebarProvider>
      {inquiryNotifications ? <AdminInquiryNotifier accountId={admin.id} /> : null}
      {/* R18: 포커스된 어드민 number 입력 위의 휠은 값을 바꾸지 않고 페이지만 스크롤한다(셸에 한 번). */}
      <AdminNumberWheelGuard />
    </div>
    </AdminNavigationPendingProvider>
    </TooltipProvider>
    </AdminKitPortalHost>
    </AdminPreferencesProvider>
  );
}
