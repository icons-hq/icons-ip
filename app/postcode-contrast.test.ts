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
 *
 * 토큰을 어느 파일에서 읽느냐가 곧 "무엇을 재는가"다. /checkout 에 실제로
 * 적용되는 :root 캐스케이드는 다음과 같다.
 *
 *   1. app/layout.tsx 의 import 순서가 소스 순서다 — globals.css 가 먼저,
 *      editorial-foundation.css·editorial-account-commerce.css 가 뒤다.
 *      같은 :root 선언은 뒤가 이긴다. 프로젝트 전체에서 :root 를 여는 파일은
 *      이 셋뿐이다.
 *   2. globals.css 의 @theme 은 Tailwind v4 가 `@layer theme` 로 내보내므로
 *      layer 밖 :root 어느 것에도 이기지 못한다. 소스에서도 맨 앞이라
 *      순서대로 덮어쓰면 결과가 같다.
 *   3. 공개 화면 토큰 브리지(editorial-public.css 의
 *      `#root:is(:has(.shop-toolbar), …)`)는 checkout 을 재색칠하지 않는다 —
 *      그 :has() 목록의 랜드마크가 체크아웃 트리(components/screens/Checkout.tsx
 *      + components/checkout/*)에 없다. 반면 editorial-foundation.css 의 :root
 *      는 스코프가 없어 checkout 에도 그대로 걸린다.
 *
 * 즉 이 페이지의 --dim 은 globals.css 의 #A9A2CC 가 아니라 editorial-foundation
 * 이 덮어쓴 --editorial-ink-muted 다. 예전 토큰 맵은 globals.css 를 통째로
 * 빼서 결과값은 우연히 맞았지만 근거가 없었고, globals.css :root 에서만
 * 정의되는 토큰이 들어오면 unresolved custom property 로 던졌다.
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const AA_NORMAL_TEXT = 4.5;

type Rgba = [number, number, number, number];

/* 체크아웃 폼 카드는 editorial-account-commerce.css 에서 --account-surface 를
   칠한다(:is(.checkout-page, ...) :is(.card, .checkout-form, ...)). */
const CHECKOUT_PAPER = 'var(--account-surface)';

/* 소스 순서대로 덮어써 캐스케이드 승자를 남긴다. `:root[data-header-hidden]`
   같은 조건부 블록은 여는 중괄호 앞에 선택자가 더 붙으므로 걸리지 않는다. */
function rootTokens(...sources: string[]): Map<string, string> {
  const tokens = new Map<string, string>();
  for (const css of sources) {
    for (const block of css.matchAll(/(?::root|@theme)\s*\{([^}]*)\}/g)) {
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
  /* app/layout.tsx 의 import 순서 그대로. 뒤가 앞을 덮는다. */
  const tokens = rootTokens(
    globals,
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

  /* 우편번호 라벨은 --dim 을 쓴다. 이 단언이 재는 것은 라벨 하나가 아니라
     "checkout 이 어느 :root 를 받는가"다 — editorial 덮어쓰기가 사라져
     globals.css 의 어두운 화면용 --dim(#A9A2CC)이 그대로 오면 흰 종이 위
     2.2:1 로 떨어진다. */
  it('resolves --dim through the editorial override that checkout actually gets', () => {
    const paper = color(CHECKOUT_PAPER);
    const ink = color(declaredValue(globals, '.postcode-field-label', 'color'));

    /* 종이가 실제로 밝은 면이 맞는지 먼저 붙잡는다. 스크림 쪽 단언과 대칭이다. */
    expect(relativeLuminance(paper)).toBeGreaterThan(0.5);
    expect(contrastRatio(ink, paper)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
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
