import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { RecordMasterList } from './RecordMasterList';

const items = [{ id: 'c1', name: '첫 카드', url: 'https://cdn.test/c1.webp' }, { id: 'c2', name: '그림 없는 카드', url: null }];

function render(props: Partial<Parameters<typeof RecordMasterList<typeof items[number]>>[0]> = {}) {
  return renderToStaticMarkup(<RecordMasterList ariaLabel="카드 목록" activeId="c1" items={items} labelFor={(item) => item.name} onSelect={vi.fn()} {...props} />);
}

describe('RecordMasterList', () => {
  /* 스크롤 상자 안의 줄이 눌려 글자가 겹치면 바로 보이는 깨짐이다(카드 화면 c2 줄). */
  it('줄이 스크롤 상자 안에서 줄어들지 않고 줄마다 구분선이 있다', () => {
    const html = render();
    expect(html).toMatch(/class="[^"]*\bdivide-y\b[^"]*" data-record-list="rows"/);
    expect(html.match(/<button[^>]*class="[^"]*\bshrink-0\b[^"]*"/g)).toHaveLength(2);
    expect(html).toMatch(/<button aria-current="true"[^>]*>첫 카드|<button aria-current="true"[\s\S]*?첫 카드/);
  });

  it('그림 칸은 그림이 없어도 자리를 지켜 글자 시작선이 같다', () => {
    const html = render({ thumbnailKind: 'card', thumbnailUrlFor: (item) => item.url });
    expect(html.match(/data-record-list="thumbnail"/g)).toHaveLength(2);
    expect(html.match(/<img /g)).toHaveLength(1);
  });

  it('줄을 누르면 수정으로 간다고 말하고, 검색과 조건은 목록 상자 안에 둔다', () => {
    const html = render({ filters: <select aria-label="보관 상태" />, searchTextFor: (item) => item.name });
    expect(html).toContain('줄을 누르면 오른쪽에서 수정합니다.');
    const panel = html.slice(html.indexOf('aria-label="카드 목록"'));
    expect(panel).toContain('aria-label="카드 목록 검색"');
    expect(panel).toContain('aria-label="보관 상태"');
    expect(render()).not.toContain('data-record-list="tools"');
  });

  it('빈 목록은 안내를 보인다', () => {
    expect(render({ items: [], emptyMessage: '등록된 카드가 없습니다.' })).toContain('등록된 카드가 없습니다.');
  });
});
