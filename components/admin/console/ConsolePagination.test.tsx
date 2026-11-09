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
    expect(html).not.toContain('aria-label="이전 페이지"');
    expect(html).toContain('href="/admin/orders?page=2"');
  });

  it('마지막 페이지에서는 다음 링크를 만들지 않고 남은 건수만 센다', () => {
    const html = renderToStaticMarkup(
      <ConsolePagination hrefForPage={hrefForPage} page={7} pageSize={20} total={137} />,
    );

    expect(html).toContain('121–137 / 전체 137건');
    expect(html).toContain('7 / 7 페이지');
    expect(html).toContain('href="/admin/orders?page=6"');
    expect(html).not.toContain('aria-label="다음 페이지"');
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
    expect(html).not.toContain('aria-label="다음 페이지"');
  });

  it('한 페이지에 다 들어가면 이전·다음이 모두 없다', () => {
    const html = renderToStaticMarkup(
      <ConsolePagination hrefForPage={hrefForPage} page={1} pageSize={20} total={4} />,
    );

    expect(html).toContain('1–4 / 전체 4건');
    expect(html).not.toContain('<a ');
  });

  it('단위를 바꿔 같은 범위 요약을 쓴다(장·개)', () => {
    const html = renderToStaticMarkup(
      <ConsolePagination hrefForPage={hrefForPage} page={1} pageSize={20} total={3} unit="장" />,
    );

    expect(html).toContain('1–3 / 전체 3장 · 1 / 1 페이지');
  });

  /* URL이 없는 목록(팝업·클라이언트 조회)도 같은 모양의 이전·다음 버튼을 쓴다. */
  it('onPageChange를 주면 이전·다음이 같은 이름의 버튼이고, 끝에서는 비활성이다', () => {
    const html = renderToStaticMarkup(
      <ConsolePagination onPageChange={() => {}} page={1} pageSize={20} total={41} />,
    );

    expect(html).toContain('1–20 / 전체 41건 · 1 / 3 페이지');
    expect(html).not.toContain('<a ');
    expect(html).toMatch(/<button aria-label="이전 페이지"[^>]*disabled=""[^>]*type="button"/);
    /* class의 disabled: 변형 글자와 헷갈리지 않게 속성(disabled="")으로 본다. */
    expect(html).toMatch(/<button aria-label="다음 페이지"(?![^>]*disabled="")[^>]*type="button"/);
  });

  it('버튼 모드는 이동할 페이지 번호를 넘기고, 조회 중(disabled)에는 둘 다 막는다', () => {
    const pages: number[] = [];
    const element = ConsolePagination({ onPageChange: (page) => pages.push(page), page: 2, pageSize: 20, total: 41 });
    const buttons = (element.props.children[1].props.children as { props: { onClick: () => void; disabled: boolean } }[]);
    buttons[0].props.onClick();
    buttons[1].props.onClick();
    expect(pages).toEqual([1, 3]);
    const locked = renderToStaticMarkup(
      <ConsolePagination disabled onPageChange={() => {}} page={2} pageSize={20} total={41} />,
    );
    expect(locked.match(/disabled=""/g)).toHaveLength(2);
  });

  /* 대화 목록처럼 목록이 제자리에서 바뀌는 화면은 페이지를 옮겨도 스크롤을 맨 위로 보내지 않는다. */
  it('링크 모드는 scroll을 next/link에 그대로 넘긴다', () => {
    const element = ConsolePagination({ hrefForPage, page: 2, pageSize: 20, total: 41, scroll: false });
    const links = element.props.children[1].props.children as { props: { href: string; scroll?: boolean } }[];
    expect(links.map(link => [link.props.href, link.props.scroll])).toEqual([['/admin/orders?page=1', false], ['/admin/orders?page=3', false]]);
    const defaults = ConsolePagination({ hrefForPage, page: 2, pageSize: 20, total: 41 }).props.children[1].props.children as { props: { scroll?: boolean } }[];
    expect(defaults.map(link => link.props.scroll)).toEqual([undefined, undefined]);
  });

  it('전체 건수를 한국어 천 단위로 끊는다', () => {
    const html = renderToStaticMarkup(
      <ConsolePagination hrefForPage={hrefForPage} page={2} pageSize={50} total={12345} />,
    );

    expect(html).toContain('51–100 / 전체 12,345건');
  });
});
