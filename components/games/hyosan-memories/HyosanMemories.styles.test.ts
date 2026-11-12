import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./HyosanMemories.module.css', import.meta.url), 'utf8');

describe('Hyosan access gate styles', () => {
  it('keeps the title legible when global editorial heading styles are loaded', () => {
    const surfaceRule = css.match(/\.game,\s*\.loading,\s*\.accessGate\s*\{([^}]*)\}/)?.[1];
    const titleRule = css.match(/\.accessGate h1\s*\{([^}]*)\}/)?.[1];

    expect(surfaceRule).toMatch(/color:\s*#eef5f1\s*;/);
    expect(titleRule).toBeDefined();
    expect(titleRule).toMatch(/color:\s*inherit\s*;/);
  });
});

/* 1014-X36 — 휠·터치가 문서로 내려가야 푸터에 닿는다. 안내·로딩 화면은 가두지 않고, 플레이 화면은 조작 때문에 가둔 채 링크로 푸터에 보낸다. */
describe('Hyosan 화면의 푸터 접근', () => {
  it('로딩·비로그인 안내 화면은 높이·스크롤·터치를 가두지 않는다', () => {
    const rule = css.match(/\*\/\n\.loading,\s*\.accessGate\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toMatch(/height:\s*auto\s*;/);
    expect(rule).toMatch(/min-height:\s*100svh\s*;/);
    expect(rule).toMatch(/overflow:\s*visible\s*;/);
    expect(rule).toMatch(/overscroll-behavior:\s*auto\s*;/);
    expect(rule).toMatch(/touch-action:\s*auto\s*;/);
    const gate = css.match(/\}\n\n\.accessGate\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(gate).not.toMatch(/overflow|overscroll|touch-action|height/);
  });

  it('플레이 화면(.game)은 조작을 위해 그대로 두고 HUD 링크가 푸터로 보낸다', () => {
    const shared = css.match(/\.game,\s*\.loading,\s*\.accessGate\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(shared).toMatch(/touch-action:\s*none\s*;/);
    expect(css).toMatch(/\.legalLink\s*\{[^}]*pointer-events:\s*auto\s*;/);
    const game = readFileSync(new URL('./HyosanMemoriesGame.client.tsx', import.meta.url), 'utf8');
    expect(game).toContain('href={SITE_FOOTER_HREF}');
    expect(game).toContain('사업자 정보·약관');
  });
});

