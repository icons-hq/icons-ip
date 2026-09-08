import type { AdminFieldErrors, AdminFormResult } from './catalog';
import type { AdminCatalogSearchQuery } from './catalog-list';

/*
 * D-4 엑셀 양식 · 비동기 내보내기 — 순수 모듈(열 사전 · CSV 렌더러 · 필터 계약 · 폼 정규화).
 *
 * 마스킹은 여기서 하지 않는다. DB(`admin_export_rows`)가 권한을 보고 마스킹한 행만 내보내므로,
 * 이 모듈은 이미 안전해진 값을 표로 옮기기만 한다 — 원문이 앱까지 나온 뒤 가리는 순서가 아니다.
 */

export const EXPORT_STATUSES = [
  { value: 'queued', label: '대기' },
  { value: 'running', label: '만드는 중' },
  { value: 'done', label: '완료' },
  { value: 'failed', label: '실패' },
  { value: 'expired', label: '만료' },
  { value: 'canceled', label: '취소' },
] as const;

export const EXPORT_STATUS_LABELS: Record<string, string> = Object.fromEntries(
  EXPORT_STATUSES.map((status) => [status.value, status.label]),
);

export const EXPORT_TARGETS = [
  { value: 'order_items', label: '주문 품목' },
] as const;

export const EXPORT_SECURITY_LEVELS = [
  { value: 'normal', label: '일반' },
  { value: 'pii', label: '개인정보 포함' },
] as const;

/**
 * 렌더러가 아는 열. 양식의 `key` 는 반드시 이 사전에 있어야 한다 —
 * 없는 키를 쓰면 파일에 빈 칸이 조용히 생기는 대신 저장 단계에서 걸린다.
 */
export const EXPORT_COLUMN_KEYS = [
  'mall_name', 'order_no', 'item_no', 'ordered_at', 'order_kind', 'order_status',
  'good_id', 'good_name', 'variant_code', 'option_summary',
  'qty', 'unit_price', 'line_total', 'paid_total',
  'location_name', 'location_id', 'carrier_label', 'tracking_number', 'ship_by',
  /* 거래확정 정산 열(현업 3-3). 배송비는 주문의 첫 품목 행에만 실린다. */
  'done_at', 'paid_at', 'shipping_fee',
  'shipment_group', 'box_kind', 'delivery_note',
  'orderer_name', 'orderer_phone',
  'recipient_name', 'recipient_phone', 'recipient_postal_code', 'recipient_address',
] as const;

export type ExportColumnKey = (typeof EXPORT_COLUMN_KEYS)[number];

export interface ExportColumn {
  key: string;
  header: string;
  /** DB 가 이 열을 마스킹 대상으로 다룬다는 표시. 정렬 키로 쓸 수 없다. */
  mask?: 'name' | 'phone' | 'address';
  /** `text` 는 앞의 0 을 지키기 위해 문자열 셀로 강제한다(우편번호). */
  format?: 'text' | 'number';
}

export interface AdminExportTemplate {
  id: string;
  key: string | null;
  name: string;
  description: string | null;
  target: string;
  columns: ExportColumn[];
  sort: { key: string; dir: string }[];
  defaultFilters: Record<string, unknown>;
  securityLevel: string;
  fileFormat: string;
  isSystem: boolean;
  archivedAt: string | null;
}

export interface AdminExportJob {
  id: string;
  templateId: string;
  templateKey: string | null;
  templateName: string;
  securityLevel: string;
  fileFormat: string;
  status: string;
  filters: Record<string, unknown>;
  reason: string | null;
  rowCount: number | null;
  fileBytes: number | null;
  error: string | null;
  requestedBy: string;
  requesterNickname: string | null;
  createdAt: string;
  finishedAt: string | null;
  expiresAt: string | null;
}

/* ------------------------------------------------------------------------- */
/* CSV 렌더러                                                                  */
/* ------------------------------------------------------------------------- */

/** 엑셀이 UTF-8 로 읽게 하는 표식. 없으면 한글이 깨진 채 열린다. */
export const CSV_BOM = '﻿';

/**
 * 한 칸을 CSV 로 옮긴다.
 * - `text` 서식은 `="0123"` 로 감싼다 — 우편번호 앞의 0 을 엑셀이 지우지 못하게(카페24 「0 보호」와 같은 수).
 * - 큰따옴표·쉼표·줄바꿈이 있으면 감싸고 따옴표는 두 번 쓴다(RFC 4180).
 */
export function toCsvCell(value: unknown, format?: ExportColumn['format']): string {
  if (value === null || value === undefined) return '';
  const raw = typeof value === 'string' ? value : String(value);
  if (format === 'text' && raw !== '') {
    return `"=""${raw.replace(/"/g, '""')}"""`;
  }
  if (/[",\r\n]/.test(raw)) return `"${raw.replace(/"/g, '""')}"`;
  return raw;
}

/** 엑셀이 기대하는 줄끝은 CRLF 다. 리눅스 줄끝이면 일부 버전이 한 줄로 읽는다. */
export function renderCsv(columns: readonly ExportColumn[], rows: readonly Record<string, unknown>[]): string {
  const header = columns.map((column) => toCsvCell(column.header)).join(',');
  const body = rows.map((row) => columns.map((column) => toCsvCell(row[column.key], column.format)).join(','));
  return `${[header, ...body].join('\r\n')}\r\n`;
}

/** 파일명 = 양식키_YYYYMMDD_HHmm.확장자. 사람이 폴더에서 정렬해도 시간순이 된다. */
export function exportFileName(templateKey: string | null, createdAt: string, fileFormat: string) {
  const date = new Date(createdAt);
  const pad = (value: number) => String(value).padStart(2, '0');
  const stamp = Number.isNaN(date.getTime())
    ? 'unknown'
    : `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}`;
  return `${templateKey ?? 'export'}_${stamp}.${fileFormat}`;
}

/* ------------------------------------------------------------------------- */
/* 필터 계약                                                                   */
/* ------------------------------------------------------------------------- */

export interface AdminExportFilters {
  from: string | null;
  to: string | null;
  status: string | null;
  locationId: string | null;
  unshippedOnly: boolean;
  ipId: string | null;
  includeArchived: boolean;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ORDER_STATUSES = ['pending', 'paid', 'confirmed', 'shipping', 'delivered', 'done', 'canceled'];

/** 폼 값 → RPC 필터. 날짜는 KST 하루 경계를 반열림 `[from, to+1일)` 로 만든다. */
export function normalizeExportFilters(formData: FormData): AdminFormResult<AdminExportFilters> {
  const errors: AdminFieldErrors = {};
  const read = (name: string) => {
    const value = formData.get(name);
    return typeof value === 'string' ? value.trim() : '';
  };
  const from = read('from');
  const to = read('to');
  const status = read('status');
  const locationId = read('locationId');

  if (from && !DATE_PATTERN.test(from)) errors.from = '시작일을 확인해주세요.';
  if (to && !DATE_PATTERN.test(to)) errors.to = '종료일을 확인해주세요.';
  if (from && to && to < from) errors.to = '종료일은 시작일보다 뒤여야 합니다.';
  if (status && !ORDER_STATUSES.includes(status)) errors.status = '주문 상태를 확인해주세요.';

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      from: from || null,
      to: to || null,
      status: status || null,
      locationId: locationId || null,
      unshippedOnly: formData.get('unshippedOnly') === 'on',
      ipId: read('ipId') || null,
      includeArchived: formData.get('includeArchived') === 'on',
    },
  };
}

/** 필터를 RPC 가 읽는 모양으로. 종료일은 그날을 포함하도록 하루를 더한다. */
export function toExportRpcFilters(filters: AdminExportFilters): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (filters.from) payload.from = `${filters.from}T00:00:00+09:00`;
  if (filters.to) {
    const end = new Date(`${filters.to}T00:00:00+09:00`);
    end.setDate(end.getDate() + 1);
    payload.to = end.toISOString();
  }
  if (filters.status) payload.status = filters.status;
  if (filters.locationId) payload.location_id = filters.locationId;
  if (filters.unshippedOnly) payload.unshipped_only = true;
  if (filters.ipId) payload.ip_id = filters.ipId;
  if (filters.includeArchived) payload.include_archived = true;
  return payload;
}

/** 목록 화면의 필터 요약 한 줄. 무엇으로 뽑은 파일인지 나중에 알아볼 수 있어야 한다. */
export function describeExportFilters(filters: Record<string, unknown>): string {
  const parts: string[] = [];
  const from = typeof filters.from === 'string' ? filters.from.slice(0, 10) : null;
  const to = typeof filters.to === 'string' ? filters.to.slice(0, 10) : null;
  if (from || to) parts.push(`${from ?? '처음'} ~ ${to ?? '지금'}`);
  if (typeof filters.status === 'string') parts.push(`상태 ${filters.status}`);
  if (typeof filters.location_id === 'string') parts.push(`출고지 ${filters.location_id}`);
  if (filters.unshipped_only === true) parts.push('미출고만');
  if (typeof filters.ip_id === 'string') parts.push(`IP ${filters.ip_id}`);
  if (filters.include_archived === true) parts.push('보관 포함');
  return parts.length > 0 ? parts.join(' · ') : '전체';
}

/* ------------------------------------------------------------------------- */
/* 양식 폼                                                                     */
/* ------------------------------------------------------------------------- */

export interface AdminExportTemplateFormValue {
  id: string | null;
  name: string;
  description: string | null;
  target: string;
  columns: ExportColumn[];
  securityLevel: string;
  fileFormat: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string) {
  return UUID_PATTERN.test(value);
}

/**
 * 사용자 양식 저장. 열은 체크박스로 고른 키 목록으로 오고, 헤더·마스킹·서식은
 * 시스템 양식(원본)의 정의를 그대로 물려받는다 — 창고·ERP 가 아는 헤더를 사람이 바꾸지 못하게 한다.
 */
export function normalizeExportTemplateForm(
  formData: FormData,
  catalog: readonly ExportColumn[],
): AdminFormResult<AdminExportTemplateFormValue> {
  const errors: AdminFieldErrors = {};
  const read = (name: string) => {
    const value = formData.get(name);
    return typeof value === 'string' ? value.trim() : '';
  };
  const rawId = read('id');
  const name = read('name');
  const securityLevel = read('securityLevel') || 'normal';
  const fileFormat = read('fileFormat') || 'csv';
  const chosen = formData.getAll('columnKeys').map((key) => String(key));

  if (rawId && !isUuid(rawId)) errors.form = '양식을 찾을 수 없습니다.';
  if (!name || name.length > 60) errors.name = '양식 이름은 1~60자여야 합니다.';
  if (!EXPORT_SECURITY_LEVELS.some((entry) => entry.value === securityLevel)) errors.securityLevel = '보안 등급을 선택해주세요.';
  if (fileFormat !== 'csv' && fileFormat !== 'xlsx') errors.fileFormat = '파일 형식을 선택해주세요.';

  const columns = chosen
    .map((key) => catalog.find((column) => column.key === key))
    .filter((column): column is ExportColumn => column !== undefined);
  if (columns.length === 0) errors.columnKeys = '열을 하나 이상 골라주세요.';
  /* 개인정보 열을 담으면 등급이 따라 올라간다 — 등급만 낮춰 우회하지 못하게. */
  if (columns.some((column) => column.mask) && securityLevel !== 'pii') {
    errors.securityLevel = '개인정보 열을 담은 양식은 「개인정보 포함」이어야 합니다.';
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      id: rawId || null,
      name,
      description: read('description') || null,
      target: 'order_items',
      columns,
      securityLevel,
      fileFormat,
    },
  };
}

/* ------------------------------------------------------------------------- */
/* 목록 화면 URL 계약                                                          */
/* ------------------------------------------------------------------------- */

export const ADMIN_EXPORTS_PATH = '/admin/settings/exports';

export interface AdminExportsFilters {
  status: string | null;
  template: string | null;
  page: number;
}

export function normalizeAdminExportsFilters(query: AdminCatalogSearchQuery): AdminExportsFilters {
  const single = (value: string | string[] | undefined) => (typeof value === 'string' ? value.trim() : '');
  const status = single(query.status);
  const template = single(query.template);
  const page = Number.parseInt(single(query.page), 10);
  return {
    status: EXPORT_STATUSES.some((entry) => entry.value === status) ? status : null,
    template: isUuid(template) ? template : null,
    page: Number.isFinite(page) && page >= 1 ? page : 1,
  };
}

export function adminExportsHref(filters: AdminExportsFilters, patch: Partial<AdminExportsFilters> = {}) {
  const next = { ...filters, ...patch };
  const search = new URLSearchParams();
  if (next.status) search.set('status', next.status);
  if (next.template) search.set('template', next.template);
  if (next.page > 1) search.set('page', String(next.page));
  const query = search.toString();
  return query ? `${ADMIN_EXPORTS_PATH}?${query}` : ADMIN_EXPORTS_PATH;
}
