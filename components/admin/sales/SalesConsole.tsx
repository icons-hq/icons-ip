import Link from 'next/link';
import type { ReactNode } from 'react';
import { ChevronDown, type LucideIcon } from 'lucide-react';
import { ConsoleFilterField } from '@/components/admin/console';
import { ADMIN_COUNT_CARD_GRID_CLASS, AdminCountCard, type AdminCountTone } from '@/components/admin/console/AdminCountCard';
import { Button, buttonVariants } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { SALES_PAGE_SIZES, SALES_SORT_OPTIONS, salesListHiddenFields } from '@/lib/admin/sales-list';
import { commerceReferenceLabel } from '@/lib/commerce-number';
import { formatOrderDate } from '@/lib/orders';
import { SalesDateRange } from './SalesDateRange';
import { SalesFilterFold } from './SalesFilterFold';

/*
 * 판매관리 목록의 공용 조각 — 템플릿 룩(ADR-0028). 조회 조건의 종류·이름·URL 계약과 기간 프리셋이 입력값만
 * 고치는 동작은 스마트스토어 기준 그대로이고, 모양만 kit 부품(조회 조건 카드 · 단계 카드 · 버튼 · 입력)으로 그린다.
 * 옛 판매관리 클래스(admin-sales-*)를 쓰지 않으며, 화면·테스트가 찾는 자리는 data-sales-* 표시로 둔다.
 */

type Option = { value: string; label: string };

/**
 * 접는 메뉴설명. 매일 쓰는 화면의 목록을 밀어내지 않도록 처음에는 접어 두고(ADR-0029),
 * 카드가 아니라 제목 아래 한 줄로 그린다 — 같은 모양의 안내 상자가 화면마다 표 한 줄 자리를 차지하지 않게 한다.
 */
export function SalesGuide({ title, children }: { title: string; children: ReactNode }) {
  return <details className="group text-sm" data-sales-guide="">
    <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
      <span className="min-w-0">{title}</span>
      <span className="shrink-0 text-xs underline underline-offset-4"><span className="hidden group-open:inline">메뉴설명 접기</span><span className="group-open:hidden">메뉴설명 보기</span></span>
    </summary>
    <div className="mt-2 flex flex-col gap-1 rounded-lg bg-muted/40 px-3 py-2.5 text-muted-foreground [&_a]:font-medium [&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-4 [&_ol]:flex [&_ol]:list-decimal [&_ol]:flex-col [&_ol]:gap-1 [&_ol]:pl-5">{children}</div>
  </details>;
}

/**
 * 긴 식별값(UUID)은 주문·배송 번호가 없을 때 쓰는 것과 같은 끝 8자로 줄여 보이고 전체 값은 title에 둔다.
 * 앞자리는 줄마다 같아 보이는 일이 있어 끝자리로 구분한다. 검색·링크에 쓰는 값은 그대로다.
 */
export function ShortId({ value, className }: { value: string; className?: string }) {
  return <span className={`tabular-nums${className ? ` ${className}` : ''}`} title={value}>{value.length > 12 ? commerceReferenceLabel(value) : value}</span>;
}

/** `YYYY-MM-DD` 달력 날짜를 화면 공통 표기(2026. 11. 9.)로 보인다. */
export function formatSalesDay(day: string) {
  return formatOrderDate(`${day}T12:00:00+09:00`);
}

const KST_OFFSET_MS = 9 * 3_600_000;
const DAY_MS = 86_400_000;

/**
 * 두 시각의 한국 달력 날짜 차이(to − from, ms). '오늘'·'N일째'는 달력으로 센다 — 24시간 단위로 세면 어젯밤 주문이
 * '오늘'이 되고 자정을 넘긴 건의 날수가 하루 늦는다.
 */
export function kstDayDiff(from: number, to: number) {
  return Math.floor((to + KST_OFFSET_MS) / DAY_MS) - Math.floor((from + KST_OFFSET_MS) / DAY_MS);
}

/**
 * 접히는 카드. 접힌 한 줄에 제목·상태·요약을 보이고 설명과 입력은 펼쳐서 본다 — 설정 카드가 처리할 목록을 밀어내지 않게 한다.
 * 닫아도 내용은 DOM에 남아 입력값과 양식 제출이 그대로다.
 */
export function SalesDisclosureCard({ title, status, summary, children, openLabel = '설정 펼치기', closeLabel = '설정 접기', id, defaultOpen = false }: {
  title: string; status?: ReactNode; summary?: ReactNode; children: ReactNode; openLabel?: string; closeLabel?: string; id?: string;
  /** 처음부터 펼친다(예: 다른 화면에서 이 카드로 바로 연 경우). 그 뒤 접고 펴기는 운영자가 한다. */
  defaultOpen?: boolean;
}) {
  return <details className="group min-w-0 scroll-mt-16 rounded-xl border bg-card text-sm text-card-foreground" data-sales-disclosure="" id={id} open={defaultOpen || undefined}>
    <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 rounded-xl px-4 py-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
      <h3 className="text-sm leading-snug font-semibold text-foreground">{title}</h3>
      {status}
      {summary ? <span className="min-w-0 text-muted-foreground">{summary}</span> : null}
      <span className="ml-auto flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
        <span className="group-open:hidden">{openLabel}</span><span className="hidden group-open:inline">{closeLabel}</span>
        <ChevronDown aria-hidden="true" className="size-4 transition-transform group-open:rotate-180" />
      </span>
    </summary>
    <div className="flex min-w-0 flex-col gap-4 border-t p-4 sm:p-5">{children}</div>
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
  currentHref, id, date, search, children, more, moreActive = false, resetHref, now, hiddenFieldExclusions = [],
}: {
  currentHref: string;
  id: string;
  date?: { from: string | null; to: string | null; field: string; options: readonly Option[] };
  search: { value: string; name?: string; field?: string; options?: readonly Option[]; placeholder: string };
  children?: ReactNode;
  /** 매일 쓰지 않는 조건. 접어 두어 표가 첫 화면에 들어오게 하고, 접어도 검색할 때 값이 함께 간다. */
  more?: ReactNode;
  /** 접힌 조건에 지금 값이 걸려 있으면 펼쳐서 보인다. */
  moreActive?: boolean;
  resetHref?: string;
  now?: Date;
  hiddenFieldExclusions?: readonly string[];
}) {
  const action = currentHref.split('?')[0];
  const searchHint = ['검색어 입력', '검색어를 입력하세요'].includes(search.placeholder.trim()) ? null : search.placeholder;
  const hidden = salesListHiddenFields(currentHref, ['from', 'to', 'dateField', 'query', 'q', 'field', 'status', 'stage', 'reasonType', 'originId', 'method', 'paymentMethod', 'state', 'tab', ...hiddenFieldExclusions]);
  /* 조회 버튼을 입력과 같은 줄 끝에 둔다 — 버튼만의 줄이 처리할 목록을 한 줄씩 밀어낸다. */
  const actions = <>
    <Link className={buttonVariants({ variant: 'ghost' })} data-slot="button" href={resetHref ?? action}>초기화</Link>
    <Button type="submit" variant="soft">검색</Button>
  </>;
  const fields = <>
    {date ? <SalesFilterField label="조회기간" htmlFor={`${id}-date-field`}>
      <SalesSelect id={`${id}-date-field`} name="dateField" value={date.field} options={date.options} />
      <SalesDateRange key={currentHref} id={id} from={date.from} to={date.to} now={now} />
    </SalesFilterField> : null}
    <ConsoleFilterField className={`${more ? 'min-w-[min(100%,17rem)]' : 'min-w-[min(100%,20rem)]'} flex-1`} htmlFor={`${id}-query`} label="상세조건">
      <div className="flex min-w-0 gap-2">
        {search.options ? <SalesSelect className="shrink-0" name="field" value={search.field} options={search.options} label="검색 유형" /> : null}
        <Input className="min-w-0 flex-1" id={`${id}-query`} type="search" name={search.name ?? 'query'} maxLength={100}
          defaultValue={search.value} placeholder="검색어를 입력하세요" title={more && searchHint ? searchHint : undefined} aria-describedby={searchHint ? `${id}-query-hint` : undefined} />
      </div>
      {/* 접는 조건이 있는 화면은 한 줄로 끝나도록 안내를 눈에서 감추고 입력칸 도움말로 둔다. */}
      {searchHint && <small className={more ? 'sr-only' : 'text-xs text-muted-foreground wrap-anywhere'} id={`${id}-query-hint`}>{searchHint}</small>}
    </ConsoleFilterField>
    {children}
  </>;
  return <form action={action} className="flex flex-col gap-3 rounded-xl border bg-card p-4 text-sm text-card-foreground print:hidden" data-sales-filters="" method="get" key={currentHref}>
    {Object.entries(hidden).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
    {more
      ? <SalesFilterFold actions={actions} defaultOpen={moreActive} fields={fields} id={id} more={more} />
      : <div className="flex flex-wrap items-start gap-x-5 gap-y-3">
        {fields}
        <div className="ml-auto flex items-center gap-2 self-end">{actions}</div>
      </div>}
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
      {/* 목록이 바뀌는 검색은 조회 조건의 '검색'이다 — 정렬·목록 수 적용은 그보다 낮춘다. */}
      <Button size="sm" type="submit" variant="outline">적용</Button>
    </form>
    {children}
  </div>;
}

/** 목록 제목과 총 건수. 정렬·목록 수 폼이 없는 목록도 같은 모양을 쓴다. */
export function SalesResultsTitle({ total, unit = '건' }: { total: number; unit?: string }) {
  return <h2 className="mr-auto text-base font-semibold whitespace-nowrap text-foreground">목록 <span className="text-sm font-normal text-muted-foreground">(총 <strong className="font-semibold text-foreground tabular-nums">{total.toLocaleString('ko-KR')}</strong>{unit})</span></h2>;
}

/** 처리 단계별 건수 카드(기준 화면의 단계 카드 모양). 건수를 모르면 0으로 꾸미지 않고 숫자를 비워 둔다. */
export function SalesStatusSummary({ items, label, aside, extra, hideLabel = false }: {
  items: readonly { label: string; href: string; count?: number; active: boolean; urgent?: boolean; tone?: AdminCountTone; icon?: LucideIcon }[];
  label: string;
  /** 카드 줄 오른쪽 끝에 붙는 상태 표시. 첫 화면의 높이를 늘리지 않는다. */
  aside?: ReactNode;
  /** 필터 링크가 없는 참고 건수 카드. 단계 카드 뒤에 같은 줄로 선다. */
  extra?: ReactNode;
  /** 카드만으로 뜻이 분명하면 단계 이름 줄을 눈으로는 감춘다(화면 낭독기는 aria-label로 읽는다). */
  hideLabel?: boolean;
}) {
  /* 8칸은 넓은 화면에서 한 줄에 세운다 — 마지막 칸만 둘째 줄에 남으면 표가 한 줄 밀린다. */
  const grid = items.length === 8 ? 'grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8' : ADMIN_COUNT_CARD_GRID_CLASS;
  return <nav aria-label={label} className="flex flex-col gap-2" data-sales-summary="">
    {hideLabel ? null : <p className="text-xs font-medium text-muted-foreground">{label}</p>}
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
      <div className={`${grid} min-w-0 flex-1 basis-96`}>
        {items.map((item) => <AdminCountCard active={item.active} count={item.count} current="page" href={item.href} icon={item.icon} key={item.href} label={item.label} tone={item.urgent ? 'danger' : item.tone ?? 'default'} />)}
        {extra}
      </div>
      {aside}
    </div>
  </nav>;
}
