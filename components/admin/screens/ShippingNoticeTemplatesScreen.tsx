import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { AdminPageHeader, AdminSectionCard, AdminStatusBadge, AdminNotice } from '@/components/admin/console/AdminKit';
import { AdminCreateDialogButton } from '@/components/admin/console/AdminCreateDialogButton';
import { CONSOLE_FILTER_CARD_CLASS, CONSOLE_FILTER_FIELDS_CLASS, ConsoleFilterActions, ConsoleFilterField } from '@/components/admin/console/ConsoleFilterPanel';
import { CONSOLE_LIST_EMPTY_CLASS, ConsoleListCard } from '@/components/admin/console/ConsoleListCard';
import { ConsolePagination } from '@/components/admin/console/ConsolePagination';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { NOTE } from '@/components/admin/settings-kit';
import {
  SHIPPING_NOTICE_TEMPLATE_NAME_MAX,
  SHIPPING_NOTICE_TEMPLATE_PAGE_SIZE,
  SHIPPING_NOTICE_TEMPLATES_PATH,
  shippingNoticeTemplateAnchor,
  shippingNoticeTemplateHref,
  type ShippingNoticeTemplatePageData,
} from '@/lib/admin/shipping-notice-templates';
import {
  ShippingNoticeTemplateActivationForm,
  ShippingNoticeTemplateApplyForm,
  ShippingNoticeTemplateForm,
} from './ShippingNoticeTemplateForm';

/* 목록 카드 안 접는 항목(상품정보제공고시 프리셋 목록과 같은 줄 모양). */
const DETAILS = 'group min-w-0 border-b last:border-b-0 open:bg-muted/20';
const DETAILS_SUMMARY = 'flex min-h-12 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm [&::-webkit-details-marker]:hidden';

export function ShippingNoticeTemplatesScreen({ data, focusId }: { data: ShippingNoticeTemplatePageData; focusId?: string }) {
  const { templates, impactGoods, filters, total } = data;
  const focused = focusId ? templates.find((template) => template.id === focusId) : undefined;
  /* 템플릿 화면군 공통 골격: 머리(설명·등록) → 조회 카드 → 목록 카드(항목·페이지 이동). 등록은 머리 오른쪽 버튼의 팝업이다. */
  return <div className="flex min-w-0 flex-col gap-4" data-admin-screen="shipping-notices">
    <AdminPageHeader
      title="배송 안내 템플릿 관리"
      description="상품 상세에 보이는 배송·교환/반품 안내문과 고객센터 연락처를 템플릿으로 관리합니다."
      actions={<AdminCreateDialogButton label="새 배송 안내 템플릿 등록" title="새 배송 안내 템플릿 등록" wide><ShippingNoticeTemplateForm /></AdminCreateDialogButton>}
    />
    <AdminNotice tone="info">
      <strong className="font-semibold">활성 템플릿은 고칠 수 없으니, 바꾸려면 새 버전으로 등록해주세요.</strong> 필수 안내와 확인 근거를 채우면 활성화할 수 있습니다. 배송비·출고지·반품 조건은 <Link className="font-medium underline underline-offset-4" href="/admin/settings/shipping-templates">배송정보 템플릿 관리</Link>에서 정합니다.
    </AdminNotice>
    {focused ? <AdminNotice role="status" tone={focused.status === 'draft' ? 'success' : 'info'} title={`'${focused.name}' 초안을 저장했습니다`}>{focused.status === 'draft' ? '아래에서 열어 두었습니다. 확인 근거를 입력하고 [활성화]를 눌러주세요.' : '아래에서 열어 두었습니다.'}</AdminNotice> : null}
    <form action={SHIPPING_NOTICE_TEMPLATES_PATH} className={CONSOLE_FILTER_CARD_CLASS}>
      <div className={CONSOLE_FILTER_FIELDS_CLASS}>
        <ConsoleFilterField className="min-w-[min(100%,15rem)] flex-1" htmlFor="shipping-notice-template-query" label="템플릿 이름 검색">
          <Input id="shipping-notice-template-query" name="q" type="search" defaultValue={filters.query} maxLength={SHIPPING_NOTICE_TEMPLATE_NAME_MAX} placeholder="템플릿 이름" />
        </ConsoleFilterField>
        <ConsoleFilterField className="min-w-[min(100%,15rem)] flex-1" htmlFor="shipping-notice-good-query" label="상품 찾기">
          <Input id="shipping-notice-good-query" name="good" type="search" defaultValue={filters.goodQuery} maxLength={120} placeholder="상품 ID 또는 이름" />
        </ConsoleFilterField>
      </div>
      <ConsoleFilterActions>
        {filters.query || filters.goodQuery ? <Link className={buttonVariants({ variant: 'ghost' })} data-slot="button" href={SHIPPING_NOTICE_TEMPLATES_PATH}>검색 초기화</Link> : null}
        <button className={buttonVariants({ variant: 'soft' })} data-slot="button" type="submit">검색</button>
      </ConsoleFilterActions>
    </form>
    <ConsoleListCard title="목록" total={total} unit="개" description="활성 템플릿은 상품에 적용한 버전과 함께 공개됩니다.">
    {templates.length ? <div className="flex min-w-0 flex-col overflow-hidden rounded-lg border" data-shipping-notice-entries="">
      {templates.map((template) => {
        const assigned = impactGoods.filter((good) => good.templateId === template.id);
        return <details key={template.id} id={shippingNoticeTemplateAnchor(template.id)} className={`${DETAILS} scroll-mt-24${template.id === focusId ? ' bg-muted/20 ring-2 ring-primary/40 ring-inset' : ''}`} open={template.id === focusId || undefined} data-focused={template.id === focusId || undefined}>
          <summary className={DETAILS_SUMMARY}>
            {/* 이름 길이와 상관없이 상태가 세로로 맞도록 이름이 남는 폭을 다 쓴다. */}
            <strong className="min-w-0 flex-1 font-medium">{template.name}</strong>
            <AdminStatusBadge tone={template.status === 'active' ? 'success' : 'neutral'}>{template.status === 'active' ? '활성' : '초안'}</AdminStatusBadge>
            <span className="text-right text-xs text-muted-foreground tabular-nums" title={`템플릿 코드 ${template.code}`}>버전 {template.version}</span>
            <span className="text-xs font-medium text-primary group-open:hidden">내용 보기</span>
            <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="flex min-w-0 flex-col gap-4 border-t p-4">
            <ShippingNoticeTemplateForm template={template} />
            <AdminSectionCard title="고객 공개 미리보기">
              <dl className="grid gap-3">
                <div className="flex flex-col gap-0.5"><dt className="text-xs text-muted-foreground">배송 안내</dt><dd className="whitespace-pre-wrap [overflow-wrap:anywhere]">{template.shippingNotice || '아직 입력되지 않았습니다.'}</dd></div>
                <div className="flex flex-col gap-0.5"><dt className="text-xs text-muted-foreground">도서산간 안내</dt><dd className="whitespace-pre-wrap [overflow-wrap:anywhere]">{template.remoteAreaNotice || '입력하지 않았습니다(선택).'}</dd></div>
                <div className="flex flex-col gap-0.5"><dt className="text-xs text-muted-foreground">교환·반품 안내</dt><dd className="whitespace-pre-wrap [overflow-wrap:anywhere]">{template.returnExchangeNotice || '아직 입력되지 않았습니다.'}</dd></div>
                <div className="flex flex-col gap-0.5"><dt className="text-xs text-muted-foreground">고객센터</dt><dd>{[template.csName, template.csPhone, template.csEmail].filter(Boolean).join(' · ') || '아직 입력되지 않았습니다.'}</dd></div>
              </dl>
              <p className={NOTE}>상품에 적용하면 공개 배송 정책에서 출고지의 현재 반송 주소와 이 스냅샷이 함께 조회됩니다.</p>
            </AdminSectionCard>
            {template.status === 'draft' ? <AdminSectionCard title="활성화" summary="활성화 전 실제 운영 자료와 안내 문구를 확인하세요. 저장된 초안에는 실제 주소·연락처를 자동으로 채우지 않습니다.">
              <ShippingNoticeTemplateActivationForm template={template} />
            </AdminSectionCard> : null}
            {template.status === 'active' ? <AdminSectionCard title={`상품 적용 대상 (${impactGoods.length}건 검색됨)`}>
              {impactGoods.length ? <ul className="flex flex-col divide-y">{impactGoods.map((good) => <li className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0" key={`${template.id}:${good.id}`}>
                <span className="min-w-0 [overflow-wrap:anywhere]">{good.name} ({good.id}) · <span className="text-muted-foreground">{good.templateId === template.id ? `현재 v${good.templateVersion}` : '다른 템플릿 또는 미적용'}</span></span>
                <ShippingNoticeTemplateApplyForm template={template} good={good} />
              </li>)}</ul> : <p className={NOTE}>상품 ID 또는 이름으로 검색해 적용 대상을 찾으세요.</p>}
              <p className={NOTE}>적용 시 상품의 최신 변경 시각을 확인합니다. 동시에 수정된 상품에는 적용하지 않습니다.</p>
            </AdminSectionCard> : null}
            {assigned.length ? <p className={NOTE}>현재 이 버전을 적용한 상품 {assigned.length}건이 검색 결과에 포함되어 있습니다.</p> : null}
          </div>
        </details>;
      })}
    </div> : <p className={CONSOLE_LIST_EMPTY_CLASS}>{filters.query ? '조건에 맞는 템플릿이 없습니다.' : '아직 배송 안내 템플릿이 없습니다. 새 초안을 등록해주세요.'}</p>}
    <ConsolePagination page={filters.page} pageSize={SHIPPING_NOTICE_TEMPLATE_PAGE_SIZE} total={total} hrefForPage={(page) => shippingNoticeTemplateHref(filters, page)} />
    </ConsoleListCard>
  </div>;
}
