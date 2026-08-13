import 'server-only';

export function encodeCanonicalField(name: string, value: string): string {
  return `${name}:${Buffer.byteLength(value, 'utf8')}:${value}\n`;
}

export function isCanonicalUtcMillisecondTimestamp(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}
