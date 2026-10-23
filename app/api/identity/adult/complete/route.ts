import {
  completeAdultVerification,
  parseAdultVerificationTicket,
  type AdultVerificationCompletion,
} from '@/lib/identity/adult-verification.server';
import { adultVerificationResultHref } from '@/lib/identity/adult-verification-routes';
import {
  adultVerificationRedirect,
  clearAdultVerificationTicketCookie,
  readAdultVerificationTicketCookie,
} from '@/lib/identity/kcp-cert-callback.server';
import { createClient } from '@/lib/supabase/server';

type CompletionRpc = Parameters<typeof completeAdultVerification>[1];

/** 확정 RPC 몇 번과 pending 재확인 대기(최대 12초)를 담는 예산. */
export const maxDuration = 30;

interface AdultVerificationCompleteHandlerDependencies {
  /** 로그인 세션 클라이언트. 세션이 없으면 null이다. */
  readonly sessionRpc: () => Promise<CompletionRpc | null>;
  readonly complete: typeof completeAdultVerification;
  readonly sleep?: (ms: number) => Promise<void>;
}

/* 콜백 처리기가 아직 KCP 결과를 조회 중이면 확정이 pending을 답한다. 조회 시한(10초)을
   넘길 때까지 짧게 다시 묻는다. 그래도 pending이면 결과 화면이 다시 확인하게 한다. */
const PENDING_RETRY_DELAYS_MS = [1_000, 2_000, 3_000, 3_000, 3_000];

/**
 * 본인 세션 확정. KCP 콜백 처리기가 같은 브라우저를 이 GET으로 보낸다 — 이 요청에는 로그인
 * 쿠키와, 콜백을 선점한 브라우저만 가진 확정 티켓 쿠키가 실린다. DB는 그 세션의 auth.uid()가
 * 인증을 시작한 계정이고 티켓이 맞을 때만 보류된 판정을 증거로 바꾼다.
 *
 * 티켓 쿠키는 결과가 끝났을 때(성공·미성년·실패·만료·차단)만 지운다. 확인 중·로그인 필요·
 * 장애에는 남겨 두어 결과 화면의 "다시 확인하기"가 같은 티켓으로 이어지게 한다.
 */
export function createAdultVerificationCompleteHandler({
  sessionRpc,
  complete,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}: AdultVerificationCompleteHandlerDependencies) {
  return async function handleAdultVerificationComplete(request: Request) {
    const ticket = parseAdultVerificationTicket(readAdultVerificationTicketCookie(request));
    if (!ticket) {
      return adultVerificationRedirect(adultVerificationResultHref({ status: 'invalid' }));
    }

    let completion: AdultVerificationCompletion;
    try {
      const rpc = await sessionRpc();
      if (!rpc) {
        return adultVerificationRedirect(adultVerificationResultHref({ status: 'login_required' }));
      }
      completion = await complete(ticket, rpc);
      for (const delay of PENDING_RETRY_DELAYS_MS) {
        if (completion.outcome !== 'pending') break;
        await sleep(delay);
        completion = await complete(ticket, rpc);
      }
    } catch {
      return adultVerificationRedirect(adultVerificationResultHref({ status: 'error' }));
    }

    switch (completion.outcome) {
      case 'not_found':
        return adultVerificationRedirect(adultVerificationResultHref({ status: 'invalid' }));
      case 'login_required':
        return adultVerificationRedirect(adultVerificationResultHref({ status: 'login_required' }));
      case 'blocked':
        return adultVerificationRedirect(
          adultVerificationResultHref({ status: 'failed' }),
          clearAdultVerificationTicketCookie(request),
        );
      case 'pending':
        return adultVerificationRedirect(adultVerificationResultHref({
          status: 'pending',
          mode: completion.presentation,
          next: completion.returnPath,
        }));
      default:
        return adultVerificationRedirect(
          adultVerificationResultHref({
            status: completion.outcome,
            mode: completion.presentation,
            next: completion.returnPath,
          }),
          clearAdultVerificationTicketCookie(request),
        );
    }
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
