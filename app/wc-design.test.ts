import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const WC_COMPONENT_DIR = new URL('../components/wc/', import.meta.url);

const readWcComponents = () =>
  readdirSync(WC_COMPONENT_DIR)
    .filter((entry) => entry.endsWith('.tsx'))
    .map((entry) => ({ entry, source: readFileSync(new URL(entry, WC_COMPONENT_DIR), 'utf8') }));

describe('White Catalog design wiring', () => {
  it('loads the White Catalog foundation after the legacy stylesheets', () => {
    /* 나중에 로드돼야 같은 특정성의 기존 규칙을 이길 수 있다. 순서가 뒤집히면 표면이 조용히 옛 스타일로 돌아간다. */
    const layout = read('./layout.tsx');

    expect(layout).toContain("'./styles/wc-foundation.css'");
    expect(layout.indexOf("'./styles/wc-foundation.css'")).toBeGreaterThan(
      layout.indexOf("'./styles/admin-console.css'"),
    );
  });

  it('defines the White Catalog palette tokens on the scoped root', () => {
    /* 토큰 값은 컴포넌트·표면이 공유하는 유일한 색 계약이라, 문자열이 어긋나면 표면마다 색이 갈라진다. */
    const css = read('./styles/wc-foundation.css');

    expect(css).toContain('--wc-surface: #FFFFFF');
    expect(css).toContain('--wc-ink: #111111');
    expect(css).toContain('--wc-ink-sub: #3F3F3F');
    expect(css).toContain('--wc-ink-tertiary: #616161');
    expect(css).toContain('--wc-ink-disabled: #BBBBBB');
    expect(css).toContain('--wc-hairline: #EBEDEE');
    expect(css).toContain('--wc-line-control: #C8CACC');
    expect(css).toContain('--wc-accent: #78BB53');
    expect(css).toContain('--wc-accent-tint: rgba(120,187,83,.12)');
    expect(css).toContain('--wc-danger: #B8324A');
    expect(css).toContain('--wc-focus: #5B74FF');
    expect(css).toContain('--wc-scrim: rgba(0,0,0,.3)');
    expect(css).toMatch(/\.wc-root\s*\{[^}]*background:\s*var\(--wc-surface\)/s);
  });

  it('never reuses the reference site accent pink', () => {
    /* 레퍼런스 사이트의 브랜드 액센트를 그대로 옮기면 디자인 도용이 된다. 값 자체를 저장소에서 막는다. */
    const sources = [read('./styles/wc-foundation.css'), ...readWcComponents().map(({ source }) => source)];

    for (const source of sources) {
      expect(source).not.toMatch(/#F83BAA/i);
      expect(source).not.toMatch(/#FD4BBB/i);
    }
  });

  it('scopes every foundation rule under a wc- class', () => {
    /* 전역 element 셀렉터를 쓰면 아직 이행되지 않은 editorial 표면과 어드민까지 함께 끌려간다. */
    const css = read('./styles/wc-foundation.css');

    expect(css).not.toMatch(/^\s*(?:html|body|:root|h[1-6]|a|p|ul|ol|button|input|\*)\s*[,{:]/m);
  });

  it('stops motion when reduced motion is requested', () => {
    /* 스켈레톤 펄스와 슬라이더 스무스 스크롤이 전정기관 민감 사용자에게 그대로 재생되면 안 된다. */
    const css = read('./styles/wc-foundation.css');

    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toMatch(/animation-duration:\s*\.01ms/);
    expect(css).toMatch(/scroll-behavior:\s*auto/);
  });

  it('keeps a visible focus ring inside the White Catalog scope', () => {
    /* 흰 지면은 대비가 약해서 브라우저 기본 아웃라인이 묻힌다. 키보드 이동 경로가 보이려면 명시 링이 필요하다. */
    const css = read('./styles/wc-foundation.css');

    expect(css).toMatch(/\.wc-root\s+:focus-visible\s*\{[^}]*outline:\s*2px\s+solid\s+var\(--wc-focus\)/s);
  });

  it('does not use sub-single line heights', () => {
    /* 1 미만 행간은 한글 조합형 글자의 위아래를 잘라 먹는다. */
    const css = read('./styles/wc-foundation.css');

    expect(css).not.toMatch(/line-height:\s*(?:0?\.)\d+/);
  });

  it('keeps the White Catalog tokens off the document root', () => {
    /* :root에 올리면 이행 전 표면까지 즉시 새 토큰을 받는다. 승격은 별도 단계에서 의도적으로 한다. */
    const css = read('./styles/wc-foundation.css');

    expect(css).not.toMatch(/:root\s*\{[^}]*--wc-/s);
  });
});

describe('White Catalog global chrome wiring', () => {
  it('loads the chrome layer after the White Catalog foundation', () => {
    /* 크롬 규칙은 파운데이션 토큰과 프리미티브 위에 얹힌다. 순서가 뒤집히면 같은 특정성에서 크롬이 먼저 밀린다. */
    const layout = read('./layout.tsx');

    expect(layout).toContain("'./styles/wc-chrome.css'");
    expect(layout.indexOf("'./styles/wc-chrome.css'")).toBeGreaterThan(
      layout.indexOf("'./styles/wc-foundation.css'"),
    );
  });

  it('keeps the chrome stylesheet scoped, rootless, and free of the reference accent', () => {
    /* 셸은 모든 라우트에 올라간다 — 전역 element 규칙 하나가 이행 전 표면과 어드민까지 통째로 끌고 간다. */
    const css = read('./styles/wc-chrome.css');

    expect(css).not.toMatch(/^\s*(?:html|body|:root|h[1-6]|a|p|ul|ol|button|input|\*)\s*[,{:]/m);
    expect(css).not.toMatch(/:root\s*\{[^}]*--wc-/s);
    expect(css).not.toMatch(/#F83BAA/i);
    expect(css).not.toMatch(/#FD4BBB/i);
    expect(css).not.toMatch(/line-height:\s*(?:0?\.)\d+/);
  });

  it('pins the sticky header above the rest of the chrome', () => {
    /* 헤더가 스크롤에 붙지 않으면 축약 애니메이션과 메가메뉴 앵커가 모두 의미를 잃는다.
     * z-index는 오버레이·바텀바와 겹치는 순서를 결정하는 계약값이다. */
    const css = read('./styles/wc-chrome.css');

    expect(css).toMatch(/\.wc-header\s*\{[^}]*position:\s*sticky/s);
    expect(css).toMatch(/\.wc-header\s*\{[^}]*z-index:\s*3/s);
  });

  it('never reuses the reference site accent pink in the new shell components', () => {
    /* 레퍼런스 사이트의 브랜드 액센트를 그대로 옮기면 디자인 도용이 된다. 값 자체를 저장소에서 막는다. */
    const sources = [
      '../components/shell/Nav.tsx',
      '../components/shell/SearchOverlay.tsx',
      '../components/shell/MenuSheet.tsx',
      '../components/shell/BottomTabBar.tsx',
      '../components/shell/SiteFooter.tsx',
    ].map(read);

    for (const source of sources) {
      expect(source).not.toMatch(/#F83BAA/i);
      expect(source).not.toMatch(/#FD4BBB/i);
    }
  });
});
