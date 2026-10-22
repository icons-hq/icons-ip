'use client';

import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

export interface TabPanelDef {
  id: string;
  label: string;
  count?: number;
  content: ReactNode;
}

export interface TabPanelsProps {
  idBase: string;
  panels: TabPanelDef[];
  defaultPanelId?: string;
  onPanelChange?: (id: string) => void;
  className?: string;
  /**
   * 탭을 고르면 탭바가 sticky 자리에 오도록 탭 묶음 머리로 스크롤한다(opt-in, 기본 꺼짐).
   * 긴 패널을 읽다 다른 탭을 고르면 새 패널의 첫머리가 화면 밖에 남기 때문이다(PDP 하부 탭).
   * 홈·이벤트 허브처럼 탭이 짧은 표면은 켜지 않는다 — 고를 때마다 화면이 움직이면 안 된다.
   */
  scrollOnSelect?: boolean;
}

/**
 * 탭바가 sticky 자리(top 오프셋)에 오게 하는 문서 스크롤 위치. 이미 그 자리면 null.
 * rootTop 은 탭 묶음 머리의 뷰포트 기준 위치, stickyTop 은 탭바의 sticky top 값이다.
 */
export function tabsStickyScrollTop(state: { scrollY: number; rootTop: number; stickyTop: number }): number | null {
  const target = Math.max(0, Math.round(state.scrollY + state.rootTop - state.stickyTop));
  return Math.abs(target - state.scrollY) < 1 ? null : target;
}

function scrollTabsToStickyTop(root: HTMLElement | null, list: HTMLElement | null) {
  if (!root || !list) return;
  const top = tabsStickyScrollTop({
    scrollY: window.scrollY,
    rootTop: root.getBoundingClientRect().top,
    /* 탭바의 실제 sticky top(px)을 읽는다 — 표면 CSS 가 전역 크롬 높이 변수(`--wc-sticky-chrome-h`)와
       대체값으로 정한 값이 여기서 이미 풀려 있어, 크롬 높이가 바뀌어도 같은 자리로 맞춘다.
       sticky 가 아니면(top: auto) 0 — 탭 묶음 머리를 화면 맨 위로 둔다. */
    stickyTop: Number.parseFloat(window.getComputedStyle(list).top) || 0,
  });
  if (top === null) return;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top, behavior: reduceMotion ? 'instant' : 'smooth' });
}

export function TabPanels({ className, defaultPanelId, idBase, onPanelChange, panels, scrollOnSelect = false }: TabPanelsProps) {
  const [selectedId, setSelectedId] = useState(defaultPanelId ?? panels[0]?.id);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  /* defaultPanelId 가 오타거나 목록이 갈아끼워지면 어느 패널도 보이지 않는 화면이 남는다.
     선택된 id 가 목록에 없으면 첫 패널로 되돌린다. */
  const activeId = panels.some((panel) => panel.id === selectedId) ? selectedId : panels[0]?.id;

  const select = (id: string) => {
    setSelectedId(id);
    onPanelChange?.(id);
    if (scrollOnSelect) scrollTabsToStickyTop(rootRef.current, listRef.current);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = panels.length - 1;
    let next = -1;
    if (event.key === 'ArrowRight') next = index === last ? 0 : index + 1;
    else if (event.key === 'ArrowLeft') next = index === 0 ? last : index - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = last;
    if (next < 0) return;

    const panel = panels[next];
    if (!panel) return;
    event.preventDefault();
    select(panel.id);
    tabRefs.current[panel.id]?.focus();
  };

  return (
    <div ref={rootRef} className={`wc-tabs${className ? ` ${className}` : ''}`}>
      <div ref={listRef} className="wc-tabs__list" role="tablist">
        {panels.map((panel, index) => {
          const active = panel.id === activeId;
          return (
            <button
              aria-controls={`${idBase}-panel-${panel.id}`}
              aria-selected={active}
              className={`wc-tabs__tab${active ? ' active' : ''}`}
              id={`${idBase}-tab-${panel.id}`}
              key={panel.id}
              onClick={() => select(panel.id)}
              onKeyDown={(event) => onKeyDown(event, index)}
              ref={(node) => { tabRefs.current[panel.id] = node; }}
              role="tab"
              /* 로빙 탭인덱스 — 탭 목록은 Tab 키 한 번에 들어오고 안쪽 이동은 화살표가 맡는다. */
              tabIndex={active ? 0 : -1}
              type="button"
            >
              {panel.count != null ? `${panel.label} (${panel.count})` : panel.label}
            </button>
          );
        })}
      </div>
      {panels.map((panel) => (
        <div
          aria-labelledby={`${idBase}-tab-${panel.id}`}
          className="wc-tabs__panel"
          hidden={panel.id !== activeId}
          id={`${idBase}-panel-${panel.id}`}
          key={panel.id}
          role="tabpanel"
          tabIndex={0}
        >
          {panel.content}
        </div>
      ))}
    </div>
  );
}
