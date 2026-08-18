import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConsoleGrid, nextSortDirection, type ConsoleGridColumn } from './ConsoleGrid';

const COLUMNS: ConsoleGridColumn[] = [
  { key: 'orderNo', label: '주문번호', sortable: true, width: '160px' },
  { key: 'buyer', label: '구매자' },
  { align: 'end', key: 'total', label: '결제금액', sortable: true },
];

const ROWS = [
  { cells: ['2026081800001', '@icons', '₩24,000'], href: '/admin/orders/o1', id: 'o1' },
  { cells: ['2026081800002', '@fan', '₩12,000'], id: 'o2' },
];

const sortHrefFor = (key: string, direction: string) => `/admin/orders?sort=${key}&dir=${direction}`;

describe('nextSortDirection', () => {
  it('같은 컬럼이면 방향을 뒤집고 다른 컬럼이면 기본 방향으로 간다', () => {
    expect(nextSortDirection({ direction: 'desc', key: 'total' }, 'total')).toBe('asc');
    expect(nextSortDirection({ direction: 'asc', key: 'total' }, 'total')).toBe('desc');
    /* 콘솔 목록의 기본 관심사는 최신순이라 첫 클릭은 내림차순이다. */
    expect(nextSortDirection({ direction: 'asc', key: 'total' }, 'orderNo')).toBe('desc');
    expect(nextSortDirection(null, 'orderNo', 'asc')).toBe('asc');
  });
});

describe('ConsoleGrid 정렬', () => {
  it('현재 정렬 컬럼의 링크는 반대 방향을 가리킨다', () => {
    const html = renderToStaticMarkup(
      <ConsoleGrid
        caption="주문 목록"
        columns={COLUMNS}
        rows={ROWS}
        sort={{ direction: 'desc', key: 'total' }}
        sortHrefFor={sortHrefFor}
      />,
    );

    /* total은 현재 내림차순이므로 헤더 링크는 오름차순으로 뒤집는다. */
    expect(html).toContain('href="/admin/orders?sort=total&amp;dir=asc"');
    /* 정렬 중이 아닌 컬럼은 기본 방향(내림차순)을 그대로 가리킨다. */
    expect(html).toContain('href="/admin/orders?sort=orderNo&amp;dir=desc"');
    expect(html).toContain('aria-label="결제금액 오름차순 정렬"');
  });

  it('정렬 상태를 aria-sort로 알린다', () => {
    const html = renderToStaticMarkup(
      <ConsoleGrid
        caption="주문 목록"
        columns={COLUMNS}
        rows={ROWS}
        sort={{ direction: 'asc', key: 'orderNo' }}
        sortHrefFor={sortHrefFor}
      />,
    );

    expect(html).toContain('aria-sort="ascending"');
    expect(html).toContain('aria-sort="none"');
    /* sortable이 아닌 구매자 컬럼에는 aria-sort를 붙이지 않는다. */
    expect(html.match(/aria-sort/g)).toHaveLength(2);
  });

  /* 함수 prop은 서버 → 클라이언트 경계를 넘지 못한다. 서버 컴포넌트는 href를 미리 넣는다. */
  it('컬럼에 박아 넣은 sortHref가 sortHrefFor보다 우선한다', () => {
    const html = renderToStaticMarkup(
      <ConsoleGrid
        caption="주문 목록"
        columns={[{ key: 'orderNo', label: '주문번호', sortHref: '/admin/orders?o=1', sortable: true }]}
        rows={[]}
      />,
    );

    expect(html).toContain('href="/admin/orders?o=1"');
  });

  it('정렬 링크를 만들 수 없으면 헤더를 링크로 만들지 않는다', () => {
    const html = renderToStaticMarkup(
      <ConsoleGrid
        caption="주문 목록"
        columns={[{ key: 'orderNo', label: '주문번호', sortable: true }]}
        rows={[]}
      />,
    );

    expect(html).not.toContain('admin-console-grid-sort');
    expect(html).toContain('주문번호');
  });
});

describe('ConsoleGrid 빈 상태', () => {
  it('행이 없으면 전체 열을 덮는 안내 문구를 보여준다', () => {
    const html = renderToStaticMarkup(
      <ConsoleGrid caption="주문 목록" columns={COLUMNS} rows={[]} selectable />,
    );

    expect(html).toContain('조건에 맞는 항목이 없습니다.');
    /* 체크박스 열 1 + 데이터 열 3 */
    expect(html).toContain('colSpan="4"');
    expect(html).toContain('admin-console-grid-empty');
  });

  it('빈 상태 문구를 콘솔별로 바꿀 수 있다', () => {
    const html = renderToStaticMarkup(
      <ConsoleGrid
        caption="문의 목록"
        columns={COLUMNS}
        emptyLabel="미답변 문의가 없습니다."
        rows={[]}
      />,
    );

    expect(html).toContain('미답변 문의가 없습니다.');
    expect(html).toContain('colSpan="3"');
  });

  it('빈 상태에서도 전체선택 체크박스를 눌러지지 않게 둔다', () => {
    const html = renderToStaticMarkup(
      <ConsoleGrid caption="주문 목록" columns={COLUMNS} rows={[]} selectable />,
    );

    expect(html).toContain('aria-label="전체 선택"');
    expect(html).toContain('disabled=""');
  });
});

describe('ConsoleGrid 행', () => {
  it('href가 있는 행은 첫 셀을 상세 링크로 감싼다', () => {
    const html = renderToStaticMarkup(
      <ConsoleGrid caption="주문 목록" columns={COLUMNS} rows={ROWS} />,
    );

    expect(html).toContain('href="/admin/orders/o1"');
    expect(html).toContain('admin-console-grid-link');
    /* href 없는 두 번째 행은 링크가 되지 않는다. */
    expect(html.match(/admin-console-grid-link/g)).toHaveLength(1);
    expect(html).toContain('2026081800002');
  });

  it('금액 열의 정렬 방향을 셀까지 전달한다', () => {
    const html = renderToStaticMarkup(
      <ConsoleGrid caption="주문 목록" columns={COLUMNS} rows={ROWS} />,
    );

    /* 헤더 1 + 행 2 */
    expect(html.match(/data-align="end"/g)).toHaveLength(3);
  });

  it('caption은 접근성 이름으로만 남기고 폭 지정 컬럼에는 colgroup을 만든다', () => {
    const html = renderToStaticMarkup(
      <ConsoleGrid caption="주문 목록" columns={COLUMNS} rows={ROWS} />,
    );

    expect(html).toContain('<caption class="admin-console-grid-caption">주문 목록</caption>');
    expect(html).toContain('width:160px');
  });
});

describe('ConsoleGrid 선택', () => {
  it('selectable이 아니면 체크박스를 만들지 않는다', () => {
    const html = renderToStaticMarkup(
      <ConsoleGrid caption="주문 목록" columns={COLUMNS} rows={ROWS} />,
    );

    expect(html).not.toContain('type="checkbox"');
  });

  it('선택된 행을 체크 상태와 data-selected로 표시한다', () => {
    const html = renderToStaticMarkup(
      <ConsoleGrid
        caption="주문 목록"
        columns={COLUMNS}
        rows={ROWS}
        selectable
        selectedIds={['o1']}
      />,
    );

    expect(html).toContain('data-selected="true"');
    /* 한 행만 골랐으므로 전체선택은 아직 체크되지 않는다. */
    expect(html.match(/checked=""/g)).toHaveLength(1);
  });

  it('현재 페이지 행을 모두 고르면 전체선택 체크박스도 체크된다', () => {
    const html = renderToStaticMarkup(
      <ConsoleGrid
        caption="주문 목록"
        columns={COLUMNS}
        rows={ROWS}
        selectable
        selectedIds={['o1', 'o2']}
      />,
    );

    /* 전체선택 1 + 행 2 */
    expect(html.match(/checked=""/g)).toHaveLength(3);
  });

  /* 일괄 처리 대상이 아닌 행(이미 종결된 클레임 등)은 체크박스 자체를 주지 않는다. */
  it('selectable이 false인 행에는 체크박스를 두지 않는다', () => {
    const html = renderToStaticMarkup(
      <ConsoleGrid
        caption="주문 목록"
        columns={COLUMNS}
        rows={[ROWS[0], { ...ROWS[1], selectable: false }]}
        selectable
      />,
    );

    /* 전체선택 1 + 선택 가능한 행 1 */
    expect(html.match(/type="checkbox"/g)).toHaveLength(2);
  });

  /* hidden input 덕분에 그리드를 form으로 감싸기만 하면 server action이 선택을 받는다. */
  it('selectionName을 주면 선택된 id를 hidden input으로 내보낸다', () => {
    const html = renderToStaticMarkup(
      <ConsoleGrid
        caption="주문 목록"
        columns={COLUMNS}
        rows={ROWS}
        selectable
        selectedIds={['o1', 'o2']}
        selectionName="orderIds"
      />,
    );

    expect(html).toContain('<input type="hidden" name="orderIds" value="o1"/>');
    expect(html).toContain('<input type="hidden" name="orderIds" value="o2"/>');
    /* 표 밖에 있어야 <form> 제출에 그대로 실린다. */
    expect(html.indexOf('name="orderIds"')).toBeGreaterThan(html.indexOf('</table>'));
  });

  it('selectionName이 없으면 hidden input을 만들지 않는다', () => {
    const html = renderToStaticMarkup(
      <ConsoleGrid
        caption="주문 목록"
        columns={COLUMNS}
        rows={ROWS}
        selectable
        selectedIds={['o1']}
      />,
    );

    expect(html).not.toContain('type="hidden"');
  });

  it('일괄 액션 바 슬롯을 표 위에 렌더한다', () => {
    const html = renderToStaticMarkup(
      <ConsoleGrid caption="주문 목록" columns={COLUMNS} rows={ROWS} selectable>
        <p>일괄 액션 슬롯</p>
      </ConsoleGrid>,
    );

    expect(html.indexOf('일괄 액션 슬롯')).toBeLessThan(html.indexOf('<table'));
  });
});
