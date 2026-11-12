import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

/* 1014-X36 뒤 /ip/aouad 아래에 사이트 푸터가 붙었다. 첫 방문 오프닝의 '스킵 →'(.openingSkip)은 화면 고정이라 끝까지 스크롤하면
   푸터 위에 떠 보였다(모바일 실측 2026-11-12). 오프닝 상자(.opening)를 clip-path 로 잘라 상자 밖에서는 그리지도 누르지도 않게 하고,
   상자 안에서는 그대로 고정이라 오프닝 내용을 스크롤해도 오른쪽 위에 남는다. */
const sheet = postcss.parse(readFileSync(new URL('./source/components/aouad/AouadSample.module.css', import.meta.url), 'utf8'));

function topLevel(selector: string): Record<string, string> {
  const found: Record<string, string> = {};
  sheet.walkRules((rule) => {
    if (rule.parent?.type !== 'root' || !rule.selectors.map((item) => item.trim()).includes(selector)) return;
    rule.walkDecls((decl) => { found[decl.prop] = decl.value; });
  });
  return found;
}

describe('오프닝 스킵 버튼은 오프닝 상자 밖으로 새지 않는다', () => {
  it('스킵 버튼은 지금처럼 화면 고정이다(오프닝 내용 스크롤에도 남음)', () => {
    expect(topLevel('.openingSkip')).toMatchObject({ position: 'fixed', 'z-index': '40' });
  });

  it('오프닝 상자는 고정 위치 자손까지 자기 상자로 자른다', () => {
    expect(topLevel('.opening')).toMatchObject({ position: 'absolute', 'clip-path': 'inset(0)' });
  });
});
