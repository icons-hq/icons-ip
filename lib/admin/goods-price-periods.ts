export type GoodsPricePeriodState = 'draft' | 'active' | 'disabled';
export interface GoodsPricePeriodInput {
  state: GoodsPricePeriodState;
  discountPrice: number | null;
  startsAt: string | null;
  endsAt: string | null;
}
export interface AdminGoodsPricePeriod extends GoodsPricePeriodInput {
  id: string;
  goodId: string;
  variantId: string;
  regularPrice: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
}
function validCalendar(value: string): boolean {
  const [year, month, day, hour, minute, second = 0] = value.slice(0, 19).split(/[-T:]/).map(Number);
  return year >= 1 && year <= 9999 && month >= 1 && month <= 12 && day >= 1
    && day <= new Date(Date.UTC(year, month, 0)).getUTCDate()
    && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 && second >= 0 && second <= 59;
}
function instant(value: unknown): string | null | false {
  if (value === null || value === '' || value === undefined) return null;
  if (typeof value !== 'string') return false;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    if (!validCalendar(value)) return false;
    const milliseconds = Date.parse(`${value}:00+09:00`);
    return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : false;
  }
  // Preserve PostgreSQL microseconds when an immutable offer is stopped. Converting
  // every stored instant through JS Date would silently alter its original bounds.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    || !validCalendar(value) || !Number.isFinite(Date.parse(value))) return false;
  return value;
}

export function toKstDateTimeInput(value: string | null): string {
  if (!value) return '';
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds + 9 * 60 * 60 * 1000).toISOString().slice(0, 16) : '';
}

export function parseGoodsPricePeriodInput(value: unknown): GoodsPricePeriodInput | null {
  if (!object(value) || Object.keys(value).some((key) => !['state', 'discountPrice', 'startsAt', 'endsAt'].includes(key))
    || !['draft', 'active', 'disabled'].includes(String(value.state))) return null;
  let discountPrice: number | null = null;
  if (value.discountPrice !== '' && value.discountPrice !== null && value.discountPrice !== undefined) {
    if (typeof value.discountPrice !== 'number' && (typeof value.discountPrice !== 'string' || !/^[1-9]\d*$/.test(value.discountPrice))) return null;
    const number = Number(value.discountPrice);
    if (!positive(number)) return null;
    discountPrice = number;
  }
  const startsAt = instant(value.startsAt);
  const endsAt = instant(value.endsAt);
  if (startsAt === false || endsAt === false || (startsAt && endsAt && Date.parse(startsAt) >= Date.parse(endsAt))) return null;
  if (value.state === 'active' && (discountPrice === null || startsAt === null || endsAt === null)) return null;
  return { state: value.state as GoodsPricePeriodState, discountPrice, startsAt, endsAt };
}

export function parseAdminGoodsPricePeriods(value: unknown): AdminGoodsPricePeriod[] | null {
  if (!Array.isArray(value)) return null;
  const result: AdminGoodsPricePeriod[] = [];
  for (const row of value) {
    if (!object(row) || typeof row.id !== 'string' || !UUID.test(row.id)
      || typeof row.goodId !== 'string' || !row.goodId || typeof row.variantId !== 'string' || !UUID.test(row.variantId)
      || typeof row.regularPrice !== 'number' || !Number.isSafeInteger(row.regularPrice) || row.regularPrice < 0 || row.regularPrice > 2147483647
      || !positive(row.revision)
      || typeof row.createdAt !== 'string' || !Number.isFinite(Date.parse(row.createdAt))
      || typeof row.updatedAt !== 'string' || !Number.isFinite(Date.parse(row.updatedAt))) return null;
    const input = parseGoodsPricePeriodInput({ state: row.state, discountPrice: row.discountPrice, startsAt: row.startsAt, endsAt: row.endsAt });
    if (!input || (input.discountPrice !== null && input.discountPrice >= row.regularPrice)) return null;
    result.push({ id: row.id, goodId: row.goodId, variantId: row.variantId, regularPrice: row.regularPrice,
      revision: row.revision, createdAt: row.createdAt, updatedAt: row.updatedAt, ...input });
  }
  return result;
}
