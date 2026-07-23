import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('Living IP Editorial global design wiring', () => {
  it('loads ordered, domain-scoped editorial styles from the root layout', () => {
    const layout = read('./layout.tsx');

    const imports = [
      './styles/editorial-foundation.css',
      './styles/editorial-shell.css',
      './styles/editorial-home.css',
      './styles/editorial-public.css',
      './styles/editorial-account-commerce.css',
      './styles/editorial-admin.css',
    ];
    let previous = layout.indexOf("'./globals.css'");
    for (const stylesheet of imports) {
      const index = layout.indexOf(`'${stylesheet}'`);
      expect(index).toBeGreaterThan(previous);
      previous = index;
    }

    expect(layout).not.toContain('<Atmos />');
    expect(layout).not.toContain('<MobNav />');
    expect(layout).toContain('<CartProvider>');
    expect(layout).toContain('<AuthPresenceProvider>');
  });

  it('defines the approved semantic palette without reusing legacy spectrum names', () => {
    const css = read('./styles/editorial-foundation.css');

    expect(css).toContain('--editorial-canvas: #f4f4f1');
    expect(css).toContain('--editorial-ink: #11110f');
    expect(css).toContain('--editorial-pastel-green: #c4e5ae');
    expect(css).toContain('--editorial-pastel-pink: #ffdaff');
    expect(css).toContain('--editorial-pastel-blue: #a6c5e6');
    expect(css).toContain('--editorial-pastel-yellow: #ffe888');
    expect(css).toContain('--editorial-focus: #5b74ff');
    expect(css).toMatch(/body\s*\{[^}]*background:\s*var\(--editorial-canvas\)/);
  });

  it('defines readable typography tokens and Korean-aware wrapping rules', () => {
    const foundation = read('./styles/editorial-foundation.css');
    const home = read('./styles/editorial-home.css');

    expect(foundation).toContain('--editorial-leading-display: 1.08');
    expect(foundation).toContain('--editorial-leading-display-mobile: 1.12');
    expect(foundation).toContain('--editorial-leading-title: 1.2');
    expect(foundation).toContain('--editorial-leading-body: 1.65');
    expect(foundation).toContain('--editorial-leading-utility: 1.5');
    expect(foundation).toContain('--editorial-leading-control: 1.4');
    expect(foundation).toContain('--editorial-leading-wordmark: 1');
    expect(foundation).toContain('--editorial-tracking-display: -.03em');
    expect(foundation).toContain('--editorial-tracking-title: -.025em');
    expect(foundation).toMatch(
      /:lang\(ko\):is\(h1, h2, h3, \.h-xxl, \.h-xl, \.h-lg\)\s*\{[^}]*word-break:\s*keep-all;[^}]*line-break:\s*strict;[^}]*overflow-wrap:\s*normal;[^}]*text-wrap:\s*balance;/s,
    );
    expect(foundation).toMatch(
      /:lang\(ko\):is\(p, li, dd, blockquote\)\s*\{[^}]*word-break:\s*keep-all;[^}]*overflow-wrap:\s*break-word;/s,
    );
    expect(home).toMatch(/\.icons-preview\s*\{[^}]*font-family:\s*var\(--editorial-font-body\);[^}]*line-height:\s*var\(--editorial-leading-body\);/s);
  });

  it('does not use sub-single line heights in editorial styles', () => {
    const css = [
      read('./styles/editorial-foundation.css'),
      read('./styles/editorial-shell.css'),
      read('./styles/editorial-home.css'),
      read('./styles/editorial-public.css'),
      read('./styles/editorial-account-commerce.css'),
      read('./styles/editorial-admin.css'),
      read('./globals.css'),
    ].join('\n');

    expect(css).not.toMatch(/line-height:\s*(?:0?\.)\d+/);
  });

  it('stops CSS motion globally when reduced motion is requested', () => {
    const css = [
      read('./styles/editorial-foundation.css'),
      read('./styles/editorial-shell.css'),
      read('./styles/editorial-home.css'),
    ].join('\n');

    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toMatch(/scroll-behavior:\s*auto/);
    expect(css).toMatch(/animation-duration:\s*\.01ms/);
  });

  it('keeps non-home navigation keyboard-visible and preserves the preview controls', () => {
    const shell = read('./styles/editorial-shell.css');
    const home = read('./styles/editorial-home.css');

    expect(shell).toMatch(/\.editorial-header\[data-hidden='true'\]:focus-within/);
    expect(home).toContain('.icons-preview .site-header');
    expect(home).toContain('.icons-preview .pause-button');
    expect(home).toContain('.icons-preview .hero-bullets button');
    expect(home).toContain('.icons-preview .mobile-menu--open');
  });

  it('keeps the final CTA artwork at the source image ratio', () => {
    const home = read('./styles/editorial-home.css');

    expect(home).toMatch(/\.icons-preview \.final-orbit \.preview-artwork\s*\{[^}]*aspect-ratio:\s*4\s*\/\s*3/s);
  });

  it('does not suppress onboarding focus outlines with inline styles', () => {
    const onboarding = read('../components/screens/Onboarding.tsx');

    expect(onboarding).not.toContain("outline: 'none'");
  });
});
