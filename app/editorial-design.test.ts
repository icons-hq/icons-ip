import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import postcss from 'postcss';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const retained = ['about-legacy.css', 'offline-popups-legacy.css', 'legal-doc.css'];

/** Historical filename retained for ADR links; no shared editorial cascade survives #433. */
describe('retained public surface boundaries after admin cutover', () => {
  it('never revives a retired shared editorial layer', () => {
    for (const file of ['editorial-shell.css', 'editorial-public.css', 'editorial-account-commerce.css', 'editorial-home.css', 'editorial-foundation.css', 'editorial-admin.css', 'admin-console.css']) {
      expect(existsSync(new URL(`./styles/${file}`, import.meta.url)), file).toBe(false);
      expect(read('./layout.tsx')).not.toContain(`'./styles/${file}'`);
    }
    expect(read('./layout.tsx')).toContain('<CartProvider>');
    expect(read('./layout.tsx')).toContain('<AuthPresenceProvider>');
  });

  it('keeps retained surfaces after the WC foundation without styling the admin', () => {
    const layout = read('./layout.tsx');
    for (const file of retained) {
      expect(layout.indexOf(`'./styles/${file}'`)).toBeGreaterThan(layout.indexOf("'./styles/wc-foundation.css'"));
      postcss.parse(read(`./styles/${file}`)).walkRules((rule) => expect(rule.selector).not.toMatch(/\.admin-|\.wc-admin|\.check-in-/));
    }
  });

  it('defines all editorial variables locally instead of inheriting from document root', () => {
    for (const file of retained) {
      const css = read(`./styles/${file}`);
      const definitions = new Set<string>();
      const refs = new Set<string>();
      const ast = postcss.parse(css);
      ast.walkDecls((decl) => {
        if (decl.prop.startsWith('--')) definitions.add(decl.prop);
        for (const match of decl.value.matchAll(/var\(\s*(--editorial-[\w-]+)/g)) refs.add(match[1]);
      });
      for (const ref of refs) expect(definitions.has(ref), `${file}: ${ref}`).toBe(true);
      expect(css).toMatch(/background:\s*var\(--(?:paper|editorial-canvas)\)/);
      expect(css).not.toMatch(/line-height:\s*(?:0?\.)\d+/);
    }
  });

  it('preserves Korean wrapping, focus and global reduced-motion support', () => {
    for (const file of retained) expect(read(`./styles/${file}`)).toContain('word-break: keep-all');
    const globals = read('./globals.css');
    expect(globals).toContain('@media (prefers-reduced-motion: reduce)');
    expect(globals).toMatch(/animation-duration:\s*\.01ms/);
    expect(globals).toMatch(/scroll-behavior:\s*auto/);
    expect(read('./styles/wc-foundation.css')).toMatch(/\.wc-root\s+:focus-visible\s*\{[^}]*outline:\s*2px\s+solid\s+var\(--wc-focus\)/s);
  });

  it('preserves the about exhibition and its independent material fonts', () => {
    const about = read('./styles/about-legacy.css');
    expect(about).toContain('.icons-preview .pause-button');
    expect(about).toContain('.icons-preview .hero-bullets button');
    expect(about).toMatch(/\.icons-preview \.final-orbit \.preview-artwork\s*\{[^}]*aspect-ratio:\s*4\s*\/\s*3/s);
    for (const obsolete of ['.site-header', '.site-footer', '.mobile-menu']) expect(about).not.toContain(obsolete);
    for (const font of ['--font-space-grotesk', '--font-space-mono']) expect(read('./layout.tsx')).toContain(font);
  });

  it('preserves the approved game HUD fonts and focus without the shared foundation', () => {
    const css = read('../components/games/hyosan-memories/HyosanMemories.module.css');
    expect(css).not.toMatch(/var\(--editorial-/);
    expect(css).toContain("--hyosan-font-utility: var(--font-space-mono), 'Pretendard', monospace");
    expect(css).toContain('--hyosan-focus: #5b74ff');
    expect(css).toContain('outline: 2px solid var(--hyosan-focus)');
  });

  it('keeps material effects independent of retired theme variables', () => {
    for (const file of ['../lib/rarity.ts', '../lib/ip-display.ts', '../lib/community.server.ts', '../components/screens/CardPacks.tsx', '../components/games/MarbleRoulette.tsx']) expect(read(file)).not.toMatch(/var\(--(?:holo|text|editorial-)/);
    expect(read('../components/screens/Onboarding.tsx')).not.toContain("outline: 'none'");
  });
});
