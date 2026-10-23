/* 한 세션 안의 위시 하트들이 공유하는 "서버가 확인한 마지막 상태" (LFS 패리티 2차 L4 · CL-01).
 *
 * 목록 하트는 router.refresh() 없이 낙관 갱신한다(계약: 목록 전체를 다시 받지 않는다). 그러면
 *   ① 같은 굿즈가 한 화면에 두 번 나올 때(홈의 여러 밴드) 다른 하트가 옛 상태로 남고,
 *   ② 뒤로 가기가 라우터 캐시의 옛 서버 렌더를 되살릴 때 방금 누른 하트가 원래대로 돌아간다.
 * 액션이 성공했을 때만 여기에 적고, 하트는 서버 초기값보다 이 값을 먼저 쓴다. 낙관 상태(아직
 * 서버가 확인하지 않은 값)는 하트 자신이 들고 있다 — 실패하면 그 하트만 되돌리면 되기 때문이다.
 *
 * 탭·기기 사이 동기화는 하지 않는다. 새로고침하면 모듈이 다시 올라와 서버 값으로 돌아간다.
 * 서버 렌더는 이 값을 읽지 않는다(useSyncExternalStore 의 서버 스냅샷은 항상 undefined) —
 * 모듈 상태가 요청 사이에 새면 다른 사람의 하트를 그리게 되기 때문이다. */

const confirmed = new Map<string, boolean>();
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

export function subscribeWishConfirmations(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 서버가 확인한 마지막 상태. 이번 세션에 아무도 누르지 않은 굿즈는 undefined 다. */
export function confirmedWish(goodId: string): boolean | undefined {
  return confirmed.get(goodId);
}

export function confirmWish(goodId: string, wished: boolean): void {
  if (confirmed.get(goodId) === wished) return;
  confirmed.set(goodId, wished);
  notify();
}

/** 로그인 벽으로 보낼 때 비운다 — 이전 회원의 확인값이 다음 방문자의 하트에 남지 않게 한다. */
export function forgetWishConfirmations(): void {
  if (confirmed.size === 0) return;
  confirmed.clear();
  notify();
}
