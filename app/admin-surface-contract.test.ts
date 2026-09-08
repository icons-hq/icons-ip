import { existsSync, readFileSync } from 'node:fs';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const retired = ['editorial-foundation.css', 'editorial-admin.css', 'admin-console.css'];

describe('complete admin WC cutover (#433)', () => {
  it('retires the shared editorial cascade and global admin selectors', () => {
    for (const file of retired) {
      expect(existsSync(new URL(`./styles/${file}`, import.meta.url)), file).toBe(false);
      expect(read('./layout.tsx')).not.toContain(`'./styles/${file}'`);
    }
    const globals = postcss.parse(read('./globals.css'));
    globals.walkRules((rule) => expect(rule.selector).not.toMatch(/\.admin-|\.check-in-|\.wc-admin/));
    globals.walkDecls((decl) => expect(decl.value).not.toMatch(/var\(--editorial-|#8b5cff|#ff4d9d|#08060f/i));
    expect(read('./globals.css')).toContain('@import "tailwindcss"');
    expect(read('./globals.css')).toMatch(/#root\s*\{[^}]*position:\s*relative;[^}]*z-index:\s*1;/s);
  });

  it('scopes nested surface rules and resolves only WC tokens', () => {
    const source = read('./styles/wc-admin-surfaces.css');
    const ast = postcss.parse(source);
    const foundation = postcss.parse(read('./styles/wc-foundation.css'));
    const tokens = new Set<string>();
    foundation.walkDecls((decl) => { if (decl.prop.startsWith('--wc-')) tokens.add(decl.prop); });
    ast.walkRules((rule) => {
      if (rule.parent?.type === 'atrule' && rule.parent.name.endsWith('keyframes')) return;
      for (const selector of rule.selectors) expect(selector.trim()).toMatch(/^\.wc-admin(?:\b|[.\s:#])/);
    });
    ast.walkDecls((decl) => {
      for (const match of decl.value.matchAll(/var\(\s*(--[\w-]+)/g)) expect(tokens.has(match[1]), `${decl.prop}: ${match[1]}`).toBe(true);
      expect(decl.value).not.toMatch(/#[\da-f]{3,8}\b|rgba?\(|hsla?\(/i);
    });
    expect(source).toContain('@media (forced-colors: active)');
    expect(source).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('keeps every major workbench layout and the independent check-in in scope', () => {
    const css = read('./styles/wc-admin-surfaces.css');
    for (const selector of ['.admin-master-detail', '.admin-form-grid', '.admin-console-grid', '.admin-order-master-detail', '.admin-notification-layout', '.admin-guide-doc', '.check-in-grid']) expect(css).toContain(selector);
    expect(read('../components/admin/check-in/TicketCheckIn.tsx')).toContain('check-in-shell wc-root wc-admin');
  });
});
