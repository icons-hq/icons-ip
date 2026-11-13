'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ADMIN_LEAVE_CONFIRM_MESSAGE,
  createAdminFormTracker,
  registerAdminLeaveGuard,
  type AdminSaveResult,
} from '@/lib/admin/leave-guard';

/**
 * 저장하지 않은 입력을 두고 화면을 떠날 때 묻는다(사이드바·상단 링크·화면 안 링크·브라우저 닫기).
 *
 * - 값을 state로 들고 있는 폼: 화면이 판정한 `dirty`를 넘긴다.
 * - 서버 액션 비제어 폼: 돌려받은 `formRef`를 form에 걸고 `serverState`에 `useActionState` 결과를 넘긴다.
 *   저장에 성공하면 그 값이 새 기준이 된다. 뒤로 가기로 돌아오면 보관해 둔 입력이 되살아난다(민감 입력 제외).
 */
export function useAdminLeaveGuard({
  dirty: screenDirty = false,
  preserved = false,
  blocked = false,
  message = ADMIN_LEAVE_CONFIRM_MESSAGE,
  serverState,
  onUnload,
  survivesQueryChange = false,
  recover = true,
}: {
  /** 화면이 직접 판정한 미저장 상태. */
  dirty?: boolean;
  /** 저장 실패·복구로 되살린 값을 폼이 새로 그린 상태. 폼 값은 새 기준과 같아도 아직 저장 전이다. */
  preserved?: boolean;
  /** 저장 결과를 기다리는 중이라 지금 떠나면 안 되는 상태. 묻지 않고 막는다. */
  blocked?: boolean;
  message?: string;
  serverState?: AdminSaveResult | null;
  /** 페이지가 내려가기 직전에 실행한다. */
  onUnload?: () => void;
  /** 쿼리만 바뀌는 이동(페이지 넘김·검색) 뒤에도 입력이 그대로 남는 화면이면 켠다. 그런 링크에는 묻지 않는다. */
  survivesQueryChange?: boolean;
  /** 폼 입력을 뒤로 가기 복구용으로 sessionStorage에 보관한다(비제어 폼의 `formRef`만 해당). 민감 입력은 늘 제외된다. */
  recover?: boolean;
} = {}) {
  const [formDirty, setFormDirty] = useState(false);
  const [tracker] = useState(() => createAdminFormTracker(setFormDirty, { recover }));
  const latestUnload = useRef(onUnload);
  useEffect(() => { latestUnload.current = onUnload; }, [onUnload]);
  useEffect(() => { tracker.noteServerResult(serverState); }, [tracker, serverState]);

  const dirty = screenDirty || preserved || formDirty;
  const guarded = dirty || blocked;
  useEffect(() => {
    if (!guarded) return;
    return registerAdminLeaveGuard({ message, blocked, survivesQueryChange, onUnload: () => latestUnload.current?.() });
  }, [guarded, blocked, message, survivesQueryChange]);

  return { formRef: tracker.attach, dirty };
}
