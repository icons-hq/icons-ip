import Link from 'next/link';
import type { ReactNode } from 'react';
import { ConsoleFilterField } from '@/components/admin/console';
import { Button, buttonVariants } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { SALES_PAGE_SIZES, SALES_SORT_OPTIONS, salesListHiddenFields } from '@/lib/admin/sales-list';
import { SalesDateRange } from './SalesDateRange';

/*
 * 판매관리 목록의 공용 조각 — 템플릿 룩(ADR-0028). 조회 조건의 종류·이름·URL 계약과 기간 프리셋이 입력값만
 * 고치는 동작은 스마트스토어 기준 그대로이고, 모양만 kit 부품(조회 조건 카드 · 단계 카드 · 버튼 · 입력)으로 그린다.
 * 옛 판매관리 클래스(admin-sales-*)를 쓰지 않으며, 화면·테스트가 찾는 자리는 data-sales-* 표시로 둔다.
 */

type Option = { value: string; label: string };

/** 접는 메뉴설명(기준 화면 ClaimQueueKitScreen과 같은 모양). 처음에는 펼쳐 둔다. */
export function SalesGuide({ title, children }: { title: string; children: ReactNode }) {
  return <details className="group rounded-lg border bg-muted/40 px-4 py-3 text-sm" data-sales-guide="" open>
    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-medium [&::-webkit-details-marker]:hidden">
      <strong className="min-w-0 font-medium">{title}</strong>
      <span className="shrink-0 text-xs font-normal text-muted-foreground"><span className="hidden group-open:inline">메뉴설명 접기</span><span className="group-open:hidden">메뉴설명 보기</span></span>
    </summary>
    <div className="mt-2 flex flex-col gap-1 text-muted-foreground [&_a]:font-medium [&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-4 [&_ol]:flex [&_ol]:list-decimal [&_ol]:flex-col [&_ol]:gap-1 [&_ol]:pl-5">{children}</div>
  </details>;
}

/** 조회 조건 한 칸. 값 자리에 셀렉트·입력 여러 개를 나란히 둘 수 있다. */
export function SalesFilterField({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return <ConsoleFilterField htmlFor={htmlFor} label={label}>
    <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div>
  </ConsoleFilterField>;
}

export function SalesSelect({ id, name, value, options, label, className, size }: {
  id?: string; name: string; value?: string; options: readonly Option[]; label?: string; className?: string; size?: 'sm' | 'default';
}) {
  return <NativeSelect aria-label={label} className={`max-w-full${className ? ` ${className}` : ''}`} defaultValue={value ?? options[0]?.value ?? ''} id={id} name={name} size={size}>
    {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
  </NativeSelect>;
}

export function SalesFilterPanel({
  currentHref, id, date, search, children, resetHref, now, hiddenFieldExclusions = [],
}: {
  currentHref: string;
  id: string;
  date?: { from: string | null; to: string | null; field: string; options: readonly Option[] };
  search: { value: string; name?: string; field?: string; options?: readonly Option[]; placeholder: string };
  children?: ReactNode;
  resetHref?: string;
  now?: Date;
  hiddenFieldExclusions?: readonly string[];
}) {
  const action = currentHref.split('?')[0];
  const searchHint = ['검색어 입력', '검색어를 입력하세요'].includes(search.placeholder.trim()) ? null : search.placeholder;
  const hidden = salesListHiddenFields(currentHref, ['from', 'to', 'dateField', 'query', 'q', 'field', 'status', 'stage', 'reasonType', 'originId', 'method', 'paymentMethod', 'state', 'tab', ...hiddenFieldExclusions]);
  return <form action={action} className="flex flex-col gap-3 rounded-xl border bg-card p-4 text-sm text-card-foreground print:hidden" data-sales-filters="" method="get" key={currentHref}>
    {Object.entries(hidden).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
    <div className="flex flex-wrap items-start gap-x-5 gap-y-3">
      {date ? <SalesFilterField label="조회기간" htmlFor={`${id}-date-field`}>
        <SalesSelect id={`${id}-date-field`} name="dateField" value={date.field} options={date.options} />
        <SalesDateRange key={currentHref} id={id} from={date.from} to={date.to} now={now} />
      </SalesFilterField> : null}
      <ConsoleFilterField className="min-w-[min(100%,20rem)] flex-1" htmlFor={`${id}-query`} label="상세조건">
        <div className="flex min-w-0 gap-2">
          {search.options ? <SalesSelect className="shrink-0" name="field" value={search.field} options={search.options} label="검색 유형" /> : null}
          <Input className="min-w-0 flex-1" id={`${id}-query`} type="search" name={search.name ?? 'query'} maxLength={100}
            defaultValue={search.value} placeholder="검색어를 입력하세요" aria-describedby={searchHint ? `${id}-query-hint` : undefined} />
        </div>
        {searchHint && <small className="text-xs text-muted-foreground wrap-anywhere" id={`${id}-query-hint`}>{searchHint}</small>}
      </ConsoleFilterField>
      {children}
    </div>
    <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
      <Link className={buttonVariants({ variant: 'outline' })} data-slot="button" href={resetHref ?? action}>초기화</Link>
      <Button type="submit">검색</Button>
    </div>
  </form>;
}

export function SalesResultsHeader({
  currentHref, total, pageSize, pageSizes = SALES_PAGE_SIZES, sort = 'newest', sortOptions = SALES_SORT_OPTIONS, children, unit = '건',
}: {
  currentHref: string; total: number; pageSize: number; pageSizes?: readonly number[]; sort?: string;
  sortOptions?: readonly Option[]; children?: ReactNode; unit?: string;
}) {
  const hidden = salesListHiddenFields(currentHref, ['sort', 'pageSize']);
  return <div className="flex flex-wrap items-center gap-2" data-sales-results-heading="">
    <SalesResultsTitle total={total} unit={unit} />
    <form action={currentHref.split('?')[0]} method="get" className="flex max-w-full flex-wrap items-center gap-1.5 print:hidden" key={currentHref}>
      {Object.entries(hidden).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
      <SalesSelect name="sort" value={sort} options={sortOptions} label="목록 정렬" size="sm" />
      <SalesSelect name="pageSize" value={String(pageSize)} options={pageSizes.map((size) => ({ value: String(size), label: `${size}개씩 보기` }))} label="목록 수" size="sm" />
      <Button size="sm" type="submit" variant="outline">적용</Button>
    </form>
    {children}
  </div>;
}

/** 목록 제목과 총 건수. 정렬·목록 수 폼이 없는 목록도 같은 모양을 쓴다. */
export function SalesResultsTitle({ total, unit = '건' }: { total: number; unit?: string }) {
  return <h2 className="mr-auto text-base font-medium whitespace-nowrap text-foreground">목록 <span className="text-sm font-normal text-muted-foreground">(총 <strong className="font-semibold text-foreground tabular-nums">{total.toLocaleString('ko-KR')}</strong>{unit})</span></h2>;
}

/** 처리 단계별 건수 카드(기준 화면의 단계 카드 모양). 건수를 모르면 0으로 꾸미지 않고 숫자를 비워 둔다. */
export function SalesStatusSummary({ items, label }: {
  items: readonly { label: string; href: string; count?: number; active: boolean; urgent?: boolean }[];
  label: string;
}) {
  return <nav aria-label={label} className="flex flex-col gap-2" data-sales-summary="">
    <p className="text-xs font-medium text-muted-foreground">{label}</p>
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))]">
      {items.map((item) => <Link key={item.href} href={item.href} aria-label={item.count === undefined ? item.label : `${item.label} ${item.count.toLocaleString('ko-KR')}건`} aria-current={item.active ? 'page' : undefined} data-urgent={item.urgent || undefined}
        className="flex min-w-0 flex-col gap-1 rounded-lg border bg-card px-3 py-2.5 transition-colors hover:bg-accent aria-[current=page]:border-primary aria-[current=page]:ring-1 aria-[current=page]:ring-primary">
        <span className="truncate text-xs text-muted-foreground">{item.label}</span>
        {item.count !== undefined ? <strong className={`text-xl leading-tight font-semibold tabular-nums${item.urgent ? ' text-[var(--wc-warning)]' : ''}`}>{item.count.toLocaleString('ko-KR')}<small className="ml-0.5 text-xs font-normal text-muted-foreground">건</small></strong> : null}
      </Link>)}
    </div>
  </nav>;
}
