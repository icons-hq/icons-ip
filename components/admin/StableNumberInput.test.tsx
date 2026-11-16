import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StableNumberInput, sameNumberText } from './StableNumberInput';

describe('StableNumberInput (원장 재작업 후속 6)', () => {
  it('같은 숫자를 가리키는 글자는 다시 쓰지 않는다 — 입력 도중의 렌더가 친 글자를 지우지 않는 판정', () => {
    expect(sameNumberText('10', '10')).toBe(true);
    expect(sameNumberText('010', '10')).toBe(true);
    expect(sameNumberText('1e1', '10')).toBe(true);
    expect(sameNumberText('', '')).toBe(true);
    /* 빈 칸과 0은 다르다(재고 0은 직접 입력한 값이다). */
    expect(sameNumberText('', '0')).toBe(false);
    expect(sameNumberText('0', '')).toBe(false);
    expect(sameNumberText('10', '')).toBe(false);
    expect(sameNumberText('10', '12')).toBe(false);
  });
  it('비제어 숫자 칸으로 그린다 — 값은 처음 값(defaultValue)으로만 싣고 나머지 속성은 그대로 넘긴다', () => {
    const html = renderToStaticMarkup(<StableNumberInput id="goods-single-stock" value="10" min={0} step={1} required onChange={() => undefined} />);
    expect(html).toContain('type="number"');
    expect(html).toContain('value="10"');
    expect(html).toContain('id="goods-single-stock"');
    expect(html).toContain('required');
  });
});
