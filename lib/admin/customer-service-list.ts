export const CUSTOMER_SERVICE_PAGE_SIZES = [20, 50, 100] as const;

export function customerServicePageSize(value: unknown): number {
  const size = typeof value === 'string' || typeof value === 'number' ? Number(value) : 0;
  return CUSTOMER_SERVICE_PAGE_SIZES.some((allowed) => allowed === size) ? size : 20;
}

export function customerServiceDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  if (Number(value.slice(0, 4)) < 1) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}
