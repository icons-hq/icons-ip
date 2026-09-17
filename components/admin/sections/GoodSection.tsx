'use client';

import { useState } from 'react';
import type { AdminCatalogActionState } from '@/app/admin/actions';
import type { AdminGoodRecord } from '@/lib/admin/catalog.server';
import type { AdminGoodsVariant } from '@/lib/admin/goods-variants';
import type { FulfillmentOrigin } from '@/lib/admin/fulfillment-origins';
import type { GoodNoticeDefaults } from '@/lib/admin/good-editor';
import type { GoodShippingRegionSummary } from '@/lib/admin/good-shipping-summary';
import type { AdminCategoryNode } from '@/lib/admin/category';
import type { GoodsShippingNoticeOption } from '../GoodsShippingNoticeField';
import type { Ip } from '@/lib/data';
import { adminCatalogArchiveCounts, filterAdminCatalogRecords, formatAdminCatalogRecordLabel, type AdminCatalogArchiveFilter } from '@/lib/admin/catalog-archive';
import { goodsReadinessAnchor, type AdminGoodsReadiness } from '@/lib/admin/goods-readiness';
import { ADMIN_VOCABULARY } from '@/lib/admin/vocabulary';
import { AdminStatusBadge } from '../console/AdminKit';
import { RecordList } from '../fields';
import { GoodEditor } from '../GoodEditor';
import { CatalogArchiveControl, CatalogArchiveFilter } from '../CatalogArchiveControls';
import { GoodOperationSection, focusGoodWorkspaceTarget } from '../GoodWorkspace';
import { VariantStockAdjustmentForm } from '../VariantStockAdjustmentForm';
import { GoodVariantsPanel } from '../GoodVariantsPanel';
import { GoodPublishControls } from '../GoodPublishControls';
import { GoodClonePanel } from '../GoodClonePanel';
import { GoodsKcPanel } from '../GoodsKcPanel';
import { GoodsPurchaseCostsPanel } from '../GoodsPurchaseCostsPanel';
import { GoodsAdditionalPanel } from '../GoodsAdditionalPanel';
import { GoodsPricePeriodsPanel } from '../GoodsPricePeriodsPanel';
import { GoodsPreordersPanel } from '../GoodsPreordersPanel';

export function GoodSection({
  action,
  adjustmentId,
  catalogIps,
  ipOptions,
  onSelect,
  pending,
  records,
  selected,
  state,
  variants = [],
  initialIpId,
  initialQuery='',
  hideRecordList=false,
  accountId='', origins=[], noticeDefaults, categories=[], shippingNoticeOptions=[], canManageCosts=false, cloneOperationId, readiness, regionSummaries = [],
}: {
  action: (payload: FormData) => void;
  adjustmentId: string;
  catalogIps: Ip[];
  ipOptions: { id: string; title: string; archivedAt: string | null }[];
  onSelect: (good: AdminGoodRecord | null) => void;
  pending: boolean;
  records: AdminGoodRecord[];
  selected: AdminGoodRecord | null;
  state: AdminCatalogActionState;
  variants?: AdminGoodsVariant[];
  initialIpId?: string;
  initialQuery?: string;
  hideRecordList?: boolean;
  accountId?: string; origins?: FulfillmentOrigin[]; noticeDefaults?: GoodNoticeDefaults;
  categories?: AdminCategoryNode[]; shippingNoticeOptions?: GoodsShippingNoticeOption[]; canManageCosts?: boolean; cloneOperationId?: string; readiness?: AdminGoodsReadiness | null; regionSummaries?: GoodShippingRegionSummary[];
}) {
  const [archiveFilter, setArchiveFilter] = useState<AdminCatalogArchiveFilter>(
    selected?.archivedAt ? 'archived' : 'active',
  );
  const [query,setQuery]=useState(initialQuery);
  const normalizedQuery=query.trim().toLocaleLowerCase();
  const visibleRecords = filterAdminCatalogRecords(records, archiveFilter).filter((good)=>!normalizedQuery
    || `${good.name} ${good.code} ${(good.searchKeywords ?? []).join(' ')}`.toLocaleLowerCase().includes(normalizedQuery)
    || variants.some((variant)=>variant.goodId===good.id && `${variant.code} ${variant.erpCode ?? ''} ${variant.erpName ?? ''} ${variant.barcode ?? ''}`.toLocaleLowerCase().includes(normalizedQuery)));

  return (
    <div className={hideRecordList?'col':'admin-master-detail'}>
      {!hideRecordList && <div className="col" style={{ gap: 12, minWidth: 0 }}>
        <label className="col" style={{gap:7}}>
          <span>{ADMIN_VOCABULARY.goods}명·{ADMIN_VOCABULARY.goodsCode}·ERP 코드·ERP 품명·바코드·검색 키워드</span>
          <input className="admin-field-control" onChange={(event)=>setQuery(event.target.value)} placeholder={`${ADMIN_VOCABULARY.goods}명·${ADMIN_VOCABULARY.goodsCode}·검색 키워드`} type="search" value={query}/>
        </label>
        <CatalogArchiveFilter
          counts={adminCatalogArchiveCounts(records)}
          filter={archiveFilter}
          onChange={(filter) => {
            setArchiveFilter(filter);
            if (selected && !filterAdminCatalogRecords([selected], filter).length) onSelect(null);
          }}
        />
        <RecordList
          activeId={selected?.id ?? null}
          items={visibleRecords}
          emptyMessage="일치하는 상품이 없습니다."
          labelFor={(good) => formatAdminCatalogRecordLabel(
            `${good.code} · ${good.name} · ${good.stockQty}개`,
            good.archivedAt,
          )}
          onNew={() => onSelect(null)}
          onSelect={onSelect}
          thumbnailKind="good"
          thumbnailUrlFor={(good) => good.imageUrl}
        />
      </div>}
      <div className="col" style={{ gap: 16, minWidth: 0 }}>
        {selected && <section aria-label="서버 판매 준비 상태" className="admin-good-workspace__readiness">
          <h3>저장된 상품의 판매 준비</h3>
          <p>게시·판매 설정·KC 검토는 별도 조건입니다. 이 요약은 결제사 승인이나 실제 구매 성공을 보증하지 않습니다.</p>
          {readiness ? <><div className="admin-good-workspace__states">
            <AdminStatusBadge>게시 · {{ draft: '초안', published: '공개', archived: '보관', unknown: '확인 필요' }[readiness.publication]}</AdminStatusBadge>
            <AdminStatusBadge>운영 · {{ active: '정상', stopped: '판매 중지', unknown: '확인 필요' }[readiness.operation]}</AdminStatusBadge>
            <AdminStatusBadge tone={readiness.saleSettings === 'ready' ? 'success' : 'warning'}>판매 설정 · {readiness.saleSettings === 'ready' ? '준비 완료' : '확인 필요'}</AdminStatusBadge>
            <AdminStatusBadge>공개 검토 · {{ current: 'KC 검토 완료', required: 'KC 검토 필요', legacy_unrecorded: '기존 공개 · KC 미기록', unknown: '확인 필요' }[readiness.publicReview]}</AdminStatusBadge>
            <span>가용 할당 재고 {readiness.availableQty === null ? '확인 필요' : `${readiness.availableQty.toLocaleString('ko-KR')}개`}</span>
          </div>
            <ul>{readiness.reasons.map((reason) => <li key={reason.code}><a href={`#${goodsReadinessAnchor(reason.target)}`} onClick={(event) => { event.preventDefault(); focusGoodWorkspaceTarget(goodsReadinessAnchor(reason.target)); }}>{reason.label}</a> · {reason.detail}</li>)}</ul>
            <small>확인 시각 {readiness.checkedAt ? new Date(readiness.checkedAt).toLocaleString('ko-KR') : '확인 필요'} · 미저장 입력은 판정에 포함되지 않습니다.</small></> : <p>판매 준비 정보를 확인하지 못했습니다. 다시 불러와 확인해주세요.</p>}
        </section>}
        <GoodEditor
          regionSummaries={regionSummaries} origins={origins} noticeDefaults={noticeDefaults} categories={categories} shippingNoticeOptions={shippingNoticeOptions} accountId={accountId}
          variants={variants.filter((variant) => variant.goodId === selected?.id)}
          action={action}
          catalogIps={catalogIps}
          ipOptions={ipOptions}
          pending={pending}
          selected={selected}
          state={state}
          initialIpId={initialIpId}
        />
        {selected && !selected.archivedAt && (
          <GoodOperationSection id="stock" title="할당 재고 조정" description="대상 옵션·변경 수량·사유를 확인해 재고 조정만 즉시 반영합니다." ><VariantStockAdjustmentForm adjustmentId={adjustmentId} good={selected} variants={variants} key={`stock-${selected.id}`} /></GoodOperationSection>
        )}
        {selected && <GoodOperationSection id="publish" title="게시 상태 · 공개·초안 전환" description="현재 서버 저장값으로 게시 상태만 전환합니다."><GoodPublishControls id={selected.id} publishedAt={selected.publishedAt} archivedAt={selected.archivedAt} key={`publish-${selected.id}-${selected.publishedAt}-${selected.archivedAt}`}/></GoodOperationSection>}
        {selected && <GoodOperationSection id="variants" title="옵션 사용·보관" description="옵션 사용 상태만 별도로 반영합니다."><GoodVariantsPanel goodId={selected.id} variants={variants} basePrice={selected.price} /></GoodOperationSection>}
        {selected && !selected.archivedAt && <GoodOperationSection id="kc" title="KC 자료·검토" description="모델과 근거·적용 옵션을 검토하고 KC만 저장합니다."><GoodsKcPanel goodId={selected.id} key={`kc-${selected.id}-${selected.publishedAt}-${selected.archivedAt}`} /></GoodOperationSection>}
        {selected && !selected.archivedAt && canManageCosts && <GoodOperationSection id="costs" title="매입단가" description="권한이 있는 관리자만 매입단가를 저장합니다."><GoodsPurchaseCostsPanel goodId={selected.id} variants={variants} key={`costs-${selected.id}`} /></GoodOperationSection>}
        {selected && !selected.archivedAt && <GoodOperationSection id="additional" title="추가 구성 상품" description="추가 구성 연결만 저장합니다."><GoodsAdditionalPanel goodId={selected.id} key={`additional-${selected.id}`} /></GoodOperationSection>}
        {selected && !selected.archivedAt && <GoodOperationSection id="prices" title="기간 할인" description="기간과 옵션별 할인 설정만 저장합니다."><GoodsPricePeriodsPanel goodId={selected.id} variants={variants} key={`prices-${selected.id}`} /></GoodOperationSection>}
        {selected && !selected.archivedAt && <GoodOperationSection id="preorders" title="예약판매" description="예약판매 설정과 물량을 별도로 저장합니다."><GoodsPreordersPanel goodId={selected.id} variants={variants} canActivate={canManageCosts} key={`preorders-${selected.id}`} /></GoodOperationSection>}
        {selected && !selected.archivedAt && cloneOperationId && <GoodOperationSection id="clone" title="상품 복사" description="서버에 저장된 상품으로 새로운 초안을 만듭니다."><GoodClonePanel operationId={cloneOperationId} goodId={selected.id} goodName={selected.name} goodCode={selected.code} key={`clone-${selected.id}`} /></GoodOperationSection>}
        {selected && (
          <GoodOperationSection id="archive" title="상품 보관·복원" description="게시와 보관 상태만 변경합니다."><CatalogArchiveControl
            archivedAt={selected.archivedAt}
            id={selected.id}
            key={`${selected.id}:${selected.archivedAt ?? 'active'}`}
            kind="good"
          /></GoodOperationSection>
        )}
      </div>
    </div>
  );
}
