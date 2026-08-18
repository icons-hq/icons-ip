import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConsolePagination } from './ConsolePagination';

const hrefForPage = (page: number) => `/admin/orders?page=${page}`;

describe('ConsolePagination', () => {
  it('첫 페이지에서는 이전 링크를 만들지 않는다', () => {
    const html = renderToStaticMarkup(
      <ConsolePagination hrefForPage={hrefForPage} page={1} pageSize={20} total={137} />,
    );

    expect(html).toContain('1–20 / 전체 137건');
    expect(html).toContain('1 / 7 페이지');
    expect(html).not.toContain('이전');
    expect(html).toContain('href="/admin/orders?page=2"');
  });

  it('마지막 페이지에서는 다음 링크를 만들지 않고 남은 건수만 센다', () => {
    const html = renderToStaticMarkup(
      <ConsolePagination hrefForPage={hrefForPage} page={7} pageSize={20} total={137} />,
    );

    expect(html).toContain('121–137 / 전체 137건');
    expect(html).toContain('7 / 7 페이지');
    expect(html).toContain('href="/admin/orders?page=6"');
    expect(html).not.toContain('다음');
  });

  /* 0건에서도 "전체 0건"이 보여야 조회가 실패한 화면과 구분된다. */
  it('결과가 0건이면 0–0을 표시하고 이동 링크를 두지 않는다', () => {
    const html = renderToStaticMarkup(
      <ConsolePagination hrefForPage={hrefForPage} page={1} pageSize={20} total={0} />,
    );

    expect(html).toContain('0–0 / 전체 0건');
    expect(html).toContain('1 / 1 페이지');
    expect(html).not.toContain('<a ');
  });

  /* 필터를 바꿔 결과가 줄면 URL의 page가 범위를 벗어난 채로 남는다. */
  it('범위를 벗어난 페이지 번호는 마지막 페이지로 보정한다', () => {
    const html = renderToStaticMarkup(
      <ConsolePagination hrefForPage={hrefForPage} page={99} pageSize={20} total={137} />,
    );

    expect(html).toContain('121–137 / 전체 137건');
    expect(html).toContain('7 / 7 페이지');
    expect(html).not.toContain('다음');
  });

  it('한 페이지에 다 들어가면 이전·다음이 모두 없다', () => {
    const html = renderToStaticMarkup(
      <ConsolePagination hrefForPage={hrefForPage} page={1} pageSize={20} total={4} />,
    );

    expect(html).toContain('1–4 / 전체 4건');
    expect(html).not.toContain('<a ');
  });

  it('전체 건수를 한국어 천 단위로 끊는다', () => {
    const html = renderToStaticMarkup(
      <ConsolePagination hrefForPage={hrefForPage} page={2} pageSize={50} total={12345} />,
    );

    expect(html).toContain('51–100 / 전체 12,345건');
  });
});
