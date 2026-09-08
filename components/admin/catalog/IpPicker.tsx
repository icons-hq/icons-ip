'use client';

import { useRef, useState, useTransition } from 'react';
import {
  searchAdminGoodsAction,
  searchAdminIpsAction,
  type IpPickerSearchResult,
} from '@/app/admin/ip-picker-actions';
import { ErrorText } from '@/components/admin/fields';
import {
  GOOD_PICKER_RECENT_KEY,
  IP_PICKER_RECENT_KEY,
  buildPickerOptions,
  parseRecentIps,
  rememberRecentIp,
  serializeRecentIps,
  type IpPickerOption,
} from '@/lib/admin/ip-picker';
import { useBrowserStoredValue, writeBrowserStoredValue } from './browser-store';

const SEARCH_DEBOUNCE_MS = 220;

/** 무엇을 고르는 선택기인가. 검색·최근 목록·문구만 다르고 **동작은 하나**다. */
interface PickerKind {
  emptyResultText: string;
  idleHint: string;
  recentKey: string;
  search: (query: string, selectedId: string | null) => Promise<IpPickerSearchResult>;
  searchPlaceholder: string;
}

const IP_KIND: PickerKind = {
  emptyResultText: '해당하는 IP가 없습니다.',
  idleHint: '최근 고른 IP 가 먼저 나옵니다.',
  recentKey: IP_PICKER_RECENT_KEY,
  search: searchAdminIpsAction,
  searchPlaceholder: 'IP 이름 또는 코드로 검색',
};

const GOOD_KIND: PickerKind = {
  emptyResultText: '해당하는 상품이 없습니다.',
  idleHint: '최근 고른 상품이 먼저 나옵니다.',
  recentKey: GOOD_PICKER_RECENT_KEY,
  search: searchAdminGoodsAction,
  searchPlaceholder: '상품 이름 또는 코드로 검색',
};

interface IpPickerProps {
  /** 서버가 그려 준 첫 후보(상위 N + 지금 값). JS 가 죽어도 이 목록으로 고를 수 있다. */
  defaultOptions: readonly IpPickerOption[];
  disabled?: boolean;
  /** 값을 비울 수 있는 자리의 라벨(예: 「플랫폼/합동 이벤트」). 없으면 비우기 칸을 그리지 않는다. */
  emptyLabel?: string;
  error?: string;
  label: string;
  name: string;
  required?: boolean;
  selected: IpPickerOption | null;
  /** 고른 값을 바깥 상태가 쥐어야 할 때(수신자 수 추정처럼) 넘긴다. 없으면 폼이 값을 쥔다. */
  value?: string;
  onValueChange?: (next: string) => void;
}

/*
 * IP 검색형 선택기 (규모 ④).
 *
 * **라디오로 만든 이유**: 값을 나르는 것이 진짜 폼 컨트롤이라 `required` 가 브라우저에서
 * 그대로 동작하고, JS 가 없어도 서버가 그려 준 후보로 고를 수 있다. 숨김 input + 버튼으로
 * 만들면 둘 다 잃는다(숨김 필드는 브라우저가 검증하지 않는다).
 *
 * 검색은 서버가 한다 — 1만 개를 내려받아 거르면 화면이 먼저 죽는다.
 */
export function IpPicker(props: IpPickerProps) {
  return <CatalogPicker {...props} kind={IP_KIND} />;
}

/** 굿즈 선택기 (현업 슬라이스 4). 「이 상품을 산 고객만」 쿠폰이 기준 상품을 여기서 고른다. */
export function GoodPicker(props: IpPickerProps) {
  return <CatalogPicker {...props} kind={GOOD_KIND} />;
}

function CatalogPicker({
  defaultOptions,
  disabled,
  emptyLabel,
  error,
  kind,
  label,
  name,
  onValueChange,
  required,
  selected,
  value,
}: IpPickerProps & { kind: PickerKind }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<readonly IpPickerOption[]>(defaultOptions);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const recents = parseRecentIps(useBrowserStoredValue(kind.recentKey));
  const options = buildPickerOptions({ query, results, recents, selected });
  const errorId = error ? `${name}-error` : undefined;

  const runSearch = (next: string) => {
    startTransition(async () => {
      const result = await kind.search(next, selected?.id ?? null);
      setSearchError(result.error ?? null);
      /* 실패했으면 목록을 비우지 않는다 — 보고 있던 후보가 사라지는 게 더 나쁘다. */
      if (!result.error) setResults(result.options);
    });
  };

  const onQueryChange = (next: string) => {
    setQuery(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => runSearch(next), SEARCH_DEBOUNCE_MS);
  };

  const onPick = (option: IpPickerOption | null) => {
    onValueChange?.(option?.id ?? '');
    if (option) {
      writeBrowserStoredValue(kind.recentKey, serializeRecentIps(rememberRecentIp(recents, option)));
    }
  };

  return (
    <fieldset className="admin-ip-picker" data-pending={pending || undefined} disabled={disabled}>
      <legend className="mono admin-ip-picker-legend">{label}</legend>
      <input
        aria-label={`${label} 검색`}
        className="admin-field-control"
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder={kind.searchPlaceholder}
        type="search"
        value={query}
      />
      <IpPickerOptions
        controlled={value !== undefined}
        emptyLabel={emptyLabel}
        emptyResultText={kind.emptyResultText}
        errorId={errorId}
        hasError={Boolean(error)}
        name={name}
        onPick={onPick}
        options={options}
        required={required}
        selectedId={value ?? selected?.id ?? ''}
      />
      <p className="admin-ip-picker-hint">
        {searchError
          ? searchError
          : query
            ? `검색 결과 ${options.length}개${options.length >= 50 ? ' — 더 좁혀서 검색하세요' : ''}`
            : kind.idleHint}
      </p>
      <ErrorText id={errorId}>{error}</ErrorText>
    </fieldset>
  );
}

function IpPickerOptions({
  controlled,
  emptyLabel,
  emptyResultText,
  errorId,
  hasError,
  name,
  onPick,
  options,
  required,
  selectedId,
}: {
  controlled: boolean;
  emptyLabel?: string;
  emptyResultText: string;
  errorId?: string;
  hasError: boolean;
  name: string;
  onPick: (option: IpPickerOption | null) => void;
  options: readonly IpPickerOption[];
  required?: boolean;
  selectedId: string;
}) {
  return (
    <div aria-describedby={errorId} aria-invalid={hasError} className="admin-ip-picker-list" role="radiogroup">
      {emptyLabel ? (
        <label className="admin-ip-picker-option">
          <input
            checked={controlled ? selectedId === '' : undefined}
            defaultChecked={controlled ? undefined : selectedId === ''}
            name={name}
            onChange={() => onPick(null)}
            type="radio"
            value=""
          />
          <span>{emptyLabel}</span>
        </label>
      ) : null}
      {options.map((option) => (
        <label
          className="admin-ip-picker-option"
          data-archived={option.archivedAt ? 'true' : undefined}
          key={option.id}
        >
          <input
            checked={controlled ? selectedId === option.id : undefined}
            defaultChecked={controlled ? undefined : selectedId === option.id}
            /* 보관된 항목은 새로 고를 수 없다 — 지금 그 값인 레코드에서만 남는다. */
            disabled={Boolean(option.archivedAt) && option.id !== selectedId}
            name={name}
            onChange={() => onPick(option)}
            required={required}
            type="radio"
            value={option.id}
          />
          <span>{option.archivedAt ? `[보관] ${option.title}` : option.title}</span>
          <span className="mono admin-ip-picker-id">{option.id}</span>
        </label>
      ))}
      {options.length === 0 ? <p className="admin-ip-picker-hint">{emptyResultText}</p> : null}
    </div>
  );
}
