import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Exchange } from './Exchange';

function render() {
  return renderToStaticMarkup(<Exchange />);
}

describe('Exchange 화면 용어', () => {
  /* 카드 C2C는 트레이드다. "교환"은 굿즈 클레임 유형(회수 후 재출고) 전용이라
   * 이 화면에 남으면 구매자가 굿즈 교환 신청 화면으로 오해한다. */
  it('카드 C2C를 트레이드로 부른다', () => {
    const html = render();

    expect(html).toContain('카드 트레이드');
    expect(html).toContain('트레이드 등록');
    expect(html).toContain('트레이드 제안하기');
  });

  it('카드 C2C 의미의 "교환" 표기를 남기지 않는다', () => {
    expect(render()).not.toContain('교환');
  });

  it('v2 플레이스홀더라는 사실을 밝힌다', () => {
    const html = render();

    expect(html).toContain('정식 오픈 시');
  });
});
