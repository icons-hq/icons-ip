import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/*
 * 우편번호 칸 안내문의 WCAG AA 대비를 실제 합성 배경 기준으로 고정한다(#175).
 *
 * 이 두 문장은 장식이 아니다. "스크립트 로드 실패 시에도 주문을 만들 수 있다"는
 * 완료 조건이 바로 이 폴백 안내를 읽을 수 있다는 데 기대고 있다.
 *
 * 토큰 이름만 확인하면 --wc-ink-tertiary 처럼 다른 표면용으로 재조정된 값이 다시
 * 들어와도 통과한다. 그래서 여기서는 토큰을 끝까지 풀고, 반투명 배경을 아래에서
 * 위로 합성한 다음 명암비를 직접 계산한다.
 *
 * 토큰을 어느 파일에서 읽느냐가 곧 "무엇을 재는가"다. S9(#331) 이후 /checkout 의
 * 캐스케이드는 다음과 같다.
 *
 *   1. 지면 루트가 `<main class="wc-root wc-receipt checkout-page">` 다.
 *      색 토큰은 `wc-foundation.css` 의 `.wc-root` 블록에만 있다 — 문서 :root 가
 *      아니라 이 스코프다(wc-design.test 가 그 경계를 지킨다).
 *   2. `.postcode-*` 어휘 자체는 남아 있지만 시각은 `wc-account-commerce.css` 의
 *      `.wc-receipt .postcode-*` 가 전부 소유한다. globals.css 의 HM 사본과
 *      editorial-account-commerce.css 는 S9에서 제거됐다.
 *   3. 그래서 이 파일은 "wc 토큰이 풀린 값"으로 잰다. 검색 레이어 스크림이 다시
 *      반투명해지면 아래 합성 경로가 그 사실을 반영한다.
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const AA_NORMAL_TEXT = 4.5;

type Rgba = [number, number, number, number];

/* 우편번호 칸이 앉는 종이. `.wc-receipt .card` 가 체크아웃 폼 카드를 칠한다. */
const CHECKOUT_PAPER_RULE = '.wc-receipt .card';

/* 소스 순서대로 덮어써 캐스케이드 승자를 남긴다. 문서 :root(globals·editorial)와
   White Catalog 스코프 루트(.wc-root)를 함께 읽는다 — 후자가 지면의 실값이다. */
function scopeTokens(...sources: string[]): Map<string, string> {
  const tokens = new Map<string, string>();
  for (const css of sources) {
    for (const block of css.matchAll(/(?::root|@theme|\.wc-root)\s*\{([^}]*)\}/g)) {
      for (const declaration of block[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
        tokens.set(declaration[1], declaration[2].trim());
      }
    }
  }
  return tokens;
}

function resolveToken(value: string, tokens: Map<string, string>): string {
  let current = value.trim();
  for (let depth = 0; depth < 16; depth += 1) {
    const reference = /^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/.exec(current);
    if (!reference) return current;
    const next = tokens.get(reference[1]) ?? reference[2]?.trim();
    if (!next) throw new Error(`unresolved custom property: ${current}`);
    current = next;
  }
  throw new Error(`custom property cycle: ${value}`);
}

function parseColor(value: string): Rgba {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) {
    return [
      Number.parseInt(hex[1].slice(0, 2), 16),
      Number.parseInt(hex[1].slice(2, 4), 16),
      Number.parseInt(hex[1].slice(4, 6), 16),
      1,
    ];
  }

  const functional = /^rgba?\(([^)]+)\)$/i.exec(value);
  if (functional) {
    const parts = functional[1].split(',').map((part) => Number(part.trim()));
    if (parts.length < 3 || parts.some(Number.isNaN)) throw new Error(`bad color: ${value}`);
    return [parts[0], parts[1], parts[2], parts[3] ?? 1];
  }

  throw new Error(`unsupported color: ${value}`);
}

/* source-over 합성. 배경은 항상 불투명하게 시작한다. */
function composite(top: Rgba, bottom: Rgba): Rgba {
  const alpha = top[3];
  return [
    top[0] * alpha + bottom[0] * (1 - alpha),
    top[1] * alpha + bottom[1] * (1 - alpha),
    top[2] * alpha + bottom[2] * (1 - alpha),
    1,
  ];
}

function relativeLuminance([red, green, blue]: Rgba): number {
  const channel = (value: number) => {
    const scaled = value / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
}

function contrastRatio(foreground: Rgba, background: Rgba): number {
  const [lighter, darker] = [relativeLuminance(foreground), relativeLuminance(background)]
    .sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

function ruleBody(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`missing rule: ${selector}`);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  if (close < 0) throw new Error(`unterminated rule: ${selector}`);
  return css.slice(open + 1, close);
}

function declaredValue(css: string, selector: string, property: string): string {
  const match = new RegExp(`(?:^|[;{\\s])${property}\\s*:\\s*([^;]+)`).exec(
    ruleBody(css, selector),
  );
  if (!match) throw new Error(`missing ${property} on ${selector}`);
  return match[1].trim();
}

describe('postcode field contrast', () => {
  const commerce = read('./styles/wc-account-commerce.css');
  /* app/layout.tsx 의 import 순서 그대로. 뒤가 앞을 덮는다. */
  const tokens = scopeTokens(
    read('./globals.css'),
    read('./styles/editorial-foundation.css'),
    read('./styles/wc-foundation.css'),
  );

  const color = (value: string) => parseColor(resolveToken(value, tokens));

  /* 레이어 배경이 지금은 불투명이라 composite 두 번은 무연산이지만, 계산을 남겨
     둔다 — 배경이 반투명으로 돌아오는 순간 실제 합성색으로 재는 단언이 된다. */
  it('keeps the search-layer fallback notice readable on its own scrim', () => {
    const paper = color(declaredValue(commerce, CHECKOUT_PAPER_RULE, 'background'));
    const layer = composite(
      color(declaredValue(commerce, '.wc-receipt .postcode-layer', 'background')),
      paper,
    );
    const scrim = composite(
      color(declaredValue(commerce, '.wc-receipt .postcode-layer-state', 'background')),
      layer,
    );
    const ink = color(declaredValue(commerce, '.wc-receipt .postcode-layer-state', 'color'));

    expect(contrastRatio(ink, scrim)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  /* 우편번호 라벨이 종이 위에서 읽히는지. 이 단언이 재는 것은 라벨 하나가 아니라
     "checkout 이 어느 스코프의 토큰을 받는가"다 — wc 스코프가 사라져 문서 :root 의
     어두운 화면용 토큰이 그대로 오면 흰 종이 위에서 대비가 무너진다. */
  it('resolves the label ink through the White Catalog scope the receipt actually gets', () => {
    const paper = color(declaredValue(commerce, CHECKOUT_PAPER_RULE, 'background'));
    const ink = color(declaredValue(commerce, '.wc-receipt .postcode-field-label', 'color'));

    /* 종이가 실제로 밝은 면이 맞는지 먼저 붙잡는다 — 라이트 스킴 전환의 전제 단언. */
    expect(relativeLuminance(paper)).toBeGreaterThan(0.5);
    expect(contrastRatio(ink, paper)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  it('keeps the manual-entry hint readable on the checkout paper', () => {
    const paper = color(declaredValue(commerce, CHECKOUT_PAPER_RULE, 'background'));
    const ink = color(declaredValue(commerce, '.wc-receipt .postcode-field-hint', 'color'));

    expect(contrastRatio(ink, paper)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  /* 같은 폼 안의 보조 문구가 이미 통과하고 있다는 기준선. 이 단언이 깨지면
     힌트만 고친 게 아니라 --wc-ink-tertiary 자체가 바뀐 것이다. */
  it('matches the sibling field error ink that already meets AA', () => {
    const paper = color(declaredValue(commerce, CHECKOUT_PAPER_RULE, 'background'));

    expect(contrastRatio(color('var(--wc-ink-tertiary)'), paper))
      .toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });
});
