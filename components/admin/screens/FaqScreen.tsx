import { adminGoodsCopy } from '@/lib/admin/vocabulary';
import Link from 'next/link';
import { ChevronDown, ExternalLink } from 'lucide-react';
import { AdminPageHeader, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { AdminSelect } from '@/components/admin/console/AdminSelect';
import { ConsoleFilterField, ConsoleFilterPanel } from '@/components/admin/console/ConsoleFilterPanel';
import { ConsolePagination } from '@/components/admin/console/ConsolePagination';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { statusTone } from '@/lib/admin/status-tone';
import { ADMIN_FAQ_PATH, FAQ_CATEGORIES, FAQ_PAGE_SIZE, faqHref } from '@/lib/faq';
import type { FaqPageData } from '@/lib/faq.server';
import { inquiryCategoryLabel } from '@/lib/inquiries';
import { FaqCreateDialog, FaqDeleteForm, FaqEntryForm } from './FaqEntryForm';

/** FAQ 머리 줄과 질문 줄이 같은 칸을 쓴다(카테고리·질문·게시 상태·표시 순서·펼침). */
const FAQ_ROW_GRID = 'items-center gap-x-4 sm:grid-cols-[5.5rem_minmax(0,1fr)_4.5rem_3.5rem_1rem]';

/* 템플릿 룩(ADR-0028): 화면 머리의 등록 버튼(팝업) → 조회 조건 → 질문 목록(펼쳐서 수정·삭제) → 페이지. */
export function FaqScreen({ data }: { data: FaqPageData }) {
  const { entries, filters, total } = data;
  return <div className="flex min-w-0 flex-col gap-4" data-faq-screen="">
    <AdminPageHeader title="FAQ 관리" description="고객이 문의하기 전에 찾아볼 질문과 답변을 관리합니다." actions={<><Link className={buttonVariants({ variant: 'outline' })} data-slot="button" href="/help" target="_blank" rel="noopener noreferrer"><ExternalLink aria-hidden="true" />공개 FAQ 보기 (새 창)</Link><FaqCreateDialog /></>} />
    <ConsoleFilterPanel action={ADMIN_FAQ_PATH}
      search={{ name: 'q', label: '질문 검색', value: filters.query, placeholder: '질문 내용으로 검색' }}
      statusFilter={{ value: filters.status, label: '게시 상태', options: [{ value: 'all', label: '전체' }, { value: 'published', label: '공개' }, { value: 'draft', label: '비공개' }] }}>
      <ConsoleFilterField htmlFor="admin-faq-category" label="카테고리"><AdminSelect id="admin-faq-category" name="category" defaultValue={filters.category} wrapperClassName="w-40"><option value="">전체</option>{FAQ_CATEGORIES.map((category) => <option key={category.id} value={category.id}>{adminGoodsCopy(category.label)}</option>)}</AdminSelect></ConsoleFilterField>
    </ConsoleFilterPanel>
    <p className="text-sm text-muted-foreground">질문을 열어 내용과 표시 순서를 고칩니다. 공개 FAQ만 고객에게 표시됩니다.</p>
    {entries.length ? <div className="flex flex-col divide-y overflow-hidden rounded-xl border bg-card text-card-foreground">
      {/* 줄마다 이름표를 반복하지 않게 칸 이름은 맨 위 한 줄에 둔다. */}
      <div aria-hidden="true" className={`hidden bg-muted px-4 py-2 text-xs font-semibold text-secondary-foreground sm:grid ${FAQ_ROW_GRID}`}><span>카테고리</span><span>질문</span><span>게시 상태</span><span className="text-right">표시 순서</span><span /></div>
      {entries.map((entry) => <details key={entry.id} className="group/entry">
      <summary className={`flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3.5 transition-colors hover:bg-muted/50 group-open/entry:bg-muted/40 sm:grid [&::-webkit-details-marker]:hidden ${FAQ_ROW_GRID}`}><span className="shrink-0 text-xs text-muted-foreground">{adminGoodsCopy(inquiryCategoryLabel(entry.category))}</span><strong className={`min-w-30 flex-1 text-sm font-medium wrap-anywhere ${entry.published ? 'text-foreground' : 'text-muted-foreground'}`}>{entry.question}</strong><AdminStatusBadge tone={statusTone('publication', entry.published ? 'published' : 'draft')}>{entry.published ? '공개' : '비공개'}</AdminStatusBadge><span className="text-right text-xs text-muted-foreground tabular-nums"><span className="sr-only">표시 순서 </span>{entry.sortOrder}</span><ChevronDown aria-hidden="true" className="size-4 text-muted-foreground transition-transform group-open/entry:rotate-180" /></summary>
      <div className="flex flex-col gap-4 border-t p-4"><FaqEntryForm entry={entry} /><FaqDeleteForm entry={entry} /></div>
    </details>)}</div> : <p className="rounded-xl border bg-card py-12 text-center text-sm text-muted-foreground">조건에 맞는 FAQ가 없습니다. 새 FAQ를 등록하거나 검색 조건을 바꿔주세요.</p>}
    <ConsolePagination page={filters.page} pageSize={FAQ_PAGE_SIZE} total={total} hrefForPage={(page) => faqHref(ADMIN_FAQ_PATH, filters, page)} />
  </div>;
}
