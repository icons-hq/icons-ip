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
}

export function TabPanels({ className, defaultPanelId, idBase, onPanelChange, panels }: TabPanelsProps) {
  const [selectedId, setSelectedId] = useState(defaultPanelId ?? panels[0]?.id);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  /* defaultPanelId 가 오타거나 목록이 갈아끼워지면 어느 패널도 보이지 않는 화면이 남는다.
     선택된 id 가 목록에 없으면 첫 패널로 되돌린다. */
  const activeId = panels.some((panel) => panel.id === selectedId) ? selectedId : panels[0]?.id;

  const select = (id: string) => {
    setSelectedId(id);
    onPanelChange?.(id);
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
    <div className={`wc-tabs${className ? ` ${className}` : ''}`}>
      <div className="wc-tabs__list" role="tablist">
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
