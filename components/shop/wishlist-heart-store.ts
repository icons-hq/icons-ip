import { INQUIRY_DRAFT_SIGN_OUT_EVENT } from '@/lib/admin/inquiry-draft-lifecycle';

/* 한 세션 안의 위시 하트들이 공유하는 "서버가 확인한 마지막 상태" (LFS 패리티 2차 L4 · CL-01).
 *
 * 목록 하트는 router.refresh() 없이 낙관 갱신한다(계약: 목록 전체를 다시 받지 않는다). 그러면
 *   ① 같은 굿즈가 한 화면에 두 번 나올 때(홈의 여러 밴드) 다른 하트가 옛 상태로 남고,
 *   ② 뒤로 가기가 라우터 캐시의 옛 서버 렌더를 되살릴 때 방금 누른 하트가 원래대로 돌아간다.
 * 액션이 성공했을 때만 여기에 적고, 하트는 서버 초기값보다 이 값을 먼저 쓴다. 낙관 상태(아직
 * 서버가 확인하지 않은 값)는 하트 자신이 들고 있다 — 실패하면 그 하트만 되돌리면 되기 때문이다.
 *
 * 확인값은 회원 것이다. 로그아웃·로그인은 server action 의 redirect 라 소프트 내비게이션이고 이 모듈은
 * 살아남는다 — 그대로 두면 공용 기기에서 이전 회원이 누른 하트가 다음 회원(같은 회원의 재로그인도)의
 * 서버 값을 덮는다. 그래서 두 겹으로 막는다.
 *   - 주인: 값마다 적은 회원(서버가 판정한 뷰어 ID)을 묶어 두고, 다른 뷰어의 하트에는 보이지 않게 한다.
 *     목록 하트는 마운트될 때 저장소를 자기 뷰어 것으로 맞춘다(다르면 비운다, 게스트도 비운다).
 *   - 로그아웃: 앱의 탭 로그아웃 신호(INQUIRY_DRAFT_SIGN_OUT_EVENT — 이름은 문의 초안에서 시작했지만
 *     로그아웃 폼 제출·AuthPresenceProvider 의 signed-out 관측·다른 탭의 로그아웃 방송이 모두 이 이벤트를
 *     낸다)에서 통째로 비운다. 같은 회원이 다시 들어와도 서버 값부터 시작한다.
 *
 * 같은 회원의 탭·기기 사이 동기화는 하지 않는다. 새로고침하면 모듈이 다시 올라와 서버 값으로 돌아간다.
 * 서버 렌더는 이 값을 읽지 않는다(useSyncExternalStore 의 서버 스냅샷은 항상 undefined) —
 * 모듈 상태가 요청 사이에 새면 다른 사람의 하트를 그리게 되기 때문이다. */

let owner: string | null = null;
const confirmed = new Map<string, boolean>();
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function clearConfirmations() {
  if (confirmed.size === 0) return;
  confirmed.clear();
  notify();
}

export function subscribeWishConfirmations(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 이 회원이 이번 세션에 확인받은 마지막 상태. 아무도 누르지 않았거나 다른 회원·게스트가 묻으면 undefined 다. */
export function confirmedWish(viewerId: string | null, goodId: string): boolean | undefined {
  return viewerId !== null && viewerId === owner ? confirmed.get(goodId) : undefined;
}

/** 저장소를 지금 화면의 뷰어 것으로 맞춘다. 다른 회원이 적은 값이 남아 있으면 비운다 — 게스트(null)도 비운다. */
export function claimWishConfirmations(viewerId: string | null): void {
  if (owner === viewerId) return;
  owner = viewerId;
  clearConfirmations();
}

/**
 * 서버가 확인한 상태를 적는다. 목록 하트는 자기 뷰어 ID 를 함께 넘긴다. 뷰어를 모르는 상세 하트는 생략해
 * 지금 주인 몫으로 적는다 — 주인이 없으면(게스트·아직 목록을 안 본 세션) 읽을 하트가 없으므로 적지 않는다.
 */
export function confirmWish(goodId: string, wished: boolean, viewerId?: string | null): void {
  if (viewerId !== undefined) claimWishConfirmations(viewerId);
  if (owner === null || confirmed.get(goodId) === wished) return;
  confirmed.set(goodId, wished);
  notify();
}

/** 로그아웃·로그인 벽에서 비운다 — 이전 회원의 확인값이 다음 방문자의 하트에 남지 않게 한다. */
export function forgetWishConfirmations(): void {
  owner = null;
  clearConfirmations();
}

/** 탭 로그아웃 신호를 듣는다. 브라우저에서는 모듈이 올라올 때 한 번 건다(아래). */
export function observeWishSignOut(target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>): () => void {
  target.addEventListener(INQUIRY_DRAFT_SIGN_OUT_EVENT, forgetWishConfirmations);
  return () => target.removeEventListener(INQUIRY_DRAFT_SIGN_OUT_EVENT, forgetWishConfirmations);
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') observeWishSignOut(window);
