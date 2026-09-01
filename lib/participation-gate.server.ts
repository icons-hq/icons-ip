import 'server-only';

import { redirect } from 'next/navigation';
import {
  ACCOUNT_SUSPENDED_PATH,
  isAccountSuspended,
  isOnboarded,
  onboardingPath,
  safeNextPath,
} from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';

/* 보호 액션 3단 게이트 (S8 #330).
 *
 * 공개 브라우징은 유지하되 쓰기·참여 시점에 자격을 요구하는 서버 액션들이 같은
 * 판정을 쓰게 하는 자리다. 순서가 계약이다:
 *   1) 미인증 → /login?next=
 *   2) 정지    → ACCOUNT_SUSPENDED_PATH
 *   3) 미온보딩 → onboardingPath(next)
 * 순서가 갈리면 정지된 계정이 온보딩 화면으로 새는 식으로 어긋난다 — 두 액션이
 * 같은 규칙을 각자 베껴 두면 한쪽만 고쳐지는 날이 온다.
 *
 * 'use server' 모듈은 액션이 아닌 함수를 export 할 수 없어 액션 파일에서 서로
 * 끌어다 쓸 수 없다. 그래서 게이트는 액션이 아닌 이 모듈이 소유한다.
 *
 * 리뷰 액션(app/my/reviews/actions.ts)이 들고 있던 같은 게이트 사본도 S9 정리(#331)
 * 에서 이 모듈로 합쳤다. 사본 쪽 loginPath 만 safeNextPath 를 지나지 않았는데, 리뷰
 * 액션이 넘기는 next 는 '/my/reviews'와 '/my/reviews/<검증된 UUID>' 둘뿐이라
 * safeNextPath 가 무연산이다 — 도달 가능한 모든 입력에서 두 구현의 출력이 같음을
 * 확인하고 합쳤다(동작 변경 아님).
 */

/* next 는 호출부에서 이미 safeNextPath 를 지난 값이지만 여기서 한 번 더 정규화한다 —
   로그인 리다이렉트의 목적지라, 게이트를 새로 부르는 사람이 원문을 그대로 넘겨도
   열린 리다이렉트가 되지 않아야 한다. */
function loginPath(next: string) {
  return `/login?next=${encodeURIComponent(safeNextPath(next))}`;
}

export async function requireActiveUser(next: string) {
  const auth = await getCurrentAuthState();

  if (!auth.isConfigured || !auth.user) redirect(loginPath(next));
  if (isAccountSuspended(auth.profile)) redirect(ACCOUNT_SUSPENDED_PATH);
  if (!isOnboarded(auth.profile, auth.user.email)) redirect(onboardingPath(next));

  return auth.user;
}
