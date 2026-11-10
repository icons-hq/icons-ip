import { isUuid } from '@/lib/uuid';

export const GOODS_SIZE_TEMPLATES_PATH = '/admin/catalog/size-templates';
export const GOODS_SIZE_LIMITS = { sizes: 10, measurements: 10, sizeName: 10, measurementName: 20, templateName: 50, note: 500 } as const;
export interface GoodsSizeChart { unit: 'cm' | 'mm'; sizes: string[]; measurements: { name: string; values: string[] }[]; note: string }
export interface GoodsSizeChartValues { enabled: boolean; chart: GoodsSizeChart }
export interface GoodsSizeChartSnapshot { goodId: string; goodName: string; values: GoodsSizeChartValues; revision: number; updatedAt: string | null }
export interface GoodsSizeTemplate { id: string; name: string; chart: GoodsSizeChart; revision: number; archived: boolean; createdAt: string; updatedAt: string }
export interface GoodsSizeTemplatePage { rows: GoodsSizeTemplate[]; total: number; page: number; pageSize: 20 }

export const emptyGoodsSizeChart = (): GoodsSizeChart => ({ unit: 'cm', sizes: [], measurements: [], note: '' });
export const emptyGoodsSizeChartValues = (): GoodsSizeChartValues => ({ enabled: false, chart: emptyGoodsSizeChart() });
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const exactKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const trim = (value: string) => value.replace(/^[ \n\r\t]+|[ \n\r\t]+$/g, '');
const controls = /[\x00-\x1f\x7f-\x9f<>]/;
const textLength = (value: string) => Array.from(value).length;
const validRevision = (value: unknown, minimum = 0): value is number => Number.isInteger(value) && Number(value) >= minimum && Number(value) <= 2147483647;
const validTime = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));

export function parseGoodsSizeName(value: unknown, maximum: number): string | null {
  if (typeof value !== 'string') return null;
  const name = trim(value);
  return textLength(name) >= 1 && textLength(name) <= maximum && !controls.test(name) ? name : null;
}

/** Exact decimal grammar shared with private.validate_goods_size_chart; never use parseFloat here. */
export function parseGoodsSizeNumber(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const number = trim(value);
  if (!/^(0|[1-9][0-9]{0,4})(\.[0-9])?$/.test(number)) return null;
  if (Number(number) < 0.1 || Number(number) > 99999) return null;
  return number.replace(/\.0$/, '');
}

export function parseGoodsSizeChart(value: unknown, allowEmpty = false): GoodsSizeChart | null {
  const data = object(value);
  if (!data || !exactKeys(data, ['unit', 'sizes', 'measurements', 'note']) || typeof data.unit !== 'string' || !['cm', 'mm'].includes(data.unit)
    || typeof data.note !== 'string' || !Array.isArray(data.sizes) || !Array.isArray(data.measurements)) return null;
  const note = trim(data.note.replace(/\r\n?/g, '\n'));
  if (textLength(note) > GOODS_SIZE_LIMITS.note || /[\x00-\x08\x0b-\x1f\x7f-\x9f<>]/.test(note)) return null;
  const unit = data.unit as 'cm' | 'mm';
  if (allowEmpty && data.sizes.length === 0 && data.measurements.length === 0 && note === '') return { unit, sizes: [], measurements: [], note };
  if (data.sizes.length < 1 || data.sizes.length > GOODS_SIZE_LIMITS.sizes || data.measurements.length < 1 || data.measurements.length > GOODS_SIZE_LIMITS.measurements) return null;
  const sizes = data.sizes.map(size => parseGoodsSizeName(size, GOODS_SIZE_LIMITS.sizeName));
  if (sizes.some(size => size === null) || new Set(sizes).size !== sizes.length) return null;
  const measurements: GoodsSizeChart['measurements'] = [];
  for (const entry of data.measurements) {
    const row = object(entry), name = parseGoodsSizeName(row?.name, GOODS_SIZE_LIMITS.measurementName);
    if (!row || !exactKeys(row, ['name', 'values']) || name === null || !Array.isArray(row.values) || row.values.length !== sizes.length) return null;
    const values = row.values.map(parseGoodsSizeNumber);
    if (values.some(cell => cell === null) || measurements.some(measurement => measurement.name === name)) return null;
    measurements.push({ name, values: values as string[] });
  }
  return { unit, sizes: sizes as string[], measurements, note };
}

export function parseGoodsSizeChartValues(value: unknown): GoodsSizeChartValues | null {
  const data = object(value);
  if (!data || !exactKeys(data, ['enabled', 'chart']) || typeof data.enabled !== 'boolean') return null;
  const chart = parseGoodsSizeChart(data.chart, !data.enabled);
  return chart ? { enabled: data.enabled, chart } : null;
}

export function parseGoodsSizeChartSnapshot(value: unknown): GoodsSizeChartSnapshot | null {
  const data = object(value), values = parseGoodsSizeChartValues(data?.values);
  if (!data || !values || typeof data.goodId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,199}$/.test(data.goodId)
    || typeof data.goodName !== 'string' || !validRevision(data.revision)
    || !(data.updatedAt === null || validTime(data.updatedAt))
    || (data.revision === 0 && (data.updatedAt !== null || JSON.stringify(values) !== JSON.stringify(emptyGoodsSizeChartValues())))
    || (data.revision > 0 && data.updatedAt === null)) return null;
  return { goodId: data.goodId, goodName: data.goodName, values, revision: data.revision, updatedAt: data.updatedAt as string | null };
}

export function parseGoodsSizeTemplate(value: unknown): GoodsSizeTemplate | null {
  const data = object(value), chart = parseGoodsSizeChart(data?.chart), name = parseGoodsSizeName(data?.name, GOODS_SIZE_LIMITS.templateName);
  if (!data || !chart || !name || typeof data.id !== 'string' || !isUuid(data.id) || !validRevision(data.revision, 1)
    || typeof data.archived !== 'boolean' || !validTime(data.createdAt) || !validTime(data.updatedAt)) return null;
  return { id: data.id, name, chart, revision: data.revision, archived: data.archived, createdAt: data.createdAt, updatedAt: data.updatedAt };
}

export function parseGoodsSizeTemplatePage(value: unknown): GoodsSizeTemplatePage | null {
  const data = object(value);
  if (!data || !Array.isArray(data.rows) || data.rows.length > 20 || data.pageSize !== 20 || !Number.isSafeInteger(data.total) || Number(data.total) < 0
    || !Number.isSafeInteger(data.page) || Number(data.page) < 1 || Number(data.page) > 100000) return null;
  const rows = data.rows.map(parseGoodsSizeTemplate);
  if (rows.some(row => row === null) || new Set(rows.map(row => row?.id)).size !== rows.length || data.rows.length > Number(data.total)) return null;
  return { rows: rows as GoodsSizeTemplate[], total: Number(data.total), page: Number(data.page), pageSize: 20 };
}

export function goodsSizeChartError(message?: string): string {
  if (message === 'operation_conflict') return '같은 저장 요청의 계정 또는 입력이 달라졌습니다. 현재 저장본을 확인해주세요.';
  if (message === 'goods_size_chart_changed' || message === 'goods_size_template_changed') return '다른 저장 결과가 있습니다. 작성한 표는 유지했습니다. 최신 저장본을 확인해주세요.';
  if (message === 'goods_size_chart_cannot_clear') return '저장된 표를 빈 표로 지울 수 없습니다. 설정안함으로 바꾸면 표를 보존하고 공개 표시를 중지합니다.';
  if (message === 'good_not_found') return '상품을 찾을 수 없거나 보관된 상품입니다. 상품 목록에서 현재 상태를 확인해주세요.';
  if (message === 'operator_capability_required') return '현재 상품 관리 권한을 확인해주세요.';
  return '사이즈·측정 항목과 모든 치수를 확인해주세요. 치수는 0.1~99,999, 소수 한 자리까지 입력할 수 있습니다.';
}
