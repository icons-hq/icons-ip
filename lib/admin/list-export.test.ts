import { describe, expect, it } from 'vitest';
import { ADMIN_SCREENS } from './navigation';
import {
  ADMIN_LIST_EXPORT_ROW_LIMIT,
  ADMIN_LIST_EXPORT_SCREEN_IDS,
  ADMIN_LIST_EXPORT_SCREENS,
  AdminListExportLimitError,
  adminListExportContentDisposition,
  adminListExportFileNameFromDisposition,
  adminListExportFileNames,
  adminListExportHref,
  adminListExportLimitMessage,
  assertAdminListExportWithinLimit,
  isAdminListExportScreenId,
  kstDateTimeText,
  kstFileStamp,
  listExportPeriodLabel,
  listExportSheetName,
  normalizeListExportCell,
} from './list-export';

describe('목록 엑셀 다운로드 화면 정의', () => {
  it('주문·배송 사이드바 화면과 같은 경로·이름을 쓴다(거래확정은 기존 기록 방식 유지)', () => {
    const sales = new Map(ADMIN_SCREENS.map((screen) => [screen.id, screen]));
    for (const id of ADMIN_LIST_EXPORT_SCREEN_IDS) {
      const screen = sales.get(id);
      expect(screen, id).toBeDefined();
      expect(ADMIN_LIST_EXPORT_SCREENS[id].href).toBe(screen!.href);
      expect(ADMIN_LIST_EXPORT_SCREENS[id].label).toBe(screen!.label);
    }
    expect(isAdminListExportScreenId('settled')).toBe(false);
    expect(isAdminListExportScreenId('orders')).toBe(true);
    expect(isAdminListExportScreenId('__proto__')).toBe(false);
  });
});

describe('KST 시각과 파일명', () => {
  it('UTC 시각을 KST 벽시계로 옮기고 자정을 넘긴다', () => {
    expect(kstDateTimeText('2026-10-07T15:30:00.000Z')).toBe('2026-10-08 00:30');
    expect(kstDateTimeText('2026-10-07T01:05:59.000Z')).toBe('2026-10-07 10:05');
    expect(kstDateTimeText(null)).toBe('');
    expect(kstDateTimeText('not-a-date')).toBe('');
    expect(kstFileStamp(new Date('2026-10-07T15:30:00.000Z'))).toBe('20261008-0030');
  });

  it('파일명은 icons-<화면>-YYYYMMDD-HHmm.xlsx이고 한글은 RFC 5987로 싣는다', () => {
    const now = new Date('2026-10-07T06:04:00.000Z');
    const names = adminListExportFileNames('dispatch', now, '발송 대기');
    expect(names.fileName).toBe('icons-발주발송-발송대기-20261007-1504.xlsx');
    expect(names.asciiFileName).toBe('icons-dispatch-20261007-1504.xlsx');
    const header = adminListExportContentDisposition(names.fileName, names.asciiFileName);
    expect(header).toBe(`attachment; filename="icons-dispatch-20261007-1504.xlsx"; filename*=UTF-8''${encodeURIComponent(names.fileName)}`);
    expect(adminListExportFileNameFromDisposition(header, 'fallback.xlsx')).toBe(names.fileName);
    expect(adminListExportFileNameFromDisposition('attachment; filename="plain.xlsx"', 'x')).toBe('plain.xlsx');
    expect(adminListExportFileNameFromDisposition(null, 'fallback.xlsx')).toBe('fallback.xlsx');
  });
});

describe('셀 값 고정', () => {
  it('문자열은 수식으로 바꾸지 않고 선행 0을 지킨다', () => {
    expect(normalizeListExportCell('code', '01012345678')).toBe('01012345678');
    expect(normalizeListExportCell('code', '00123')).toBe('00123');
    expect(normalizeListExportCell('text', '=HYPERLINK("https://example.test")')).toBe('=HYPERLINK("https://example.test")');
    expect(normalizeListExportCell('text', '이름\u0000\u0007끝')).toBe('이름끝');
    expect(normalizeListExportCell('text', '')).toBeNull();
    expect(normalizeListExportCell('text', { formula: 'SUM(A1)' })).toBeNull();
    expect(normalizeListExportCell('text', 'a'.repeat(40_000))).toHaveLength(32_767);
  });

  it('금액·수량은 안전한 정수만 숫자로 쓰고 나머지는 빈 칸이다', () => {
    expect(normalizeListExportCell('amount', 42_000)).toBe(42_000);
    expect(normalizeListExportCell('amount', '42000')).toBeNull();
    expect(normalizeListExportCell('amount', 1.5)).toBeNull();
    expect(normalizeListExportCell('count', Number.MAX_SAFE_INTEGER + 1)).toBeNull();
    expect(normalizeListExportCell('count', null)).toBeNull();
  });

  it('시트 이름 규칙에 맞춘다', () => {
    expect(listExportSheetName('발주·발송 관리 [발송 대기]')).toBe('발주·발송 관리 발송 대기');
    expect(listExportSheetName('a'.repeat(40))).toHaveLength(31);
    expect(listExportSheetName('///')).toBe('목록');
  });
});

describe('상한과 주소', () => {
  it('상한을 넘으면 조건을 좁히라는 오류로 멈춘다', () => {
    expect(() => assertAdminListExportWithinLimit(ADMIN_LIST_EXPORT_ROW_LIMIT)).not.toThrow();
    expect(() => assertAdminListExportWithinLimit(ADMIN_LIST_EXPORT_ROW_LIMIT + 1)).toThrow(AdminListExportLimitError);
    expect(adminListExportLimitMessage()).toBe('한 번에 내려받을 수 있는 양을 넘었습니다. 조건을 좁혀 다시 내려받아 주세요(최대 10,000건).');
  });

  it('목록 주소의 필터만 옮기고 페이지·선택 주문은 버린다', () => {
    expect(adminListExportHref('orders', '/admin/sales/orders?status=paid&from=2026-10-01&query=%ED%99%8D&field=recipient&page=3&order=abc'))
      .toBe('/api/admin/list-export?screen=orders&status=paid&from=2026-10-01&query=%ED%99%8D&field=recipient');
    expect(adminListExportHref('unpaid', '/admin/sales/unpaid')).toBe('/api/admin/list-export?screen=unpaid');
    expect(adminListExportHref('claims-returns', '/admin/sales/claims/returns?stage=open&page=1&screen=orders'))
      .toBe('/api/admin/list-export?screen=claims-returns&stage=open');
  });

  it('기간 문구', () => {
    expect(listExportPeriodLabel(null, null)).toBe('전체 기간');
    expect(listExportPeriodLabel('2026-10-01', null)).toBe('2026-10-01 ~ 종료 제한 없음');
  });
});
