import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const layout = readFileSync(new URL('./layout.tsx', import.meta.url), 'utf8');
const page = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');
const zonePage = readFileSync(new URL('./[zone]/page.tsx', import.meta.url), 'utf8');

describe('AOUAD popup route contract', () => {
  it('is noindex and has the same request-time Last Bell prototype gate on every route surface', () => {
    expect(layout).toContain('robots: { index: false, follow: false }');
    for (const source of [layout, page, zonePage]) {
      expect(source).toContain('await connection()');
      expect(source).toContain('isLastBellPrototypeEnabled()');
      expect(source).toContain('notFound()');
    }
  });

  it('uses Next 16 async params and fails closed for unknown zones', () => {
    expect(zonePage).toContain('params: Promise<{ zone: string }>');
    expect(zonePage).toContain('const { zone } = await params');
    expect(zonePage).toContain('if (!isAouadZoneId(zone)) notFound()');
  });
});
