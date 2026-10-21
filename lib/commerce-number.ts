/** Display numbers are strings: 16 digits exceed Excel's exact numeric precision. */
export function isCommerceNumber(value: unknown, kind?: 'order' | 'item' | 'shipment'): boolean {
  const digit = kind ? { order: '1', item: '2', shipment: '3' }[kind] : '[123]';
  return typeof value === 'string' && new RegExp(`^[0-9]{8}${digit}[0-9]{7}$`).test(value);
}

/** Legacy fixtures/old receipts may omit the display number; never derive a new one from a UUID. */
export function commerceReferenceLabel(id: string, number?: string | null): string {
  return typeof number === 'string' && isCommerceNumber(number) ? number : isCommerceNumber(id) ? id : id.replaceAll('-', '').slice(-8).toUpperCase();
}
