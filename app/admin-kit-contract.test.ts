import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

/*
 * ADR-0028 kit 경계 계약. 템플릿 룩 kit(shadcn/ui · Base UI · Dice UI data-table)은 어드민 안에서만
 * 효력이 있고, 관리자 CSS가 cascade layer 밖에 있는 동안의 `revert-layer` 다리는 kit 부품에만 걸린다.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

function sources(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(join(ROOT, path)).isDirectory()) return name === 'node_modules' ? [] : sources(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

const SHADCN_TOKENS = ['--background', '--foreground', '--primary', '--border', '--input', '--ring', '--radius', '--sidebar'];
const KIT_GUARD = ':not([data-slot])';
/** 아직 kit 부품으로 옮기지 않은 화면의 관리자 CSS(ADR-0028 순서 ⑤에서 퇴역한다). */
const LEGACY_STYLESHEETS = readdirSync(join(ROOT, 'app', 'styles'))
  .filter((name) => /^(admin-|wc-admin).*\.css$/.test(name))
  .filter((name) => !['admin-kit.css', 'admin-kit-vocabulary.css'].includes(name));

describe('admin kit 경계 (ADR-0028)', () => {
  const css = postcss.parse(read('app/styles/admin-kit.css'));

  it('shadcn 토큰 값은 .wc-admin 안에만 둔다 — 공개 표면에서 kit 유틸리티는 값이 없다', () => {
    const owners = new Set<string>();
    css.walkDecls((declaration) => {
      if (!SHADCN_TOKENS.includes(declaration.prop)) return;
      const parent = declaration.parent;
      if (parent?.type === 'rule') owners.add((parent as postcss.Rule).selector);
    });
    expect([...owners]).toEqual(['.wc-admin']);
  });

  it('revert-layer 다리 없이 kit 유틸리티가 이긴다 — 옛 관리자 CSS는 utilities 아래 layer에 있다', () => {
    css.walkDecls('all', (declaration) => expect(declaration.value).not.toBe('revert-layer'));
    for (const file of LEGACY_STYLESHEETS) {
      const body = read(`app/styles/${file}`).replace(/\/\*[\s\S]*?\*\//g, '').trim();
      postcss.parse(body).each((node) => {
        /* 글꼴 선언(@font-face)만 layer 밖에 둘 수 있다. */
        if (node.type === 'atrule' && node.name === 'font-face') return;
        expect(node.type === 'atrule' && node.name === 'layer' && node.params === 'components', `${file}: ${node.toString().slice(0, 80)}`).toBe(true);
      });
    }
  });

  it('옛 관리자 CSS의 모든 선택자는 kit 부품(data-slot)을 비켜 간다', () => {
    for (const file of LEGACY_STYLESHEETS) {
      postcss.parse(read(`app/styles/${file}`)).walkRules((rule) => {
        if (rule.parent?.type === 'atrule' && /keyframes$/i.test((rule.parent as postcss.AtRule).name)) return;
        for (const selector of rule.selectors) expect(selector, `${file}: ${selector}`).toContain(KIT_GUARD);
      });
    }
  });

  it('옛 클래스 어휘의 kit 옷(admin-kit-vocabulary.css)은 kit 부품과 공개 미리보기를 건드리지 않고, 관리자 CSS 뒤에 싣는다', () => {
    postcss.parse(read('app/styles/admin-kit-vocabulary.css')).walkRules((rule) => {
      for (const selector of rule.selectors) {
        expect(selector, selector).toMatch(/^\.wc-admin\b/);
        expect(selector, selector).toContain(KIT_GUARD);
        expect(selector, selector).toContain(':not(.wc-root *)');
      }
    });
    const layout = read('app/layout.tsx');
    const vocabulary = layout.indexOf("'./styles/admin-kit-vocabulary.css'");
    expect(vocabulary).toBeGreaterThan(0);
    for (const file of LEGACY_STYLESHEETS) {
      const at = layout.indexOf(`'./styles/${file}'`);
      if (at >= 0) expect(at, file).toBeLessThan(vocabulary);
    }
  });

  it('kit 부품은 어드민 코드에서만 쓴다', () => {
    const outside = [...sources('app'), ...sources('components'), ...sources('lib')]
      .filter((path) => !path.startsWith(join('components', 'admin')) && !path.startsWith(join('app', 'admin')))
      .filter((path) => read(path).includes('@/components/admin/kit/'));
    expect(outside.map((path) => relative('.', path))).toEqual([]);
  });

  it('의미색 글자는 자기 옅은 바탕과 흰 바탕에서 WCAG AA(4.5:1)를 넘는다 — 토큰을 바꿀 때 계산으로 지킨다', () => {
    const values = new Map<string, string>();
    css.walkRules('.wc-admin', (rule) => rule.walkDecls((declaration) => values.set(declaration.prop, declaration.value)));
    const oklch = (name: string): [number, number, number] => {
      let value = values.get(name);
      while (value?.startsWith('var(')) value = values.get(value.slice(4, -1));
      const match = value?.match(/^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/);
      expect(match, `${name}: ${value}`).toBeTruthy();
      return [Number(match![1]), Number(match![2]), Number(match![3])];
    };
    const luminance = ([L, C, h]: [number, number, number]) => {
      const a = C * Math.cos((h * Math.PI) / 180), b = C * Math.sin((h * Math.PI) / 180);
      const l_ = L + 0.3963377774 * a + 0.2158037573 * b, m_ = L - 0.1055613458 * a - 0.0638541728 * b, s_ = L - 0.0894841775 * a - 1.291485548 * b;
      const [l, m, s] = [l_ ** 3, m_ ** 3, s_ ** 3];
      const [r, g, bl] = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s].map((v) => Math.min(1, Math.max(0, v)));
      return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    };
    const contrast = (x: [number, number, number], y: [number, number, number]) => {
      const [high, low] = [luminance(x), luminance(y)].sort((p, q) => q - p);
      return (high + 0.05) / (low + 0.05);
    };
    const white: [number, number, number] = [1, 0, 0];
    for (const [text, soft] of [['--success', '--success-soft'], ['--warning', '--warning-soft'], ['--destructive', '--danger-soft'], ['--info', '--info-soft'], ['--primary-soft-foreground', '--primary-soft']]) {
      expect(contrast(oklch(text), oklch(soft)), `${text} / ${soft}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(oklch(text), white), `${text} / white`).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(oklch('--primary-foreground'), oklch('--primary')), 'primary 버튼 글자').toBeGreaterThanOrEqual(4.5);
    expect(contrast(oklch('--muted-foreground'), oklch('--muted')), '보조 글자').toBeGreaterThanOrEqual(4.5);
    expect(contrast(oklch('--input'), white), '입력 칸 경계').toBeGreaterThanOrEqual(3);
  });

  it('어드민 화면은 색을 직접 고르지 않는다 — 팔레트 유틸리티 대신 토큰·공용 부품을 쓴다(ADR-0029)', () => {
    const palette = /\b(?:bg|text|border|ring|fill|stroke|from|to|via)-(?:red|green|blue|amber|yellow|orange|emerald|sky|indigo|violet|purple|pink|rose|lime|teal|cyan|slate|gray|zinc|stone|neutral)-\d{2,3}\b/;
    const offenders = sources(join('components', 'admin'))
      .filter((path) => !path.includes('.test.') && !path.includes('/kit/'))
      .filter((path) => palette.test(read(path)));
    expect(offenders.map((path) => relative('.', path))).toEqual([]);
  });

  it('열 설정 버튼은 좁은 화면에서도 숨기지 않는다 — 열 머리글에서 숨긴 열을 되살릴 곳은 여기뿐이다', () => {
    for (const path of ['components/admin/kit/data-table/data-table-view-options.tsx', 'components/admin/kit/console-table-settings.tsx']) {
      expect(read(path), path).not.toMatch(/className="[^"]*\bhidden\b[^"]*"/);
    }
  });

  it('Dice UI의 URL 상태(nuqs·useDataTable)를 쓰지 않는다 — 목록 URL은 화면의 기존 계약이 진실원이다', () => {
    const kit = sources(join('components', 'admin', 'kit'));
    for (const path of kit) {
      const source = read(path);
      expect(source, path).not.toMatch(/from ['"]nuqs/);
      expect(source, path).not.toMatch(/\buseDataTable\s*\(|import[^;]*\buseDataTable\b/);
    }
    expect(JSON.parse(read('package.json')).dependencies).not.toHaveProperty('nuqs');
  });
});
