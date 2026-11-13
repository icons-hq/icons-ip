import { isUuid } from '@/lib/uuid';

/*
 * 문의 처리 이력(1014-105, 2026-11-12 오케스트레이터 판단): 그 문의를 열 수 있는 모든 운영자(cs.manage)가
 * 누가 언제 담당을 맡거나 바꾸고, 답변하고, 완료했는지 본다. 원본은 DB 감사 기록이고(`admin_inquiry_processing_history`),
 * 7일 무응답 자동 종결은 실행자가 없어 '자동 종결'로 보인다.
 */

export const INQUIRY_PROCESSING_EVENT_KINDS = ['assigned', 'reassigned', 'answered', 'closed', 'auto_closed'] as const;
export type InquiryProcessingEventKind = typeof INQUIRY_PROCESSING_EVENT_KINDS[number];

export const INQUIRY_PROCESSING_EVENT_LABELS: Record<InquiryProcessingEventKind, string> = {
  assigned: '첫 답변으로 담당 지정',
  reassigned: '담당 변경',
  answered: '답변',
  closed: '완료',
  auto_closed: '자동 종결',
};

export interface InquiryProcessingEvent {
  id: string;
  at: string;
  kind: InquiryProcessingEventKind;
  /** 처리한 운영자 표시명. 자동 종결은 null. */
  actorName: string | null;
  /** 담당 변경 전 담당자. null이면 미배정. */
  fromName: string | null;
  /** 담당 변경·지정 뒤 담당자. null이면 미배정. */
  toName: string | null;
  reason: string | null;
}

export interface InquiryProcessingHistory {
  inquiryId: string;
  events: InquiryProcessingEvent[];
  /** 전체 처리 기록 수. `limit`보다 많으면 최근 기록만 온다. */
  total: number;
  limit: number;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function nullableText(value: unknown, max = 500): value is string | null {
  return value === null || (typeof value === 'string' && value.length > 0 && value.length <= max);
}
function count(value: unknown, min = 0): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min;
}

/** 계약과 다른 응답은 빈 이력이 아니라 읽기 실패다. */
export function parseInquiryProcessingHistory(value: unknown): InquiryProcessingHistory | null {
  if (!record(value) || !isUuid(value.inquiryId) || !Array.isArray(value.events) || !count(value.total) || !count(value.limit, 1)) return null;
  if (value.events.length > value.limit + 1 || value.events.length > value.total) return null;
  const events: InquiryProcessingEvent[] = [];
  for (const row of value.events) {
    if (!record(row) || typeof row.id !== 'string' || !row.id || typeof row.at !== 'string' || !Number.isFinite(Date.parse(row.at))
      || !INQUIRY_PROCESSING_EVENT_KINDS.includes(row.kind as InquiryProcessingEventKind)
      || !nullableText(row.actorName, 200) || !nullableText(row.fromName, 200) || !nullableText(row.toName, 200) || !nullableText(row.reason)) return null;
    events.push({ id: row.id, at: row.at, kind: row.kind as InquiryProcessingEventKind, actorName: row.actorName,
      fromName: row.fromName, toName: row.toName, reason: row.reason });
  }
  if (new Set(events.map(event => event.id)).size !== events.length) return null;
  return { inquiryId: value.inquiryId, events, total: value.total, limit: value.limit };
}

/** 한 줄 설명: 처리 종류와, 담당 변경이면 이전 → 이후 담당자. */
export function inquiryProcessingEventSummary(event: Pick<InquiryProcessingEvent, 'kind' | 'fromName' | 'toName'>): string {
  const label = INQUIRY_PROCESSING_EVENT_LABELS[event.kind];
  if (event.kind === 'reassigned') return `${label} · ${event.fromName ?? '미배정'} → ${event.toName ?? '미배정'}`;
  if (event.kind === 'assigned' && event.toName) return `${label} · ${event.toName}`;
  return label;
}
