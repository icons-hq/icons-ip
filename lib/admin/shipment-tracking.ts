import { isUuid } from '@/lib/uuid';
import { isTrackingEventStatus, TRACKING_EVENT_STATUS_LABELS, type TrackingEventStatus } from '@/lib/fulfillment/tracking/types';

/**
 * 배송현황의 추가 운송장·자동 배송완료 표시(`admin_shipment_tracking_summaries`, QNA-019·QNA-028).
 * 추가 운송장은 늘 싣고, 자동·수동 구분과 추적 진행은 DB 스위치가 켜진 때만 온다(꺼져 있으면 null — 화면에 아무것도 더하지 않는다).
 */
export interface ShipmentConsoleExtraTracking {
  id: string;
  carrier: string;
  trackingNumber: string;
  source: 'warehouse_reply' | 'operator';
  createdAt: string;
}
export type ShipmentDeliveredBy = 'tracking' | 'manual';
export interface ShipmentTrackingProgress {
  /** 대표 + 추가 운송장 수와 그중 최근 이벤트가 배달완료인 수. */
  total: number;
  delivered: number;
  latestStatus: TrackingEventStatus | null;
  latestAt: string | null;
  /** 자동 배송완료로 바꾸지 못해 보류된 배송 건(취소·반품 진행 등). 운영자가 수동으로 처리할 수 있다. */
  held: boolean;
}
export interface ShipmentTrackingSummary {
  extraTrackings: ShipmentConsoleExtraTracking[];
  deliveredBy: ShipmentDeliveredBy | null;
  tracking: ShipmentTrackingProgress | null;
}
export interface ShipmentTrackingSummaries {
  autoDelivery: boolean;
  shipments: Record<string, ShipmentTrackingSummary>;
}

/** 추가 운송장을 더하거나 지우는 사유 길이 상한. DB(order_shipment_tracking_changes.reason)와 같다. */
export const SHIPMENT_EXTRA_TRACKING_REASON_LIMIT = 500;
/** 배송 건 하나에 붙일 수 있는 추가 운송장 수(대표 포함 20개). */
export const SHIPMENT_EXTRA_TRACKING_LIMIT = 19;

export const SHIPMENT_DELIVERED_BY_LABELS: Record<ShipmentDeliveredBy, string> = { tracking: '자동 확인 · 택배 추적', manual: '수동 처리' };

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const instant = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));

function parseExtra(value: unknown): ShipmentConsoleExtraTracking | null {
  if (!record(value) || !isUuid(value.id) || typeof value.carrier !== 'string' || typeof value.trackingNumber !== 'string'
    || !/^[A-Z0-9]{8,30}$/.test(value.trackingNumber) || (value.source !== 'warehouse_reply' && value.source !== 'operator') || !instant(value.createdAt)) return null;
  return { id: value.id, carrier: value.carrier, trackingNumber: value.trackingNumber, source: value.source, createdAt: value.createdAt };
}

function parseProgress(value: unknown): ShipmentTrackingProgress | null | undefined {
  if (value === null) return null;
  if (!record(value) || !count(value.total) || !count(value.delivered) || value.delivered > value.total || typeof value.held !== 'boolean'
    || (value.latestStatus !== null && !isTrackingEventStatus(value.latestStatus)) || (value.latestAt !== null && !instant(value.latestAt))) return undefined;
  return { total: value.total, delivered: value.delivered, latestStatus: value.latestStatus as TrackingEventStatus | null, latestAt: value.latestAt as string | null, held: value.held };
}

/** 모양이 틀리면 null이다(화면은 목록을 그리지 않고 오류를 보인다 — 합포장·제작 요약과 같다). 스위치가 꺼져 있으면 추적 표시는 늘 비운다. */
export function parseShipmentTrackingSummaries(value: unknown, ids: readonly string[]): ShipmentTrackingSummaries | null {
  if (!record(value) || typeof value.autoDelivery !== 'boolean' || !record(value.shipments)) return null;
  const shipments: Record<string, ShipmentTrackingSummary> = {};
  for (const id of ids) {
    const entry = value.shipments[id];
    if (!record(entry) || !Array.isArray(entry.extraTrackings)) return null;
    const extraTrackings = entry.extraTrackings.map(parseExtra);
    if (extraTrackings.some(extra => !extra)) return null;
    const deliveredBy = entry.deliveredBy === null ? null : entry.deliveredBy === 'tracking' || entry.deliveredBy === 'manual' ? entry.deliveredBy : undefined;
    const tracking = parseProgress(entry.tracking);
    if (deliveredBy === undefined || tracking === undefined) return null;
    shipments[id] = {
      extraTrackings: extraTrackings as ShipmentConsoleExtraTracking[],
      deliveredBy: value.autoDelivery ? deliveredBy : null,
      tracking: value.autoDelivery ? tracking : null,
    };
  }
  return { autoDelivery: value.autoDelivery, shipments };
}

/**
 * 배송현황 추적 표시 문구(QA2 물류). 최근 이벤트가 '배달 완료'여도 도착하지 않은 운송장이 남아 있으면(도착 n/m, n<m)
 * 배송 건은 아직 도착하지 않았으므로 '이동 중'으로 읽힌다 — 자동 배송완료는 모든 운송장이 도착해야 한다.
 */
export function trackingProgressLabel(progress: Pick<ShipmentTrackingProgress, 'latestStatus' | 'delivered' | 'total'>): string {
  const allArrived = progress.total > 0 && progress.delivered >= progress.total;
  const status = progress.latestStatus === 'delivered' && !allArrived ? '이동 중'
    : progress.latestStatus ? TRACKING_EVENT_STATUS_LABELS[progress.latestStatus] : '기록 없음';
  return `택배 추적 ${status} · 도착 ${progress.delivered}/${progress.total}`;
}
