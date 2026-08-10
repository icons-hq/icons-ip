import type { SocialAuthProvider } from '@/app/login/actions';

/* 법정 문서가 소셜 로그인 제공자를 기술할 때 쓰는 표기.
 *
 * 키가 SocialAuthProvider라서 /login이 제공자를 늘리거나 줄이면 여기가 컴파일 에러로 막는다.
 * Apple 로그인이 가능한데 방침에는 Google·카카오만 적혀 있던 사고를 타입으로 닫는다.
 * 타입만 가져오므로 서버 액션 모듈이 번들에 딸려오지 않는다.
 *
 * 국외 이전 고지는 여기서 파생하지 않는다. signInWithSocialAction은 supabase.auth.signInWithOAuth로
 * 만든 인가 요청 URL로 redirect할 뿐이고, 계정 식별자와 이메일은 제공자가 Supabase로 보내오는
 * 값이다 — 제공자는 이전받는 자가 아니라 수집 경로다(방침 제1조·제6조). */

/** 문서 본문 표기. 로그인 화면 버튼과 같은 이름을 쓴다. */
export const SOCIAL_LOGIN_LABELS: Record<SocialAuthProvider, string> = {
  google: 'Google',
  apple: 'Apple',
  kakao: '카카오',
};

/** "Google·Apple·카카오" — 문서 문장에 그대로 끼워 쓴다. */
export function socialLoginWords(): string {
  return Object.values(SOCIAL_LOGIN_LABELS).join('·');
}
