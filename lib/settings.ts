import type { OnboardingConsents } from './auth/onboarding';

/** DB에 저장된 consents에서 marketing 키만 갱신한다 — terms·privacy 등 나머지 키는 저장값 그대로 보존 */
export function mergeMarketingConsent(
  current: OnboardingConsents | null | undefined,
  marketing: boolean,
): OnboardingConsents {
  return { ...(current ?? {}), marketing };
}
