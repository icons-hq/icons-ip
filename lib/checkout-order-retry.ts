/**
 * 주문 생성 혼잡 재시도(2026-11-23 예약판매 동접 대비).
 *
 * 주문 생성 RPC는 장바구니의 모든 상품 행을 잠그므로 같은 상품을 담은 주문은 한 줄로 처리된다. 결제가 한꺼번에
 * 몰리면 잠금 대기(8초)를 넘긴 주문이 오류로 돌아온다. 그 오류를 고객에게 바로 보이지 않고, 같은 주문서 키로
 * 서버가 다시 시도해 '조금 기다림'으로 바꾼다.
 *
 * 다시 보내는 것은 DB가 주문을 만들지 않고 되돌렸음이 확실한 오류뿐이다 — 잠금 대기·문장 시간 초과·교착·직렬화
 * 실패(트랜잭션 롤백)와 API 연결 풀 대기·연결 실패(요청이 DB에 닿지 않음). 네트워크 오류처럼 결과를 모르는 경우는
 * 다시 보내지 않는다. 같은 키의 재요청은 DB가 원래 주문으로 돌려주므로(checkout_draft_used) 이중 주문은 없다.
 */

const TRANSIENT_ORDER_ERROR_CODES = new Set([
  '55P03', // lock_not_available — lock_timeout
  '57014', // query_canceled — statement_timeout
  '40P01', // deadlock_detected
  '40001', // serialization_failure
  'PGRST000', // PostgREST가 DB에 연결하지 못했다
  'PGRST003', // PostgREST 연결 풀 대기 시간 초과
]);

export function isTransientOrderError(error: { code?: string | null } | null | undefined): boolean {
  return typeof error?.code === 'string' && TRANSIENT_ORDER_ERROR_CODES.has(error.code);
}

/** 화면이 '주문이 많아 처리 중'으로 바꾸는 시점(주문서 제출 뒤). */
export const ORDER_BUSY_NOTICE_DELAY_MS = 3_000;
/** 이 시간 안에서만 다시 시작한다. 한 번의 시도는 잠금 대기 한도(8초)까지 걸릴 수 있다. */
export const ORDER_BUSY_RETRY_BUDGET_MS = 25_000;
/** 재시도 사이 기다림(지터 0.5~1.5배). 한꺼번에 실패한 주문들이 같은 순간 다시 몰리지 않게 퍼뜨린다. */
export const ORDER_BUSY_RETRY_DELAYS_MS = [300, 700, 1_500, 2_500, 3_500] as const;

export interface OrderRetryOptions {
  budgetMs?: number;
  delaysMs?: readonly number[];
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  onRetry?: (attempt: number, code: string) => void;
}

const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** 일시적 혼잡 오류면 예산 안에서 다시 부르고, 마지막 결과(성공·일반 오류·끝난 혼잡 오류)를 그대로 돌려준다. */
export async function retryTransientOrderErrors<T extends { error: { code?: string | null } | null }>(
  attempt: () => PromiseLike<T>,
  options: OrderRetryOptions = {},
): Promise<T> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  const delays = options.delaysMs ?? ORDER_BUSY_RETRY_DELAYS_MS;
  const budgetMs = options.budgetMs ?? ORDER_BUSY_RETRY_BUDGET_MS;
  const startedAt = now();
  let result = await attempt();
  for (let index = 0; index < delays.length && isTransientOrderError(result.error); index += 1) {
    const delay = Math.round(delays[index] * (0.5 + random()));
    if (now() - startedAt + delay > budgetMs) break;
    options.onRetry?.(index + 1, result.error?.code ?? '');
    await sleep(delay);
    result = await attempt();
  }
  return result;
}
