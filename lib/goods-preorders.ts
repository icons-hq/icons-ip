export interface GoodsVariantSupply {
  mode: 'stock' | 'preorder';
  availableQty: number;
  policyId: string | null;
  policyRevision: number | null;
  state: 'stock' | 'scheduled' | 'open' | 'closed' | 'stopped';
  startsAt: string | null;
  endsAt: string | null;
  expectedShipDate: string | null;
  calculatedAt: string;
  nextChangeAt: string | null;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function integer(value: unknown, minimum = 0): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= 2147483647;
}
function instant(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}
export function isGoodsShipDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
export function parseGoodsVariantSupply(value: unknown): GoodsVariantSupply | null {
  if (!object(value) || !['stock', 'preorder'].includes(String(value.mode)) || !integer(value.availableQty)
    || !instant(value.calculatedAt) || (value.nextChangeAt !== null && (!instant(value.nextChangeAt)
      || Date.parse(value.nextChangeAt) <= Date.parse(value.calculatedAt)))) return null;
  if (value.mode === 'stock') {
    if (value.state !== 'stock' || value.policyId !== null || value.policyRevision !== null
      || value.startsAt !== null || value.endsAt !== null || value.expectedShipDate !== null || value.nextChangeAt !== null) return null;
  } else {
    if (typeof value.policyId !== 'string' || !UUID.test(value.policyId) || !integer(value.policyRevision, 1)
      || !instant(value.startsAt) || !instant(value.endsAt) || Date.parse(value.startsAt) >= Date.parse(value.endsAt)
      || !isGoodsShipDate(value.expectedShipDate) || !['scheduled', 'open', 'closed', 'stopped'].includes(String(value.state))) return null;
    const now = Date.parse(value.calculatedAt);
    if ((value.state === 'scheduled' && now >= Date.parse(value.startsAt))
      || (value.state === 'open' && (now < Date.parse(value.startsAt) || now >= Date.parse(value.endsAt)))
      || (value.state === 'closed' && now < Date.parse(value.endsAt))
      || (value.state !== 'open' && value.availableQty !== 0)) return null;
  }
  return { mode: value.mode as GoodsVariantSupply['mode'], availableQty: value.availableQty,
    policyId: value.policyId as string | null, policyRevision: value.policyRevision as number | null,
    state: value.state as GoodsVariantSupply['state'], startsAt: value.startsAt as string | null, endsAt: value.endsAt as string | null,
    expectedShipDate: value.expectedShipDate as string | null, calculatedAt: value.calculatedAt, nextChangeAt: value.nextChangeAt as string | null };
}
export function preorderSupplyLabel(supply: GoodsVariantSupply | null | undefined): string | null {
  if (!supply || supply.mode === 'stock') return null;
  if (supply.state === 'open') return supply.availableQty > 0 ? '예약판매' : '예약 물량 마감';
  return { stock: null, scheduled: '예약 접수 예정', closed: '예약 접수 종료', stopped: '예약 접수 중지' }[supply.state];
}
export function preorderUnavailableLabel(options: readonly { stockQty: number; supply?: GoodsVariantSupply }[] | undefined, soldOut: boolean): string | null {
  if (!soldOut || !options?.length || !options.every((option) => option.supply?.mode === 'preorder')) return null;
  if (options.some((option) => option.stockQty > 0)) return '현재 주문을 받지 않습니다';
  if (options.some((option) => option.supply?.state === 'scheduled')) return '예약 접수 예정';
  if (options.some((option) => option.supply?.state === 'open')) return '예약 물량 마감';
  return options.every((option) => option.supply?.state === 'stopped') ? '예약 접수 중지' : '예약 접수 종료';
}
export function goodsShipDateLabel(date: string | null | undefined): string {
  return date && isGoodsShipDate(date) ? `${date.slice(0, 4)}년 ${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일 발송 예정` : '발송 예정일 확인 필요';
}
