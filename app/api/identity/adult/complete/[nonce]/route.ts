import {
  completeAdultVerification,
  isAdultVerificationNonce,
  type AdultVerificationCompletion,
} from '@/lib/identity/adult-verification.server';
import { adultVerificationResultHref } from '@/lib/identity/adult-verification-routes';
import { adultVerificationRedirect } from '@/lib/identity/kcp-cert-callback.server';
import { createClient } from '@/lib/supabase/server';

type CompletionRpc = Parameters<typeof completeAdultVerification>[1];

/** 확정 RPC 몇 번과 pending 재확인 대기(최대 6초)를 담는 예산. */
export const maxDuration = 30;

interface AdultVerificationCompleteHandlerDependencies {
  /** 로그인 세션 클라이언트. 세션이 없으면 null이다. */
  readonly sessionRpc: () => Promise<CompletionRpc | null>;
  readonly complete: typeof completeAdultVerification;
  readonly sleep?: (ms: number) => Promise<void>;
}

/* 같은 콜백이 두 번 와서 다른 요청이 아직 결과를 조회 중이면 확정이 pending을 답한다.
   조회 한도(10초) 안에서 짧게 다시 묻는다. */
const PENDING_RETRY_DELAYS_MS = [1_000, 2_000, 3_000];

/**
 * 본인 세션 확정. KCP 콜백 처리기가 같은 브라우저를 이 동일 사이트 GET으로 보낸다 — 이
 * 요청에는 로그인 쿠키가 실리고, DB는 그 세션의 auth.uid()가 인증을 시작한 계정과 같을
 * 때만 보류된 판정을 증거로 바꾼다. 로그인이 없거나 다른 계정이면 아무것도 확정하지 않는다.
 */
export function createAdultVerificationCompleteHandler({
  sessionRpc,
  complete,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}: AdultVerificationCompleteHandlerDependencies) {
  return async function handleAdultVerificationComplete(
    _request: Request,
    context: { params: Promise<{ nonce: string }> },
  ) {
    const { nonce } = await context.params;
    if (!isAdultVerificationNonce(nonce)) {
      return adultVerificationRedirect(adultVerificationResultHref({ status: 'invalid' }));
    }

    let completion: AdultVerificationCompletion;
    try {
      const rpc = await sessionRpc();
      if (!rpc) {
        return adultVerificationRedirect(adultVerificationResultHref({ status: 'login_required' }));
      }
      completion = await complete(nonce, rpc);
      for (const delay of PENDING_RETRY_DELAYS_MS) {
        if (completion.outcome !== 'pending') break;
        await sleep(delay);
        completion = await complete(nonce, rpc);
      }
    } catch {
      return adultVerificationRedirect(adultVerificationResultHref({ status: 'error' }));
    }

    if (completion.outcome === 'not_found') {
      return adultVerificationRedirect(adultVerificationResultHref({ status: 'invalid' }));
    }
    return adultVerificationRedirect(adultVerificationResultHref({
      status: completion.outcome,
      mode: completion.presentation,
      next: completion.returnPath,
    }));
  };
}

export const GET = createAdultVerificationCompleteHandler({
  sessionRpc: async () => {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;
    return async <T,>(fn: string, args: Record<string, unknown>) => {
      const result = await supabase.rpc(fn, args);
      return {
        data: (result.data ?? null) as T | null,
        error: result.error ? { message: result.error.message } : null,
      };
    };
  },
  complete: completeAdultVerification,
});
