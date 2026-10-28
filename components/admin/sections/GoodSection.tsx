'use client';
import { goodsGroupCommonHref, goodsGroupHref, type GoodsEditorOwnership } from '@/lib/admin/goods-group-common';

import { useState } from 'react';
import type { AdminCatalogActionState } from '@/app/admin/actions';
import type { AdminGoodRecord } from '@/lib/admin/catalog.server';
import type { AdminGoodsVariant } from '@/lib/admin/goods-variants';
import type { GoodsFulfillmentOrigin } from '@/lib/admin/fulfillment-origins';
import type { GoodNoticeDefaults } from '@/lib/admin/good-editor';
import type { GoodShippingRegionSummary } from '@/lib/admin/good-shipping-summary';
import type { AdminCategoryNode } from '@/lib/admin/category';
import type { GoodsShippingNoticeOption } from '../GoodsShippingNoticeField';
import type { Ip } from '@/lib/data';
import { adminCatalogArchiveCounts, filterAdminCatalogRecords, formatAdminCatalogRecordLabel, type AdminCatalogArchiveFilter } from '@/lib/admin/catalog-archive';
import { goodsReadinessAnchor, type AdminGoodsReadiness } from '@/lib/admin/goods-readiness';
import { ADMIN_VOCABULARY, adminGoodsCopy } from '@/lib/admin/vocabulary';
import { AdminStatusBadge } from '../console/AdminKit';
import { RecordList } from '../fields';
import { GoodEditor } from '../GoodEditor';
import { CatalogArchiveControl, CatalogArchiveFilter } from '../CatalogArchiveControls';
import { GoodsListingColorsPanel } from '../GoodsListingColorsPanel';
import { GoodOperationSection, GoodWorkspaceProvider, focusGoodWorkspaceTarget } from '../GoodWorkspace';
import { GoodWorkspaceKcCard, GoodWorkspacePreorderCard } from '../GoodWorkspaceSections';
import { VariantStockAdjustmentForm } from '../VariantStockAdjustmentForm';
import { GoodVariantsPanel } from '../GoodVariantsPanel';
import { GoodPublishControls } from '../GoodPublishControls';
import { GoodClonePanel } from '../GoodClonePanel';
import { GoodCopySourcePicker } from '../GoodCopySourcePicker';
import { GoodsKcPanel } from '../GoodsKcPanel';
import { useGoodsKcTemplate } from '../useGoodsKcTemplate';
import { GoodsPurchaseCostsPanel } from '../GoodsPurchaseCostsPanel';
import { GoodsAdditionalPanel } from '../GoodsAdditionalPanel';
import { GoodsPricePeriodsPanel } from '../GoodsPricePeriodsPanel';
import { GoodsPreordersPanel } from '../GoodsPreordersPanel';
import { GoodsBenefitsPanel } from '../GoodsBenefitsPanel';
import { GoodsAfterSalesPanel } from '../GoodsAfterSalesPanel';
import { GoodSizeChartPanel } from '../GoodSizeChartPanel';
import { GoodsTransactionTermsPanel } from '../GoodsTransactionTermsPanel';
import { GoodsFulfillmentPanel } from '../GoodsFulfillmentPanel';
import { GoodsProductionPanel } from '../GoodsProductionPanel';
import { GoodsSubscriptionPolicyPanel } from '../GoodsSubscriptionPolicyPanel';
import { GoodShippingChargeGroupPanel } from '../GoodShippingChargeGroupPanel';

/** 운영 섹션 제목·설명. 저장된 상품의 독립 패널과 등록 화면의 자리표시 카드가 같은 문구·같은 id를 쓴다. */
const OPERATION = {
  stock: ['할당 재고 조정', '대상 옵션·변경 수량·사유를 확인해 재고 조정만 즉시 반영합니다.'],
  publish: ['게시 상태 · 공개·초안 전환', '현재 서버 저장값으로 게시 상태만 전환합니다.'],
  variants: ['옵션 사용·보관', '옵션 사용 상태만 별도로 반영합니다.'],
  kc: ['KC 자료·검토', 'KC 대상이 아니면 상품 전체 KC 해당 없음으로 바로 검토하고, KC 대상이면 모델·근거·적용 옵션을 검토합니다. KC만 저장합니다.'],
  costs: ['매입단가', '권한이 있는 관리자만 매입단가를 저장합니다.'],
  'listing-colors': ['목록 색상칩', '상품목록에 표시할 실제 색상을 별도로 저장합니다.'],
  additional: [adminGoodsCopy('추가 구성 상품'), '추가 구성 연결만 저장합니다.'],
  benefits: ['사은품·이벤트 안내', '사은품 설명·사진과 이벤트 문구를 별도로 저장합니다.'],
  'after-sales': ['A/S 안내·판매자 특이사항', '상품별 A/S 안내와 판매자 특이사항을 상품정보고시와 별도로 저장합니다.'],
  'size-chart': ['사이즈 안내', '측정 치수와 공개 표시 여부만 별도로 저장합니다. 구매 옵션·고시 크기와 구분됩니다.'],
  prices: ['기간 할인', '기간과 옵션별 할인 설정만 저장합니다.'],
  'transaction-terms': ['복수구매 할인·착불·수량별 배송비', '저장된 상품을 기준으로 할인과 확장 배송비를 각각 저장합니다.'],
  'shipping-charge-group': ['배송비 묶음그룹', '저장된 상품의 묶음그룹 배정만 별도로 저장합니다.'],
  'subscription-policy': ['정기배송', '신청 가능한 주기와 정기배송 안내를 별도로 저장합니다.'],
  fulfillment: ['수령 방식·설치비·디지털 파일', '주문서의 수령 방식과 선결제 비용·제공 파일을 별도로 저장합니다.'],
  production: ['주문 후 제작', '상품별 제작 여부와 발송 예정 기간·휴무일을 저장합니다.'],
  preorders: ['예약판매', '예약판매 설정과 물량을 별도로 저장합니다.'],
  clone: ['상품 복사', '서버에 저장된 상품으로 새로운 초안을 만듭니다.'],
  archive: ['상품 보관·복원', '게시와 보관 상태만 변경합니다.'],
} as const;
type OperationId = keyof typeof OPERATION;

function Placeholder({ id }: { id: OperationId }) {
  return <GoodOperationSection id={id} title={OPERATION[id][0]} description={OPERATION[id][1]} mode="placeholder" />;
}

export function GoodSection({
  action,
  adjustmentId, ownership,
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
  hideRecordList=false, listHref='/admin/catalog/goods',
  accountId='', origins=[], noticeDefaults, categories=[], shippingNoticeOptions=[], canManageCosts=false, canReadOrders=true, canManageSales=true, canSearchErp=true, cloneOperationId, readiness, regionSummaries = [],
}: {
  action: (payload: FormData) => void;
  adjustmentId: string; ownership?: GoodsEditorOwnership | null;
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
  hideRecordList?: boolean; listHref?: string;
  accountId?: string; origins?: GoodsFulfillmentOrigin[]; noticeDefaults?: GoodNoticeDefaults;
  categories?: AdminCategoryNode[]; shippingNoticeOptions?: GoodsShippingNoticeOption[]; canManageCosts?: boolean; canReadOrders?: boolean; canManageSales?: boolean; canSearchErp?: boolean; cloneOperationId?: string; readiness?: AdminGoodsReadiness | null; regionSummaries?: GoodShippingRegionSummary[];
}) {
  const [archiveFilter, setArchiveFilter] = useState<AdminCatalogArchiveFilter>(
    selected?.archivedAt ? 'archived' : 'active',
  );
  const [query,setQuery]=useState(initialQuery);
  const [editingState, setEditingState] = useState<{ goodId: string | null; dirty: boolean; busy: boolean } | null>(null);
  const [transactionBusy, setTransactionBusy] = useState(false);
  const [subscriptionBusy, setSubscriptionBusy] = useState(false);
  const [chargeBusy, setChargeBusy] = useState(false);
  const policyDisabled = pending || editingState?.busy ? '기본 상품을 저장하는 중입니다. 저장이 끝난 뒤 별도 설정을 저장해주세요.'
    : editingState?.goodId !== selected?.id ? '기본 상품의 입력 상태를 확인하고 있습니다.'
    : editingState?.dirty ? '기본 상품에 미저장 변경이 있습니다. 먼저 기본 상품을 저장한 뒤 별도 설정을 저장해주세요.' : '';
  const kcTemplate = useGoodsKcTemplate(selected?.id ?? null);
  const normalizedQuery=query.trim().toLocaleLowerCase();
  const visibleRecords = filterAdminCatalogRecords(records, archiveFilter).filter((good)=>!normalizedQuery
    || `${good.name} ${good.code} ${(good.searchKeywords ?? []).join(' ')}`.toLocaleLowerCase().includes(normalizedQuery)
    || variants.some((variant)=>variant.goodId===good.id && `${variant.code} ${variant.erpCode ?? ''} ${variant.erpName ?? ''} ${variant.barcode ?? ''}`.toLocaleLowerCase().includes(normalizedQuery)));
  /* 저장에 성공한 시도. 등록 화면의 KC·예약판매 입력은 서버로 들어갔으므로 provider가 비우고 작업 ID를 새로 만든다. */
  const completedKey = state.savedGoodId && !state.errors ? `${state.savedGoodId}:${state.attempt ?? 0}` : null;

  return (
    <GoodWorkspaceProvider completedKey={completedKey}>
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
        {!selected && accountId ? <GoodCopySourcePicker accountId={accountId} disabledReason={pending || editingState?.busy ? '현재 입력을 저장하는 중입니다.'
          : editingState?.dirty ? '작성 중인 입력은 먼저 임시저장한 뒤 복사할 상품을 선택해주세요.' : ''} /> : null}
        {ownership?.group ? <section className="admin-good-workspace__lock"><strong>{ownership.group.name} · 그룹상품</strong><p>상품명과 옵션 구성은 <a href={goodsGroupHref(ownership.group.id)}>그룹 구성</a>에서, 카테고리·속성·IP·유형·고시·상세설명·A/S·사이즈는 <a href={goodsGroupCommonHref(ownership.group)}>공통정보 편집</a>에서 수정합니다.</p></section> : null}
        {ownership && !ownership.aggregation.editable ? <p>배송비·주문 수량·회원 누적 한도·복수구매 할인은 <a href={`/admin/catalog/goods?goodId=${encodeURIComponent(ownership.aggregation.ownerGoodId)}`}>합산 기준 상품</a>에서 관리합니다.</p> : null}
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
        <fieldset className="col" disabled={transactionBusy || subscriptionBusy || chargeBusy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, gap: 16 }}>
        <GoodEditor
          ownership={ownership}
          onEditingStateChange={setEditingState}
          listHref={listHref}
          canSearchErp={canSearchErp}
          canActivatePreorders={canManageCosts}
          onApplyKcTemplate={kcTemplate.apply}
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
        </fieldset>
        {selected ? <>
          {!selected.archivedAt && (
            <GoodOperationSection id="stock" title={OPERATION.stock[0]} description={OPERATION.stock[1]}><VariantStockAdjustmentForm adjustmentId={adjustmentId} good={selected} variants={variants} key={`stock-${selected.id}`} /></GoodOperationSection>
          )}
          <GoodOperationSection id="publish" title={OPERATION.publish[0]} description={OPERATION.publish[1]}><GoodPublishControls id={selected.id} publishedAt={selected.publishedAt} archivedAt={selected.archivedAt} key={`publish-${selected.id}-${selected.publishedAt}-${selected.archivedAt}`}/></GoodOperationSection>
          {!ownership?.group && <GoodOperationSection id="variants" title={OPERATION.variants[0]} description={OPERATION.variants[1]}><GoodVariantsPanel goodId={selected.id} variants={variants} basePrice={selected.price} /></GoodOperationSection>}
          {!selected.archivedAt && <GoodOperationSection id="kc" title={OPERATION.kc[0]} description={OPERATION.kc[1]}><GoodsKcPanel goodId={selected.id} refreshKey={state.attempt ?? 0} templateRequest={kcTemplate.request} onTemplateApplied={kcTemplate.consume} key={`kc-${selected.id}-${selected.publishedAt}-${selected.archivedAt}`} /></GoodOperationSection>}
          {!selected.archivedAt && canManageCosts && <GoodOperationSection id="costs" title={OPERATION.costs[0]} description={OPERATION.costs[1]}><GoodsPurchaseCostsPanel goodId={selected.id} variants={variants} key={`costs-${selected.id}`} /></GoodOperationSection>}
          {!selected.archivedAt && <GoodOperationSection id="listing-colors" title={OPERATION['listing-colors'][0]} description={OPERATION['listing-colors'][1]}><GoodsListingColorsPanel goodId={selected.id} key={`listing-colors-${selected.id}`} /></GoodOperationSection>}
          {!selected.archivedAt && <GoodOperationSection id="additional" title={OPERATION.additional[0]} description={OPERATION.additional[1]}><GoodsAdditionalPanel goodId={selected.id} key={`additional-${selected.id}`} /></GoodOperationSection>}
          {!selected.archivedAt && <GoodOperationSection id="benefits" title={OPERATION.benefits[0]} description={OPERATION.benefits[1]}><GoodsBenefitsPanel goodId={selected.id} key={`benefits-${accountId}-${selected.id}`} /></GoodOperationSection>}
          {!selected.archivedAt && !ownership?.group && <GoodOperationSection id="after-sales" title={OPERATION['after-sales'][0]} description={OPERATION['after-sales'][1]}><GoodsAfterSalesPanel goodId={selected.id} key={`after-sales-${accountId}-${selected.id}`} /></GoodOperationSection>}
          {!selected.archivedAt && !ownership?.group && <GoodOperationSection id="size-chart" title={OPERATION['size-chart'][0]} description={OPERATION['size-chart'][1]}><GoodSizeChartPanel goodId={selected.id} accountId={accountId} key={`size-chart-${accountId}-${selected.id}`} /></GoodOperationSection>}
          {!selected.archivedAt && <GoodOperationSection id="prices" title={OPERATION.prices[0]} description={OPERATION.prices[1]}><GoodsPricePeriodsPanel goodId={selected.id} variants={variants} key={`prices-${selected.id}`} /></GoodOperationSection>}
          {!selected.archivedAt && <GoodOperationSection id="transaction-terms" title={OPERATION['transaction-terms'][0]} description={OPERATION['transaction-terms'][1]}><GoodsTransactionTermsPanel goodId={selected.id} accountId={accountId} disabledReason={ownership && !ownership.aggregation.editable ? '할인·수량별 배송비는 합산 기준 상품에서 관리합니다.' : chargeBusy ? '묶음그룹 저장 결과를 확인한 뒤 할인·배송 설정을 저장해주세요.' : subscriptionBusy ? '정기배송 저장 결과를 확인한 뒤 할인·배송 설정을 저장해주세요.' : policyDisabled} onBusyChange={setTransactionBusy} key={`transaction-${accountId}-${selected.id}`} /></GoodOperationSection>}
          {!selected.archivedAt && <GoodOperationSection id="shipping-charge-group" title={OPERATION['shipping-charge-group'][0]} description={OPERATION['shipping-charge-group'][1]}><GoodShippingChargeGroupPanel goodId={selected.id} accountId={accountId} disabledReason={transactionBusy || subscriptionBusy ? '할인·배송 또는 정기배송 요청의 결과를 확인한 뒤 배정해주세요.' : policyDisabled} onBusyChange={setChargeBusy} key={`shipping-charge-${accountId}-${selected.id}`} /></GoodOperationSection>}
          {!selected.archivedAt && <GoodOperationSection id="subscription-policy" title={OPERATION['subscription-policy'][0]} description={OPERATION['subscription-policy'][1]}><GoodsSubscriptionPolicyPanel goodId={selected.id} accountId={accountId} disabledReason={transactionBusy || chargeBusy ? '할인·배송 저장 결과를 확인한 뒤 정기배송 설정을 저장해주세요.' : policyDisabled} onBusyChange={setSubscriptionBusy} key={`subscription-${accountId}-${selected.id}`} /></GoodOperationSection>}
          {!selected.archivedAt && accountId ? <GoodOperationSection id="fulfillment" title={OPERATION.fulfillment[0]} description={OPERATION.fulfillment[1]}><GoodsFulfillmentPanel key={`fulfillment-${accountId}-${selected.id}`} goodId={selected.id} accountId={accountId} disabledReason={policyDisabled} /></GoodOperationSection> : null}
          {!selected.archivedAt && accountId ? <GoodOperationSection id="production" title={OPERATION.production[0]} description={OPERATION.production[1]}><GoodsProductionPanel key={`production-${accountId}-${selected.id}`} goodId={selected.id} accountId={accountId} disabledReason={policyDisabled} /></GoodOperationSection> : null}
          {/* T7 랜덤 판매 패널 자리(D5②): 통합 때 예약판매 바로 앞인 이 자리에
              <GoodOperationSection id="option-sale-mode" …><GoodsOptionSaleModePanel goodId={selected.id} disabled={…} /></GoodOperationSection>을 마운트한다. */}
          {!selected.archivedAt && <GoodOperationSection id="preorders" title={OPERATION.preorders[0]} description={OPERATION.preorders[1]}><GoodsPreordersPanel goodId={selected.id} variants={variants} canActivate={canManageCosts} canReadOrders={canReadOrders} canAllocate={canManageSales} key={`preorders-${selected.id}`} /></GoodOperationSection>}
          {!selected.archivedAt && cloneOperationId && <GoodOperationSection id="clone" title={OPERATION.clone[0]} description={OPERATION.clone[1]}><GoodClonePanel operationId={cloneOperationId} goodId={selected.id} goodName={selected.name} goodCode={selected.code} key={`clone-${selected.id}`} /></GoodOperationSection>}
          <GoodOperationSection id="archive" title={OPERATION.archive[0]} description={OPERATION.archive[1]}><CatalogArchiveControl
            archivedAt={selected.archivedAt}
            id={selected.id}
            key={`${selected.id}:${selected.archivedAt ?? 'active'}`}
            kind="good"
          /></GoodOperationSection>
        </> : <>
          {/* 등록 화면(R13·D6②): 저장 뒤 나오는 운영 섹션을 같은 순서·같은 id로 보인다. KC·예약판매는 기본 입력과 함께 원자 저장한다. */}
          <Placeholder id="stock" />
          <Placeholder id="publish" />
          {!ownership?.group && <Placeholder id="variants" />}
          <GoodOperationSection id="kc" title={OPERATION.kc[0]} description="KC 자료와 검토 상태를 상품과 함께 입력합니다." mode="inline" defaultOpen>
            <GoodWorkspaceKcCard serverError={state.errors?.workspaceKc} disabled={pending} />
          </GoodOperationSection>
          {canManageCosts && <Placeholder id="costs" />}
          <Placeholder id="listing-colors" />
          <Placeholder id="additional" />
          <Placeholder id="benefits" />
          {!ownership?.group && <Placeholder id="after-sales" />}
          {!ownership?.group && <Placeholder id="size-chart" />}
          <Placeholder id="prices" />
          <Placeholder id="transaction-terms" />
          <Placeholder id="shipping-charge-group" />
          <Placeholder id="subscription-policy" />
          {accountId ? <Placeholder id="fulfillment" /> : null}
          {accountId ? <Placeholder id="production" /> : null}
          <GoodOperationSection id="preorders" title={OPERATION.preorders[0]} description="옵션별 예약 조건을 상품과 함께 입력합니다." mode="inline" defaultOpen>
            <GoodWorkspacePreorderCard canActivate={canManageCosts} serverError={state.errors?.workspacePreorders} disabled={pending} />
          </GoodOperationSection>
          {cloneOperationId && <Placeholder id="clone" />}
          <Placeholder id="archive" />
        </>}
      </div>
    </div>
    </GoodWorkspaceProvider>
  );
}
