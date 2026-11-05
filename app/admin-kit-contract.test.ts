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

const SHADCN_TOKENS = ['--background', '--foreground', '--primary', '--border', '--input', '--ring', '--radius'];

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

  it('revert-layer 다리는 kit 섬과 kit 포털 안의 kit 부품(data-slot)에만 건다', () => {
    const bridges: string[] = [];
    css.walkDecls('all', (declaration) => {
      if (declaration.value === 'revert-layer') bridges.push((declaration.parent as postcss.Rule).selector);
    });
    expect(bridges).not.toHaveLength(0);
    for (const selector of bridges.flatMap((value) => value.split(',').map((part) => part.trim()))) {
      expect(selector, selector).toMatch(/^\.wc-admin(?: \.admin-kit-island|\.admin-kit-portal) \[data-slot\]$/);
    }
  });

  it('kit 부품은 어드민 코드에서만 쓴다', () => {
    const outside = [...sources('app'), ...sources('components'), ...sources('lib')]
      .filter((path) => !path.startsWith(join('components', 'admin')) && !path.startsWith(join('app', 'admin')))
      .filter((path) => read(path).includes('@/components/admin/kit/'));
    expect(outside.map((path) => relative('.', path))).toEqual([]);
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
