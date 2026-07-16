import { describe, expect, it } from 'vitest';
import { hrefFor, isActive, isAuthShellPath } from './routes';

describe('ticket routes', () => {
  it('maps and activates the protected my-tickets surface', () => {
    expect(hrefFor('tickets')).toBe('/tickets');
    expect(isActive('tickets', '/tickets')).toBe(true);
    expect(isActive('tickets', '/tickets/5cbcbfed-202d-4676-821a-7706398e57c0')).toBe(true);
  });
});

describe('account routes', () => {
  it('maps and activates the protected my hub', () => {
    expect(hrefFor('my')).toBe('/my');
    expect(isActive('my', '/my')).toBe(true);
    expect(isActive('my', '/my/preferences')).toBe(true);
    expect(isActive('my', '/settings')).toBe(false);
  });

  it('maps and activates the protected notification inbox and settings surface', () => {
    expect(hrefFor('notifications')).toBe('/notifications');
    expect(isActive('notifications', '/notifications')).toBe(true);
    expect(isActive('notifications', '/notifications/settings')).toBe(true);
    expect(isActive('notifications', '/settings')).toBe(false);
  });
});

describe('isAuthShellPath', () => {
  it.each(['/login', '/update-password'])('treats %s as an auth-only shell', (pathname) => {
    expect(isAuthShellPath(pathname)).toBe(true);
  });

  it('does not hide the product shell on normal routes', () => {
    expect(isAuthShellPath('/community')).toBe(false);
  });
});
