import {
  findShippingCarrier,
  isTrackingNumber,
  normalizeTrackingNumber,
  type ShippingCarrierRegistry,
} from '@/lib/orders/shipment';

/** Shipment UUID is canonical; a single-shipment order also accepts its order reference. */
export const TRACKING_IMPORT_ROW_LIMIT = 1000;

export interface TrackingImportRow {
  /** 원본 줄 번호(1-based). 실패 리포트가 "몇 번째 줄"을 말할 수 있어야 한다. */
  line: number;
  /** 입력된 주문번호 원문. 실패 리포트에 그대로 싣는다. */
  reference: string;
  /** 전체 UUID로 적힌 경우. 아니면 `null`이고 `reference`로 조회한다. */
  referenceId: string | null;
  carrier: string;
  trackingNumber: string;
}

export interface TrackingImportIssue {
  line: number;
  /** 주문번호를 읽지 못한 줄도 있으므로 빈 문자열일 수 있다. */
  reference: string;
  reason: string;
}

export interface TrackingImportParseResult {
  rows: TrackingImportRow[];
  issues: TrackingImportIssue[];
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REFERENCE_PATTERN = /^[0-9A-F]{8}$/;

/** 헤더 줄로 인정하는 첫 칸. 운영자가 헤더를 지우고 붙여넣어도 동작해야 한다. */
const HEADER_FIRST_CELLS = new Set(['배송건번호', '배송 건 번호', 'shipmentid', 'shipment_id', '주문번호', 'order', 'orderid', 'order_id', '주문 번호']);

function splitCells(line: string): string[] {
  /* 엑셀에서 복사한 값은 탭 구분, 파일로 저장한 값은 쉼표 구분이다. 한 줄 안에
     탭이 있으면 탭이 구분자다 — 굿즈명 같은 자유 텍스트 칸이 없어 혼동 여지가 없다. */
  const delimiter = line.includes('\t') ? '\t' : ',';
  return line.split(delimiter).map(unquote);
}

function unquote(cell: string): string {
  const trimmed = cell.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replaceAll('""', '"').trim();
  }
  return trimmed;
}

/**
 * 택배사 칸을 레지스트리 코드로 푼다.
 *
 * 코드(`hanjin`)와 표시명(`한진택배`)을 모두 받는다. 운영자가 화면에서 보는 것은
 * 표시명이고 WMS가 내보내는 것은 무엇일지 아직 모른다(#177) — 둘 다 받아 두면
 * 포맷 확인 전에도 파일이 그대로 통과한다. 비활성 택배사는 코드가 맞아도 거절한다.
 */
function resolveCarrier(cell: string, carriers: ShippingCarrierRegistry) {
  const byCode = findShippingCarrier(carriers, cell.toLowerCase());
  if (byCode) return byCode;
  return carriers.find((carrier) => carrier.label === cell) ?? null;
}

export function parseTrackingImport(
  text: string,
  carriers: ShippingCarrierRegistry,
): TrackingImportParseResult {
  const rows: TrackingImportRow[] = [];
  const issues: TrackingImportIssue[] = [];
  /* 같은 주문에 두 운송장이 적히면 나중 줄이 앞 줄을 덮어쓴다. 조용히 덮어쓰는
     대신 거절한다 — 어느 쪽이 맞는지는 파일을 만든 사람만 안다. */
  const seen = new Map<string, number>();

  const lines = text.replace(/^﻿/, '').split(/\r\n|\r|\n/);
  let headerChecked = false;

  lines.forEach((raw, index) => {
    const line = index + 1;
    if (!raw.trim()) return;

    const cells = splitCells(raw);

    if (!headerChecked) {
      headerChecked = true;
      if (HEADER_FIRST_CELLS.has(cells[0]?.toLowerCase() ?? '')) return;
    }

    const [rawReference = '', rawCarrier = '', rawTracking = ''] = cells;
    const reference = rawReference.trim();

    if (cells.length !== 3 || !reference || !rawCarrier || !rawTracking) {
      issues.push({
        line,
        reference,
        reason: '배송건번호·택배사코드·운송장번호 세 칸이 모두 필요합니다.',
      });
      return;
    }

    const isUuid = UUID_PATTERN.test(reference);
    const normalizedReference = isUuid
      ? reference.toLowerCase()
      : reference.replace(/[\s-]/g, '').toUpperCase();

    if (!isUuid && !REFERENCE_PATTERN.test(normalizedReference)) {
      issues.push({
        line,
        reference,
        reason: '배송건번호 또는 단일 배송 주문번호는 콘솔에 표시되는 8자리 또는 전체 UUID여야 합니다.',
      });
      return;
    }

    const duplicateLine = seen.get(normalizedReference);
    if (duplicateLine !== undefined) {
      issues.push({
        line,
        reference,
        reason: `${duplicateLine}번째 줄과 배송건번호가 중복됩니다.`,
      });
      return;
    }

    const carrier = resolveCarrier(rawCarrier, carriers);
    if (!carrier) {
      issues.push({
        line,
        reference,
        reason: `등록되지 않은 택배사입니다: ${rawCarrier}`,
      });
      return;
    }
    if (!carrier.active) {
      issues.push({
        line,
        reference,
        reason: `지금 사용하지 않는 택배사입니다: ${carrier.label}`,
      });
      return;
    }

    const trackingNumber = normalizeTrackingNumber(rawTracking);
    if (!isTrackingNumber(trackingNumber)) {
      issues.push({
        line,
        reference,
        reason: '운송장번호는 하이픈을 뺀 8~30자리 영숫자여야 합니다.',
      });
      return;
    }

    seen.set(normalizedReference, line);
    rows.push({
      line,
      reference: isUuid ? reference : normalizedReference,
      referenceId: isUuid ? normalizedReference : null,
      carrier: carrier.code,
      trackingNumber,
    });
  });

  return { rows, issues };
}

/** 운영자가 화면에서 받아 갈 예시. 화면 문구와 테스트가 같은 값을 본다. */
export const TRACKING_IMPORT_SAMPLE = [
  '배송건번호,택배사코드,운송장번호',
  '11111111-1111-4111-8111-111111111111,hanjin,123456789012',
].join('\n');
