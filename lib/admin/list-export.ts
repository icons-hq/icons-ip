/*
 * 주문·배송 목록 엑셀 다운로드의 순수 계약.
 *
 * 화면 목록을 그대로 확인용 .xlsx로 내려받는다. 창고에 전달하는 출고지시 파일
 * (`shipment-workbook`)이나 정산 검토용 거래확정 엑셀(`settled-export`)과는 다른
 * 파일이다 — 화면에서 본 조건·열 그대로를 건수가 많을 때 엑셀에서 확인하려는 용도다.
 *
 * 클라이언트 버튼도 이 모듈의 주소 헬퍼를 쓰므로 서버 전용 의존을 두지 않는다.
 */
import { ORDER_CLAIM_TYPE_SLUGS, type OrderClaimType } from '@/lib/orders/claims';

/** 한 파일에 담는 최대 행 수. 화면 조건의 결과 건수와 엑셀 행 수 양쪽에 적용한다. */
export const ADMIN_LIST_EXPORT_ROW_LIMIT = 10_000;

export const ADMIN_LIST_EXPORT_ROUTE = '/api/admin/list-export';

export const ADMIN_LIST_EXPORT_BUTTON_LABEL = '목록 엑셀 다운로드';

export const ADMIN_LIST_EXPORT_SCREEN_IDS = [
  'orders',
  'unpaid',
  'dispatch',
  'shipping',
  'claims-cancels',
  'claims-returns',
  'claims-exchanges',
] as const;
export type AdminListExportScreenId = (typeof ADMIN_LIST_EXPORT_SCREEN_IDS)[number];

export interface AdminListExportScreen {
  id: AdminListExportScreenId;
  /** 사이드바 화면 이름. 엑셀 시트·안내 시트에 그대로 쓴다. */
  label: string;
  /** 권한 게이트에 넘기는 화면 경로. `lib/admin/navigation.ts`의 href와 같아야 한다. */
  href: string;
  /** 한글 파일명 조각(공백·기호 없음). */
  fileLabel: string;
  /** 한글을 못 읽는 클라이언트용 ASCII 파일명 조각. */
  asciiLabel: string;
}

export const ADMIN_LIST_EXPORT_SCREENS: Record<AdminListExportScreenId, AdminListExportScreen> = {
  orders: { id: 'orders', label: '주문 통합검색', href: '/admin/sales/orders', fileLabel: '주문통합검색', asciiLabel: 'orders' },
  unpaid: { id: 'unpaid', label: '미입금 확인', href: '/admin/sales/unpaid', fileLabel: '미입금확인', asciiLabel: 'unpaid' },
  dispatch: { id: 'dispatch', label: '발주·발송 관리', href: '/admin/sales/dispatch', fileLabel: '발주발송', asciiLabel: 'dispatch' },
  shipping: { id: 'shipping', label: '배송현황 관리', href: '/admin/sales/shipping', fileLabel: '배송현황', asciiLabel: 'shipping' },
  'claims-cancels': { id: 'claims-cancels', label: '취소 관리', href: '/admin/sales/claims/cancels', fileLabel: '취소관리', asciiLabel: 'claims-cancels' },
  'claims-returns': { id: 'claims-returns', label: '반품 관리', href: '/admin/sales/claims/returns', fileLabel: '반품관리', asciiLabel: 'claims-returns' },
  'claims-exchanges': { id: 'claims-exchanges', label: '교환 관리', href: '/admin/sales/claims/exchanges', fileLabel: '교환관리', asciiLabel: 'claims-exchanges' },
};

/** 클레임 유형별 화면 id. 사이드바 id(`claims-cancels` 등)와 같다. */
export function adminListExportClaimScreenId(claimType: OrderClaimType): AdminListExportScreenId {
  return `claims-${ORDER_CLAIM_TYPE_SLUGS[claimType]}` as AdminListExportScreenId;
}

export function isAdminListExportScreenId(value: unknown): value is AdminListExportScreenId {
  return typeof value === 'string'
    && (ADMIN_LIST_EXPORT_SCREEN_IDS as readonly string[]).includes(value);
}

/**
 * 셀 종류.
 * - text: 일반 문자열(이름·주소·상태).
 * - code: 번호·연락처·우편번호처럼 선행 0과 자릿수를 지켜야 하는 문자열.
 * - amount: 원 단위 정수 금액. 숫자 셀 + 천 단위 서식.
 * - count: 수량·건수. 숫자 셀 + 천 단위 서식.
 */
export type ListExportCellKind = 'text' | 'code' | 'amount' | 'count';
export type ListExportCellValue = string | number | null;

export interface ListExportColumn {
  header: string;
  kind: ListExportCellKind;
  /** 엑셀 열 너비(문자 수 기준). */
  width: number;
}

export interface AdminListExportSheet {
  screen: AdminListExportScreenId;
  /** 데이터 시트 이름. 화면 이름과 탭 이름을 쓴다. */
  title: string;
  columns: ListExportColumn[];
  rows: ListExportCellValue[][];
  /** 화면 기준 건수(주문·배송 건·클레임). 행은 상품 줄 단위라 이보다 많을 수 있다. */
  recordCount: number;
  /** 안내 시트에 적는 조건 [항목, 값]. */
  conditions: [string, string][];
  /** 행 단위 등 이 파일을 읽는 방법. */
  notes: string[];
  /** 감사 기록에 남기는 정규화된 필터. 페이지·선택 주문은 담지 않는다. */
  filters: Record<string, string | null>;
}

export const ADMIN_LIST_EXPORT_PRIVACY_NOTICE =
  '개인정보가 담긴 파일입니다. 업무 목적 밖으로 공유하지 말고, 확인이 끝나면 삭제해주세요. 내려받은 기록(담당자·시각·화면·조건·건수)이 남습니다.';

export function adminListExportLimitMessage(limit = ADMIN_LIST_EXPORT_ROW_LIMIT) {
  return `한 번에 내려받을 수 있는 양을 넘었습니다. 조건을 좁혀 다시 내려받아 주세요(최대 ${limit.toLocaleString('ko-KR')}건).`;
}

/** 화면 건수는 상한 안이지만 상품 줄로 펼친 엑셀 행이 상한을 넘었을 때의 안내. */
export function adminListExportRowLimitMessage(limit = ADMIN_LIST_EXPORT_ROW_LIMIT) {
  return `상품 한 줄을 한 행으로 펼치면 한 파일에 담을 수 있는 ${limit.toLocaleString('ko-KR')}행을 넘습니다. 기간·상태를 좁혀 나누어 받아 주세요.`;
}

/** `records`는 화면 결과 건수, `rows`는 상품 줄로 펼친 엑셀 행 수가 상한을 넘은 경우다. */
export type AdminListExportLimitUnit = 'records' | 'rows';

export class AdminListExportLimitError extends Error {
  constructor(
    readonly count: number,
    readonly limit = ADMIN_LIST_EXPORT_ROW_LIMIT,
    readonly unit: AdminListExportLimitUnit = 'records',
  ) {
    super(unit === 'rows' ? adminListExportRowLimitMessage(limit) : adminListExportLimitMessage(limit));
    this.name = 'AdminListExportLimitError';
  }
}

/** 상한을 넘으면 파일을 만들지 않는다. 일부만 자른 파일을 성공처럼 내보내지 않는다. */
export function assertAdminListExportWithinLimit(
  count: number,
  limit = ADMIN_LIST_EXPORT_ROW_LIMIT,
  unit: AdminListExportLimitUnit = 'records',
) {
  if (!Number.isSafeInteger(count) || count < 0 || count > limit) {
    throw new AdminListExportLimitError(count, limit, unit);
  }
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function kstParts(date: Date) {
  const shifted = new Date(date.getTime() + KST_OFFSET_MS).toISOString();
  return {
    day: shifted.slice(0, 10),
    time: shifted.slice(11, 16),
  };
}

/** ISO 시각을 KST 벽시계 `YYYY-MM-DD HH:mm` 문자열로. 비었거나 읽을 수 없으면 빈 칸이다. */
export function kstDateTimeText(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const { day, time } = kstParts(date);
  return `${day} ${time}`;
}

/** 파일명에 쓰는 KST 시각 `YYYYMMDD-HHmm`. */
export function kstFileStamp(now: Date): string {
  const { day, time } = kstParts(now);
  return `${day.replaceAll('-', '')}-${time.replace(':', '')}`;
}

export function adminListExportFileNames(screen: AdminListExportScreenId, now: Date, variant?: string) {
  const definition = ADMIN_LIST_EXPORT_SCREENS[screen];
  const stamp = kstFileStamp(now);
  const suffix = variant ? `-${variant.replace(/[^\p{L}\p{N}]+/gu, '')}` : '';
  return {
    fileName: `icons-${definition.fileLabel}${suffix}-${stamp}.xlsx`,
    asciiFileName: `icons-${definition.asciiLabel}-${stamp}.xlsx`,
  };
}

/** RFC 5987/6266: ASCII fallback + UTF-8 filename*. */
export function adminListExportContentDisposition(fileName: string, asciiFileName: string) {
  const ascii = asciiFileName.replace(/[^\x20-\x7e]|["\\]/g, '_');
  const encoded = encodeURIComponent(fileName).replace(/['()*!]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/** 응답 헤더에서 파일명을 읽는다. filename*를 우선한다. */
export function adminListExportFileNameFromDisposition(header: string | null, fallback: string) {
  if (!header) return fallback;
  const extended = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (extended) {
    try {
      return decodeURIComponent(extended[1].trim());
    } catch {
      /* fall through to the ASCII name */
    }
  }
  const plain = /filename="([^"]+)"/i.exec(header);
  return plain?.[1] ?? fallback;
}

/* XML 1.0이 허용하지 않는 제어문자는 xlsx를 깨뜨린다. 탭·줄바꿈은 남긴다. */
const XML_INVALID_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;
const EXCEL_CELL_TEXT_LIMIT = 32_767;

/**
 * 셀 값을 종류에 맞게 고정한다. 문자열은 언제나 문자열로 남는다 — `=`·`+`·`-`·`@`로
 * 시작해도 수식 객체로 바꾸지 않으므로 엑셀이 계산하지 않는다. 금액·수량은 안전한
 * 정수만 숫자 셀로 쓰고, 아니면 빈 칸으로 둔다(지어낸 값을 넣지 않는다).
 */
export function normalizeListExportCell(kind: ListExportCellKind, value: unknown): ListExportCellValue {
  if (value === null || value === undefined) return null;
  if (kind === 'amount' || kind === 'count') {
    return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
  }
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).replace(XML_INVALID_CHARS, '');
  if (!text) return null;
  return text.length > EXCEL_CELL_TEXT_LIMIT ? text.slice(0, EXCEL_CELL_TEXT_LIMIT) : text;
}

/** 시트 이름 규칙(31자, `\ / * ? : [ ]` 금지)에 맞춘다. */
export function listExportSheetName(value: string) {
  const name = value.replace(/[\\/*?:[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31);
  return name.replace(/^'+|'+$/g, '') || '목록';
}

const DROPPED_PARAMS = new Set(['page', 'order', 'back', 'screen', 'registered']);

/**
 * 화면 목록 주소(정규화된 필터가 담긴 href)를 다운로드 주소로 바꾼다.
 * 페이지·선택 주문처럼 목록 범위와 무관한 값은 버린다 — 파일은 전체 페이지를 담는다.
 */
export function adminListExportHref(screen: AdminListExportScreenId, listHref: string) {
  const query = listHref.includes('?') ? listHref.slice(listHref.indexOf('?') + 1) : '';
  const source = new URLSearchParams(query);
  const params = new URLSearchParams({ screen });
  for (const [key, value] of source) {
    if (!DROPPED_PARAMS.has(key) && value) params.append(key, value);
  }
  return `${ADMIN_LIST_EXPORT_ROUTE}?${params.toString()}`;
}

/** 조건 표기용 기간 문구. */
export function listExportPeriodLabel(from: string | null, to: string | null) {
  if (!from && !to) return '전체 기간';
  return `${from ?? '시작 제한 없음'} ~ ${to ?? '종료 제한 없음'}`;
}
