import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  CONSOLE_DATE_PRESET_IDS,
  consoleDatePresets,
  isConsoleDateRangeActive,
  type ConsoleDatePresetId,
  type ConsoleDateRange,
} from './date-presets';

/** 셀렉트 한 칸의 선택지. */
export interface ConsoleFilterOption {
  value: string;
  label: string;
}

export interface ConsoleDateRangeFilter {
  /** 현재 시작일 `YYYY-MM-DD`. 비었으면 `null`. */
  from?: string | null;
  /** 현재 종료일 `YYYY-MM-DD`. 비었으면 `null`. */
  to?: string | null;
  /** 시작일 input의 `name`. 기본 `'from'`. */
  fromName?: string;
  /** 종료일 input의 `name`. 기본 `'to'`. */
  toName?: string;
  /** 필드 묶음 라벨. 기본 `'조회기간'`. */
  label?: string;
  /** 노출할 프리셋과 순서. 기본 `['today', 'week', 'month', 'quarter']`. */
  presets?: readonly ConsoleDatePresetId[];
  /**
   * 프리셋 링크 href 생성기. 주지 않으면 `action` + `hiddenFields` + 현재 상태·검색 값에
   * 프리셋 기간과 `page=1`을 얹은 기본 href를 만든다.
   */
  presetHref?: (range: ConsoleDateRange, preset: ConsoleDatePresetId) => string;
}

export interface ConsoleStatusFilter {
  /** 셀렉트 선택지. `{ value: 'all', label: '전체' }` 같은 항목도 호출자가 직접 넣는다. */
  options: ConsoleFilterOption[];
  /** 현재 값. */
  value?: string;
  /** select의 `name`. 기본 `'status'`. */
  name?: string;
  /** 필드 라벨. 기본 `'상태'`. */
  label?: string;
}

export interface ConsoleSearchFilter {
  /** 검색 유형 드롭다운 선택지(주문번호·구매자명·이메일·운송장 등). 비우면 드롭다운을 그리지 않는다. */
  fields?: ConsoleFilterOption[];
  /** 검색 유형 select의 `name`. 기본 `'searchField'`. */
  fieldName?: string;
  /** 현재 검색 유형. */
  fieldValue?: string;
  /** 검색어 input의 `name`. 기본 `'query'`. */
  name?: string;
  /** 현재 검색어. */
  value?: string;
  /** 필드 라벨. 기본 `'검색어'`. */
  label?: string;
  placeholder?: string;
}

export interface ConsoleFilterPanelProps {
  /** GET 폼이 향하는 경로. 예: `/admin/orders`. */
  action: string;
  /** 제출·프리셋·초기화 링크에 함께 실어 보낼 고정 파라미터. 예: `{ section: 'orders' }`. */
  hiddenFields?: Record<string, string>;
  /** 기간 필터. 생략하면 기간 영역 자체를 렌더하지 않는다. */
  dateRange?: ConsoleDateRangeFilter;
  /** 상태 필터. 생략하면 상태 셀렉트를 렌더하지 않는다. */
  statusFilter?: ConsoleStatusFilter;
  /** 검색 유형 + 검색어. 생략하면 검색 영역을 렌더하지 않는다. */
  search?: ConsoleSearchFilter;
  /** 초기화 링크 대상. 기본은 `action` + `hiddenFields`만 남긴 URL. */
  resetHref?: string;
  /** 제출 버튼 문구. 기본 `'검색'`. */
  submitLabel?: string;
  /** 콘솔별 추가 필터 컨트롤. 액션 버튼 앞에 붙는다. */
  children?: ReactNode;
  /** id 충돌을 피하려는 경우의 접두사. 기본 `'admin-console-filter'`. */
  idPrefix?: string;
  /** 기간 프리셋 계산 기준 시각. 테스트 주입용. */
  now?: Date;
  className?: string;
}

/** hiddenFields + 주어진 파라미터로 GET URL을 만든다. 빈 값은 URL에서 뺀다. */
function buildHref(
  action: string,
  hiddenFields: Record<string, string> | undefined,
  params: Record<string, string | null | undefined>,
) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(hiddenFields ?? {})) search.set(key, value);
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const query = search.toString();
  return query ? `${action}?${query}` : action;
}

/**
 * 콘솔 목록 화면 상단의 필터 패널.
 *
 * 클라이언트 상태가 없는 GET 폼이다. 검색은 폼 제출로, 기간 프리셋과 초기화는 링크 이동으로
 * 처리한다. 그래서 서버 컴포넌트 안에 그대로 놓을 수 있고, 필터 조건이 URL에 남아
 * 딥링크·새로고침·뒤로가기가 전부 살아 있다.
 *
 * @example
 * <ConsoleFilterPanel
 *   action="/admin/orders"
 *   dateRange={{ from: filters.from, to: filters.to }}
 *   statusFilter={{ options: STATUS_OPTIONS, value: filters.status }}
 *   search={{ fields: SEARCH_FIELDS, fieldValue: filters.searchField, value: filters.query }}
 * />
 */
export function ConsoleFilterPanel({
  action,
  children,
  className,
  dateRange,
  hiddenFields,
  idPrefix = 'admin-console-filter',
  now,
  resetHref,
  search,
  statusFilter,
  submitLabel = '검색',
}: ConsoleFilterPanelProps) {
  const statusName = statusFilter?.name ?? 'status';
  const searchFieldName = search?.fieldName ?? 'searchField';
  const searchName = search?.name ?? 'query';
  const fromName = dateRange?.fromName ?? 'from';
  const toName = dateRange?.toName ?? 'to';

  /* 프리셋 링크는 기간만 바꾸고 나머지 조건은 유지한다. 다만 page는 1로 되돌린다 —
     기간을 좁힌 뒤 5페이지에 남아 있으면 결과가 비어 보인다. */
  const presetHref = dateRange?.presetHref
    ?? ((range: ConsoleDateRange) => buildHref(action, hiddenFields, {
      [statusName]: statusFilter?.value,
      [searchFieldName]: search?.fieldValue,
      [searchName]: search?.value,
      [fromName]: range.from,
      [toName]: range.to,
      page: '1',
    }));

  const presets = dateRange
    ? consoleDatePresets(dateRange.presets ?? CONSOLE_DATE_PRESET_IDS, now)
    : [];
  const periodLabelId = `${idPrefix}-period-label`;

  return (
    <form
      action={action}
      className={`${className ? `${className} ` : ''}admin-console-filters card`}
      method="get"
    >
      {Object.entries(hiddenFields ?? {}).map(([name, value]) => (
        <input key={name} name={name} type="hidden" value={value} />
      ))}

      {dateRange ? (
        <div className="admin-console-filter-field admin-console-filter-period">
          <span className="admin-console-filter-label" id={periodLabelId}>
            {dateRange.label ?? '조회기간'}
          </span>
          <div aria-labelledby={periodLabelId} className="admin-console-filter-presets" role="group">
            {presets.map((preset) => {
              const active = isConsoleDateRangeActive(preset.range, dateRange);
              return (
                <Link
                  aria-current={active ? 'true' : undefined}
                  className={`btn btn-sm admin-console-preset${active ? ' on' : ' btn-ghost'}`}
                  href={presetHref(preset.range, preset.id)}
                  key={preset.id}
                >
                  {preset.label}
                </Link>
              );
            })}
          </div>
          <div className="admin-console-filter-dates">
            <label htmlFor={`${idPrefix}-from`}>
              <span>시작일</span>
              <input
                defaultValue={dateRange.from ?? ''}
                id={`${idPrefix}-from`}
                name={fromName}
                type="date"
              />
            </label>
            <span aria-hidden="true" className="admin-console-filter-tilde">~</span>
            <label htmlFor={`${idPrefix}-to`}>
              <span>종료일</span>
              <input
                defaultValue={dateRange.to ?? ''}
                id={`${idPrefix}-to`}
                name={toName}
                type="date"
              />
            </label>
          </div>
        </div>
      ) : null}

      {statusFilter ? (
        <div className="admin-console-filter-field">
          <label className="admin-console-filter-label" htmlFor={`${idPrefix}-status`}>
            {statusFilter.label ?? '상태'}
          </label>
          <select
            defaultValue={statusFilter.value ?? ''}
            id={`${idPrefix}-status`}
            name={statusName}
          >
            {statusFilter.options.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
      ) : null}

      {search ? (
        <div className="admin-console-filter-field admin-console-filter-search">
          <label className="admin-console-filter-label" htmlFor={`${idPrefix}-query`}>
            {search.label ?? '검색어'}
          </label>
          <div className="admin-console-filter-search-row">
            {search.fields?.length ? (
              <select
                aria-label="검색 유형"
                defaultValue={search.fieldValue ?? search.fields[0]?.value ?? ''}
                name={searchFieldName}
              >
                {search.fields.map((field) => (
                  <option key={field.value} value={field.value}>{field.label}</option>
                ))}
              </select>
            ) : null}
            <input
              defaultValue={search.value ?? ''}
              id={`${idPrefix}-query`}
              name={searchName}
              placeholder={search.placeholder ?? '검색어를 입력하세요'}
              type="search"
            />
          </div>
        </div>
      ) : null}

      {children}

      <div className="admin-console-filter-actions">
        <button className="btn btn-sm" type="submit">{submitLabel}</button>
        <Link
          className="btn btn-sm btn-ghost"
          href={resetHref ?? buildHref(action, hiddenFields, {})}
        >
          초기화
        </Link>
      </div>
    </form>
  );
}
