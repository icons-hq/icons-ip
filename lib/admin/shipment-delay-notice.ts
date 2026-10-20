import { isUuid } from '@/lib/uuid';
import { ORDER_DELAY_STATUS_LABELS, type OrderDelayChannelStatus } from './order-delay-notices';

export const SHIPMENT_DELAY_NOTICE_OPTIONS = [
  { value: '', label: '전체' },
  { value: 'sent', label: '발송 처리' },
  { value: 'partial_failed', label: '일부 채널 실패·제외' },
  { value: 'pending', label: '대기·처리 중' },
  { value: 'unknown', label: '결과 확인 필요' },
  { value: 'not_sent', label: '미발송' },
] as const;
export type ShipmentDelayNoticeStatus = Exclude<(typeof SHIPMENT_DELAY_NOTICE_OPTIONS)[number]['value'], ''>;
export interface ShipmentDelayNoticeSummary {
  status: ShipmentDelayNoticeStatus;
  noticeId: string | null;
  requestedAt: string | null;
  inAppStatus: 'prepared' | 'sent' | null;
  emailStatus: OrderDelayChannelStatus | null;
  emailProviderState: string | null;
}
export function shipmentDelayNoticeLabel(status?: ShipmentDelayNoticeStatus) {
  return SHIPMENT_DELAY_NOTICE_OPTIONS.find(option => option.value === status)?.label ?? '확인 필요';
}
/** Missing receipts must not be displayed as a verified unsent result. */
export function parseShipmentDelayNotice(value: unknown): ShipmentDelayNoticeSummary | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (!SHIPMENT_DELAY_NOTICE_OPTIONS.some(option => option.value && option.value === row.status)) return null;
  if (row.status === 'not_sent') {
    if (['noticeId', 'requestedAt', 'inAppStatus', 'emailStatus', 'emailProviderState'].some(key => row[key] !== null)) return null;
  } else if (typeof row.noticeId !== 'string' || !isUuid(row.noticeId)
    || typeof row.requestedAt !== 'string' || !Number.isFinite(Date.parse(row.requestedAt))
    || !['prepared', 'sent'].includes(String(row.inAppStatus))
    || !Object.hasOwn(ORDER_DELAY_STATUS_LABELS, String(row.emailStatus))
    || (row.emailProviderState !== null && typeof row.emailProviderState !== 'string')) return null;
  return row as unknown as ShipmentDelayNoticeSummary;
}
