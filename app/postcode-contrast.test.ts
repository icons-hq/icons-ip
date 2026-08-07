import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/*
 * 우편번호 칸 안내문의 WCAG AA 대비를 실제 합성 배경 기준으로 고정한다(#175).
 *
 * 이 두 문장은 장식이 아니다. "스크립트 로드 실패 시에도 주문을 만들 수 있다"는
 * 완료 조건이 바로 이 폴백 안내를 읽을 수 있다는 데 기대고 있다.
 *
 * 토큰 이름만 확인하면 --dim 처럼 다른 표면용으로 재매핑된 값이 다시 들어와도
 * 통과한다. 그래서 여기서는 토큰을 끝까지 풀고, 반투명 배경을 아래에서 위로
 * 합성한 다음 명암비를 직접 계산한다.
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const AA_NORMAL_TEXT = 4.5;

type Rgba = [number, number, number, number];

/* 체크아웃 폼 카드는 editorial-account-commerce.css 에서 --account-surface 를
   칠한다(:is(.checkout-page, ...) :is(.card, .checkout-form, ...)). */
const CHECKOUT_PAPER = 'var(--account-surface)';

function rootTokens(...sources: string[]): Map<string, string> {
  const tokens = new Map<string, string>();
  for (const css of sources) {
    for (const block of css.matchAll(/:root\s*\{([^}]*)\}/g)) {
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
  const globals = read('./globals.css');
  const tokens = rootTokens(
    read('./styles/editorial-foundation.css'),
    read('./styles/editorial-account-commerce.css'),
  );

  const color = (value: string) => parseColor(resolveToken(value, tokens));

  it('keeps the search-layer fallback notice readable on its own scrim', () => {
    const paper = color(CHECKOUT_PAPER);
    const layer = composite(color(declaredValue(globals, '.postcode-layer', 'background')), paper);
    const scrim = composite(
      color(declaredValue(globals, '.postcode-layer-state', 'background')),
      layer,
    );
    const ink = color(declaredValue(globals, '.postcode-layer-state', 'color'));

    /* 스크림이 실제로 어두운 면이 맞는지 먼저 붙잡는다 — 배경이 밝아지면
       반전 잉크 선택 자체가 틀린 전제가 된다. */
    expect(relativeLuminance(scrim)).toBeLessThan(0.05);
    expect(contrastRatio(ink, scrim)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  it('keeps the manual-entry hint readable on the checkout paper', () => {
    const paper = color(CHECKOUT_PAPER);
    const ink = color(declaredValue(globals, '.postcode-field-hint', 'color'));

    expect(contrastRatio(ink, paper)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  /* 같은 폼 안의 보조 문구가 이미 통과하고 있다는 기준선. 이 단언이 깨지면
     힌트만 고친 게 아니라 --account-muted 자체가 바뀐 것이다. */
  it('matches the sibling label hint that already meets AA', () => {
    const paper = color(CHECKOUT_PAPER);

    expect(contrastRatio(color('var(--account-muted)'), paper))
      .toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });
});
