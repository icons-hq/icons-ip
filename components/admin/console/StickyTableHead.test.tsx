import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/admin/kit/ui/table';
import { ConsoleGrid } from './ConsoleGrid';
import { ADMIN_TOP_BAR_OFFSET, StickyTableHead } from './StickyTableHead';

/*
 * 표 머리글 고정(ADM-009): 복제 머리글은 고정될 때만(클라이언트에서 진짜 머리글이 상단 막대 밑으로 지난 뒤) 마운트된다.
 * 서버 렌더·평소에는 DOM에 없어 진짜 표 마크업(접근성 이름·체크박스 수)이 그대로다. 위치·가로 스크롤 동기화는 브라우저에서 본다.
 */
const METRICS = { stuck: true, left: 24, width: 480, border: 1, columns: [120, 360], tableWidth: 480 };

describe('표 머리글 고정', () => {
  it('상단 막대(48px) 아래에 고정되고 보조기기에는 숨는다', () => {
    expect(ADMIN_TOP_BAR_OFFSET).toBe(48);
    const html = renderToStaticMarkup(
      <StickyTableHead cloneScrollRef={{ current: null }} metrics={METRICS} scrollRef={{ current: null }}>
        <tr><th>번호</th><th>이름</th></tr>
      </StickyTableHead>,
    );
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('data-sticky-head=""');
    expect(html).toContain('fixed');
    expect(html).toMatch(/top:48px;left:24px;width:480px/);
    expect(html).toContain('<col style="width:120px"/>');
    expect(html).toContain('<th>번호</th>');
  });

  it('고정되지 않았으면 아무것도 그리지 않는다', () => {
    const html = renderToStaticMarkup(
      <StickyTableHead cloneScrollRef={{ current: null }} metrics={{ ...METRICS, stuck: false }} scrollRef={{ current: null }}><tr /></StickyTableHead>,
    );
    expect(html).toBe('');
  });

  it('서버 렌더 ConsoleGrid·kit Table에는 복제 머리글이 없다', () => {
    const grid = renderToStaticMarkup(
      <ConsoleGrid caption="시험 목록" columns={[{ key: 'a', label: '번호' }, { key: 'b', label: '이름' }]} rows={[{ id: '1', cells: ['1', '가'] }]} />,
    );
    expect(grid).not.toContain('data-sticky-head');
    expect(grid.match(/<th /g)).toHaveLength(2);
    const table = renderToStaticMarkup(
      <Table stickyHeader><TableHeader><TableRow><TableHead>번호</TableHead></TableRow></TableHeader><TableBody><TableRow><TableCell>1</TableCell></TableRow></TableBody></Table>,
    );
    expect(table).not.toContain('data-sticky-head');
    expect(table.match(/<th /g)).toHaveLength(1);
  });
});
