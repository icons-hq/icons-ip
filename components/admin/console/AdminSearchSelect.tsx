'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronDownIcon } from 'lucide-react';
import { cn } from 'cn';
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from '@/components/admin/kit/ui/command';
import { FacetedInput } from '@/components/admin/kit/ui/faceted';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/admin/kit/ui/popover';

export interface AdminSearchSelectOption {
  value: string;
  label: string;
  /** 화면에 보이지 않지만 검색에 걸리는 말(코드, 붙여 쓴 경로 등). */
  keywords?: string;
}

const NO_OPTIONS: readonly AdminSearchSelectOption[] = [];

const normalize = (text: string) => text.normalize('NFKC').toLocaleLowerCase('ko-KR');

/** 검색어의 낱말이 라벨·keywords에 모두 들어 있는 항목만 남긴다. 순서는 그대로다. */
export function filterAdminSearchSelectOptions(options: readonly AdminSearchSelectOption[], query: string): readonly AdminSearchSelectOption[] {
  const words = normalize(query).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return options;
  return options.filter((option) => {
    const text = normalize(`${option.label} ${option.keywords ?? ''}`);
    return words.every((word) => text.includes(word));
  });
}

const optionsByValue = new WeakMap<readonly AdminSearchSelectOption[], Map<string, AdminSearchSelectOption>>();

/** 지금 값의 항목. 표의 행마다 전체 목록을 훑지 않게 목록 배열 하나에 Map을 한 번만 만든다. */
export function findAdminSearchSelectOption(
  value: string,
  pinnedOptions: readonly AdminSearchSelectOption[],
  options: readonly AdminSearchSelectOption[],
): AdminSearchSelectOption | undefined {
  const pinned = pinnedOptions.find((option) => option.value === value);
  if (pinned) return pinned;
  let byValue = optionsByValue.get(options);
  if (!byValue) {
    byValue = new Map(options.map((option) => [option.value, option]));
    optionsByValue.set(options, byValue);
  }
  return byValue.get(value);
}

/**
 * 팝업을 연 뒤 칸이 화면에서 움직였는가. 조상이 스크롤될 때만 그렇다 — 포털에 뜬 팝업 안의 목록을 스크롤해도 칸은 그대로다.
 * 이벤트만 보지 않는 이유: 스크롤 이벤트는 한 프레임 늦게 와서, 방금 스크롤하고 바로 누른 칸이 열리자마자 닫힌다.
 */
export function searchSelectFieldMoved(start: { top: number; left: number }, now: { top: number; left: number }): boolean {
  return Math.abs(now.top - start.top) >= 1 || Math.abs(now.left - start.left) >= 1;
}

/* 네이티브 모달 dialog는 열릴 때 autofocus 속성이 달린 칸으로 포커스를 옮긴다. React의 autoFocus는 속성을 DOM에 남기지 않아 직접 단다. */
const markDialogAutofocus = (input: HTMLInputElement | null) => { input?.setAttribute('autofocus', ''); };

/* cmdk 항목 값은 비어 있으면 안 되고('연결 안 함'의 값이 빈 문자열이다) 앞뒤 공백이 잘린다. */
const itemValue = (value: string) => `option:${value}`;

/**
 * 검색창과 목록. 평소에는 `AdminSearchSelect`의 팝업 안에 들어간다.
 * 네이티브 모달 dialog 안에서는 포털 팝업이 dialog 뒤에 깔리므로 이 부분만 바로 그린다.
 */
export function AdminSearchSelectPanel({ dialogAutoFocus, disabled, emptyMessage = '일치하는 항목이 없습니다.', label, onChoose, options, pinnedOptions = NO_OPTIONS, searchPlaceholder = '검색', value }: {
  /** 모달 dialog가 열릴 때 검색칸에 포커스를 둔다. */
  dialogAutoFocus?: boolean;
  disabled?: boolean;
  emptyMessage?: string;
  label: string;
  onChoose: (value: string) => void;
  options: readonly AdminSearchSelectOption[];
  pinnedOptions?: readonly AdminSearchSelectOption[];
  searchPlaceholder?: string;
  value: string;
}) {
  const [query, setQuery] = useState('');
  const visible = useMemo(
    () => [...filterAdminSearchSelectOptions(pinnedOptions, query), ...filterAdminSearchSelectOptions(options, query)],
    [options, pinnedOptions, query],
  );
  const listRef = useRef<HTMLDivElement>(null);
  const searched = useRef(false);
  /* 아래쪽 값이 골라진 칸을 열면 목록이 그 값까지 내려가 있다. 검색하면 강조는 첫 결과로 옮겨 가니 스크롤도 맨 위로 올려야
     Enter가 보이지 않는 항목을 고르지 않는다. 처음 열 때는 cmdk가 고른 값까지 내려 둔 자리를 건드리지 않는다. */
  useLayoutEffect(() => {
    if (!searched.current) { searched.current = true; return; }
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [query]);
  /* 검색은 위 낱말 비교로 끝낸다. cmdk의 점수 정렬은 항목 순서를 바꾸고 DOM을 다시 끼워 넣는다. */
  return <Command className="p-0.5" defaultValue={itemValue(value)} label={`${label} 검색`} shouldFilter={false}>
    <FacetedInput disabled={disabled} maxLength={100} onValueChange={setQuery} placeholder={searchPlaceholder} ref={dialogAutoFocus ? markDialogAutofocus : undefined} value={query} variant="line" />
    {/* 항목이 수백 개라 스크롤 단서를 남긴다(사이드바와 같은 얇은 스크롤바, kit 기본은 no-scrollbar). 끝까지 내려도 뒤의 표·페이지로 스크롤이 넘어가지 않는다. */}
    <CommandList className="overscroll-contain [scrollbar-width:thin]!" label={label} ref={listRef}>
      <CommandEmpty>{emptyMessage}</CommandEmpty>
      <CommandGroup>
        {visible.map((option) => <CommandItem data-checked={option.value === value ? 'true' : undefined} disabled={disabled} key={option.value} onSelect={() => onChoose(option.value)} value={itemValue(option.value)}>
          <span className="min-w-0 flex-1 wrap-anywhere">{option.label}</span>
        </CommandItem>)}
      </CommandGroup>
    </CommandList>
  </Command>;
}

/**
 * 검색이 되는 한 칸 선택. 닫혀 있을 때는 지금 값을 보여 주는 버튼 하나뿐이고, 항목은 칸을 연 동안에만 그린다.
 * 표의 행마다 항목이 수백 개인 네이티브 select를 두면 행×항목만큼 DOM이 늘어난다(2026-11-10 실측: option 59,800개).
 * 팝업은 kit 포털로 그려서 표의 스크롤 영역에 잘리지 않고 sticky 머리 위에 뜬다.
 */
export function AdminSearchSelect({
  'aria-label': ariaLabel,
  className,
  disabled,
  emptyMessage = '일치하는 항목이 없습니다.',
  id,
  onValueChange,
  options,
  pinnedOptions = NO_OPTIONS,
  placeholder = '선택',
  searchPlaceholder = '검색',
  value,
}: {
  'aria-label': string;
  className?: string;
  disabled?: boolean;
  emptyMessage?: string;
  id?: string;
  onValueChange: (value: string) => void;
  /** 여러 칸이 같은 배열을 나눠 쓰면 값 찾기와 메모리가 한 벌로 끝난다. */
  options: readonly AdminSearchSelectOption[];
  /** 목록 맨 앞에 둘 항목(선택 해제, 지금은 고를 수 없는 현재 값 등). */
  pinnedOptions?: readonly AdminSearchSelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  value: string;
}) {
  const [open, setOpen] = useState(false);
  const fieldRef = useRef<HTMLButtonElement>(null);
  const current = findAdminSearchSelectOption(value, pinnedOptions, options);
  useEffect(() => {
    const field = fieldRef.current;
    if (!open || !field) return undefined;
    /* 연 채로 표를 스크롤하면 칸이 밀려나 팝업이 표 밖에 떠 있고, 그 상태에서 고르면 보이지 않는 행에 값이 들어간다. */
    const start = field.getBoundingClientRect();
    const closeWhenFieldMoves = () => { if (searchSelectFieldMoved(start, field.getBoundingClientRect())) setOpen(false); };
    window.addEventListener('scroll', closeWhenFieldMoves, { capture: true, passive: true });
    return () => window.removeEventListener('scroll', closeWhenFieldMoves, { capture: true });
  }, [open]);
  return <Popover onOpenChange={setOpen} open={open}>
    {/* 칸 이름은 aria-label, 지금 값은 글자로 읽히도록 combobox로 둔다(aria-label만 있는 button은 글자가 가려진다). */}
    <PopoverTrigger
      aria-label={ariaLabel}
      className={cn('flex min-h-8 w-full min-w-0 items-center gap-2 rounded-lg border border-input bg-transparent px-2.5 py-1 text-left text-sm transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-muted disabled:text-secondary-foreground', className)}
      data-admin-search-select=""
      disabled={disabled}
      id={id}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); }
      }}
      ref={fieldRef}
      role="combobox"
    >
      <span className={cn('min-w-0 flex-1 wrap-anywhere', !current && 'text-muted-foreground')}>{current?.label ?? placeholder}</span>
      <ChevronDownIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
    </PopoverTrigger>
    <PopoverContent align="start" aria-label={ariaLabel} className="w-[min(32rem,calc(100vw-2rem))] p-0">
      <AdminSearchSelectPanel emptyMessage={emptyMessage} label={ariaLabel} onChoose={(next) => { onValueChange(next); setOpen(false); }} options={options} pinnedOptions={pinnedOptions} searchPlaceholder={searchPlaceholder} value={value} />
    </PopoverContent>
  </Popover>;
}
