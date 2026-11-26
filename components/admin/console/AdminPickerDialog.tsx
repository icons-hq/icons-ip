/* eslint-disable @next/next/no-img-element -- 목록 썸네일은 이미 호스팅된 공개 이미지를 고정 크기로 보인다. */
'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Search } from 'lucide-react';
import { ConsolePagination } from '@/components/admin/console/ConsolePagination';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { CustomerServiceDialog } from '@/components/admin/screens/CustomerServiceDialog';
import { ADMIN_PICKER_PAGE_SIZE, type AdminPickerLoader, type AdminPickerPage, type AdminPickerRequest } from '@/lib/admin/picker';

/*
 * 공용 선택창(docs/admin-screen-rules.md 규칙 1·2).
 *
 * 상품·카테고리·템플릿·그룹처럼 "다른 대상을 골라 넣는 칸"은 모두 이 창을 쓴다. 화면마다 따로 짠 인라인 검색·전체 드롭다운을 새로 만들지 않는다.
 *   검색(검색 대상·검색어·추가 조건) → 결과 수 → 20개씩 목록(상품은 사진) → 줄마다 [선택] → 페이지 이동.
 *   사진 보관함처럼 사진으로만 구분하는 대상은 같은 흐름을 격자(`layout="grid"`)로 보인다.
 * 고를 수 없는 항목은 조회(load) 단계에서 빼고 `excludedNote` 한 줄로 알린다. 목록에 넣고 눌렀을 때 거절하지 않는다.
 * 상품 폼 안에서 열리므로 항상 body로 포털해 바깥 폼의 제출·자동저장 이벤트와 섞이지 않게 한다.
 * 버튼은 네이티브 button에 kit 모양을 입힌다 — 화면 시험이 이 컴포넌트를 함수로 불러 네이티브 버튼을 찾는다.
 */

export interface AdminPickerRowView {
  /** 줄의 이름(굵게). */
  title: ReactNode;
  /** 이름 아래 한 줄(코드·분류·상태). 내부 번호는 넣지 않는다(화면 규칙 8). */
  meta?: ReactNode;
  /** `showImages`일 때의 썸네일. 없으면 빈 칸을 같은 크기로 둔다. */
  imageUrl?: string | null;
}

export interface AdminPickerOption { value: string; label: string }

export interface AdminPickerPanelProps<T> {
  /** 창 맨 위 한두 문장: 무엇을 고르고, 고르면 무엇이 바뀌는지. */
  description?: ReactNode;
  load: AdminPickerLoader<T>;
  rowKey: (row: T) => string;
  rowView: (row: T) => AdminPickerRowView;
  /** 고른 뒤의 일. `false`를 돌려주면 창을 닫지 않는다(오류를 창 안에 보일 때). */
  onSelect: (row: T) => void | boolean | Promise<void | boolean>;
  onClose: () => void;
  /** 검색 대상이 둘 이상일 때의 선택지(예: 상품명 / 상품 자동코드). */
  searchFields?: readonly AdminPickerOption[];
  searchPlaceholder?: string;
  /** 추가 조건 하나(예: 카테고리). 첫 항목은 '전체'(value '')로 둔다. 조건을 바꾸면 [검색]을 누르지 않아도 첫 쪽부터 바로 다시 조회한다(적어 둔 검색어는 그대로 쓴다). */
  filterLabel?: string;
  filterOptions?: readonly AdminPickerOption[];
  /** 상품처럼 사진으로 알아보는 대상이면 썸네일 칸을 둔다. */
  showImages?: boolean;
  /**
   * 목록 모양. 기본 'list'는 줄 목록(48px 썸네일)이다.
   * 'grid'는 사진을 크게 보이는 격자(사진 + 이름 + [선택])로, 이름이 아니라 사진으로 구분하는 대상(사진 보관함)에 쓴다.
   * 격자는 `showImages`와 관계없이 사진 칸을 둔다. 검색·페이지·여러 개 고르기·[선택] 동작은 줄 목록과 같다.
   */
  layout?: 'list' | 'grid';
  /** 결과 수의 단위(개·건). */
  unit?: string;
  /** 조회에서 뺀 항목을 알리는 한 줄(예: "옵션이 없는 상품은 목록에서 뺐습니다."). */
  excludedNote?: string;
  emptyText?: string;
  /** 줄 버튼 이름. */
  selectLabel?: string;
  /** 이미 고른 항목의 키. 그 줄은 '선택됨'으로 보인다. */
  selectedKeys?: readonly string[];
  /** 주면 '선택됨' 줄에 [빼기]를 보인다(여러 개 고르기). */
  onDeselect?: (row: T) => void;
  /**
   * `onDeselect`가 있을 때 이 줄만 뺄 수 없게 한다. 뺄 수 있으면 null, 뺄 수 없으면 그 까닭을 돌려준다([빼기] 자리에 글로 보인다).
   * 까닭 없이 [빼기]만 숨기려면 빈 글자를 돌려준다(창을 열기 전부터 들어 있던 항목처럼 여기서 뺄 일이 없는 줄).
   */
  deselectBlocked?: (row: T) => string | null;
  /** 고른 줄에 '선택됨' 대신 보일 글(예: 들어간 자리 '추가 이미지 2'). 돌려준 것이 없으면 '선택됨'이다. */
  selectedLabel?: (row: T) => string | null | undefined;
  /** 여러 개 고르기: 고른 뒤에도 창을 닫지 않고 [완료]로 닫는다. */
  multiple?: boolean;
  /**
   * 여러 개 고르기에서 창을 닫는 버튼의 글자. 기본은 '완료'다. 한 개 고르기의 [닫기]는 바뀌지 않는다.
   * 주면 닫는 버튼을 보조 모양으로 그린다 — 주 동작이 `footer`에 따로 있는 창([N개 등록] 등)에서 주 버튼이 둘로 보이지 않게 한다.
   * 주지 않으면 [완료]가 지금처럼 주 버튼이다(`footer`에 개수·주의 글만 둔 창도 그대로다).
   */
  closeLabel?: string;
  /**
   * 창을 열 때 검색어 칸에 미리 넣어 둘 글. 첫 조회도 이 검색어로 한다(같은 검색을 줄마다 다시 적지 않게).
   * 넣어 둔 글은 통째로 선택된 채 열려, 다른 검색어를 바로 치면 바뀐다. 창이 열린 뒤에 값을 바꿔도 다시 조회하지 않는다.
   */
  initialQuery?: string;
  /** 이 줄을 고를 수 없는 이유(예: '지금 편집 중인 상품'). 조회에서 뺄 수 없는 경우에만 쓴다. */
  rowBlocked?: (row: T) => string | null;
  /** 줄 오른쪽 동작을 직접 그린다(링크로 이동하는 창 등). 주면 [선택] 버튼 대신 쓴다. */
  rowAction?: (row: T, state: { busy: boolean }) => ReactNode;
  /** 창을 쓸 수 없는 이유. 있으면 검색·선택을 모두 막고 이 글을 보인다. */
  blockedReason?: string | null;
  /** 목록 아래에 더 놓을 내용(추가 선택지·주의 글). */
  footer?: ReactNode;
  /** 고른 항목을 적용하는 중인지 알린다. 창(AdminPickerDialog)이 그동안 닫히지 않게 한다. */
  onSelectingChange?: (selecting: boolean) => void;
}

const LABEL_CLASS = 'text-sm leading-snug font-medium text-foreground';
const INPUT_CLASS = 'h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50';
const LOAD_FAILED = '목록을 불러오지 못했습니다. 잠시 뒤 다시 검색해주세요.';
/* 목록 상자. 줄 목록은 테두리 안에 줄을 쌓고, 격자는 칸마다 테두리를 둔다(바깥 여백은 칸의 포커스 링이 잘리지 않게 한다). */
const LIST_CLASS = 'm-0 flex max-h-[min(27.5rem,50svh)] min-w-0 list-none flex-col overflow-y-auto rounded-lg border p-0 empty:hidden';
const GRID_CLASS = 'm-0 grid max-h-[min(36rem,56svh)] min-w-0 list-none grid-cols-2 gap-2.5 overflow-y-auto p-0.5 empty:hidden sm:grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] sm:gap-3';

/** [선택]을 누른 자리: 선택창 본문과 그 줄이 목록에서 몇 번째였는지. DOM이 없는 곳(화면 시험)에서는 null. */
function pickerFocusAnchor(pressed?: Element | null): { panel: Element; index: number } | null {
  const panel = pressed?.closest?.('[data-admin-picker]'), item = pressed?.closest?.('li');
  if (!panel || !item?.parentElement) return null;
  return { panel, index: Array.prototype.indexOf.call(item.parentElement.children, item) };
}
/**
 * 여러 개 고르기에서 고른 뒤, 누른 [선택]이 사라져 포커스를 잃었을 때만 다음에 고를 수 있는 [선택]으로 옮긴다
 * (누른 줄 아래에서 먼저 찾고, 없으면 목록 처음, 그래도 없으면 검색어 칸). 포커스가 창 안 다른 곳에 있으면 건드리지 않는다.
 */
function restorePickerFocus(anchor: { panel: Element; index: number }) {
  if (typeof requestAnimationFrame !== 'function') return;
  /* 고른 결과가 화면에 그려진 뒤에 본다(두 프레임 뒤). */
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const { panel, index } = anchor, active = panel.ownerDocument.activeElement;
    if (!panel.isConnected || (active && active !== panel.ownerDocument.body && panel.contains(active) && !(active as HTMLButtonElement).disabled)) return;
    const selects = [...panel.querySelectorAll<HTMLButtonElement>('[data-admin-picker-list] > li')]
      .map((item, position) => ({ position, button: item.querySelector<HTMLButtonElement>('[data-admin-picker-select]:not(:disabled)') }))
      .filter((entry): entry is { position: number; button: HTMLButtonElement } => Boolean(entry.button));
    const next = selects.find((entry) => entry.position >= index) ?? selects[0];
    (next?.button ?? panel.querySelector<HTMLElement>('[data-dialog-autofocus]'))?.focus();
  }));
}

/** 선택창의 본문. 창(모달·포털) 없이 그린다 — `AdminPickerDialog`가 감싼다. */
export function AdminPickerPanel<T>({
  description, load, rowKey, rowView, onSelect, onClose, searchFields, searchPlaceholder = '이름으로 찾기', filterLabel = '조건', filterOptions,
  showImages = false, unit = '개', excludedNote, emptyText = '조건에 맞는 항목이 없습니다.', selectLabel = '선택', selectedKeys, onDeselect,
  multiple = false, rowBlocked, rowAction, blockedReason = null, footer, onSelectingChange, layout = 'list', closeLabel, initialQuery = '',
  deselectBlocked, selectedLabel,
}: AdminPickerPanelProps<T>) {
  const id = useId();
  const first = (): AdminPickerRequest => ({ query: initialQuery, field: searchFields?.[0]?.value ?? '', filter: filterOptions?.[0]?.value ?? '', page: 1 });
  const [filters, setFilters] = useState(first);
  const [applied, setApplied] = useState(first);
  const [data, setData] = useState<AdminPickerPage<T> | null>(null);
  /* 조회 중(busy)과 고른 항목을 적용하는 중(selecting)은 다르다. 조회 중에는 새 검색을 받아 가장 최근 조회만 반영하고, 적용 중에는 검색·선택·닫기를 모두 막는다. */
  const [busy, setBusy] = useState(true);
  const [selecting, setSelecting] = useState(false);
  const [error, setError] = useState('');
  /* 가장 최근 조회만 화면에 반영한다(느린 응답이 새 검색 결과를 덮지 않게). */
  const sequence = useRef(0), alive = useRef(false), loader = useRef(load);
  useEffect(() => { loader.current = load; }, [load]);
  useEffect(() => {
    alive.current = true;
    const version = ++sequence.current;
    loader.current(first()).then((result) => {
      if (!alive.current || sequence.current !== version) return;
      if ('error' in result) setError(result.error); else setData(result);
    }).catch(() => { if (alive.current && sequence.current === version) setError(LOAD_FAILED); })
      .finally(() => { if (alive.current && sequence.current === version) setBusy(false); });
    /* 미리 넣어 둔 검색어는 통째로 선택해 둔다. 창이 열리며 이 칸이 포커스를 받으면 바로 다른 검색어를 칠 수 있다. */
    if (initialQuery && typeof document !== 'undefined') (document.getElementById(`${id}-query`) as HTMLInputElement | null)?.select?.();
    return () => { alive.current = false; };
    // 창을 열 때 한 번만 첫 페이지를 읽는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function search(next: AdminPickerRequest) {
    if (selecting || blockedReason) return;
    const version = ++sequence.current;
    setBusy(true); setError('');
    try {
      const result = await loader.current(next);
      if (!alive.current || sequence.current !== version) return;
      if ('error' in result) setError(result.error);
      else { setData(result); setApplied({ ...next, page: result.page }); }
    } catch { if (alive.current && sequence.current === version) setError(LOAD_FAILED); }
    finally { if (alive.current && sequence.current === version) setBusy(false); }
  }
  async function choose(row: T, pressed?: Element | null) {
    if (busy || selecting || blockedReason) return;
    /* 여러 개 고르기에서 고른 줄의 [선택]은 '선택됨'으로 바뀌며 사라진다. 누른 자리를 기억해 두었다가 키보드 포커스를 다음 [선택]으로 옮긴다. */
    const anchor = multiple ? pickerFocusAnchor(pressed) : null;
    setSelecting(true); onSelectingChange?.(true); setError('');
    let keepOpen = false;
    try { keepOpen = await onSelect(row) === false; }
    catch { keepOpen = true; if (alive.current) setError('선택한 항목을 적용하지 못했습니다. 다시 선택해주세요.'); }
    onSelectingChange?.(false);
    if (!alive.current) return;
    setSelecting(false);
    if (!keepOpen && !multiple) onClose();
    else if (anchor) restorePickerFocus(anchor);
  }
  const locked = busy || selecting || Boolean(blockedReason);
  /* 검색은 조회 중에도 받는다(창을 열자마자 넣은 검색어가 버려지지 않게). 적용 중이거나 창을 쓸 수 없을 때만 막는다. */
  const searchLocked = selecting || Boolean(blockedReason);
  const selected = new Set(selectedKeys ?? []);
  const grid = layout === 'grid';
  const submit = () => { void search({ ...filters, page: 1 }); };
  /* 조건(보기·범위·카테고리)은 고르는 즉시 목록이 바뀐다 — 바꿔 놓고 [검색]을 누르지 않아 목록이 그대로인 일이 없게 한다.
     적어 둔 검색어를 함께 넘기고 첫 쪽부터 읽는다. 같은 값을 다시 고르면 조회하지 않고, 앞선 조회가 끝나지 않았어도 가장 최근 조회만 반영된다. */
  const changeFilter = (filter: string) => {
    if (filter === filters.filter) return;
    const next = { ...filters, filter };
    setFilters(next);
    void search({ ...next, page: 1 });
  };
  /* 고른 줄의 [빼기]. 그 줄만 뺄 수 없으면 버튼 자리에 까닭을 글로 보인다(까닭이 빈 글자면 아무것도 두지 않는다). */
  const pickedRowDeselect = (row: T) => {
    if (!onDeselect) return null;
    const reason = deselectBlocked?.(row) ?? null;
    if (reason !== null) return reason ? <span className="text-xs text-muted-foreground">{reason}</span> : null;
    return <button className={buttonVariants({ variant: 'ghost', size: 'sm' })} data-slot="button" disabled={locked} onClick={() => onDeselect(row)} type="button">빼기</button>;
  };
  return <section className="flex min-w-0 flex-col gap-4 text-sm" data-admin-picker="">
    {description ? <p className="text-muted-foreground">{description}</p> : null}
    {blockedReason ? <p className="text-destructive" role="alert">{blockedReason}</p> : null}
    <div aria-label="찾기" className="flex min-w-0 flex-wrap items-end gap-3" role="search">
      {searchFields && searchFields.length > 1 ? <div className="flex min-w-0 basis-40 flex-col gap-2">
        <label className={LABEL_CLASS} htmlFor={`${id}-field`}>검색 대상</label>
        <NativeSelect className="w-full" disabled={searchLocked} id={`${id}-field`} onChange={(event) => setFilters((current) => ({ ...current, field: event.target.value }))} value={filters.field}>
          {searchFields.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </NativeSelect>
      </div> : null}
      <div className="flex min-w-0 flex-1 basis-56 flex-col gap-2">
        <label className={LABEL_CLASS} htmlFor={`${id}-query`}>검색어</label>
        <input className={INPUT_CLASS} data-dialog-autofocus="" data-slot="input" disabled={Boolean(blockedReason)} id={`${id}-query`} maxLength={100} placeholder={searchPlaceholder} type="search" value={filters.query}
          onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); submit(); } }} />
      </div>
      {filterOptions && filterOptions.length > 1 ? <div className="flex min-w-0 basis-48 flex-col gap-2">
        <label className={LABEL_CLASS} htmlFor={`${id}-filter`}>{filterLabel}</label>
        <NativeSelect className="w-full" disabled={searchLocked} id={`${id}-filter`} onChange={(event) => changeFilter(event.target.value)} value={filters.filter}>
          {filterOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </NativeSelect>
      </div> : null}
      <button className={buttonVariants({ variant: 'outline' })} data-slot="button" disabled={searchLocked} onClick={submit} type="button"><Search aria-hidden="true" />검색</button>
    </div>
    <div className="flex min-w-0 flex-col gap-1">
      <p className="text-muted-foreground tabular-nums" role="status">{selecting ? '적용하고 있습니다.' : busy ? '불러오고 있습니다.' : `검색 결과 ${(data?.total ?? 0).toLocaleString('ko-KR')}${unit}`}</p>
      {excludedNote ? <p className="text-xs text-muted-foreground" data-admin-picker-excluded="">{excludedNote}</p> : null}
    </div>
    {error ? <p className="text-destructive wrap-anywhere" role="alert">{error}</p> : null}
    <ul className={grid ? GRID_CLASS : LIST_CLASS} data-admin-picker-layout={grid ? 'grid' : undefined} data-admin-picker-list="">
      {data?.rows.map((row) => {
        const key = rowKey(row), view = rowView(row), picked = selected.has(key), blocked = rowBlocked?.(row) ?? null;
        /* 줄 오른쪽(격자에서는 칸 아래) 동작. 두 모양이 같은 것을 쓴다. */
        const action = rowAction ? rowAction(row, { busy: locked })
          : blocked ? <span className="text-xs text-muted-foreground">{blocked}</span>
          : picked ? <span className="flex min-w-0 flex-wrap items-center gap-2"><span className="text-xs font-medium text-muted-foreground">{selectedLabel?.(row) || '선택됨'}</span>{pickedRowDeselect(row)}</span>
          : <button className={buttonVariants({ variant: 'outline', size: 'sm' })} data-admin-picker-select="" data-slot="button" disabled={locked} onClick={(event?: { currentTarget: Element }) => void choose(row, event?.currentTarget)} type="button">{selectLabel}</button>;
        /* 격자: 원본 사진이라 화면에 들어올 때만 내려받고(loading), 크기는 CSS(w-full·aspect-square)가 정한다. 잘리지 않게 통째로 보인다(object-contain). */
        if (grid) return <li className="flex min-w-0 flex-col gap-2 rounded-lg border bg-card p-2.5 text-card-foreground data-picked:bg-muted/40" data-picked={picked || undefined} key={key}>
          {view.imageUrl ? <img alt="" className="aspect-square w-full rounded-md bg-muted object-contain" decoding="async" loading="lazy" src={view.imageUrl} /> : <span aria-hidden="true" className="aspect-square w-full rounded-md bg-muted" />}
          <div className="flex min-w-0 flex-col gap-0.5 wrap-anywhere"><strong className="line-clamp-2 font-medium">{view.title}</strong>{view.meta ? <small className="text-xs text-muted-foreground">{view.meta}</small> : null}</div>
          <div className="mt-auto flex min-h-7 flex-wrap items-center gap-2">{action}</div>
        </li>;
        return <li className={`grid min-w-0 items-center gap-3 border-b p-3 last:border-b-0 data-picked:bg-muted/40 ${showImages ? 'grid-cols-[3rem_minmax(0,1fr)_auto]' : 'grid-cols-[minmax(0,1fr)_auto]'}`} data-picked={picked || undefined} key={key}>
          {showImages ? view.imageUrl ? <img alt="" className="size-12 rounded-md bg-muted object-cover" height={48} src={view.imageUrl} width={48} /> : <span aria-hidden="true" className="size-12 rounded-md bg-muted" /> : null}
          <div className="flex min-w-0 flex-col gap-0.5 wrap-anywhere"><strong className="font-medium">{view.title}</strong>{view.meta ? <small className="text-xs text-muted-foreground">{view.meta}</small> : null}</div>
          {action}
        </li>;
      })}
    </ul>
    {!busy && data && data.total === 0 && !error ? <p className="py-6 text-center text-muted-foreground">{emptyText}</p> : null}
    <ConsolePagination disabled={locked || !data} label="선택창 목록 페이지" onPageChange={(page) => void search({ ...applied, page })} page={data?.page ?? 1} pageSize={data?.pageSize ?? ADMIN_PICKER_PAGE_SIZE} total={data?.total ?? 0} unit={unit} />
    {footer}
    <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-4">
      <button className={buttonVariants({ variant: multiple && closeLabel === undefined ? 'default' : 'ghost' })} data-slot="button" disabled={selecting} onClick={onClose} type="button">{multiple ? closeLabel ?? '완료' : '닫기'}</button>
    </div>
  </section>;
}

/**
 * 공용 선택창. 바깥 폼과 떨어지게 body로 포털하고 모달로 띄운다.
 * 열림 상태는 부르는 쪽이 가진다: `{open ? <AdminPickerDialog … onClose={() => setOpen(false)} /> : null}`.
 */
export function AdminPickerDialog<T>({ title, ...panel }: AdminPickerPanelProps<T> & { title: string }) {
  /* 고른 항목을 적용하는 동안에는 닫기·Esc를 막는다. 닫힌 뒤에 늦게 온 응답이 값을 채우지 않게 한다. */
  const [selecting, setSelecting] = useState(false);
  if (typeof document === 'undefined') return null;
  return createPortal(<div className="wc-admin" onChange={(event) => event.stopPropagation()} onInput={(event) => event.stopPropagation()} onSubmit={(event) => event.stopPropagation()}>
    <CustomerServiceDialog busy={selecting} onClose={panel.onClose} title={title} wide>
      <AdminPickerPanel {...panel} onSelectingChange={setSelecting} />
    </CustomerServiceDialog>
  </div>, document.body);
}
