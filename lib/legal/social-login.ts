import type { SocialAuthProvider } from '@/app/login/actions';

/* 법정 문서가 소셜 로그인 제공자를 기술할 때 쓰는 표.
 *
 * 키가 SocialAuthProvider라서 /login이 제공자를 늘리거나 줄이면 여기가 컴파일 에러로 막는다.
 * Apple 로그인이 가능한데 방침에는 Google·카카오만 적혀 있던 사고를 타입으로 닫는다.
 * 타입만 가져오므로 서버 액션 모듈이 번들에 딸려오지 않는다. */

export interface SocialLoginProvider {
  /** 문서 본문 표기. 로그인 화면 버튼과 같은 이름을 쓴다. */
  label: string;
  /** 개인정보가 국외로 나가는 제공자의 법인과 국가. 국내 사업자는 null이다. */
  overseas: { entity: string; country: string } | null;
}

export const SOCIAL_LOGIN_PROVIDERS: Record<SocialAuthProvider, SocialLoginProvider> = {
  google: { label: 'Google', overseas: { entity: 'Google LLC', country: '미국' } },
  apple: { label: 'Apple', overseas: { entity: 'Apple Inc.', country: '미국' } },
  kakao: { label: '카카오', overseas: null },
};

export interface OverseasSocialLogin {
  label: string;
  entity: string;
  country: string;
}

/** "Google·Apple·카카오" — 문서 문장에 그대로 끼워 쓴다. */
export function socialLoginWords(): string {
  return Object.values(SOCIAL_LOGIN_PROVIDERS).map((provider) => provider.label).join('·');
}

/** 국외 이전 고지가 필요한 제공자만. 국내 사업자는 제외된다. */
export function overseasSocialLogins(): OverseasSocialLogin[] {
  return Object.values(SOCIAL_LOGIN_PROVIDERS).flatMap((provider) => (
    provider.overseas ? [{ label: provider.label, ...provider.overseas }] : []
  ));
}
