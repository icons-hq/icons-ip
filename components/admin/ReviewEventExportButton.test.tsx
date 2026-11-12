import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { ReviewEventExportButton } from './ReviewEventExportButton';

/* 1027T-026·027: 잠긴 내려받기 버튼 옆 안내(aria-describedby)가 지금 무엇을 해야 눌리는지 말한다. */
const render = (props: Partial<Parameters<typeof ReviewEventExportButton>[0]> = {}) =>
  renderToStaticMarkup(<ReviewEventExportButton href="/admin/cs/review-events/export?mode=events" total={3} {...props} />);
const button = (html: string) => html.match(/<button[^>]*>/)?.[0] ?? '';

it('책임 확인 전에는 버튼이 잠기고, 확인란에 체크하면 내려받을 수 있다고 알린다', () => {
  const html = render();
  expect(button(html)).toContain('disabled=""');
  expect(html).toContain('현재 검색 조건의 전체 3건을 받습니다. 최대 10,000건이며 내려받은 기록이 남습니다. 보관·삭제 책임 확인란에 체크하면 내려받을 수 있습니다.');
  const describedBy = button(html).match(/aria-describedby="([^"]+)"/)?.[1];
  expect(html).toContain(`id="${describedBy}"`);
});

it('수정 중이거나 건수 상한을 넘으면 그 이유만 말한다', () => {
  const editing = render({ entries: true, disabled: true });
  expect(editing).toContain('수정 중인 내용을 저장하거나 되돌린 뒤 내려받아 주세요.');
  expect(editing).not.toContain('확인란에 체크하면');
  const tooMany = render({ total: 10001 });
  expect(tooMany).toContain('최대 10,000건입니다. 검색 조건을 좁혀주세요.');
  expect(tooMany).not.toContain('확인란에 체크하면');
});
