'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { searchErpItemsAction } from '@/app/admin/erp-item-actions';
import type { ErpItemMatch } from '@/lib/admin/erp-items';
import {
  createErpItemSearchScheduler,
  erpItemListPlacement,
  nextErpItemHighlight,
  type ErpItemListPlacement,
} from '@/lib/admin/erp-item-search';

export type ErpItemNameInputProps = {
  value: string;
  onChange: (value: string) => void;
  /** 반입된 ERP 품목을 고르면 호출한다. 직접 입력만 한 경우에는 호출하지 않는다. */
  onSelect?: (item: ErpItemMatch) => void;
  ariaLabel: string;
  ariaDescribedBy?: string;
  maxLength?: number;
  placeholder?: string;
  disabled?: boolean;
};

function placementFor(input: HTMLInputElement | null | undefined): ErpItemListPlacement | null {
  if (!input || typeof window === 'undefined') return null;
  return erpItemListPlacement(input.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight });
}

/**
 * 옵션별 ERP 품명 입력. props 시그니처는 상품 편집기와 ERP 품목 반입 작업이
 * 함께 쓰는 고정 계약이다.
 *
 * 2자 이상 입력이 250ms 멈추면 반입된 ERP 품목을 검색해 최대 8개를 제안한다
 * (ARIA combobox: ↑↓ 이동, Enter 선택, Esc 닫기). 제안이 없거나 검색이 실패해도
 * 입력을 막지 않고, 직접 입력한 값은 그대로 저장된다.
 */
export function ErpItemNameInput({ value, onChange, onSelect, ariaLabel, ariaDescribedBy, maxLength, placeholder, disabled }: ErpItemNameInputProps) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<ErpItemMatch[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [placement, setPlacement] = useState<ErpItemListPlacement | null>(null);
  const [scheduler] = useState(() => createErpItemSearchScheduler({
    search: searchErpItemsAction,
    onResults: (next) => {
      setItems(next);
      setActive(-1);
      setOpen(next.length > 0);
    },
  }));
  const expanded = open && items.length > 0 && !disabled;
  const optionId = (index: number) => `${listId}-option-${index}`;

  useEffect(() => () => scheduler.cancel(), [scheduler]);
  useEffect(() => {
    if (!expanded) return undefined;
    const update = () => setPlacement(placementFor(inputRef.current));
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [expanded]);

  const close = () => {
    setOpen(false);
    setActive(-1);
  };
  const choose = (item: ErpItemMatch) => {
    scheduler.cancel();
    close();
    onChange(item.name);
    onSelect?.(item);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent?.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!items.length) return;
      event.preventDefault();
      if (!expanded) setPlacement(placementFor(event.currentTarget));
      setOpen(true);
      setActive(nextErpItemHighlight(expanded ? active : -1, items.length, event.key));
      return;
    }
    if (event.key === 'Enter' && expanded && active >= 0 && items[active]) {
      event.preventDefault();
      choose(items[active]);
      return;
    }
    if (event.key === 'Escape' && expanded) {
      event.preventDefault();
      close();
    }
  };

  return <div className="admin-erp-item-combobox">
    <input
      ref={inputRef}
      role="combobox"
      aria-autocomplete="list"
      aria-expanded={expanded}
      aria-controls={listId}
      aria-activedescendant={expanded && active >= 0 ? optionId(active) : undefined}
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
      autoComplete="off"
      value={value}
      maxLength={maxLength}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(event) => {
        onChange(event.target.value);
        /* 결과가 오기 전 입력 위치로 목록 자리를 잡아 둔다. 열린 뒤에는 스크롤·크기 변경을 따라간다. */
        setPlacement(placementFor(event.currentTarget));
        scheduler.request(event.target.value);
      }}
      onKeyDown={handleKeyDown}
      onBlur={() => {
        scheduler.cancel();
        close();
      }}
    />
    <ul
      id={listId}
      role="listbox"
      aria-label={`${ariaLabel} 제안`}
      className="admin-erp-item-combobox__list"
      hidden={!expanded}
      style={expanded && placement ? placement : undefined}
    >
      {expanded ? items.map((item, index) => <li
        key={item.code}
        id={optionId(index)}
        role="option"
        aria-selected={index === active}
        className="admin-erp-item-combobox__option"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => choose(item)}
      >
        <span className="admin-erp-item-combobox__name">{item.name}</span>
        <span className="admin-erp-item-combobox__meta">{item.code}{item.category ? ` · ${item.category}` : ''}</span>
      </li>) : null}
    </ul>
  </div>;
}
