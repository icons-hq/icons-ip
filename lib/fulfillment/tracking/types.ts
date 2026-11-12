/**
 * 택배 추적 seam(QNA-028). 추적 서비스(계약 전)마다 다른 응답을 이 모양으로 정규화해 DB 서비스 RPC
 * (`service_record_delivery_tracking`)에 넘긴다. 상태 전이(배송완료)는 DB만 한다 — 어댑터·cron은 이벤트를 옮길 뿐이다.
 * 같은 seam을 반품 회수 송장 추적(QNA-032·QNA-034, T13b)도 쓴다.
 */

/** 정규화한 추적 상태. DB `private.shipment_tracking_events.status` 목록과 같다. 양쪽을 함께 바꾼다. */
export const TRACKING_EVENT_STATUSES = ['accepted', 'in_transit', 'out_for_delivery', 'delivered', 'exception', 'returned', 'unknown'] as const;
export type TrackingEventStatus = (typeof TRACKING_EVENT_STATUSES)[number];

/** 운영 화면에 쓰는 이름. 고객 화면에는 아직 보이지 않는다. */
export const TRACKING_EVENT_STATUS_LABELS: Record<TrackingEventStatus, string> = {
  accepted: '집화 접수', in_transit: '이동 중', out_for_delivery: '배송 출발', delivered: '배달 완료',
  exception: '배송 이상', returned: '반송', unknown: '확인 중',
};

export function isTrackingEventStatus(value: unknown): value is TrackingEventStatus {
  return typeof value === 'string' && (TRACKING_EVENT_STATUSES as readonly string[]).includes(value);
}

/** 조회할 운송장. 택배사 코드는 ICONS 레지스트리(`shipping_carriers.code`)이고, 서비스별 코드로 바꾸는 일은 어댑터 몫이다. */
export interface TrackingTarget { carrier: string; trackingNumber: string }

/**
 * 추적 서비스가 준 이벤트 하나. `eventKey`는 같은 이벤트를 두 번 받아도 한 번만 남기는 열쇠다(서비스 이벤트 id, 없으면
 * 시각·상태·지점으로 만든 값). `raw`는 근거로 남길 원본 일부다 — 수령인 이름·전화 같은 개인정보는 어댑터가 빼고 넘긴다.
 */
export interface TrackingEvent {
  eventKey: string;
  status: TrackingEventStatus;
  /** ISO 8601(시간대 포함). */
  occurredAt: string;
  description?: string;
  location?: string;
  raw: Record<string, unknown>;
}

export type TrackingLookup =
  | { outcome: 'ok'; events: TrackingEvent[] }
  | { outcome: 'not_found' }
  | { outcome: 'error'; errorCode: string };

/** 추적 서비스 어댑터. `provider`는 DB 스위치(`private.delivery_tracking_settings.provider`)와 같아야 쓰인다. */
export interface TrackingAdapter {
  readonly provider: string;
  lookup(target: TrackingTarget, signal: AbortSignal): Promise<TrackingLookup>;
}

/** DB로 보내는 조회 결과 한 건(`service_record_delivery_tracking`의 results 원소). */
export interface TrackingPollResult extends TrackingTarget {
  outcome: TrackingLookup['outcome'];
  errorCode?: string;
  events?: TrackingEvent[];
}

const EVENT_KEY_LIMIT = 200;
const RAW_BYTES_LIMIT = 8192;
const ERROR_CODE = /^[a-z0-9_]{1,64}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})$/;

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 어댑터가 만든 이벤트를 DB가 받는 모양으로 다듬는다. 형식이 틀린 이벤트는 버리고 나머지를 남긴다(한 이벤트 때문에 그 운송장
 * 기록 전체를 잃지 않게). 설명·지점은 DB 길이에 맞춰 자르고, 원본이 8KB를 넘으면 원본 대신 잘렸다는 표시만 남긴다.
 */
export function normalizeTrackingEvents(events: unknown): TrackingEvent[] {
  if (!Array.isArray(events)) return [];
  const seen = new Set<string>();
  return events.slice(0, 100).flatMap((event): TrackingEvent[] => {
    if (!record(event) || typeof event.eventKey !== 'string' || !event.eventKey.trim() || event.eventKey.length > EVENT_KEY_LIMIT
      || !isTrackingEventStatus(event.status) || typeof event.occurredAt !== 'string' || !INSTANT.test(event.occurredAt)
      || !Number.isFinite(Date.parse(event.occurredAt)) || seen.has(event.eventKey)) return [];
    seen.add(event.eventKey);
    const raw = record(event.raw) ? event.raw : {};
    const fits = new TextEncoder().encode(JSON.stringify(raw)).length <= RAW_BYTES_LIMIT;
    return [{
      eventKey: event.eventKey, status: event.status, occurredAt: event.occurredAt,
      ...(typeof event.description === 'string' && event.description.trim() ? { description: event.description.trim().slice(0, 200) } : {}),
      ...(typeof event.location === 'string' && event.location.trim() ? { location: event.location.trim().slice(0, 100) } : {}),
      raw: fits ? raw : { truncated: true },
    }];
  });
}

/** 조회 실패 코드는 DB가 받는 형식(`^[a-z0-9_]{1,64}$`)만 남긴다. */
export function trackingErrorCode(value: unknown): string {
  return typeof value === 'string' && ERROR_CODE.test(value) ? value : 'upstream_error';
}
