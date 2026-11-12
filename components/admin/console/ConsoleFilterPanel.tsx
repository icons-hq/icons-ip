import Link from 'next/link';
import type { ReactNode } from 'react';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { AdminSelect } from './AdminSelect';
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
  /** 제출·프리셋·초기화 링크에 함께 실어 보낼 고정 파라미터. 예: `{ tab: 'unpaid' }`. */
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
 * 필터 값은 GET 폼과 URL이 소유한다. 검색은 폼 제출로, 기간 프리셋과 초기화는 링크 이동으로
 * 처리한다. 선택값 잘림 안내만 클라이언트에서 측정하며, 서버 컴포넌트 안에 그대로 놓을 수 있다.
 * 필터 조건이 URL에 남아 딥링크·새로고침·뒤로가기가 유지된다.
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
  const searchHintId = search?.placeholder ? `${idPrefix}-search-hint` : undefined;

  /*
   * 조회 조건 카드(템플릿 룩, ADR-0028). 조회 조건의 종류·이름·URL 계약은 그대로이고(스마트스토어 기준),
   * 모양만 kit 부품(Input · 버튼)과 유틸리티로 그린다. 화면 고유 CSS가 닿지 않게 옛 클래스 이름을 쓰지 않는다 —
   * 화면이 children으로 더하는 조건도 `ConsoleFilterField`로 같은 칸 모양을 쓴다.
   */
  const presetBase = 'inline-flex h-7 items-center rounded-md px-2.5 text-[0.8rem] font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground aria-[current=true]:bg-background aria-[current=true]:text-primary-soft-foreground aria-[current=true]:shadow-sm';
  return (
    <form
      action={action}
      className={`${className ? `${className} ` : ''}${CONSOLE_FILTER_CARD_CLASS}`}
      data-console-filters=""
      method="get"
    >
      {Object.entries(hiddenFields ?? {}).map(([name, value]) => (
        <input key={name} name={name} type="hidden" value={value} />
      ))}

      {/* 칸은 위 기준으로 맞춘다 — 도움말 줄이 붙은 칸도 라벨·입력 줄이 이웃 칸과 같은 높이에 선다. */}
      <div className={CONSOLE_FILTER_FIELDS_CLASS}>
        {dateRange ? (
          <div className="flex min-w-0 flex-col gap-1.5" data-console-filter="period">
            <span className="text-sm leading-none font-medium" id={periodLabelId}>
              {dateRange.label ?? '조회기간'}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <div aria-labelledby={periodLabelId} className="inline-flex rounded-lg bg-muted p-0.5" role="group">
                {presets.map((preset) => {
                  const active = isConsoleDateRangeActive(preset.range, dateRange);
                  return (
                    <Link
                      aria-current={active ? 'true' : undefined}
                      className={presetBase}
                      href={presetHref(preset.range, preset.id)}
                      key={preset.id}
                    >
                      {preset.label}
                    </Link>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <label className="sr-only" htmlFor={`${idPrefix}-from`}>시작일</label>
                <Input className="w-36" defaultValue={dateRange.from ?? ''} id={`${idPrefix}-from`} name={fromName} type="date" />
                <span aria-hidden="true" className="text-muted-foreground">~</span>
                <label className="sr-only" htmlFor={`${idPrefix}-to`}>종료일</label>
                <Input className="w-36" defaultValue={dateRange.to ?? ''} id={`${idPrefix}-to`} name={toName} type="date" />
              </div>
            </div>
          </div>
        ) : null}

        {statusFilter ? (
          <ConsoleFilterField htmlFor={`${idPrefix}-status`} label={statusFilter.label ?? '상태'}>
            <AdminSelect
              defaultValue={statusFilter.value ?? ''}
              id={`${idPrefix}-status`}
              name={statusName}
              wrapperClassName="w-40"
            >
              {statusFilter.options.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </AdminSelect>
          </ConsoleFilterField>
        ) : null}

        {search ? (
          <div className="flex min-w-[min(100%,20rem)] flex-1 flex-col gap-1.5" data-console-filter="search">
            <label className="text-sm leading-none font-medium" htmlFor={`${idPrefix}-query`}>
              {search.label ?? '검색어'}
            </label>
            <div className="flex gap-2">
              {search.fields?.length ? (
                <AdminSelect
                  aria-label="검색 유형"
                  defaultValue={search.fieldValue ?? search.fields[0]?.value ?? ''}
                  name={searchFieldName}
                  wrapperClassName="w-36 shrink-0"
                >
                  {search.fields.map((field) => (
                    <option key={field.value} value={field.value}>{field.label}</option>
                  ))}
                </AdminSelect>
              ) : null}
              <Input
                aria-describedby={searchHintId}
                className="min-w-0 flex-1"
                defaultValue={search.value ?? ''}
                id={`${idPrefix}-query`}
                name={searchName}
                placeholder="검색어 입력"
                type="search"
              />
            </div>
            {search?.placeholder ? <span className="text-xs text-muted-foreground" id={searchHintId}>{search.placeholder}</span> : null}
          </div>
        ) : null}

        {children}
      </div>

      <ConsoleFilterActions>
        <Link className={buttonVariants({ variant: 'outline' })} data-slot="button" href={resetHref ?? buildHref(action, hiddenFields, {})}>
          초기화
        </Link>
        <button className={buttonVariants({ variant: 'soft' })} data-slot="button" type="submit">{submitLabel}</button>
      </ConsoleFilterActions>
    </form>
  );
}

/**
 * 조회 조건 카드의 바닥 버튼 줄 — 구분선 아래 오른쪽에 [초기화][검색] 순서로 둔다. 조회 폼을 직접 그리는 화면도
 * (클라이언트 조회·서버 액션 폼) 같은 줄을 쓴다. `start`는 같은 줄 왼쪽에 두는 안내·보조 동작이다.
 */
export function ConsoleFilterActions({ children, start }: { children: ReactNode; start?: ReactNode }) {
  return (
    <div
      className={`flex flex-wrap items-center gap-2 border-t pt-3 ${start ? 'justify-between' : 'justify-end'}`}
      data-console-filter-actions=""
    >
      {start ? <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">{start}</div> : null}
      <div className="flex flex-wrap items-center justify-end gap-2">{children}</div>
    </div>
  );
}

/** 조회 조건 카드 바깥 상자(ConsoleFilterPanel과 같은 모양). 조회 폼을 직접 그리는 화면이 form·div에 단다. */
export const CONSOLE_FILTER_CARD_CLASS = 'flex flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground';
/** 조회 조건 칸 줄(라벨 위·입력 아래 칸을 위 기준으로 감싼다). */
export const CONSOLE_FILTER_FIELDS_CLASS = 'flex flex-wrap items-start gap-x-5 gap-y-3';
/** 입력을 감싸는 조회 조건 라벨(ConsoleFilterField와 같은 글자·간격). */
export const CONSOLE_FILTER_LABEL_CLASS = 'flex min-w-0 flex-col gap-1.5 text-sm font-medium [&_input]:font-normal [&_select]:font-normal';

/** 조회 조건 한 칸(라벨 위·입력 아래). 화면이 children으로 더하는 조건도 이 모양을 쓴다. */
export function ConsoleFilterField({ children, className, htmlFor, label }: {
  children: ReactNode;
  className?: string;
  htmlFor?: string;
  label: ReactNode;
}) {
  return (
    <div className={`flex min-w-0 flex-col gap-1.5${className ? ` ${className}` : ''}`} data-console-filter="field">
      {htmlFor ? <label className="text-sm leading-none font-medium" htmlFor={htmlFor}>{label}</label>
        : <span className="text-sm leading-none font-medium">{label}</span>}
      {children}
    </div>
  );
}
