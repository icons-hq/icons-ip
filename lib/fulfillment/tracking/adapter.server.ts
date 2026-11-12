import 'server-only';
import { readFile } from 'node:fs/promises';
import { normalizeTrackingEvents, type TrackingAdapter, type TrackingLookup } from './types';

/**
 * 추적 서비스 어댑터 선택. 켜는 조건은 두 겹이다: DB 스위치(`private.delivery_tracking_settings`, 서비스 이름 포함)가 켜져 있고,
 * 이 서버의 `DELIVERY_TRACKING_PROVIDER`가 그 이름과 같아야 한다. env만으로는 아무것도 하지 않는다(DB가 대상을 고르지 않는다).
 *
 * 실제 추적 서비스(계약 전 — 사람 게이트)는 계약한 서비스의 API로 `TrackingAdapter`를 만들어 아래 `PROVIDERS`에 더한다.
 * 키·주소는 `DELIVERY_TRACKING_API_KEY`·`DELIVERY_TRACKING_API_URL`로 받고(서버 전용, 공개 접두어 금지), 응답에서 수령인
 * 이름·전화 같은 개인정보는 `raw`에 남기지 않는다. 지금 등록된 것은 격리 시험용 가짜 어댑터뿐이다.
 */
export type TrackingAdapterUnavailable = 'provider_missing' | 'provider_mismatch' | 'provider_unsupported' | 'fake_in_production' | 'fake_file_missing';
export type TrackingAdapterChoice = { configured: true; adapter: TrackingAdapter } | { configured: false; reason: TrackingAdapterUnavailable };

type Environment = Record<string, string | undefined>;

/**
 * 격리 시험용 가짜 어댑터. `DELIVERY_TRACKING_FAKE_EVENTS_FILE`(JSON)에서 운송장별 이벤트를 조회할 때마다 다시 읽는다 —
 * 시험자는 파일을 고친 뒤 다음 cron을 기다리면 된다. 열쇠는 `택배사코드:운송장번호`다.
 * `{ "hanjin:123456789012": [{ "eventKey": "d1", "status": "delivered", "occurredAt": "2026-11-12T15:00:00+09:00" }] }`
 * 열쇠가 없으면 not_found, 파일을 읽지 못하면 error다.
 */
export function fakeTrackingAdapter(file: string): TrackingAdapter {
  return {
    provider: 'fake',
    async lookup(target, signal): Promise<TrackingLookup> {
      let parsed: unknown;
      try { parsed = JSON.parse(await readFile(file, { encoding: 'utf8', signal })); }
      catch { return { outcome: 'error', errorCode: 'fake_events_unreadable' }; }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { outcome: 'error', errorCode: 'fake_events_invalid' };
      const events = (parsed as Record<string, unknown>)[`${target.carrier}:${target.trackingNumber}`];
      if (events === undefined) return { outcome: 'not_found' };
      return { outcome: 'ok', events: normalizeTrackingEvents(Array.isArray(events)
        ? events.map(event => event && typeof event === 'object' && !Array.isArray(event) && !('raw' in event) ? { ...event, raw: { fake: true } } : event)
        : []) };
    },
  };
}

const PROVIDERS: Record<string, (env: Environment) => TrackingAdapterChoice> = {
  fake(env) {
    // 운영 배포에서는 DB·env가 모두 fake여도 만들지 않는다(가짜 배달완료로 철회 기간이 시작되지 않게).
    if (env.VERCEL_ENV === 'production') return { configured: false, reason: 'fake_in_production' };
    const file = env.DELIVERY_TRACKING_FAKE_EVENTS_FILE?.trim();
    return file ? { configured: true, adapter: fakeTrackingAdapter(file) } : { configured: false, reason: 'fake_file_missing' };
  },
};

/** DB 스위치가 고른 서비스(`provider`)와 이 서버 env가 같을 때만 어댑터를 만든다. */
export function trackingAdapterFromEnvironment(provider: string, env: Environment = process.env): TrackingAdapterChoice {
  const configured = env.DELIVERY_TRACKING_PROVIDER?.trim();
  if (!configured) return { configured: false, reason: 'provider_missing' };
  if (configured !== provider) return { configured: false, reason: 'provider_mismatch' };
  const factory = Object.hasOwn(PROVIDERS, provider) ? PROVIDERS[provider] : undefined;
  return factory ? factory(env) : { configured: false, reason: 'provider_unsupported' };
}
