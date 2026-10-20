import { describe, expect, it } from 'vitest';
import { emptyGoodsSizeChartValues, parseGoodsSizeChart, parseGoodsSizeChartSnapshot, parseGoodsSizeChartValues, parseGoodsSizeName, parseGoodsSizeNumber, parseGoodsSizeTemplate, parseGoodsSizeTemplatePage } from './goods-size-chart';

const chart = { unit: 'mm' as const, sizes: ['단일', '확장'], measurements: [{ name: '가로', values: ['37.4', '63'] }, { name: '세로', values: ['24', '48.2'] }], note: '합성 치수 안내' };
const now = '2026-10-14T00:00:00Z';
const template = { id: '99000000-0000-4000-8000-000000000001', name: '합성 안내표', chart, revision: 1, archived: false, createdAt: now, updatedAt: now };
describe('the exact size table contract', () => {
  it('normalizes only ASCII boundary whitespace, preserves NBSP, and matches SQL codepoints', () => {
    expect(parseGoodsSizeChart({ ...chart, sizes: [' \n단일\t', '\u00a0확장\u00a0'], measurements: [{ name: ' 가로 ', values: [' 37.4\t', '63.0'] }], note: ' \r\n측정\r\n안내\t문구\r ' })).toEqual({ ...chart, sizes: ['단일', '\u00a0확장\u00a0'], measurements: [{ name: '가로', values: ['37.4', '63'] }], note: '측정\n안내\t문구' });
    expect(parseGoodsSizeName('😀'.repeat(10), 10)).toBe('😀'.repeat(10));
    expect(parseGoodsSizeName('😀'.repeat(11), 10)).toBeNull();
    expect(parseGoodsSizeName(' \t\n', 10)).toBeNull();
  });
  it.each(['1e3', '1E-1', '37.49', '1,000', '+3', '-3', '.1', '01', '0', '0.0', '99999.1', '100000', '3mm', 'NaN', 'Infinity', '', '\u00a01\u00a0'])('rejects %j instead of silently shortening or converting it', value => {
    expect(parseGoodsSizeNumber(value)).toBeNull();
  });
  it.each([['0.1', '0.1'], ['99999.0', '99999'], ['37.0', '37'], [' \t37.4\r\n', '37.4']])('accepts and canonicalizes %s', (input, expected) => expect(parseGoodsSizeNumber(input)).toBe(expected));
  it('requires a complete rectangular matrix and distinct names', () => {
    const bad = [
      { ...chart, unit: ['mm'] }, { ...chart, sizes: ['같음', ' 같음 '] },
      { ...chart, measurements: [{ name: '가로', values: ['37'] }] },
      { ...chart, measurements: [chart.measurements[0], chart.measurements[0]] },
      { ...chart, measurements: [{ name: '가로', values: [37, '63'] }] },
      { ...chart, sizes: ['a'], measurements: [{ name: '가로', values: [''] }] },
      { ...chart, measurements: [{ ...chart.measurements[0], extra: 1 }] },
      { ...chart, unknown: 1 }, { ...chart, note: '<script>x</script>' },
    ];
    for (const value of bad) expect(parseGoodsSizeChart(value)).toBeNull();
  });
  it('enforces every limit and C0/C1 controls while allowing notes to have tabs', () => {
    const boundary = { unit: 'cm', sizes: Array.from({ length: 10 }, (_, i) => `크기${i}`), measurements: Array.from({ length: 10 }, (_, i) => ({ name: `항목${i}`, values: Array(10).fill('0.1') })), note: '😀'.repeat(500) };
    expect(parseGoodsSizeChart(boundary)).not.toBeNull();
    expect(parseGoodsSizeChart({ ...boundary, sizes: [...boundary.sizes, '추가'] })).toBeNull();
    expect(parseGoodsSizeChart({ ...boundary, measurements: [...boundary.measurements, boundary.measurements[0]] })).toBeNull();
    expect(parseGoodsSizeChart({ ...boundary, note: '😀'.repeat(501) })).toBeNull();
    for (const control of ['\x01', '\x7f', '\x85']) {
      expect(parseGoodsSizeName(`이름${control}`, 20)).toBeNull();
      expect(parseGoodsSizeChart({ ...chart, note: `메모${control}` })).toBeNull();
    }
  });
  it('allows the initial empty disabled state without treating a partial table as empty', () => {
    const initial = emptyGoodsSizeChartValues();
    expect(parseGoodsSizeChartValues(initial)).toEqual(initial);
    expect(parseGoodsSizeChartValues({ ...initial, enabled: true })).toBeNull();
    expect(parseGoodsSizeChartValues({ ...initial, chart: { ...initial.chart, sizes: ['단일'] } })).toBeNull();
    expect(parseGoodsSizeChartValues({ enabled: false, chart })).toEqual({ enabled: false, chart });
  });
  it('validates revision zero and hides template metadata from the chart contract', () => {
    const snapshot = { goodId: 'synthetic-chart', goodName: '합성 상품', values: emptyGoodsSizeChartValues(), revision: 0, updatedAt: null };
    expect(parseGoodsSizeChartSnapshot(snapshot)).toEqual(snapshot);
    expect(parseGoodsSizeChartSnapshot({ ...snapshot, values: { enabled: true, chart } })).toBeNull();
    expect(parseGoodsSizeChartSnapshot({ ...snapshot, revision: 1 })).toBeNull();
    expect(parseGoodsSizeTemplate(template)).toEqual(template);
    expect(parseGoodsSizeTemplate({ ...template, chart: emptyGoodsSizeChartValues().chart })).toBeNull();
    expect(parseGoodsSizeTemplate({ ...template, name: '😀'.repeat(50) })).not.toBeNull();
    expect(parseGoodsSizeTemplate({ ...template, name: '😀'.repeat(51) })).toBeNull();
    expect(parseGoodsSizeTemplatePage({ rows: [template, template], total: 2, page: 1, pageSize: 20 })).toBeNull();
  });
});
