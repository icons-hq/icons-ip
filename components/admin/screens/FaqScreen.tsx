import { adminGoodsCopy } from '@/lib/admin/vocabulary';
import Link from 'next/link';
import { ChevronDown, ExternalLink, Plus } from 'lucide-react';
import { AdminPageHeader, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { AdminSelect } from '@/components/admin/console/AdminSelect';
import { ConsoleFilterField, ConsoleFilterPanel } from '@/components/admin/console/ConsoleFilterPanel';
import { ConsolePagination } from '@/components/admin/console/ConsolePagination';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { ADMIN_FAQ_PATH, FAQ_CATEGORIES, FAQ_PAGE_SIZE, faqHref } from '@/lib/faq';
import type { FaqPageData } from '@/lib/faq.server';
import { inquiryCategoryLabel } from '@/lib/inquiries';
import { FaqDeleteForm, FaqEntryForm } from './FaqEntryForm';

/* 템플릿 룩(ADR-0028): 새 FAQ 등록(접기) → 조회 조건 → 질문 목록(펼쳐서 수정·삭제) → 페이지. */
export function FaqScreen({ data }: { data: FaqPageData }) {
  const { entries, filters, total } = data;
  return <div className="flex min-w-0 flex-col gap-4" data-faq-screen="">
    <AdminPageHeader title="FAQ 관리" description="고객이 문의하기 전에 찾아볼 질문과 답변을 관리합니다." actions={<Link className={buttonVariants({ variant: 'outline' })} data-slot="button" href="/help" target="_blank" rel="noopener noreferrer"><ExternalLink aria-hidden="true" />공개 FAQ 보기 (새 창)</Link>} />
    <details className="group/create rounded-xl border bg-card text-card-foreground"><summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium text-foreground [&::-webkit-details-marker]:hidden"><Plus aria-hidden="true" className="size-4" />새 FAQ 등록<ChevronDown aria-hidden="true" className="ml-auto size-4 text-muted-foreground transition-transform group-open/create:rotate-180" /></summary><div className="border-t p-4"><FaqEntryForm /></div></details>
    <ConsoleFilterPanel action={ADMIN_FAQ_PATH}
      search={{ name: 'q', label: '질문 검색', value: filters.query, placeholder: '질문 내용으로 검색' }}
      statusFilter={{ value: filters.status, label: '게시 상태', options: [{ value: 'all', label: '전체' }, { value: 'published', label: '공개' }, { value: 'draft', label: '비공개' }] }}>
      <ConsoleFilterField htmlFor="admin-faq-category" label="카테고리"><AdminSelect id="admin-faq-category" name="category" defaultValue={filters.category} wrapperClassName="w-40"><option value="">전체</option>{FAQ_CATEGORIES.map((category) => <option key={category.id} value={category.id}>{adminGoodsCopy(category.label)}</option>)}</AdminSelect></ConsoleFilterField>
    </ConsoleFilterPanel>
    <p className="text-sm text-muted-foreground">질문을 열어 수정할 수 있습니다. 공개 FAQ만 고객에게 표시됩니다.</p>
    {entries.length ? <div className="flex flex-col divide-y overflow-hidden rounded-xl border bg-card text-card-foreground">{entries.map((entry) => <details key={entry.id} className="group/entry">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3.5 transition-colors hover:bg-muted/50 group-open/entry:bg-muted/40 [&::-webkit-details-marker]:hidden"><span className="text-xs text-muted-foreground">{adminGoodsCopy(inquiryCategoryLabel(entry.category))}</span><strong className="min-w-30 flex-1 text-sm font-medium text-foreground wrap-anywhere">{entry.question}</strong><AdminStatusBadge tone={entry.published ? 'success' : 'neutral'}>{entry.published ? '공개' : '비공개'}</AdminStatusBadge><span className="text-xs text-muted-foreground tabular-nums">순서 {entry.sortOrder}</span><ChevronDown aria-hidden="true" className="size-4 text-muted-foreground transition-transform group-open/entry:rotate-180" /></summary>
      <div className="flex flex-col gap-4 border-t p-4"><FaqEntryForm entry={entry} /><FaqDeleteForm entry={entry} /></div>
    </details>)}</div> : <p className="rounded-xl border bg-card py-12 text-center text-sm text-muted-foreground">조건에 맞는 FAQ가 없습니다. 새 FAQ를 등록하거나 검색 조건을 바꿔주세요.</p>}
    <ConsolePagination page={filters.page} pageSize={FAQ_PAGE_SIZE} total={total} hrefForPage={(page) => faqHref(ADMIN_FAQ_PATH, filters, page)} />
  </div>;
}
