/** Decimal arithmetic for provider statements. Values never pass through float sums. */
export function settlementDecimal(value: unknown, maximumWholeDigits = 18): string | null {
  if (typeof value !== 'string' || value.length > 80) return null;
  const match = /^(-?)(0|[1-9]\d*)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(value);
  if (!match) return null;
  const exponent = Number(match[4] ?? 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 30) return null;
  const digits = match[2] + (match[3] ?? '');
  const point = match[2].length + exponent;
  const expanded = point <= 0 ? `0.${'0'.repeat(-point)}${digits}`
    : point >= digits.length ? digits + '0'.repeat(point - digits.length)
      : `${digits.slice(0, point)}.${digits.slice(point)}`;
  const [wholeRaw, fractionRaw = ''] = expanded.split('.');
  const whole = wholeRaw.replace(/^0+(?=\d)/, '');
  const fraction = fractionRaw.replace(/0+$/, '');
  if (whole.length > maximumWholeDigits || fraction.length > 8) return null;
  const result = fraction ? `${whole}.${fraction}` : whole;
  return match[1] && result !== '0' ? `-${result}` : result;
}

const SCALE = BigInt(100_000_000);
const ZERO = BigInt(0);
function scaled(value: string): bigint {
  const normalized = settlementDecimal(value, 26);
  if (normalized === null) throw new Error('invalid_settlement_decimal');
  const negative = normalized.startsWith('-');
  const [whole, fraction = ''] = (negative ? normalized.slice(1) : normalized).split('.');
  const result = BigInt(whole) * SCALE + BigInt(fraction.padEnd(8, '0'));
  return negative ? -result : result;
}

export function addSettlementDecimals(values: readonly string[]): string {
  const sum = values.reduce((total, value) => total + scaled(value), ZERO);
  const magnitude = sum < ZERO ? -sum : sum;
  const fraction = String(magnitude % SCALE).padStart(8, '0').replace(/0+$/, '');
  return `${sum < ZERO ? '-' : ''}${magnitude / SCALE}${fraction ? `.${fraction}` : ''}`;
}

export function formatSettlementDecimal(value: string): string {
  const normalized = settlementDecimal(value, 26);
  if (normalized === null) return '확인 필요';
  const [whole, fraction] = normalized.split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${fraction ? `.${fraction}` : ''}`;
}
