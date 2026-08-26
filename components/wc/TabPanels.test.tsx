import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TabPanels, type TabPanelDef } from './TabPanels';

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
});
