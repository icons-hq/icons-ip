'use client';

import { useState, type ReactNode } from 'react';
import { ImageOff, Plus } from 'lucide-react';
import { AdminSidePanel } from '../console/AdminKit';
import { Button } from '../kit/ui/button';
import { Input } from '../kit/ui/input';
import type { AdminArtworkKind } from '@/lib/admin/artwork';
import { useSelectedRecord } from '../screens/record-selection';

/*
 * 목록-상세 화면의 왼쪽 목록 패널(카드·이벤트·게임·발급 정책).
 *
 * 처음 열면 오른쪽은 안내만 보이고 주 행동은 화면 머리 오른쪽의 등록 버튼 하나다. 줄을 누르면 오른쪽에서 그 항목을 수정한다.
 * 줄은 스크롤 상자 안에서 눌려 줄어들지 않고(shrink-0) 그림 칸은 그림이 없어도 자리를 지켜 글자 시작선이 같다.
 */

/** 선택한 항목 + "새로 등록 중" 상태. 저장 후 서버가 새 배열을 내려도 id로 다시 찾는다(useSelectedRecord). */
export function useRecordDetail<T extends { id: string }>(records: readonly T[], initialId: string | null = null) {
  const { selected, select: selectRecord } = useSelectedRecord(records, initialId);
  const [creating, setCreating] = useState(false);
  return {
    selected,
    creating,
    open: Boolean(selected) || creating,
    select: (record: T | null) => { setCreating(false); selectRecord(record); },
    startNew: () => { selectRecord(null); setCreating(true); focusRecordForm(); },
    close: () => { selectRecord(null); setCreating(false); focusRecordNewButton(); },
  };
}

/** 폼이 열린 다음 프레임에 첫 입력칸으로 보낸다 — 좁은 화면에서는 폼이 목록 아래에 열려 화면 변화가 안 보인다. */
function focusRecordForm() {
  requestAnimationFrame(() => {
    const form = document.querySelector<HTMLElement>('[data-record-detail="form"]');
    form?.scrollIntoView({ block: 'nearest' });
    form?.querySelector<HTMLElement>('input:not([type=hidden]), select, textarea')?.focus({ preventScroll: true });
  });
}

/** 닫기 버튼이 숨으면 포커스가 사라지므로 등록 버튼으로 돌려준다. */
function focusRecordNewButton() {
  requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-record-new]')?.focus());
}

/** 화면 머리 오른쪽의 등록 버튼. 입력 칸이 열려 있으면 그쪽의 저장이 주 행동이라 외곽선으로 물러난다. */
export function RecordNewButton({ label, onClick, open }: { label: string; onClick: () => void; open: boolean }) {
  return <Button data-record-new="" onClick={onClick} type="button" variant={open ? 'outline' : 'default'}><Plus aria-hidden="true" />{label}</Button>;
}

function RecordThumbnail({ kind, url }: { kind: AdminArtworkKind; url: string | null | undefined }) {
  return (
    <span aria-hidden="true" className="grid size-10 flex-none place-items-center overflow-hidden rounded-md bg-muted text-muted-foreground" data-record-list="thumbnail">
      {url
        // eslint-disable-next-line @next/next/no-img-element
        ? <img alt="" className={`block size-full ${kind === 'event' ? 'object-contain' : 'object-cover'}`} decoding="async" loading="lazy" src={url} />
        : <ImageOff className="size-4" />}
    </span>
  );
}

export function RecordMasterList<T extends { id: string }>({
  activeId,
  ariaLabel,
  emptyMessage,
  filters,
  headerAction,
  items,
  labelFor,
  onSelect,
  searchTextFor,
  thumbnailKind,
  thumbnailUrlFor,
}: {
  activeId: string | null;
  ariaLabel: string;
  emptyMessage?: string;
  /** 검색칸 옆에 놓을 조건(보관 상태 등). 목록 상자 안에 들어간다. */
  filters?: ReactNode;
  /** 목록 제목 줄 오른쪽에 놓을 요소(처리할 건수 등). */
  headerAction?: ReactNode;
  items: T[];
  labelFor: (item: T) => ReactNode;
  onSelect: (item: T) => void;
  /** 주면 검색칸이 생긴다(불러온 목록 안에서만 거른다). */
  searchTextFor?: (item: T) => string;
  thumbnailKind?: AdminArtworkKind;
  thumbnailUrlFor?: (item: T) => string | null | undefined;
}) {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLocaleLowerCase('ko-KR');
  const visible = needle && searchTextFor
    ? items.filter((item) => searchTextFor(item).toLocaleLowerCase('ko-KR').includes(needle))
    : items;

  return (
    <AdminSidePanel actions={headerAction} title={ariaLabel}>
      {searchTextFor || filters ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2" data-record-list="tools">
          {searchTextFor ? <Input aria-label={`${ariaLabel} 검색`} className="min-w-36 flex-1" onChange={(event) => setQuery(event.target.value)} placeholder="코드·이름 검색" type="search" value={query} /> : null}
          {filters}
        </div>
      ) : null}
      {items.length ? <p className="text-xs text-muted-foreground">줄을 누르면 오른쪽에서 수정합니다.</p> : null}
      <div className="flex max-h-[520px] min-w-0 flex-col divide-y overflow-y-auto lg:max-h-[calc(100dvh-21rem)]" data-record-list="rows">
        {!visible.length ? <p className="m-0 py-6 text-center text-sm text-muted-foreground">{needle ? '검색 결과가 없습니다.' : (emptyMessage ?? '표시할 항목이 없습니다.')}</p> : null}
        {visible.map((item) => {
          const label = labelFor(item);
          return (
            <button
              aria-current={activeId === item.id ? 'true' : undefined}
              className="flex min-h-11 w-full shrink-0 items-center justify-start gap-2.5 rounded-md px-2 py-2 text-left text-sm transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset aria-[current=true]:bg-primary-soft aria-[current=true]:font-medium aria-[current=true]:text-primary-soft-foreground"
              data-slot="button"
              key={item.id}
              onClick={() => onSelect(item)}
              type="button"
            >
              {thumbnailKind ? <RecordThumbnail kind={thumbnailKind} url={thumbnailUrlFor?.(item)} /> : null}
              {typeof label === 'string' ? <span className="min-w-0 truncate" title={label}>{label}</span> : label}
            </button>
          );
        })}
      </div>
    </AdminSidePanel>
  );
}
