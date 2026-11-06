import Link from 'next/link';
import { Plus, Search } from 'lucide-react';
import { AdminPageHeader, AdminSectionCard, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { ConsolePagination } from '@/components/admin/console/ConsolePagination';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { EMPTY, FILTER_CARD, NOTE, STATUS_BOX } from '@/components/admin/settings-kit';
import {
  SHIPPING_NOTICE_TEMPLATE_NAME_MAX,
  SHIPPING_NOTICE_TEMPLATE_PAGE_SIZE,
  SHIPPING_NOTICE_TEMPLATES_PATH,
  shippingNoticeTemplateHref,
  type ShippingNoticeTemplatePageData,
} from '@/lib/admin/shipping-notice-templates';
import {
  ShippingNoticeTemplateActivationForm,
  ShippingNoticeTemplateApplyForm,
  ShippingNoticeTemplateForm,
} from './ShippingNoticeTemplateForm';

const DETAILS = 'group min-w-0 rounded-xl border bg-card text-card-foreground';
const DETAILS_SUMMARY = 'flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm';

export function ShippingNoticeTemplatesScreen({ data }: { data: ShippingNoticeTemplatePageData }) {
  const { templates, impactGoods, filters, total } = data;
  return <div className="flex min-w-0 flex-col gap-4" data-admin-screen="shipping-notices">
    <AdminPageHeader
      title="배송 안내 템플릿"
      description="배송·교환/반품 안내와 고객센터 연락처를 버전으로 저장합니다. 실제 운임과 반송 주소는 출고지 설정이 소유하며, 창고 출고지시 양식과 분리됩니다."
    />
    <p className={STATUS_BOX}>
      배송비 유형·출고지·반품 조건은 <Link className="font-medium underline underline-offset-4" href="/admin/settings/shipping-templates">배송정보 템플릿 관리</Link>에서 적용합니다. 이 안내 템플릿은 초안으로 저장되고 필수 안내와 확인 근거가 있어야 활성화됩니다. 활성 버전은 수정할 수 없으며 새 버전으로 등록합니다.
    </p>
    <details className={DETAILS}>
      <summary className={`${DETAILS_SUMMARY} font-medium`}><Plus aria-hidden="true" className="size-4 text-muted-foreground" />새 배송 안내 템플릿 등록</summary>
      <div className="border-t p-4"><ShippingNoticeTemplateForm /></div>
    </details>
    <form action={SHIPPING_NOTICE_TEMPLATES_PATH} className={FILTER_CARD}>
      <div className="flex min-w-[min(100%,15rem)] flex-1 flex-col gap-1.5"><label className="text-sm leading-none font-medium" htmlFor="shipping-notice-template-query">템플릿 이름 검색</label>
        <Input id="shipping-notice-template-query" name="q" type="search" defaultValue={filters.query} maxLength={SHIPPING_NOTICE_TEMPLATE_NAME_MAX} placeholder="템플릿 이름" />
      </div>
      <div className="flex min-w-[min(100%,15rem)] flex-1 flex-col gap-1.5"><label className="text-sm leading-none font-medium" htmlFor="shipping-notice-good-query">상품 찾기</label>
        <Input id="shipping-notice-good-query" name="good" type="search" defaultValue={filters.goodQuery} maxLength={120} placeholder="상품 ID 또는 이름" />
      </div>
      <div className="flex flex-wrap items-center gap-2"><button className={buttonVariants()} data-slot="button" type="submit"><Search aria-hidden="true" />검색</button>
        {filters.query || filters.goodQuery ? <Link className={buttonVariants({ variant: 'outline' })} data-slot="button" href={SHIPPING_NOTICE_TEMPLATES_PATH}>검색 초기화</Link> : null}</div>
    </form>
    <p className={NOTE}>총 <span className="tabular-nums">{total.toLocaleString('ko-KR')}</span>개 · 활성 템플릿은 상품에 적용한 버전과 함께 공개됩니다.</p>
    {templates.length ? <div className="flex min-w-0 flex-col gap-3" data-shipping-notice-entries="">
      {templates.map((template) => {
        const assigned = impactGoods.filter((good) => good.templateId === template.id);
        return <details key={template.id} className={DETAILS}>
          <summary className={DETAILS_SUMMARY}>
            <strong className="font-medium">{template.name}</strong>
            <span className="text-xs text-muted-foreground tabular-nums">{template.code} v{template.version}</span>
            <AdminStatusBadge tone={template.status === 'active' ? 'success' : 'neutral'}>{template.status === 'active' ? '활성' : '초안'}</AdminStatusBadge>
          </summary>
          <div className="flex min-w-0 flex-col gap-4 border-t p-4">
            <ShippingNoticeTemplateForm template={template} />
            <AdminSectionCard title="고객 공개 미리보기">
              <dl className="grid gap-3">
                <div className="flex flex-col gap-0.5"><dt className="text-xs text-muted-foreground">배송 안내</dt><dd className="whitespace-pre-wrap [overflow-wrap:anywhere]">{template.shippingNotice || '아직 입력되지 않았습니다.'}</dd></div>
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
    </div> : <p className={`${EMPTY} rounded-xl border bg-card`}>{filters.query ? '조건에 맞는 템플릿이 없습니다.' : '아직 배송 안내 템플릿이 없습니다. 새 초안을 등록해주세요.'}</p>}
    <ConsolePagination page={filters.page} pageSize={SHIPPING_NOTICE_TEMPLATE_PAGE_SIZE} total={total} hrefForPage={(page) => shippingNoticeTemplateHref(filters, page)} />
  </div>;
}
