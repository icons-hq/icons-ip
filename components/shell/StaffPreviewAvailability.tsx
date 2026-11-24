'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { COMMUNITY_ENABLED, COMMUNITY_STAFF_PREVIEW_ENABLED } from '@/lib/community-visibility';
import { fetchStaffAccess } from '@/lib/staff-preview.client';
import { useAuthPresence, type AuthPresence } from './AuthPresenceProvider';

/* 스태프 전용 진입점 가시성 — 유틸 메뉴·전체 메뉴 시트·푸터와 온라인 팝업 디렉토리가 읽는다. 관리자 페이지 바로가기,
 * 커뮤니티와 AOUAD 프레젠테이션은 같은 운영 권한 조회(`admin_current_operator_access`) 한 번을
 * 공유하고 각자의 공개·킬스위치를 적용한다. presence·pathname 리듬은 기능들이 공유해야 하므로 provider 하나에
 * 모아 둔다 — 복사본이 갈라지면 한쪽만 강등된 세션에 진입점을 남기는 사고가 난다.
 *
 * 로그인 presence 가 확정된 뒤에만 readback 을 보내고, 로그아웃되면 값이 저절로 닫힌다.
 * readback 은 경로가 바뀔 때마다 다시 보낸다(AuthPresenceProvider 가 pathname 마다
 * 재구독하는 것과 같은 리듬) — 세션이 살아 있는 채로 강등·정지된 스태프에게 새로고침
 * 전까지 진입점이 남지 않게 하기 위해서다. 라우트 서버 게이트는 이와 무관하게 매 요청
 * 판정한다. presence·경로가 바뀔 때의 초기화는 effect 안 동기 setState 대신 렌더 중 "이전
 * 값과 다르면 되돌리기" 패턴으로 한다(visibilityOnContextChange) — 같은 브라우저에서 스태프가
 * 나가고 일반 회원이 들어와도 이전 결과가 새 세션에 잠깐이라도 새지 않는다. 기본값은 항상
 * false 라 provider 밖(테스트·정적 렌더)과 서버 HTML 에서도 진입점은 닫혀 있다. */
interface StaffPreviewVisibility {
  /** 관리자 페이지(`/admin`) 바로가기 — 어드민 콘솔 게이트와 같은 판정. */
  adminConsole: boolean;
  isStaff: boolean;
  communityPreview: boolean;
}

const CLOSED: StaffPreviewVisibility = { adminConsole: false, isStaff: false, communityPreview: false };

/** presence·경로가 바뀐 렌더의 즉시 값. presence 가 바뀌면(로그아웃·계정 전환) 전부 닫는다. 경로만 바뀌면 프리뷰
 *  진입점은 닫았다가 새 readback 으로 다시 열고, 관리자 페이지 바로가기만 새 readback 이 올 때까지 직전 값을 둔다 —
 *  유틸 메뉴 맨 앞에 보이는 링크가 이동할 때마다 깜빡이지 않게 하기 위해서다. 강등된 세션에도 다음 readback 에서
 *  바로 닫히고, 그 사이에 눌러도 `/admin` 서버 게이트가 막는다. */
export function visibilityOnContextChange(current: StaffPreviewVisibility, presenceChanged: boolean): StaffPreviewVisibility {
  if (presenceChanged || !current.adminConsole) return CLOSED;
  return { ...CLOSED, adminConsole: true };
}

const StaffPreviewContext = createContext<StaffPreviewVisibility>(CLOSED);

export function StaffPreviewAvailabilityProvider({ children }: { children: ReactNode }) {
  const presence = useAuthPresence();
  const pathname = usePathname();
  const [trackedContext, setTrackedContext] = useState<{ presence: AuthPresence; pathname: string }>({ presence, pathname });
  const [visible, setVisible] = useState<StaffPreviewVisibility>(CLOSED);

  if (trackedContext.presence !== presence || trackedContext.pathname !== pathname) {
    const presenceChanged = trackedContext.presence !== presence;
    setTrackedContext({ presence, pathname });
    setVisible((current) => visibilityOnContextChange(current, presenceChanged));
  }

  useEffect(() => {
    if (presence !== 'signed-in') return;
    let active = true;
    void fetchStaffAccess().then(({ adminConsole, platformManage }) => {
      if (active) setVisible({
        adminConsole,
        isStaff: platformManage,
        communityPreview: platformManage && !COMMUNITY_ENABLED && COMMUNITY_STAFF_PREVIEW_ENABLED,
      });
    });
    return () => {
      active = false;
    };
  }, [pathname, presence]);

  return (
    <StaffPreviewContext.Provider value={presence === 'signed-in' ? visible : CLOSED}>
      {children}
    </StaffPreviewContext.Provider>
  );
}

/** 관리자 페이지 바로가기 노출 — 링크가 보여도 실제 권한은 `/admin` 서버 게이트가 판정한다. */
export function useAdminConsoleVisible() {
  return useContext(StaffPreviewContext).adminConsole;
}

export function useStaffPreviewVisible() {
  return useContext(StaffPreviewContext).isStaff;
}

export function useCommunityStaffPreviewVisible() {
  return useContext(StaffPreviewContext).communityPreview;
}
