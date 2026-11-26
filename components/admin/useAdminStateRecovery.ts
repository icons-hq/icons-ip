'use client';

import { useEffect, useRef } from 'react';
import { adminLeaveWasJustConfirmed } from '@/lib/admin/leave-guard';

/*
 * 값을 state로 들고 있는 화면의 '뒤로 가기' 복구.
 *
 * 브라우저 뒤로 가기는 막을 수 없다 — App Router가 주소를 바꾼 뒤에야 알 수 있다(lib/admin/leave-guard). 비제어 폼은
 * `useAdminLeaveGuard`의 `formRef`가 입력을 sessionStorage에 보관했다 되살리지만, 값을 state로 드는 화면은 폼에 값이 없어
 * 그 길을 타지 못한다(QA G5 — 올린 동영상을 저장하지 않고 뒤로 가면 말없이 사라졌다). 이 훅이 같은 규칙으로 state 값을 보관한다.
 * - 저장하지 않은 값이 있는 채로 다른 주소로 떠날 때만 보관한다(같은 주소에서 화면이 다시 그려지는 경우는 아니다).
 * - 운영자가 '화면 이동' 확인창에서 [이동]을 눌러 버리기로 한 값은 보관하지 않는다.
 * - 같은 주소(경로+쿼리)로 돌아오면 한 번 되살리고 기록을 지운다. 1시간이 지난 기록은 버리고, 탭을 닫으면 사라진다.
 * 비밀번호·계좌·카드·인증 번호 같은 민감한 값이 든 state에는 쓰지 않는다.
 */
const RECOVERY_PREFIX = 'admin-state-recovery:';
const RECOVERY_TTL_MS = 60 * 60 * 1000;

/** 같은 화면의 같은 묶음을 가리키는 키. 주소(경로+쿼리)와 화면이 준 이름으로 정한다. */
export function adminStateRecoveryKey(location: { pathname: string; search: string }, id: string): string {
  return `${RECOVERY_PREFIX}${location.pathname}${location.search}|${id}`;
}

export function useAdminStateRecovery({ id, dirty, value, onRestore }: {
  /** 한 화면에 복구할 묶음이 여럿일 때 구분하는 이름. */
  id: string;
  /** 저장하지 않은 값이 있는가. 없으면 떠날 때 보관하지 않는다. */
  dirty: boolean;
  /** 보관할 값. JSON으로 옮길 수 있어야 한다. */
  value: unknown;
  /** 보관해 둔 값을 받는다. 화면이 형식을 다시 확인한 뒤 state에 넣는다(브라우저에 있던 값이라 그대로 믿지 않는다). */
  onRestore: (saved: unknown) => void;
}) {
  const latest = useRef({ dirty, value, onRestore });
  useEffect(() => { latest.current = { dirty, value, onRestore }; }, [dirty, value, onRestore]);
  useEffect(() => {
    const at = { pathname: window.location.pathname, search: window.location.search };
    const key = adminStateRecoveryKey(at, id);
    /* 화면이 서버에서 받은 값으로 먼저 그려진 뒤에 되살린다(비제어 폼 복구와 같은 순서). */
    const timer = setTimeout(() => {
      let raw: string | null = null;
      try { raw = sessionStorage.getItem(key); if (raw) sessionStorage.removeItem(key); } catch { return; }
      if (!raw) return;
      try {
        const saved = JSON.parse(raw) as { at?: unknown; value?: unknown } | null;
        if (saved && typeof saved.at === 'number' && Date.now() - saved.at <= RECOVERY_TTL_MS) latest.current.onRestore(saved.value);
      } catch { /* 깨진 기록은 버린다. */ }
    }, 0);
    return () => {
      clearTimeout(timer);
      const now = latest.current;
      if (!now.dirty || adminLeaveWasJustConfirmed()) return;
      /* 같은 주소에서 화면이 내려가는 경우(다시 그리기)는 떠난 것이 아니다. */
      if (window.location.pathname === at.pathname && window.location.search === at.search) return;
      try { sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), value: now.value })); } catch { /* 보관하지 못하면 복구만 못 한다. */ }
    };
  }, [id]);
}
