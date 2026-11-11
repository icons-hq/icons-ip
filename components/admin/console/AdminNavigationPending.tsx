'use client';

import { createContext, useContext, useEffect, useLayoutEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import {
  ADMIN_NAVIGATION_IDLE,
  adminNavigationStatusMessage,
  createAdminNavigationPendingStore,
  type AdminNavigationPending,
  type AdminNavigationPendingStore,
} from '@/lib/admin/navigation-pending';
import { Button } from '@/components/admin/kit/ui/button';
import { AdminNotice } from './AdminKit';

/*
 * 메뉴 이동 대기의 화면 쪽. 판단은 lib/admin/navigation-pending이 하고 여기는 그리기만 한다.
 * 각 조각이 저장소를 직접 구독해, 대기 상태가 바뀌어도 셸과 화면 본문은 다시 렌더되지 않는다.
 */
const PendingStoreContext = createContext<AdminNavigationPendingStore | null>(null);

const noStore = { subscribe: () => () => {}, getSnapshot: () => ADMIN_NAVIGATION_IDLE };
const idleSnapshot = () => ADMIN_NAVIGATION_IDLE;

/** 셸 밖(단위 테스트·미리보기)에서는 언제나 대기 없음이다. */
export function useAdminNavigationPending(): AdminNavigationPending {
  const store = useContext(PendingStoreContext) ?? noStore;
  return useSyncExternalStore(store.subscribe, store.getSnapshot, idleSnapshot);
}

/** 이동 중인 목적지만 구독한다. 단계가 바뀔 때마다 메뉴 전체를 다시 그리지 않게 한다. */
export function useAdminNavigationPendingPath(): string | null {
  const store = useContext(PendingStoreContext) ?? noStore;
  return useSyncExternalStore(store.subscribe, () => store.getSnapshot().path, () => null);
}

export function AdminNavigationPendingProvider({ currentPath, children }: { currentPath: string; children: ReactNode }) {
  const [store] = useState(createAdminNavigationPendingStore);
  /* 화면이 페인트되기 전에 끝내야 새 본문이 흐린 채 한 프레임 보이지 않는다. */
  useLayoutEffect(() => { store.routeChanged(currentPath); }, [store, currentPath]);
  useEffect(() => store.connect(), [store]);
  return <PendingStoreContext.Provider value={store}>{children}</PendingStoreContext.Provider>;
}

/**
 * 본문 영역 맨 위의 표시들. 상단 막대 바로 아래에 붙어 스크롤해도 보이고, 사이드바 위로는 넘어가지 않는다.
 * 높이 0이라 나타나도 본문을 밀지 않는다.
 */
export function AdminNavigationIndicators() {
  const { barVisible, href, stage } = useAdminNavigationPending();
  if (!barVisible && stage !== 'slow') return null;
  const finishing = stage === 'idle';
  return (
    <div className="pointer-events-none sticky top-12 z-30 h-0 print:hidden" data-admin-nav-indicators="">
      {barVisible ? (
        <div
          aria-hidden="true"
          className={`absolute inset-x-0 top-0 h-0.5 origin-left bg-primary transition-transform ${finishing
            ? 'scale-x-100 duration-150 ease-out'
            : 'scale-x-[.99] duration-[15s] ease-[cubic-bezier(.15,.5,.2,1)] starting:scale-x-[.05]'}`}
          data-admin-nav-progress={finishing ? 'finishing' : 'running'}
        />
      ) : null}
      {stage === 'slow' && href ? (
        /* 본문을 가리지 않게 오른쪽 아래 구석에 띄운다. */
        <div className="fixed right-4 bottom-4 left-4 flex justify-end sm:left-auto sm:max-w-sm" data-admin-nav-slow="">
          <AdminNotice className="pointer-events-auto shadow-md" title="응답이 늦어지고 있습니다" tone="warning">
            <div className="flex flex-wrap items-center gap-2">
              <span>새로 고쳐 다시 불러올 수 있습니다.</span>
              <Button onClick={() => window.location.assign(href)} size="sm" type="button" variant="outline">다시 시도</Button>
            </div>
          </AdminNotice>
        </div>
      ) : null}
    </div>
  );
}

/**
 * 화면 본문 칸. 1초가 지나면 이전 본문을 흐리게 하고 잠그며, 낭독 문구를 한 번 넣는다.
 * 흐림은 150ms에 걸쳐 들어가 곧 끝나는 대기는 살짝만 어두워진다. 끝나면 즉시 푼다 — 전환 속성을 흐릴 때만 달아 새 본문이 페이드되지 않는다.
 */
export function AdminNavigationBody({ children, className }: { children: ReactNode; className?: string }) {
  const store = useContext(PendingStoreContext);
  const { stage } = useAdminNavigationPending();
  const dimmed = stage === 'dim' || stage === 'slow';
  /* inert가 풀린 커밋 직후다. 같은 화면이 남아 있으면(페이지 이동 등) 키보드 포커스를 돌려준다. */
  useLayoutEffect(() => { if (!dimmed) store?.restoreFocus(); }, [dimmed, store]);
  return (
    <>
      <p className="sr-only" data-admin-nav-status="" role="status">{adminNavigationStatusMessage(stage)}</p>
      <div className={`${className ?? ''}${dimmed ? ' opacity-60 transition-opacity duration-150 ease-in' : ''}`} data-admin-nav-dimmed={dimmed ? '' : undefined} inert={dimmed}>
        {children}
      </div>
    </>
  );
}
