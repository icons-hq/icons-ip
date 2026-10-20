import { describe, expect, it } from 'vitest';
import { isSameOriginRequest } from './same-origin.server';

const request = (values: Record<string, string> = {}) => new Request('http://localhost:4334/api/orders/fixture/cancel', {
  method: 'POST', headers: { host: '127.0.0.1:4334', origin: 'http://127.0.0.1:4334', ...values },
});
describe('same-origin financial requests', () => {
  it('uses the browser host and port when Next normalizes its internal hostname', () => {
    expect(isSameOriginRequest(request())).toBe(true);
    expect(isSameOriginRequest(new Request('https://internal.local/action', { headers: { host: 'icons.test', origin: 'https://icons.test' } }))).toBe(true);
  });
  it.each<Record<string, string>>([
    { origin: 'http://other.test:4334' }, { origin: 'http://127.0.0.1:4335' }, { origin: 'https://127.0.0.1:4334' },
    { origin: 'null' }, { origin: 'http://127.0.0.1:4334/path' }, { 'sec-fetch-site': 'cross-site' },
    { host: 'evil.test', 'x-forwarded-host': '127.0.0.1:4334' }, { host: '127.0.0.1:4334/evil' },
    { host: 'user@127.0.0.1:4334' }, { host: '127.0.0.1:4334?query' }, { host: '127.0.0.1:4334#fragment' },
    { host: '127.0.0.1:4334,other.test' }, { host: '127.0.0.1 :4334' }, { host: '%31%32%37.0.0.1:4334' },
  ])('rejects mismatched origin, protocol, port, cross-site or malformed Host: %j', values => {
    expect(isSameOriginRequest(request(values))).toBe(false);
  });
  it.each(['host', 'origin'])('rejects missing %s even when forwarded values claim the expected origin', name => {
    const input = request({ 'x-forwarded-host': '127.0.0.1:4334', 'x-forwarded-proto': 'http' }); input.headers.delete(name);
    expect(isSameOriginRequest(input)).toBe(false);
  });
  it('does not let forwarded headers alter the checked browser origin', () => {
    expect(isSameOriginRequest(request({ 'x-forwarded-host': 'evil.test', 'x-forwarded-proto': 'https' }))).toBe(true);
  });
});
