import Link from 'next/link';
import { AdminPageHeader, AdminSectionCard } from '@/components/admin/console/AdminKit';
import { ConsolePagination } from '@/components/admin/console/ConsolePagination';
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

export function ShippingNoticeTemplatesScreen({ data }: { data: ShippingNoticeTemplatePageData }) {
  const { templates, impactGoods, filters, total } = data;
  return <section className="wc-admin-kit admin-shipping-notice-templates">
    <AdminPageHeader
      title="배송정보 템플릿"
      description="배송·교환/반품 안내와 고객센터 연락처를 버전으로 저장합니다. 실제 운임과 반송 주소는 출고지 설정이 소유하며, 창고 출고지시 양식과 분리됩니다."
    />
    <p className="admin-shipping-notice-templates__policy">
      템플릿은 초안으로 저장되고 필수 안내와 확인 근거가 있어야 활성화됩니다. 활성 버전은 수정할 수 없으며 새 버전으로 등록합니다.
    </p>
    <details className="admin-shipping-notice-templates__create">
      <summary>새 배송정보 템플릿 등록</summary>
      <ShippingNoticeTemplateForm />
    </details>
    <form action={SHIPPING_NOTICE_TEMPLATES_PATH} className="admin-shipping-notice-templates__search">
      <label htmlFor="shipping-notice-template-query">템플릿 이름 검색</label>
      <div>
        <input id="shipping-notice-template-query" name="q" type="search" defaultValue={filters.query} maxLength={SHIPPING_NOTICE_TEMPLATE_NAME_MAX} placeholder="템플릿 이름" />
        <label htmlFor="shipping-notice-good-query">상품 찾기</label>
        <input id="shipping-notice-good-query" name="good" type="search" defaultValue={filters.goodQuery} maxLength={120} placeholder="상품 ID 또는 이름" />
        <button className="wc-admin-kit__button" type="submit">검색</button>
        {filters.query || filters.goodQuery ? <Link href={SHIPPING_NOTICE_TEMPLATES_PATH}>검색 초기화</Link> : null}
      </div>
    </form>
    <p className="admin-shipping-notice-templates__count">총 {total.toLocaleString('ko-KR')}개 · 활성 템플릿은 상품에 적용한 버전과 함께 공개됩니다.</p>
    {templates.length ? <div className="admin-shipping-notice-templates__entries">
      {templates.map((template) => {
        const assigned = impactGoods.filter((good) => good.templateId === template.id);
        return <details key={template.id} className="admin-shipping-notice-templates__entry">
          <summary>
            <strong>{template.name}</strong>
            <span>{template.code} v{template.version} · {template.status === 'active' ? '활성' : '초안'}</span>
          </summary>
          <ShippingNoticeTemplateForm template={template} />
          <AdminSectionCard title="고객 공개 미리보기">
            <dl>
              <dt>배송 안내</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{template.shippingNotice || '아직 입력되지 않았습니다.'}</dd>
              <dt>교환·반품 안내</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{template.returnExchangeNotice || '아직 입력되지 않았습니다.'}</dd>
              <dt>고객센터</dt><dd>{[template.csName, template.csPhone, template.csEmail].filter(Boolean).join(' · ') || '아직 입력되지 않았습니다.'}</dd>
            </dl>
            <p>상품에 적용하면 공개 배송 정책에서 출고지의 현재 반송 주소와 이 스냅샷이 함께 조회됩니다.</p>
          </AdminSectionCard>
          {template.status === 'draft' ? <AdminSectionCard title="활성화">
            <p>활성화 전 실제 운영 자료와 안내 문구를 확인하세요. 저장된 초안에는 실제 주소·연락처를 자동으로 채우지 않습니다.</p>
            <ShippingNoticeTemplateActivationForm template={template} />
          </AdminSectionCard> : null}
          {template.status === 'active' ? <AdminSectionCard title={`상품 적용 대상 (${impactGoods.length}건 검색됨)`}>
            {impactGoods.length ? <ul>{impactGoods.map((good) => <li key={`${template.id}:${good.id}`}>
              <span>{good.name} ({good.id}) · {good.templateId === template.id ? `현재 v${good.templateVersion}` : '다른 템플릿 또는 미적용'}</span>
              <ShippingNoticeTemplateApplyForm template={template} good={good} />
            </li>)}</ul> : <p>상품 ID 또는 이름으로 검색해 적용 대상을 찾으세요.</p>}
            <p>적용 시 상품의 최신 변경 시각을 확인합니다. 동시에 수정된 상품에는 적용하지 않습니다.</p>
          </AdminSectionCard> : null}
          {assigned.length ? <p>현재 이 버전을 적용한 상품 {assigned.length}건이 검색 결과에 포함되어 있습니다.</p> : null}
        </details>;
      })}
    </div> : <p className="admin-shipping-notice-templates__empty">{filters.query ? '조건에 맞는 템플릿이 없습니다.' : '아직 배송정보 템플릿이 없습니다. 새 초안을 등록해주세요.'}</p>}
    <ConsolePagination page={filters.page} pageSize={SHIPPING_NOTICE_TEMPLATE_PAGE_SIZE} total={total} hrefForPage={(page) => shippingNoticeTemplateHref(filters, page)} />
  </section>;
}
