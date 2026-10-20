import Link from 'next/link';
import type { ReactNode } from 'react';
import { SALES_PAGE_SIZES, SALES_SORT_OPTIONS, salesListHiddenFields } from '@/lib/admin/sales-list';
import { SalesDateRange } from './SalesDateRange';

type Option = { value: string; label: string };

export function SalesGuide({ title, children }: { title: string; children: ReactNode }) {
  return <details className="admin-sales-guide" open>
    <summary><strong>{title}</strong><span className="admin-sales-guide-toggle"><span className="admin-sales-guide-collapse">메뉴설명 접기</span><span className="admin-sales-guide-expand">메뉴설명 보기</span></span></summary>
    <div>{children}</div>
  </details>;
}

export function SalesFilterField({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return <div className="admin-sales-filter-field">
    {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <span className="admin-sales-filter-label">{label}</span>}
    <div className="admin-sales-filter-value">{children}</div>
  </div>;
}

export function SalesSelect({ id, name, value, options, label }: { id?: string; name: string; value?: string; options: readonly Option[]; label?: string }) {
  return <select aria-label={label} defaultValue={value ?? options[0]?.value ?? ''} id={id} name={name}>
    {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
  </select>;
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
  return <form action={action} className="admin-sales-filters" method="get" key={currentHref}>
    {Object.entries(hidden).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
    <div className="admin-sales-filter-rows">
      {date ? <SalesFilterField label="조회기간" htmlFor={`${id}-date-field`}>
        <SalesSelect id={`${id}-date-field`} name="dateField" value={date.field} options={date.options} />
        <SalesDateRange key={currentHref} id={id} from={date.from} to={date.to} now={now} />
      </SalesFilterField> : null}
      <SalesFilterField label="상세조건" htmlFor={`${id}-query`}>
        {search.options ? <SalesSelect name="field" value={search.field} options={search.options} label="검색 유형" /> : null}
        <input id={`${id}-query`} type="search" name={search.name ?? 'query'} maxLength={100}
          defaultValue={search.value} placeholder="검색어를 입력하세요" aria-describedby={searchHint ? `${id}-query-hint` : undefined} />
        {searchHint && <small id={`${id}-query-hint`} className="admin-sales-search-hint">{searchHint}</small>}
      </SalesFilterField>
      {children}
    </div>
    <div className="admin-sales-filter-actions">
      <button type="submit">검색</button>
      <Link href={resetHref ?? action}>초기화</Link>
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
  return <div className="admin-sales-results-heading">
    <h2>목록 <span>(총 <strong>{total.toLocaleString('ko-KR')}</strong>{unit})</span></h2>
    <form action={currentHref.split('?')[0]} method="get" className="admin-sales-list-options" key={currentHref}>
      {Object.entries(hidden).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
      <SalesSelect name="sort" value={sort} options={sortOptions} label="목록 정렬" />
      <SalesSelect name="pageSize" value={String(pageSize)} options={pageSizes.map((size) => ({ value: String(size), label: `${size}개씩 보기` }))} label="목록 수" />
      <button type="submit">적용</button>
    </form>
    {children}
  </div>;
}

export function SalesStatusSummary({ items, label }: {
  items: readonly { label: string; href: string; count?: number; active: boolean; urgent?: boolean }[];
  label: string;
}) {
  const columns = items.length > 4 && items.length % 3 === 0 ? 3 : Math.max(1, Math.min(4, items.length));
  return <nav aria-label={label} className="admin-sales-summary" data-columns={columns}>
    <p className="admin-sales-summary-heading">{label}</p>
    <div className="admin-sales-summary-items">
    {items.map((item) => <Link key={item.href} href={item.href} aria-label={item.count === undefined ? item.label : `${item.label} ${item.count.toLocaleString('ko-KR')}건`} aria-current={item.active ? 'page' : undefined} data-urgent={item.urgent || undefined}>
      <span className="admin-sales-summary-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M7 3.5h7l4 4V20H7zM14 3.5V8h4M10 12h5M10 15h5" stroke="currentColor" strokeWidth="1.2" /></svg></span>
      <span><span className="admin-sales-summary-label">{item.label}</span>{item.count !== undefined ? <strong>{item.count.toLocaleString('ko-KR')}<small>건</small></strong> : null}</span>
    </Link>)}
    </div>
  </nav>;
}
