import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

/* S9(#331)에서 editorial-shell / -public / -account-commerce 세 파일이 삭제됐다.
 * 여기 남은 계약은 "아직 이행되지 않은 표면"에 대한 것이다 —
 * HM 다크 어드민, 보존 전시 /about, legacy 3화면(/offline-popups·/offline-popups/[id]·/legal/[doc]).
 * 이행이 끝난 공개 표면의 계약은 app/wc-design.test.ts가 담당한다. */

const REMOVED_EDITORIAL_STYLESHEETS = [
  'editorial-shell.css',
  'editorial-public.css',
  'editorial-account-commerce.css',
  'editorial-home.css',
];

/* Holographic Midnight 스펙트럼 리터럴. 이행이 끝난 wc 표면에 이 값이 들어오면
 * White Catalog 팔레트가 조용히 다시 갈라진다(DESIGN.md §2). */
const HM_SPECTRUM_HEX = [
  '#8B5CFF',
  '#FF4D9D',
  '#2DE2FF',
  '#38F0C0',
  '#C6FF3D',
  '#FFB23D',
  '#08060F',
];

const WC_STYLESHEETS = [
  './styles/wc-foundation.css',
  './styles/wc-chrome.css',
  './styles/wc-home.css',
  './styles/wc-catalog.css',
  './styles/wc-discovery.css',
  './styles/wc-account-commerce.css',
  './styles/wc-campaign.css',
];

describe('Living IP Editorial global design wiring', () => {
  it('loads the surviving editorial layers in order and never re-imports the deleted ones', () => {
    const layout = read('./layout.tsx');

    /* globals(어드민 하부) → editorial-foundation(전역 element·토큰) → 어드민 →
     * White Catalog. legacy 사본 3종은 맨 뒤여야 원본과 동률인 캐스케이드가 재현된다. */
    const imports = [
      './styles/editorial-foundation.css',
      './styles/editorial-admin.css',
      './styles/admin-console.css',
      './styles/wc-foundation.css',
      './styles/about-legacy.css',
      './styles/offline-popups-legacy.css',
      './styles/legal-doc.css',
    ];
    let previous = layout.indexOf("'./globals.css'");
    for (const stylesheet of imports) {
      const index = layout.indexOf(`'${stylesheet}'`);
      expect(index).toBeGreaterThan(previous);
      previous = index;
    }

    /* 삭제된 파일을 되살리면 빌드가 깨지는 게 아니라, 되살린 사람이 그 안의 HM 값을
     * 공개 표면 위에 다시 얹게 된다. 임포트 자체를 막는다. */
    for (const stylesheet of REMOVED_EDITORIAL_STYLESHEETS) {
      expect(layout).not.toContain(stylesheet);
    }

    expect(layout).toContain('<CartProvider>');
    expect(layout).toContain('<AuthPresenceProvider>');
  });

  it('keeps the Holographic Midnight spectrum out of the White Catalog stylesheets', () => {
    /* S9의 목적은 "지워도 같아 보인다"가 아니라 "지운 뒤 HM이 되돌아오지 않는다"다.
     * wc 표면이 HM 리터럴이나 editorial 토큰을 직접 참조하면 legacy 제거가 무의미해진다.
     * (주석 안의 '--editorial-…' 언급은 이관 출처 기록이라 var() 참조만 검사한다.) */
    for (const stylesheet of WC_STYLESHEETS) {
      const css = read(stylesheet);

      for (const hex of HM_SPECTRUM_HEX) {
        expect(css.toLowerCase(), `${stylesheet} contains ${hex}`).not.toContain(hex.toLowerCase());
      }
      expect(css, `${stylesheet} references an editorial token`).not.toMatch(/var\(\s*--editorial-/);
    }
  });

  it('keeps the shrunken globals.css on the admin surface only', () => {
    /* globals.css는 S9 이후 "Tailwind·폰트 같은 진짜 전역 하부 + HM 다크 어드민"만 담는다.
     * 공개 표면 어휘가 다시 들어오면 전역 규칙 하나가 wc 지면을 통째로 흔든다. */
    const css = read('./globals.css');

    expect(css).toContain('@import "tailwindcss"');
    expect(css).toContain('.admin-shell');
    expect(css).toContain('.check-in-shell');
    /* 어드민이 대량으로 기대는 mono/display 서체 매핑 — next/font 변수 이름이 바뀌면 여기서 잡힌다. */
    expect(css).toContain('--font-mono:    var(--font-space-mono)');
    expect(css).toContain('--font-display: var(--font-space-grotesk)');

    for (const selector of [
      '.checkout-',
      '.cart-line',
      '.order-detail-',
      '.ticket-detail-',
      '.my-destination',
      '.bg-atmos',
      '.mobnav',
    ]) {
      expect(css, `globals.css still styles ${selector}`).not.toContain(selector);
    }
  });

  it('keeps both Holographic Midnight display faces loaded for the admin console', () => {
    /* 어드민은 `.mono`·`.admin-title`에서 Space Mono / Space Grotesk 에 그대로 기대고 있다.
     * S9는 어드민 시각 회귀 없음을 단언하므로 폰트 로드는 함께 남는다. */
    const layout = read('./layout.tsx');

    expect(layout).toContain('Space_Grotesk');
    expect(layout).toContain('Space_Mono');
    expect(layout).toContain('--font-space-grotesk');
    expect(layout).toContain('--font-space-mono');
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
    /* /offline-popups 는 스코프 루트에 background 를 두지 않고 이 body 밑색을 그대로 쓴다.
     * 이 선언이 사라지면 그 화면의 지면색이 흰색으로 바뀐다(wc-foundation 승격 보류 근거). */
    expect(css).toMatch(/body\s*\{[^}]*background:\s*var\(--editorial-canvas\)/);
  });

  it('defines readable typography tokens and Korean-aware wrapping rules', () => {
    const foundation = read('./styles/editorial-foundation.css');
    const aboutLegacy = read('./styles/about-legacy.css');

    expect(foundation).toContain('--editorial-leading-display: 1.08');
    expect(foundation).toContain('--editorial-leading-display-mobile: 1.12');
    expect(foundation).toContain('--editorial-leading-title: 1.2');
    expect(foundation).toContain('--editorial-leading-body: 1.65');
    expect(foundation).toContain('--editorial-leading-utility: 1.5');
    expect(foundation).toContain('--editorial-leading-control: 1.4');
    expect(foundation).toContain('--editorial-leading-wordmark: 1');
    expect(foundation).toContain('--editorial-tracking-display: -.03em');
    expect(foundation).toContain('--editorial-tracking-title: -.025em');
    /* `.h-xxl`·`.h-lg`는 S9에서 컨슈머가 사라져 목록에서 빠졌다. `:is()` 명시도는 최대
     * 인자 기준이라 `.h-xl`이 남아 있는 한 캐스케이드는 그대로다. */
    expect(foundation).toMatch(
      /:lang\(ko\):is\(h1, h2, h3, \.h-xl\)\s*\{[^}]*word-break:\s*keep-all;[^}]*line-break:\s*strict;[^}]*overflow-wrap:\s*normal;[^}]*text-wrap:\s*balance;/s,
    );
    expect(foundation).toMatch(
      /:lang\(ko\):is\(p, li, dd, blockquote\)\s*\{[^}]*word-break:\s*keep-all;[^}]*overflow-wrap:\s*break-word;/s,
    );
    expect(aboutLegacy).toMatch(/\.icons-preview\s*\{[^}]*font-family:\s*var\(--editorial-font-body\);[^}]*line-height:\s*var\(--editorial-leading-body\);/s);
  });

  it('does not use sub-single line heights in the surviving stylesheets', () => {
    /* 1 미만 행간은 한글 조합형 글자의 위아래를 잘라 먹는다. */
    const css = [
      read('./globals.css'),
      read('./styles/editorial-foundation.css'),
      read('./styles/editorial-admin.css'),
      read('./styles/admin-console.css'),
      read('./styles/about-legacy.css'),
      read('./styles/offline-popups-legacy.css'),
      read('./styles/legal-doc.css'),
    ].join('\n');

    expect(css).not.toMatch(/line-height:\s*(?:0?\.)\d+/);
  });

  it('stops CSS motion globally when reduced motion is requested', () => {
    const css = [
      read('./styles/editorial-foundation.css'),
      read('./styles/about-legacy.css'),
    ].join('\n');

    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toMatch(/scroll-behavior:\s*auto/);
    expect(css).toMatch(/animation-duration:\s*\.01ms/);
  });

  it('preserves the /about exhibition controls without the retired chrome', () => {
    const aboutLegacy = read('./styles/about-legacy.css');

    expect(aboutLegacy).toContain('.icons-preview .pause-button');
    expect(aboutLegacy).toContain('.icons-preview .hero-bullets button');
    // 자체 헤더·푸터는 전역 셸로 넘어갔다 — 이사한 파일에 크롬 잔재가 남으면 안 된다.
    expect(aboutLegacy).not.toContain('.site-header');
    expect(aboutLegacy).not.toContain('.site-footer');
    expect(aboutLegacy).not.toContain('.mobile-menu');
  });

  it('keeps the final CTA artwork at the source image ratio', () => {
    const aboutLegacy = read('./styles/about-legacy.css');

    expect(aboutLegacy).toMatch(/\.icons-preview \.final-orbit \.preview-artwork\s*\{[^}]*aspect-ratio:\s*4\s*\/\s*3/s);
  });

  it('does not suppress onboarding focus outlines with inline styles', () => {
    const onboarding = read('../components/screens/Onboarding.tsx');

    expect(onboarding).not.toContain("outline: 'none'");
  });
});
