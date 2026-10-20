/** Read-only bridge: an authorized isolated SQL runner supplies captured JSON.
 * No database, Auth, browser, shell or application server is contacted here. */
import { readFileSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { aggregateCartVariantQuantities } from '@/lib/cart';
import { parseShippingQuoteItems, type ShippingQuoteItem } from '@/lib/fulfillment';
import { parseGoodsSalesPrecheckoutQuote, parseGoodsSalesQuote } from '@/lib/goods-sales';
import { parseAddressGoodsSalesQuote } from '@/lib/shipping-regions';
import { loadGoodsSalesPrecheckoutQuote } from '@/lib/goods-sales.server';
import { quoteGoodsSalesPrecheckoutAction } from '@/app/cart/sales-actions';

const transport = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: () => ({ rpc: transport.rpc }) }));
const KINDS = ['grouped_fixed_repeat', 'family_owner_child', 'preorder_period'] as const;
interface Capture { kind: typeof KINDS[number]; items: ShippingQuoteItem[]; value: unknown }
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

function readCaptures(path: string | undefined): Capture[] {
  if (!path || !isAbsolute(path)) throw new Error('GOODS_SALES_PRECHECKOUT_DTO_FILE must name an absolute isolated SQL capture path');
  const info = statSync(path);
  if (!info.isFile() || info.size < 1 || info.size > 20 * 1024 * 1024) throw new Error('goods_sales_precheckout_capture_file_invalid');
  const text = readFileSync(path, 'utf8'), prefix = 'GOODS_SALES_PRECHECKOUT_DTO:';
  let raw: unknown;
  try { raw = JSON.parse(text); } catch {
    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(line => line.startsWith(prefix));
    if (!lines.length) throw new Error('goods_sales_precheckout_capture_markers_missing');
    raw = lines.map(line => JSON.parse(line.slice(prefix.length)) as unknown);
  }
  if (!Array.isArray(raw) || raw.length !== KINDS.length) throw new Error('goods_sales_precheckout_capture_count_invalid');
  const seen = new Set<string>();
  const captures: Capture[] = [];
  for (const row of raw) {
    if (!object(row) || Object.keys(row).sort().join(',') !== 'items,kind,value'
      || !KINDS.includes(row.kind as Capture['kind']) || seen.has(String(row.kind))) throw new Error('goods_sales_precheckout_capture_kind_invalid');
    const items = parseShippingQuoteItems(row.items);
    if (!items?.length) throw new Error('goods_sales_precheckout_capture_items_invalid');
    seen.add(String(row.kind)); captures.push({ kind: row.kind as Capture['kind'], items, value: row.value });
  }
  if (KINDS.some(kind => !seen.has(kind))) throw new Error('goods_sales_precheckout_capture_kind_missing');
  return captures;
}
const captures = readCaptures(process.env.GOODS_SALES_PRECHECKOUT_DTO_FILE);
beforeEach(() => transport.rpc.mockReset());

describe('actual SQL precheckout payloads -> application contracts', () => {
  it.each(captures)('parses $kind without dropping fields or admitting a legacy shipping amount', capture => {
    const quote = parseGoodsSalesPrecheckoutQuote(capture.value);
    expect(quote).toEqual(capture.value);
    if (!quote) throw new Error('goods_sales_precheckout_capture_contract_invalid');
    expect(quote.shipping).toEqual({ status: 'checkout_required' });
    expect(Object.hasOwn(quote, 'coupon')).toBe(false);
    expect(parseGoodsSalesQuote(capture.value)).toBeNull();
    expect(parseAddressGoodsSalesQuote(capture.value)).toBeNull();
    const identities = (items: ShippingQuoteItem[]) => items.map(({ goodId, variantId, qty }) => `${goodId}:${variantId}:${qty}`).sort();
    expect(identities(quote.lines)).toEqual(identities(aggregateCartVariantQuantities(capture.items)));
    expect(quote.lines.every(line => line.supply !== undefined)).toBe(true);
    if (capture.kind === 'preorder_period') {
      expect(quote.lines.some(line => line.supply?.mode === 'preorder')).toBe(true);
      expect(quote.lines.some(line => line.pricePeriodId !== null)).toBe(true);
      expect(quote.nextChangeAt).not.toBeNull();
    } else expect(quote.lines.length).toBeGreaterThanOrEqual(2);
  });
  it.each(captures)('passes $kind through the production loader with a mocked transport', async capture => {
    transport.rpc.mockResolvedValueOnce({ data: capture.value, error: null });
    expect(await loadGoodsSalesPrecheckoutQuote(capture.items)).toEqual(capture.value);
    expect(transport.rpc).toHaveBeenCalledExactlyOnceWith('quote_goods_sales_precheckout', { items: capture.items });
  });
  it.each(captures)('passes $kind through the public server action without a legacy fallback', async capture => {
    transport.rpc.mockResolvedValueOnce({ data: capture.value, error: null });
    expect(await quoteGoodsSalesPrecheckoutAction(capture.items)).toEqual({ ok: true, quote: capture.value });
    expect(transport.rpc).toHaveBeenCalledExactlyOnceWith('quote_goods_sales_precheckout', { items: capture.items });
  });
});
