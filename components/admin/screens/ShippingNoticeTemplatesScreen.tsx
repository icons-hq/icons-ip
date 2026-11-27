import Link from 'next/link';
import { AdminPageHeader, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { CONSOLE_FILTER_CARD_CLASS, CONSOLE_FILTER_FIELDS_CLASS, ConsoleFilterActions, ConsoleFilterField } from '@/components/admin/console/ConsoleFilterPanel';
import { CONSOLE_TABLE_FRAME_CLASS, ConsoleListCard, ConsoleTableEmptyRow, ConsoleTableHeader } from '@/components/admin/console/ConsoleListCard';
import { ConsolePagination } from '@/components/admin/console/ConsolePagination';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableRow } from '@/components/admin/kit/ui/table';
import { templateExcerpt } from '@/lib/admin/goods-template-save';
import { kstDateTimeText } from '@/lib/admin/list-export';
import {
  SHIPPING_NOTICE_TEMPLATE_CREATE_LABEL,
  SHIPPING_NOTICE_TEMPLATE_LABEL,
  SHIPPING_NOTICE_TEMPLATE_NAME_MAX,
  SHIPPING_NOTICE_TEMPLATE_PAGE_SIZE,
  SHIPPING_NOTICE_TEMPLATES_PATH,
  shippingNoticeTemplateHref,
  type ShippingNoticeTemplatePageData,
} from '@/lib/admin/shipping-notice-templates';
import { statusTone } from '@/lib/admin/status-tone';
import {
  ShippingNoticeTemplateCreateButton,
  ShippingNoticeTemplateResultLine,
  ShippingNoticeTemplateRowActions,
  ShippingNoticeTemplateWorkspace,
} from './ShippingNoticeTemplateForm';

/*
 * 배송 안내 템플릿 관리(/admin/settings/shipping-notices). 템플릿 화면군 공통 골격이다:
 * 머리(설명·등록) → 조회 카드 → 결과 한 줄 → 목록 카드(표·페이지 이동) → [수정] 창.
 * 한 줄이 템플릿 하나다. 고칠 때마다 생기는 예전 내용과 코드·버전은 보이지 않는다(화면 규칙 8).
 * 등록·수정·상품 적용 창과 결과 한 줄은 ShippingNoticeTemplateForm이 그린다. 조회 조건이 바뀌면 결과 한 줄을 지운다(key).
 */
export function ShippingNoticeTemplatesScreen({ data }: { data: ShippingNoticeTemplatePageData }) {
  const { templates, filters, total } = data;
  return <section className="flex min-w-0 flex-col gap-4 text-sm" data-admin-screen="shipping-notices">
    <ShippingNoticeTemplateWorkspace key={`${filters.page}:${filters.query}`}>
      <AdminPageHeader
        title={`${SHIPPING_NOTICE_TEMPLATE_LABEL} 관리`}
        description="상품 상세에 보이는 배송·교환·반품 안내 글입니다. 배송비와 출고지는 ‘배송정보 템플릿 관리’에서 정합니다."
        actions={<ShippingNoticeTemplateCreateButton />}
      />
      <form action={SHIPPING_NOTICE_TEMPLATES_PATH} className={CONSOLE_FILTER_CARD_CLASS}>
        <div className={CONSOLE_FILTER_FIELDS_CLASS}>
          <ConsoleFilterField className="w-full sm:w-80" htmlFor="shipping-notice-template-query" label="템플릿 이름 검색">
            <Input id="shipping-notice-template-query" name="q" type="search" defaultValue={filters.query} maxLength={SHIPPING_NOTICE_TEMPLATE_NAME_MAX} />
          </ConsoleFilterField>
        </div>
        <ConsoleFilterActions>
          {filters.query ? <Link className={buttonVariants({ variant: 'ghost' })} data-slot="button" href={SHIPPING_NOTICE_TEMPLATES_PATH}>초기화</Link> : null}
          <button className={buttonVariants({ variant: 'soft' })} data-slot="button" type="submit">검색</button>
        </ConsoleFilterActions>
      </form>
      <ShippingNoticeTemplateResultLine />
      <ConsoleListCard headingLevel={3} title="목록" total={total} unit="개">
        <div className={`${CONSOLE_TABLE_FRAME_CLASS} [&>[data-slot=table-container]]:overflow-visible`} role="region" aria-label={`${SHIPPING_NOTICE_TEMPLATE_LABEL} 목록 가로 스크롤`} tabIndex={0}>
          <Table className="min-w-[42rem]" data-shipping-notice-entries="">
            <TableCaption className="sr-only">{SHIPPING_NOTICE_TEMPLATE_LABEL} 목록</TableCaption>
            <ConsoleTableHeader><TableRow className="hover:bg-transparent">
              <TableHead className="px-3" scope="col">템플릿 이름</TableHead>
              <TableHead className="px-3" scope="col">배송 안내</TableHead>
              <TableHead className="px-3" scope="col">쓰는 상품</TableHead>
              <TableHead className="px-3" scope="col">수정일</TableHead>
              <TableHead className="px-3" scope="col">관리</TableHead>
            </TableRow></ConsoleTableHeader>
            <TableBody>
              {templates.map((template) => <TableRow key={template.id}>
                <TableHead className="h-auto bg-transparent px-3 py-2 align-top text-sm font-medium whitespace-normal wrap-anywhere text-foreground" scope="row">
                  <span className="flex flex-wrap items-center gap-2">
                    {template.name}
                    {template.status === 'draft' ? <AdminStatusBadge tone={statusTone('setting', 'inactive')}>준비 중</AdminStatusBadge> : null}
                  </span>
                </TableHead>
                <TableCell className="px-3 align-top whitespace-normal wrap-anywhere text-muted-foreground">{templateExcerpt(template.shippingNotice, 40) || '—'}</TableCell>
                <TableCell className="px-3 align-top tabular-nums">{template.goodsCount > 0 ? `${template.goodsCount.toLocaleString('ko-KR')}개` : '없음'}</TableCell>
                <TableCell className="px-3 align-top text-muted-foreground tabular-nums">{kstDateTimeText(template.updatedAt).replaceAll('-', '.')}</TableCell>
                <TableCell className="px-3 align-top"><ShippingNoticeTemplateRowActions template={template} /></TableCell>
              </TableRow>)}
              {!templates.length ? <ConsoleTableEmptyRow colSpan={5}>{filters.query ? '조건에 맞는 템플릿이 없습니다.' : `아직 템플릿이 없습니다. [${SHIPPING_NOTICE_TEMPLATE_CREATE_LABEL}]으로 만들어 주세요.`}</ConsoleTableEmptyRow> : null}
            </TableBody>
          </Table>
        </div>
        <ConsolePagination label={`${SHIPPING_NOTICE_TEMPLATE_LABEL} 페이지`} page={filters.page} pageSize={SHIPPING_NOTICE_TEMPLATE_PAGE_SIZE} total={total} unit="개" hrefForPage={(page) => shippingNoticeTemplateHref(filters, page)} />
      </ConsoleListCard>
    </ShippingNoticeTemplateWorkspace>
  </section>;
}
