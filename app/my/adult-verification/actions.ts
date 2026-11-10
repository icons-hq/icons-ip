'use server';

import { unstable_rethrow } from 'next/navigation';

import { isOnboarded } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import {
  AdultVerificationAccountBlockedError,
  AdultVerificationRateLimitedError,
  beginAdultVerification,
} from '@/lib/identity/adult-verification.server';
import { adultVerificationEnabledFor } from '@/lib/identity/kcp-cert-config';

export type BeginAdultVerificationResult =
  | {
    readonly ok: true;
    readonly callUrl: string;
    readonly registrationKey: string;
    readonly pageSubmit: 'Y' | 'N';
  }
  | {
    readonly ok: false;
    readonly error: 'login_required' | 'onboarding_required' | 'unavailable' | 'rate_limited' | 'blocked';
  };

/**
 * 성인 인증 시작. KCP 거래등록을 서버에서 마친 뒤 인증창 주소와 거래등록키만 돌려준다 —
 * 브라우저는 그 둘로 KCP 인증창 form을 제출할 뿐, 세션 행이나 인증키에 닿지 않는다.
 */
export async function beginAdultVerificationAction(input: unknown): Promise<BeginAdultVerificationResult> {
  const request = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const presentation = request.presentation === 'popup' ? 'popup' : request.presentation === 'page' ? 'page' : null;
  const next = typeof request.next === 'string' ? request.next : '';
  if (!presentation) return { ok: false, error: 'unavailable' };

  const auth = await getCurrentAuthState();
  if (!auth.isConfigured || !auth.user) return { ok: false, error: 'login_required' };
  if (!isOnboarded(auth.profile, auth.user.email)) return { ok: false, error: 'onboarding_required' };
  if (auth.profile?.suspended_at) return { ok: false, error: 'blocked' };
  if (!adultVerificationEnabledFor(auth.user.id)) return { ok: false, error: 'unavailable' };

  try {
    const started = await beginAdultVerification({ userId: auth.user.id, presentation, returnPath: next });
    return { ok: true, ...started };
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof AdultVerificationRateLimitedError) return { ok: false, error: 'rate_limited' };
    if (error instanceof AdultVerificationAccountBlockedError) return { ok: false, error: 'blocked' };
    return { ok: false, error: 'unavailable' };
  }
}
