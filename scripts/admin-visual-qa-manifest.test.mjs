import { describe, expect, it } from 'vitest';
import { ADMIN_SCREENS } from '../lib/admin/navigation';
import { ADMIN_QA_ROUTES } from './admin-visual-qa-manifest.mjs';

describe('admin visual QA coverage', () => {
  it('includes every ready navigation route in the default smoke run', () => {
    const covered = new Set(ADMIN_QA_ROUTES.map(route => route.path));
    const missing = ADMIN_SCREENS.filter(screen => screen.status === 'ready' && !covered.has(screen.href));
    expect(missing.map(screen => `${screen.label}: ${screen.href}`)).toEqual([]);
  });

  it('keeps route identities unique and exact headings nonempty', () => {
    expect(new Set(ADMIN_QA_ROUTES.map(route => route.id)).size).toBe(ADMIN_QA_ROUTES.length);
    expect(new Set(ADMIN_QA_ROUTES.map(route => route.path)).size).toBe(ADMIN_QA_ROUTES.length);
    for (const route of ADMIN_QA_ROUTES) {
      expect(route.heading.trim(), route.path).not.toBe('');
      expect(route.id, route.path).toMatch(/^[a-zA-Z0-9_-]+$/);
    }
  });

  it('matches shell page headings to the current navigation contract', () => {
    for (const screen of ADMIN_SCREENS.filter(screen => screen.status === 'ready' && screen.href !== '/admin/check-in')) {
      const route = ADMIN_QA_ROUTES.find(route => route.path === screen.href);
      expect(route?.heading, screen.href).toBe(screen.label);
    }
  });
});
