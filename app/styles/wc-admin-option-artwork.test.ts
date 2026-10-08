import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

/*
 * 옵션 상세 정보 표 안 문구의 최종 색·크기를 CSS 우선순위로 계산한다. 이 파일의 선택자는 자손 결합자와
 * 태그·클래스·:not(.클래스)만 쓰므로 그 범위만 해석하고, 대상 요소(small·ERP 안내)를 가리킬 수 있는데
 * 해석할 수 없는 선택자가 생기면 조용히 넘기지 않고 실패한다. 미디어 쿼리 안 규칙은 기본 화면에 적용되지 않는다.
 */
type Element = { tag: string; classes: string[] };
type Compound = { tag?: string; classes: string[]; excluded: string[] };

const css = postcss.parse(readFileSync(new URL('./wc-admin-option-artwork.css', import.meta.url), 'utf8'));

function compound(source: string): Compound | null {
  const match = /^([a-z][a-z0-9]*)?((?:\.[\w-]+|:not\(\.[\w-]+\))*)$/i.exec(source);
  if (!match) return null;
  const parts = match[2].match(/\.[\w-]+|:not\(\.[\w-]+\)/g) ?? [];
  return {
    tag: match[1]?.toLowerCase(),
    classes: parts.filter((part) => part.startsWith('.')).map((part) => part.slice(1)),
    excluded: parts.filter((part) => part.startsWith(':not(')).map((part) => part.slice(6, -1)),
  };
}

const matchesElement = (part: Compound, element: Element) => (!part.tag || part.tag === element.tag)
  && part.classes.every((name) => element.classes.includes(name))
  && part.excluded.every((name) => !element.classes.includes(name));

/** 맞으면 특정도(클래스·:not 인자 수, 태그 수), 아니면 null. */
function specificity(selector: string, path: Element[]): [number, number] | null {
  const sources = selector.trim().split(/\s+/);
  const parts = sources.map(compound);
  if (parts.some((part) => part === null)) {
    const last = sources.at(-1) ?? '';
    if (/small|erp-message/.test(last)) throw new Error(`해석하지 못한 선택자: ${selector}`);
    return null;
  }
  const compounds = parts as Compound[];
  if (!matchesElement(compounds[compounds.length - 1], path[path.length - 1])) return null;
  let ancestor = path.length - 2;
  for (let index = compounds.length - 2; index >= 0; index -= 1) {
    while (ancestor >= 0 && !matchesElement(compounds[index], path[ancestor])) ancestor -= 1;
    if (ancestor < 0) return null;
    ancestor -= 1;
  }
  return [
    compounds.reduce((sum, part) => sum + part.classes.length + part.excluded.length, 0),
    compounds.filter((part) => part.tag).length,
  ];
}

function computed(path: Element[], property: string): string | undefined {
  let winner: { value: string; weight: [number, number] } | undefined;
  css.walkRules((rule) => {
    if (rule.parent?.type !== 'root') return;
    for (const selector of rule.selectors) {
      const weight = specificity(selector, path);
      if (!weight) continue;
      rule.walkDecls(property, (declaration) => {
        const wins = !winner || weight[0] > winner.weight[0] || (weight[0] === winner.weight[0] && weight[1] >= winner.weight[1]);
        if (wins) winner = { value: declaration.value, weight };
      });
    }
  });
  return winner?.value;
}

const detailCell: Element[] = [
  { tag: 'div', classes: ['wc-admin'] },
  { tag: 'div', classes: ['col', 'admin-option-editor', 'wc-admin-option-artwork'] },
  { tag: 'details', classes: ['goods-option-secondary'] },
  { tag: 'div', classes: ['goods-option-secondary__table'] },
  { tag: 'table', classes: ['wc-admin-table', 'goods-option-secondary-table', 'goods-option-detail-table'] },
  { tag: 'tbody', classes: [] },
  { tag: 'tr', classes: [] },
  { tag: 'td', classes: [] },
];
const inCell = (element: Element) => [...detailCell, element];

/* 2026-10-07 3차 리뷰: 표 안 small의 재고 부족 경고 규칙이 ERP 안내 규칙보다 특정도가 높아, 성공 안내도 경고색 11px로 보였다. */
describe('옵션 상세 정보의 ERP 안내 색', () => {
  const success = inCell({ tag: 'small', classes: ['goods-option-erp-message'] });
  const failed = inCell({ tag: 'small', classes: ['goods-option-erp-message', 'goods-option-erp-message--failed'] });
  const lowStock = inCell({ tag: 'small', classes: [] });

  it('적용 성공은 성공색, 적용 실패·확인 필요는 경고색으로 구분한다', () => {
    expect(computed(success, 'color')).toBe('var(--wc-success)');
    expect(computed(failed, 'color')).toBe('var(--wc-warning)');
    expect(computed(success, 'font-size')).toBe('12px');
    expect(computed(failed, 'font-size')).toBe('12px');
  });

  it('같은 칸의 재고 부족 경고는 그대로 경고색 11px이다', () => {
    expect(computed(lowStock, 'color')).toBe('var(--wc-warning)');
    expect(computed(lowStock, 'font-size')).toBe('11px');
  });
});
