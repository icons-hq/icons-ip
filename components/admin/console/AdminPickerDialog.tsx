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
  /** 추가 조건 하나(예: 카테고리). 첫 항목은 '전체'(value '')로 둔다. */
  filterLabel?: string;
  filterOptions?: readonly AdminPickerOption[];
  /** 상품처럼 사진으로 알아보는 대상이면 썸네일 칸을 둔다. */
  showImages?: boolean;
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
  /** 여러 개 고르기: 고른 뒤에도 창을 닫지 않고 [완료]로 닫는다. */
  multiple?: boolean;
  /** 이 줄을 고를 수 없는 이유(예: '지금 편집 중인 상품'). 조회에서 뺄 수 없는 경우에만 쓴다. */
  rowBlocked?: (row: T) => string | null;
  /** 줄 오른쪽 동작을 직접 그린다(링크로 이동하는 창 등). 주면 [선택] 버튼 대신 쓴다. */
  rowAction?: (row: T, state: { busy: boolean }) => ReactNode;
  /** 창을 쓸 수 없는 이유. 있으면 검색·선택을 모두 막고 이 글을 보인다. */
  blockedReason?: string | null;
  /** 목록 아래에 더 놓을 내용(추가 선택지·주의 글). */
  footer?: ReactNode;
}

const LABEL_CLASS = 'text-sm leading-snug font-medium text-foreground';
const INPUT_CLASS = 'h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50';
const LOAD_FAILED = '목록을 불러오지 못했습니다. 잠시 뒤 다시 검색해주세요.';

/** 선택창의 본문. 창(모달·포털) 없이 그린다 — `AdminPickerDialog`가 감싼다. */
export function AdminPickerPanel<T>({
  description, load, rowKey, rowView, onSelect, onClose, searchFields, searchPlaceholder = '이름으로 찾기', filterLabel = '조건', filterOptions,
  showImages = false, unit = '개', excludedNote, emptyText = '조건에 맞는 항목이 없습니다.', selectLabel = '선택', selectedKeys, onDeselect,
  multiple = false, rowBlocked, rowAction, blockedReason = null, footer,
}: AdminPickerPanelProps<T>) {
  const id = useId();
  const first = (): AdminPickerRequest => ({ query: '', field: searchFields?.[0]?.value ?? '', filter: filterOptions?.[0]?.value ?? '', page: 1 });
  const [filters, setFilters] = useState(first);
  const [applied, setApplied] = useState(first);
  const [data, setData] = useState<AdminPickerPage<T> | null>(null);
  const [busy, setBusy] = useState(true);
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
    return () => { alive.current = false; };
    // 창을 열 때 한 번만 첫 페이지를 읽는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function search(next: AdminPickerRequest) {
    if (busy || blockedReason) return;
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
  async function choose(row: T) {
    if (busy || blockedReason) return;
    setBusy(true); setError('');
    let keepOpen = false;
    try { keepOpen = await onSelect(row) === false; }
    catch { keepOpen = true; if (alive.current) setError('선택한 항목을 적용하지 못했습니다. 다시 선택해주세요.'); }
    if (!alive.current) return;
    setBusy(false);
    if (!keepOpen && !multiple) onClose();
  }
  const locked = busy || Boolean(blockedReason);
  const selected = new Set(selectedKeys ?? []);
  const submit = () => { void search({ ...filters, page: 1 }); };
  return <section className="flex min-w-0 flex-col gap-4 text-sm" data-admin-picker="">
    {description ? <p className="text-muted-foreground">{description}</p> : null}
    {blockedReason ? <p className="text-destructive" role="alert">{blockedReason}</p> : null}
    <div aria-label="찾기" className="flex min-w-0 flex-wrap items-end gap-3" role="search">
      {searchFields && searchFields.length > 1 ? <div className="flex min-w-0 basis-40 flex-col gap-2">
        <label className={LABEL_CLASS} htmlFor={`${id}-field`}>검색 대상</label>
        <NativeSelect className="w-full" disabled={locked} id={`${id}-field`} onChange={(event) => setFilters((current) => ({ ...current, field: event.target.value }))} value={filters.field}>
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
        <NativeSelect className="w-full" disabled={locked} id={`${id}-filter`} onChange={(event) => setFilters((current) => ({ ...current, filter: event.target.value }))} value={filters.filter}>
          {filterOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </NativeSelect>
      </div> : null}
      <button className={buttonVariants({ variant: 'outline' })} data-slot="button" disabled={locked} onClick={submit} type="button"><Search aria-hidden="true" />검색</button>
    </div>
    <div className="flex min-w-0 flex-col gap-1">
      <p className="text-muted-foreground tabular-nums" role="status">{busy ? '불러오고 있습니다.' : `검색 결과 ${(data?.total ?? 0).toLocaleString('ko-KR')}${unit}`}</p>
      {excludedNote ? <p className="text-xs text-muted-foreground" data-admin-picker-excluded="">{excludedNote}</p> : null}
    </div>
    {error ? <p className="text-destructive wrap-anywhere" role="alert">{error}</p> : null}
    <ul className="m-0 flex max-h-[min(27.5rem,50svh)] min-w-0 list-none flex-col overflow-y-auto rounded-lg border p-0 empty:hidden" data-admin-picker-list="">
      {data?.rows.map((row) => {
        const key = rowKey(row), view = rowView(row), picked = selected.has(key), blocked = rowBlocked?.(row) ?? null;
        return <li className={`grid min-w-0 items-center gap-3 border-b p-3 last:border-b-0 data-picked:bg-muted/40 ${showImages ? 'grid-cols-[3rem_minmax(0,1fr)_auto]' : 'grid-cols-[minmax(0,1fr)_auto]'}`} data-picked={picked || undefined} key={key}>
          {showImages ? view.imageUrl ? <img alt="" className="size-12 rounded-md bg-muted object-cover" height={48} src={view.imageUrl} width={48} /> : <span aria-hidden="true" className="size-12 rounded-md bg-muted" /> : null}
          <div className="flex min-w-0 flex-col gap-0.5 wrap-anywhere"><strong className="font-medium">{view.title}</strong>{view.meta ? <small className="text-xs text-muted-foreground">{view.meta}</small> : null}</div>
          {rowAction ? rowAction(row, { busy: locked })
            : blocked ? <span className="text-xs text-muted-foreground">{blocked}</span>
            : picked ? <span className="flex items-center gap-2"><span className="text-xs font-medium text-muted-foreground">선택됨</span>{onDeselect ? <button className={buttonVariants({ variant: 'ghost', size: 'sm' })} data-slot="button" disabled={locked} onClick={() => onDeselect(row)} type="button">빼기</button> : null}</span>
            : <button className={buttonVariants({ variant: 'outline', size: 'sm' })} data-slot="button" disabled={locked} onClick={() => void choose(row)} type="button">{selectLabel}</button>}
        </li>;
      })}
    </ul>
    {!busy && data && data.total === 0 && !error ? <p className="py-6 text-center text-muted-foreground">{emptyText}</p> : null}
    <ConsolePagination disabled={locked || !data} label="선택창 목록 페이지" onPageChange={(page) => void search({ ...applied, page })} page={data?.page ?? 1} pageSize={data?.pageSize ?? ADMIN_PICKER_PAGE_SIZE} total={data?.total ?? 0} unit={unit} />
    {footer}
    <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-4">
      <button className={buttonVariants({ variant: multiple ? 'default' : 'ghost' })} data-slot="button" onClick={onClose} type="button">{multiple ? '완료' : '닫기'}</button>
    </div>
  </section>;
}

/**
 * 공용 선택창. 바깥 폼과 떨어지게 body로 포털하고 모달로 띄운다.
 * 열림 상태는 부르는 쪽이 가진다: `{open ? <AdminPickerDialog … onClose={() => setOpen(false)} /> : null}`.
 */
export function AdminPickerDialog<T>({ title, ...panel }: AdminPickerPanelProps<T> & { title: string }) {
  if (typeof document === 'undefined') return null;
  return createPortal(<div className="wc-admin" onChange={(event) => event.stopPropagation()} onInput={(event) => event.stopPropagation()} onSubmit={(event) => event.stopPropagation()}>
    <CustomerServiceDialog onClose={panel.onClose} title={title} wide>
      <AdminPickerPanel {...panel} />
    </CustomerServiceDialog>
  </div>, document.body);
}
