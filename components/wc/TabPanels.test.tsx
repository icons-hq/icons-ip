import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TabPanels, tabsStickyScrollTop, type TabPanelDef } from './TabPanels';

const panels: TabPanelDef[] = [
  { id: 'detail', label: '상세정보', content: <p>상세</p> },
  { id: 'review', label: '리뷰', count: 17, content: <p>후기</p> },
  { id: 'delivery', label: '배송/교환', content: <p>배송</p> },
];

const render = () => renderToStaticMarkup(<TabPanels idBase="good" panels={panels} />);

describe('TabPanels', () => {
  it('uses the tab roles so the group is reachable as one widget', () => {
    const html = render();

    expect(html).toContain('role="tablist"');
    expect((html.match(/role="tab"/g) ?? []).length).toBe(3);
    expect((html.match(/role="tabpanel"/g) ?? []).length).toBe(3);
  });

  /* 패널을 전부 미리 렌더하고 hidden 만 토글한다 — 첫 패널 하나만 열려 있어야 한다. */
  it('leaves only the first panel visible', () => {
    const html = render();

    const visible = [...html.matchAll(/<div\b([^>]*role="tabpanel"[^>]*)>/g)]
      .filter((panel) => !panel[1].includes('hidden'));
    expect(visible).toHaveLength(1);
    expect(visible[0][1]).toContain('id="good-panel-detail"');
  });

  /* aria-controls / aria-labelledby 가 어긋나면 스크린리더에서 탭과 패널이 끊긴다. */
  it('wires each tab to its panel in both directions', () => {
    const html = render();

    for (const id of ['detail', 'review', 'delivery']) {
      expect(html).toContain(`id="good-tab-${id}"`);
      expect(html).toContain(`aria-controls="good-panel-${id}"`);
      expect(html).toContain(`id="good-panel-${id}"`);
      expect(html).toContain(`aria-labelledby="good-tab-${id}"`);
    }

    const activeTab = html.match(/<button\b[^>]*id="good-tab-detail"[^>]*>/)?.[0] ?? '';
    const idleTab = html.match(/<button\b[^>]*id="good-tab-review"[^>]*>/)?.[0] ?? '';
    expect(activeTab).toContain('aria-selected="true"');
    expect(activeTab).toContain('wc-tabs__tab active');
    expect(idleTab).toContain('aria-selected="false"');
    /* 로빙 탭인덱스 — Tab 키는 활성 탭 하나로만 들어온다. */
    expect(activeTab).toContain('tabindex="0"');
    expect(idleTab).toContain('tabindex="-1"');
  });

  /* 개수는 별도 배지가 아니라 탭 이름에 붙는다 — 접근 가능한 이름에 같이 읽혀야 한다. */
  it('folds the count into the tab label', () => {
    expect(render()).toContain('리뷰 (17)');
  });

  /* defaultPanelId 가 오타이거나 목록이 갈아끼워지면 어느 패널도 안 보이는 화면이 남는다. */
  it('falls back to the first panel when the requested id is unknown', () => {
    const html = renderToStaticMarkup(
      <TabPanels defaultPanelId="ghost" idBase="good" panels={panels} />,
    );

    const visible = [...html.matchAll(/<div\b([^>]*role="tabpanel"[^>]*)>/g)]
      .filter((panel) => !panel[1].includes('hidden'));
    expect(visible).toHaveLength(1);
    expect(visible[0][1]).toContain('id="good-panel-detail"');
  });

  it('honours an explicit default panel', () => {
    const html = renderToStaticMarkup(
      <TabPanels defaultPanelId="review" idBase="good" panels={panels} />,
    );

    const visible = [...html.matchAll(/<div\b([^>]*role="tabpanel"[^>]*)>/g)]
      .filter((panel) => !panel[1].includes('hidden'));
    expect(visible).toHaveLength(1);
    expect(visible[0][1]).toContain('id="good-panel-review"');
  });

  /* PD-13 — 스크롤은 PDP 만 켜는 opt-in 이다. 켜도 마크업은 그대로라 홈·이벤트 허브가 같은 컴포넌트를 쓴다. */
  it('scrollOnSelect 는 마크업을 바꾸지 않는다', () => {
    expect(renderToStaticMarkup(<TabPanels idBase="good" panels={panels} scrollOnSelect />)).toBe(render());
  });
});

describe('tabsStickyScrollTop', () => {
  it('탭 묶음 머리가 sticky 자리(top)에 오는 문서 위치를 낸다', () => {
    /* 긴 패널을 읽다(탭바가 붙은 채 머리가 화면 위 1200px) 다른 탭을 고르면 머리로 되돌아간다. */
    expect(tabsStickyScrollTop({ scrollY: 3000, rootTop: -1200, stickyTop: 68 })).toBe(1732);
    /* 탭바가 화면 중간에 있으면 sticky 자리까지 내려 새 패널 첫머리를 보인다. */
    expect(tabsStickyScrollTop({ scrollY: 0, rootTop: 600, stickyTop: 81 })).toBe(519);
  });

  it('이미 그 자리면 움직이지 않고, 문서 위로 넘어가지 않는다', () => {
    expect(tabsStickyScrollTop({ scrollY: 1000, rootTop: 68, stickyTop: 68 })).toBeNull();
    expect(tabsStickyScrollTop({ scrollY: 1000, rootTop: 68.4, stickyTop: 68 })).toBeNull();
    expect(tabsStickyScrollTop({ scrollY: 10, rootTop: 20, stickyTop: 68 })).toBe(0);
  });
});
