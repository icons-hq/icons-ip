import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConsoleCountChips } from './ConsoleCountChips';

describe('ConsoleCountChips', () => {
  /* 0건 칩을 감추면 운영자가 "정말 0건"과 "집계를 못 불러옴"을 구분하지 못한다. */
  it('0건 상태도 숨기지 않고 그대로 렌더한다', () => {
    const html = renderToStaticMarkup(
      <ConsoleCountChips
        chips={[
          { count: 12, label: '결제완료' },
          { count: 0, label: '배송준비' },
          { count: 0, label: '취소요청', tone: 'danger' },
        ]}
      />,
    );

    expect(html).toContain('결제완료');
    expect(html).toContain('배송준비');
    expect(html).toContain('취소요청');
    /* 0이 두 번 나온다 = 두 상태 모두 자리를 지켰다. */
    expect(html.match(/>0</g)).toHaveLength(2);
    expect(html).toContain('admin-console-chip--danger');
  });

  it('건수를 한국어 천 단위로 끊어 보여준다', () => {
    const html = renderToStaticMarkup(
      <ConsoleCountChips chips={[{ count: 12345, label: '전체' }]} />,
    );

    expect(html).toContain('12,345');
  });

  it('href가 있으면 링크가 되고 활성 칩에 aria-current를 남긴다', () => {
    const html = renderToStaticMarkup(
      <ConsoleCountChips
        chips={[
          { active: true, count: 3, href: '/admin/orders?status=paid', label: '결제완료' },
          { count: 0, label: '배송중' },
        ]}
      />,
    );

    expect(html).toContain('href="/admin/orders?status=paid"');
    expect(html).toContain('aria-current="true"');
    /* 링크 접근성 이름은 자식 텍스트가 "결제완료3"으로 붙어버려 단위가 사라진다. */
    expect(html).toContain('aria-label="결제완료 3건"');
    /* href 없는 칩은 링크가 아니다. */
    expect(html.match(/<a /g)).toHaveLength(1);
  });

  it('묶음 라벨을 접근성 이름으로 노출한다', () => {
    const html = renderToStaticMarkup(
      <ConsoleCountChips chips={[{ count: 0, label: '신규' }]} label="클레임 상태별 건수" />,
    );

    expect(html).toContain('aria-label="클레임 상태별 건수"');
    expect(html).toContain('role="group"');
  });
});
