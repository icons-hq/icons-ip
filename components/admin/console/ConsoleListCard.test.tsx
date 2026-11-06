import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CONSOLE_TABLE_FRAME_CLASS, ConsoleListCard, ConsoleTableEmptyRow, ConsoleTableHeader } from './ConsoleListCard';

describe('ConsoleListCard', () => {
  it('주문 목록과 같은 카드 머리(제목 · (총 N건) · 동작)를 그린다', () => {
    const html = renderToStaticMarkup(
      <ConsoleListCard actions={<button type="button">새로고침</button>} title="송금 대기" total={1234}>
        <p>표</p>
      </ConsoleListCard>,
    );

    expect(html).toContain('rounded-xl border bg-card p-4');
    expect(html).toMatch(/<h2[^>]*>송금 대기<span[^>]*>\(총 <strong[^>]*>1,234<\/strong>건\)<\/span><\/h2>/);
    expect(html).toContain('새로고침');
    expect(html).toContain('<p>표</p>');
  });

  it('제목 없이 카드만 그릴 수 있고, 단위·제목 수준을 바꾼다', () => {
    expect(renderToStaticMarkup(<ConsoleListCard aria-label="신고 목록"><p>빈 목록</p></ConsoleListCard>)).not.toContain('data-console-list-head');
    const html = renderToStaticMarkup(<ConsoleListCard headingLevel={3} title="조회 결과" total={0} unit="개"><p /></ConsoleListCard>);
    expect(html).toMatch(/<h3[^>]*>조회 결과<span[^>]*>\(총 <strong[^>]*>0<\/strong>개\)/);
  });

  it('표 머리는 ConsoleGrid와 같은 회색 바탕·작은 흐린 글자다', () => {
    const html = renderToStaticMarkup(<table><ConsoleTableHeader><tr><th>이름</th></tr></ConsoleTableHeader></table>);
    for (const token of ['[&amp;_th]:bg-muted', '[&amp;_th]:text-xs', '[&amp;_th]:text-muted-foreground']) expect(html).toContain(token);
  });

  /* 좁은 화면에서 표가 가로로 넓어도 빈 목록 문구는 보이는 폭 가운데에 남는다(ConsoleGrid와 같다). */
  it('빈 행은 크기 질의 표 상자 안에서 보이는 폭 가운데에 선다', () => {
    expect(CONSOLE_TABLE_FRAME_CLASS).toContain('@container');
    const html = renderToStaticMarkup(<table><tbody><ConsoleTableEmptyRow colSpan={4}>등록된 템플릿이 없습니다.</ConsoleTableEmptyRow></tbody></table>);
    expect(html).toContain('colSpan="4"');
    expect(html).toMatch(/<div class="sticky left-0 [^"]*w-\[100cqw\][^"]*">등록된 템플릿이 없습니다.<\/div>/);
  });
});
