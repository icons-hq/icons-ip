import {
  adultVerificationCompletionPath,
  processKcpCertReturn,
  type KcpCertReturnOutcome,
} from '@/lib/identity/adult-verification.server';
import { adultVerificationResultHref } from '@/lib/identity/adult-verification-routes';
import {
  adultVerificationRedirect,
  KcpCertCallbackInvalidError,
  parseKcpCertCallback,
} from '@/lib/identity/kcp-cert-callback.server';

/**
 * 라우트 실행 예산(초). 최악 경로는 KCP 결과조회 1회(10초 시한) + DB 호출 서너 번이다.
 * 예산을 넘겨 함수가 죽어도 세션은 confirming(선점 2분)으로 남고, 선점이 풀린 뒤
 * 콜백이 다시 오면 처음부터 처리된다.
 */
export const maxDuration = 30;

interface KcpCertReturnHandlerDependencies {
  readonly processReturn: typeof processKcpCertReturn;
}

/**
 * KCP 인증창의 Ret_URL. 사용자 브라우저가 KCP 페이지에서 보내는 교차 사이트 요청이라
 * 로그인 쿠키가 없다 — 계정은 경로 nonce로 찾은 세션 행에서만 정해진다. 결과를 판정해
 * 보류로 적은 뒤, 같은 브라우저를 본인 세션 확정 경로(동일 사이트 GET)로 보낸다.
 */
export function createKcpCertReturnHandler({ processReturn }: KcpCertReturnHandlerDependencies) {
  return async function handleKcpCertReturn(
    request: Request,
    context: { params: Promise<{ nonce: string }> },
  ) {
    const { nonce } = await context.params;

    let fields;
    try {
      fields = await parseKcpCertCallback(request);
    } catch (error) {
      if (error instanceof KcpCertCallbackInvalidError) {
        return adultVerificationRedirect(adultVerificationResultHref({ status: 'invalid' }));
      }
      throw error;
    }

    let outcome: KcpCertReturnOutcome;
    try {
      outcome = await processReturn({
        nonce,
        resultCode: fields.resultCode,
        registrationKey: fields.registrationKey,
      });
    } catch {
      // DB·네트워크 장애. 세션은 선점 TTL 뒤 다시 처리될 수 있으니 상태를 추측해 닫지 않는다.
      return adultVerificationRedirect(adultVerificationResultHref({ status: 'error' }));
    }

    if (outcome.kind === 'invalid') {
      return adultVerificationRedirect(adultVerificationResultHref({ status: 'invalid' }));
    }
    return adultVerificationRedirect(adultVerificationCompletionPath(outcome.nonce));
  };
}

const handler = createKcpCertReturnHandler({ processReturn: (input) => processKcpCertReturn(input) });

export const POST = handler;
export const GET = handler;
