'use client';

import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

export interface CategorySheetTab {
  id: 'categories' | 'ips';
  label: string;
  content: ReactNode;
}

const TAB_ID_BASE = 'wc-catsheet';

/* ③ [카테고리 | 온라인 팝업] 탭. 공용 TabPanels 와 같은 마크업·키보드(로빙 탭인덱스, ←/→/Home/End)지만 고른 패널만 DOM 에 둔다.
   모달 포커스 트랩(useOverlayA11y)은 패널 안 포커스 후보의 처음·끝을 DOM 순서로 고르므로, 숨긴(hidden) 패널과 그 링크가 남아 있으면
   끝 후보가 보이지 않는 요소가 돼 마지막 타일에서 Tab 이 대화상자 밖으로 새고 Shift+Tab 이 닫기 버튼에서 멈춘다(리뷰 l5-ui-1).
   그래서 이 시트는 비활성 패널을 렌더하지 않는다 — 시트 안의 포커스 후보는 전부 보이는 요소다. */
export function CategorySheetTabs({ defaultTabId, tabs }: { defaultTabId?: CategorySheetTab['id']; tabs: CategorySheetTab[] }) {
  const [selectedId, setSelectedId] = useState(defaultTabId ?? tabs[0]?.id);
  const tabRefs = useRef<Partial<Record<CategorySheetTab['id'], HTMLButtonElement | null>>>({});
  const active = tabs.find((tab) => tab.id === selectedId) ?? tabs[0];
  if (!active) return null;

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = tabs.length - 1;
    let next = -1;
    if (event.key === 'ArrowRight') next = index === last ? 0 : index + 1;
    else if (event.key === 'ArrowLeft') next = index === 0 ? last : index - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = last;
    const tab = tabs[next];
    if (!tab) return;
    event.preventDefault();
    setSelectedId(tab.id);
    tabRefs.current[tab.id]?.focus();
  };

  return (
    <div className="wc-tabs wc-catsheet__tabs">
      <div className="wc-tabs__list" role="tablist">
        {tabs.map((tab, index) => {
          const selected = tab.id === active.id;
          return (
            <button
              /* 패널은 고른 탭 것만 있으므로 aria-controls 도 그 탭에만 둔다(없는 id 를 가리키지 않는다). */
              aria-controls={selected ? `${TAB_ID_BASE}-panel-${tab.id}` : undefined}
              aria-selected={selected}
              className={`wc-tabs__tab${selected ? ' active' : ''}`}
              id={`${TAB_ID_BASE}-tab-${tab.id}`}
              key={tab.id}
              onClick={() => setSelectedId(tab.id)}
              onKeyDown={(event) => onKeyDown(event, index)}
              ref={(node) => { tabRefs.current[tab.id] = node; }}
              role="tab"
              tabIndex={selected ? 0 : -1}
              type="button"
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <div
        aria-labelledby={`${TAB_ID_BASE}-tab-${active.id}`}
        className="wc-tabs__panel"
        id={`${TAB_ID_BASE}-panel-${active.id}`}
        key={active.id}
        role="tabpanel"
        tabIndex={0}
      >
        {active.content}
      </div>
    </div>
  );
}
