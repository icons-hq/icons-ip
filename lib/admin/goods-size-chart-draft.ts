import { isUuid } from '@/lib/uuid';
import { parseGoodsSizeChart, parseGoodsSizeChartValues, type GoodsSizeChart, type GoodsSizeChartValues } from '@/lib/goods-size-chart';

export interface GoodsSizeSaveRequest { values: GoodsSizeChartValues; revision: number; operationId: string }
export interface GoodsSizeDraft { baseRevision: number; values: GoodsSizeChartValues; request: GoodsSizeSaveRequest | null }
export interface GoodsSizeTemplateRequest { id: string; name: string; chart: GoodsSizeChart; archived: boolean; revision: number; operationId: string }
export interface GoodsSizeTemplateDraft { baseRevision: number; name: string; chart: GoodsSizeChart; request: GoodsSizeTemplateRequest | null }
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const revision = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 0 && Number(value) < 2147483647;
const text = (value: unknown, maximum = 4096): value is string => typeof value === 'string' && value.length <= maximum;

/** Recovery keeps incomplete input; only a pending submitted request must pass the strict server contract. */
function editableChart(value: unknown): GoodsSizeChart | null {
  const data = object(value);
  if (!data || (data.unit !== 'cm' && data.unit !== 'mm') || !text(data.note, 20000) || !Array.isArray(data.sizes) || data.sizes.length > 10
    || !data.sizes.every(size => text(size)) || !Array.isArray(data.measurements) || data.measurements.length > 10) return null;
  const sizes = data.sizes as string[], measurements: GoodsSizeChart['measurements'] = [];
  for (const value of data.measurements) {
    const row = object(value);
    if (!row || !text(row.name) || !Array.isArray(row.values) || row.values.length !== sizes.length || !row.values.every(value => text(value, 32))) return null;
    measurements.push({ name: row.name, values: row.values as string[] });
  }
  return { unit: data.unit, sizes, measurements, note: data.note };
}

export function parseGoodsSizeDraft(value: unknown): GoodsSizeDraft | null {
  const data = object(value), values = object(data?.values), chart = editableChart(values?.chart);
  if (!data || !revision(data.baseRevision) || !values || typeof values.enabled !== 'boolean' || !chart) return null;
  let request: GoodsSizeSaveRequest | null = null;
  if (data.request !== null) {
    const source = object(data.request), savedValues = parseGoodsSizeChartValues(source?.values);
    if (!source || !savedValues || !revision(source.revision) || source.revision !== data.baseRevision || typeof source.operationId !== 'string' || !isUuid(source.operationId)) return null;
    request = { values: savedValues, revision: source.revision, operationId: source.operationId };
  }
  return { baseRevision: data.baseRevision, values: { enabled: values.enabled, chart }, request };
}

export function parseGoodsSizeTemplateDraft(value: unknown): GoodsSizeTemplateDraft | null {
  const data = object(value), chart = editableChart(data?.chart);
  if (!data || !chart || !revision(data.baseRevision) || !text(data.name)) return null;
  let request: GoodsSizeTemplateRequest | null = null;
  if (data.request !== null) {
    const source = object(data.request), savedChart = parseGoodsSizeChart(source?.chart);
    if (!source || !savedChart || !revision(source.revision) || source.revision !== data.baseRevision || !text(source.name, 200)
      || typeof source.archived !== 'boolean' || typeof source.id !== 'string' || !isUuid(source.id)
      || typeof source.operationId !== 'string' || !isUuid(source.operationId)) return null;
    request = { id: source.id, name: source.name, chart: savedChart, archived: source.archived, revision: source.revision, operationId: source.operationId };
  }
  return { baseRevision: data.baseRevision, name: data.name, chart, request };
}
