import { describe, expect, it } from 'vitest';
import { hrefFor, isActive } from './routes';

describe('ticket routes', () => {
  it('maps and activates the protected my-tickets surface', () => {
    expect(hrefFor('tickets')).toBe('/tickets');
    expect(isActive('tickets', '/tickets')).toBe(true);
    expect(isActive('tickets', '/tickets/5cbcbfed-202d-4676-821a-7706398e57c0')).toBe(true);
  });
});
