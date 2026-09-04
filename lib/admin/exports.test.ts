import { describe, expect, it } from 'vitest';
import {
  CSV_BOM,
  adminExportsHref,
  describeExportFilters,
  exportFileName,
  normalizeAdminExportsFilters,
  normalizeExportFilters,
  normalizeExportTemplateForm,
  renderCsv,
  toCsvCell,
  toExportRpcFilters,
  type ExportColumn,
} from './exports';

const columns: ExportColumn[] = [
  { key: 'order_no', header: '주문번호' },
  { key: 'recipient_postal_code', header: '우편번호', format: 'text' },
  { key: 'recipient_name', header: '수취인명', mask: 'name' },
  { key: 'qty', header: '수량', format: 'number' },
  { key: 'delivery_note', header: '배송메시지' },
];

function form(entries: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

describe('CSV 렌더러', () => {
  it('우편번호는 앞의 0 을 지키는 문자열 셀로 쓴다', () => {
    expect(toCsvCell('06236', 'text')).toBe('"=""06236"""');
    expect(toCsvCell('06236')).toBe('06236');
    expect(toCsvCell(null)).toBe('');
    expect(toCsvCell(3, 'number')).toBe('3');
  });

  it('쉼표·따옴표·줄바꿈이 있는 값은 감싸고 따옴표를 두 번 쓴다', () => {
    expect(toCsvCell('문 앞, 부재 시')).toBe('"문 앞, 부재 시"');
    expect(toCsvCell('그는 "빨리"라고 했다')).toBe('"그는 ""빨리""라고 했다"');
    expect(toCsvCell('첫 줄\n둘째 줄')).toBe('"첫 줄\n둘째 줄"');
  });

  it('헤더와 행을 CRLF 로 잇고, 없는 값은 빈 칸으로 둔다', () => {
    const csv = renderCsv(columns, [
      { order_no: 'A-1', recipient_postal_code: '06236', recipient_name: '홍*동', qty: 2, delivery_note: '문 앞' },
      { order_no: 'A-2', recipient_postal_code: '', recipient_name: '김*', qty: 1 },
    ]);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('주문번호,우편번호,수취인명,수량,배송메시지');
    expect(lines[1]).toBe('A-1,"=""06236""",홍*동,2,문 앞');
    expect(lines[2]).toBe('A-2,,김*,1,');
    /* 마지막 줄도 CRLF 로 끝난다 — 일부 엑셀이 마지막 행을 빠뜨리지 않게. */
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(CSV_BOM.length).toBe(1);
  });

  it('파일명은 양식키와 요청 시각으로 만든다', () => {
    expect(exportFileName('picking_list', '2026-09-04T10:05:00', 'csv')).toBe('picking_list_20260904_1005.csv');
    expect(exportFileName(null, 'not-a-date', 'csv')).toBe('export_unknown.csv');
  });
});

describe('필터 계약', () => {
  it('날짜를 KST 반열림 창으로 옮긴다 — 종료일 그날까지 포함', () => {
    const result = normalizeExportFilters(form({ from: '2026-09-01', to: '2026-09-03', status: 'paid' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rpc = toExportRpcFilters(result.value);
    expect(rpc.from).toBe('2026-09-01T00:00:00+09:00');
    /* 9월 3일 주문도 들어와야 하므로 경계는 9월 4일 0시다. */
    expect(new Date(rpc.to as string).toISOString()).toBe(new Date('2026-09-04T00:00:00+09:00').toISOString());
    expect(rpc.status).toBe('paid');
    expect(rpc.unshipped_only).toBeUndefined();
  });

  it('뒤집힌 기간과 모르는 상태를 거른다', () => {
    const inverted = normalizeExportFilters(form({ from: '2026-09-03', to: '2026-09-01' }));
    expect(inverted.ok).toBe(false);
    const badStatus = normalizeExportFilters(form({ status: 'nope' }));
    expect(badStatus.ok).toBe(false);
  });

  it('조건을 사람이 읽는 한 줄로 요약한다', () => {
    expect(describeExportFilters({})).toBe('전체');
    expect(describeExportFilters({ from: '2026-09-01T00:00:00+09:00', status: 'paid', unshipped_only: true }))
      .toBe('2026-09-01 ~ 지금 · 상태 paid · 미출고만');
  });
});

describe('양식 폼', () => {
  it('고른 열의 헤더·마스킹·서식은 원본 정의를 그대로 물려받는다', () => {
    const result = normalizeExportTemplateForm(
      (() => {
        const data = form({ name: '김포 발주서(간단)', securityLevel: 'pii', fileFormat: 'csv' });
        data.append('columnKeys', 'order_no');
        data.append('columnKeys', 'recipient_name');
        data.append('columnKeys', '없는열');
        return data;
      })(),
      columns,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.columns).toEqual([
      { key: 'order_no', header: '주문번호' },
      { key: 'recipient_name', header: '수취인명', mask: 'name' },
    ]);
  });

  it('개인정보 열을 담고 등급만 낮추면 거부한다', () => {
    const data = form({ name: '우회 시도', securityLevel: 'normal' });
    data.append('columnKeys', 'recipient_name');
    const result = normalizeExportTemplateForm(data, columns);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.securityLevel).toBeTruthy();
  });

  it('열을 하나도 고르지 않으면 거부한다', () => {
    const result = normalizeExportTemplateForm(form({ name: '빈 양식' }), columns);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.columnKeys).toBeTruthy();
  });
});

describe('목록 URL 계약', () => {
  it('상태·양식·페이지를 좁히고 기본값은 URL에서 뺀다', () => {
    const filters = normalizeAdminExportsFilters({ status: 'done', template: 'not-a-uuid', page: '2' });
    expect(filters).toEqual({ status: 'done', template: null, page: 2 });
    expect(adminExportsHref(filters)).toBe('/admin/settings/exports?status=done&page=2');
    expect(adminExportsHref(filters, { status: null, page: 1 })).toBe('/admin/settings/exports');
  });
});
