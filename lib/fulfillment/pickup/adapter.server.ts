import 'server-only';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { ReturnPickupAdapter, ReturnPickupCancelResult, ReturnPickupRequestResult } from './types';

/**
 * 반품 회수 접수 어댑터 선택. 켜는 조건은 두 겹이다: DB 스위치(`private.return_pickup_settings`, 서비스 이름 포함)가 켜져 있고, 이 서버의
 * `RETURN_PICKUP_PROVIDER`가 그 이름과 같아야 한다. env만으로는 아무것도 하지 않는다(DB가 할 일을 고르지 않는다). 운영 기본은 '설정 없음'
 * — env가 없으면 접수하지 않는다.
 *
 * 실제 택배사 어댑터(사람 게이트: 우체국·한진 반품 회수 계약·API 키·회수 운임, 개인정보 처리위탁 계약):
 *  - TODO(epost 반품 회수): 우체국 계약소포 반품 접수 API. 계약·API 문서를 받기 전에는 요청·응답 모양을 추측해 구현하지 않는다.
 *  - TODO(hanjin 반품 회수): 한진 반품 접수 API. 위와 같다.
 *  계약한 서비스는 `ReturnPickupAdapter`를 구현해 아래 `PROVIDERS`에 더한다. 키·주소는 `RETURN_PICKUP_API_KEY`·`RETURN_PICKUP_API_URL`
 *  (서버 전용 — 공개 접두어 금지)로 받고, 요청에는 `ReturnPickupRequest`의 최소 필드만 보내며, 회수지 이름·연락처·주소를 로그·오류 코드·
 *  결과에 남기지 않는다. 멱등 키(`idempotencyKey`)를 택배사 주문 번호(또는 그에 준하는 값)로 보내 재전송이 수거를 두 번 잡지 않게 하고,
 *  취소는 접수 응답을 못 받았어도 멱등 키로 찾아 취소한다.
 */
export type ReturnPickupAdapterUnavailable = 'provider_missing' | 'provider_mismatch' | 'provider_unsupported' | 'fake_in_production';
export type ReturnPickupAdapterChoice = { configured: true; adapter: ReturnPickupAdapter } | { configured: false; reason: ReturnPickupAdapterUnavailable };

type Environment = Record<string, string | undefined>;

/**
 * 격리 시험·QA용 가짜 어댑터. 실제로 아무 데도 보내지 않는다. 회수 송장은 멱등 키에서 정해지는 값이다(`FAKE` + 숫자 10자리 —
 * 같은 묶음을 다시 보내면 같은 송장, 택배사의 멱등 처리를 흉내 낸다).
 * `RETURN_PICKUP_FAKE_FILE`(선택, JSON)을 부를 때마다 다시 읽어 동작을 바꾼다 — 시험자는 파일을 고친 뒤 다음 크론을 기다리면 된다.
 * `{ "request": "ok" | "error", "cancel": "ok" | "not_found" | "error", "errorCode": "fake_unavailable" }` (빠진 칸은 ok)
 */
export function fakeReturnPickupAdapter(file?: string): ReturnPickupAdapter {
  async function behavior(signal: AbortSignal): Promise<Record<string, unknown> | null> {
    if (!file) return {};
    try {
      const parsed: unknown = JSON.parse(await readFile(file, { encoding: 'utf8', signal }));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
    } catch {
      return null;
    }
  }
  const failure = (config: Record<string, unknown>) => ({ outcome: 'error' as const,
    errorCode: typeof config.errorCode === 'string' && /^[a-z0-9_]{1,64}$/u.test(config.errorCode) ? config.errorCode : 'fake_unavailable' });
  return {
    provider: 'fake',
    async request(input, signal): Promise<ReturnPickupRequestResult> {
      const config = await behavior(signal);
      if (!config) return { outcome: 'error', errorCode: 'fake_behavior_unreadable' };
      if (config.request === 'error') return failure(config);
      const digest = createHash('sha256').update(input.idempotencyKey).digest();
      const digits = Array.from(digest.subarray(0, 10), byte => String(byte % 10)).join('');
      return { outcome: 'requested', trackingNumber: `FAKE${digits}`, externalId: `fake-${digest.subarray(0, 6).toString('hex')}` };
    },
    async cancel(_input, signal): Promise<ReturnPickupCancelResult> {
      const config = await behavior(signal);
      if (!config) return { outcome: 'error', errorCode: 'fake_behavior_unreadable' };
      if (config.cancel === 'error') return failure(config);
      return { outcome: config.cancel === 'not_found' ? 'not_found' : 'canceled' };
    },
  };
}

const PROVIDERS: Record<string, (env: Environment) => ReturnPickupAdapterChoice> = {
  fake(env) {
    // 운영 배포에서는 DB·env가 모두 fake여도 만들지 않는다(가짜 회수 송장이 고객에게 보이지 않게).
    if (env.VERCEL_ENV === 'production') return { configured: false, reason: 'fake_in_production' };
    return { configured: true, adapter: fakeReturnPickupAdapter(env.RETURN_PICKUP_FAKE_FILE?.trim() || undefined) };
  },
};

/** DB가 고른 서비스(`provider`)와 이 서버 env가 같을 때만 어댑터를 만든다. */
export function returnPickupAdapterFromEnvironment(provider: string, env: Environment = process.env): ReturnPickupAdapterChoice {
  const configured = env.RETURN_PICKUP_PROVIDER?.trim();
  if (!configured) return { configured: false, reason: 'provider_missing' };
  if (configured !== provider) return { configured: false, reason: 'provider_mismatch' };
  const factory = Object.hasOwn(PROVIDERS, provider) ? PROVIDERS[provider] : undefined;
  return factory ? factory(env) : { configured: false, reason: 'provider_unsupported' };
}
