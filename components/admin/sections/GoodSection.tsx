'use client';
import { goodsGroupCommonHref, goodsGroupHref, type GoodsEditorOwnership } from '@/lib/admin/goods-group-common';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useState, type ReactNode } from 'react';
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
import type { AdminGoodsReadiness } from '@/lib/admin/goods-readiness';
import { goodSaleSettingsState } from '@/lib/admin/good-workspace';
import { statusTone } from '@/lib/admin/status-tone';
import { ADMIN_VOCABULARY, adminGoodsCopy } from '@/lib/admin/vocabulary';
import { AdminNotice, AdminPageHeader, AdminStatusBadge } from '../console/AdminKit';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { GOOD_INPUT_CLASS } from '../GoodEditorParts';
import { RecordList } from '../fields';
import { GoodEditor } from '../GoodEditor';
import { CatalogArchiveControl, CatalogArchiveFilter } from '../CatalogArchiveControls';
import { GoodsListingColorsPanel } from '../GoodsListingColorsPanel';
import { GOOD_OPERATION_PLACEHOLDER_COPY, GOOD_UNSAVED_BASE_COPY, GoodOperationDisabledNotice, GoodOperationGroup, GoodOperationSection, GoodWorkspaceProvider, focusGoodWorkspaceTarget } from '../GoodWorkspace';
import { GoodSavedPreorderSection, GoodWorkspaceKcCard, GoodWorkspacePreorderRow } from '../GoodWorkspaceSections';
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
import { GoodsAfterSalesPhoneSuggestion } from '../GoodsAfterSalesFields';
import { GoodSizeChartPanel } from '../GoodSizeChartPanel';
import { GoodsTransactionTermsPanel } from '../GoodsTransactionTermsPanel';
import { GoodsFulfillmentPanel } from '../GoodsFulfillmentPanel';
import { GoodsProductionPanel } from '../GoodsProductionPanel';
import { GoodsSubscriptionPolicyPanel } from '../GoodsSubscriptionPolicyPanel';
import { GoodShippingChargeGroupPanel } from '../GoodShippingChargeGroupPanel';
import { GoodsOptionSaleModePanel } from '../GoodsOptionSaleModePanel';

/** 운영 섹션 제목·설명. 저장된 상품의 독립 패널과 등록 화면의 이어서 설정 목록이 같은 문구·같은 id를 쓴다. */
const OPERATION = {
  stock: ['재고 조정', '대상 옵션·변경 수량·사유를 확인해 재고 조정만 즉시 반영합니다.'],
  publish: ['게시 상태 · 공개·초안 전환', '저장된 내용으로 게시 상태만 전환합니다.'],
  variants: ['옵션 사용·보관', '옵션 사용 상태만 별도로 반영합니다.'],
  kc: ['KC 자료·검토', 'KC 인증 대상 여부를 고릅니다. 대상이 아니면 상품 전체 KC 해당 없음으로 바로 검토하고, 대상이면 인증 종류·번호와 모델·사업자·적용 옵션을 확인합니다(내부 근거는 선택). KC와 기타 인증을 각각 따로 저장합니다.'],
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
  'option-sale-mode': ['판매 방식', '고객이 옵션을 고르는 판매와 랜덤 판매 중 판매 방식만 별도로 저장합니다.'],
  preorders: ['예약판매', '예약판매 설정과 물량을 별도로 저장합니다.'],
  clone: ['상품 복사', '저장된 상품으로 새로운 초안을 만듭니다.'],
  archive: ['상품 보관·복원', '게시와 보관 상태만 변경합니다.'],
} as const;
type OperationId = keyof typeof OPERATION;

/*
 * 이어서 설정 카드의 묶음(저장 뒤 접이식 5그룹). 저장 전에는 같은 묶음·같은 순서로 이름만 보인다(10/27 회의 D6·R13).
 * 게시 상태는 판매 준비 카드, KC는 고시 카드에 있고, 저장 전 목록의 첫 줄에만 게시 상태 이름이 같이 나온다.
 */
const OPERATION_GROUPS: { id: string; title: string; operations: readonly OperationId[] }[] = [
  { id: 'sales', title: '판매 운영', operations: ['stock', 'variants', 'option-sale-mode', 'preorders'] },
  { id: 'benefits', title: '가격·혜택', operations: ['prices', 'additional', 'benefits'] },
  { id: 'delivery', title: '배송·수령', operations: ['transaction-terms', 'shipping-charge-group', 'subscription-policy', 'fulfillment', 'production'] },
  { id: 'content', title: '상세 콘텐츠', operations: ['listing-colors', 'after-sales', 'size-chart'] },
  { id: 'manage', title: '관리', operations: ['costs', 'clone', 'archive'] },
];

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
  accountId='', origins=[], noticeDefaults, categories=[], shippingNoticeOptions=[], canManageCosts=false, canReadOrders=true, canManageSales=true, canSearchErp=true, canOpenIp=false, canManageMedia=false, cloneOperationId, readiness, regionSummaries = [],
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
  categories?: AdminCategoryNode[]; shippingNoticeOptions?: GoodsShippingNoticeOption[]; canManageCosts?: boolean; canReadOrders?: boolean; canManageSales?: boolean; canSearchErp?: boolean; canOpenIp?: boolean; canManageMedia?: boolean; cloneOperationId?: string; readiness?: AdminGoodsReadiness | null; regionSummaries?: GoodShippingRegionSummary[];
}) {
  const [archiveFilter, setArchiveFilter] = useState<AdminCatalogArchiveFilter>(
    selected?.archivedAt ? 'archived' : 'active',
  );
  const [query,setQuery]=useState(initialQuery);
  const [editingState, setEditingState] = useState<{ goodId: string | null; dirty: boolean; busy: boolean } | null>(null);
  const [publishOnSave, setPublishOnSave] = useState(false);
  const [transactionBusy, setTransactionBusy] = useState(false);
  const [subscriptionBusy, setSubscriptionBusy] = useState(false);
  const [chargeBusy, setChargeBusy] = useState(false);
  /* 처음 열 때 KC 검토가 필요하면 펼쳐 둔다. 검토를 끝낸 순간 판정이 바뀌어도 방금 작업한 패널을 접지 않게 처음 값을 쓴다. */
  const [kcStartsOpen] = useState(readiness?.publicReview === 'required');
  const policyUnsaved = !(pending || editingState?.busy) && editingState?.goodId === selected?.id && Boolean(editingState?.dirty);
  const policyDisabled = pending || editingState?.busy ? '기본 상품을 저장하는 중입니다. 저장이 끝난 뒤 별도 설정을 저장해주세요.'
    : editingState?.goodId !== selected?.id ? '기본 상품의 입력 상태를 확인하고 있습니다.'
    : editingState?.dirty ? GOOD_UNSAVED_BASE_COPY : '';
  /*
   * R14: 기본 입력 상태 때문에 잠긴 운영 패널은 맨 위에 같은 이유와 저장 바로가기를 보인다. 그때 패널은 잠그기만 하고
   * 같은 이유를 본문에 다시 그리지 않는다(showDisabledReason=false, 리뷰 T3a-7). 다른 패널 저장을 기다리느라 공통 안내를
   * 보이지 않을 때는 패널이 자기 이유를 직접 보인다.
   */
  const policyNotice = <GoodOperationDisabledNotice reason={policyDisabled} unsaved={policyUnsaved} />;
  const transactionOwnReason = ownership && !ownership.aggregation.editable ? '할인·수량별 배송비는 합산 기준 상품에서 관리합니다.'
    : chargeBusy ? '묶음그룹 저장 결과를 확인한 뒤 할인·배송 설정을 저장해주세요.'
    : subscriptionBusy ? '정기배송 저장 결과를 확인한 뒤 할인·배송 설정을 저장해주세요.' : '';
  const chargeOwnReason = transactionBusy || subscriptionBusy ? '할인·배송 또는 정기배송 요청의 결과를 확인한 뒤 배정해주세요.' : '';
  const subscriptionOwnReason = transactionBusy || chargeBusy ? '할인·배송 저장 결과를 확인한 뒤 정기배송 설정을 저장해주세요.' : '';
  const kcTemplate = useGoodsKcTemplate(selected?.id ?? null);
  const normalizedQuery=query.trim().toLocaleLowerCase();
  const visibleRecords = filterAdminCatalogRecords(records, archiveFilter).filter((good)=>!normalizedQuery
    || `${good.name} ${good.code} ${(good.searchKeywords ?? []).join(' ')}`.toLocaleLowerCase().includes(normalizedQuery)
    || variants.some((variant)=>variant.goodId===good.id && `${variant.code} ${variant.erpCode ?? ''} ${variant.erpName ?? ''} ${variant.barcode ?? ''}`.toLocaleLowerCase().includes(normalizedQuery)));
  /* 저장에 성공한 시도. 등록 화면의 KC·예약판매 입력은 서버로 들어갔으므로 provider가 비우고 작업 ID를 새로 만든다. */
  const completedKey = state.savedGoodId && !state.errors ? `${state.savedGoodId}:${state.attempt ?? 0}` : null;
  const saleSettings = readiness ? goodSaleSettingsState(readiness) : null;
  /* 고시 입력 바로 아래 놓일 KC 영역. 저장 전에는 기본 입력과 함께 저장하고, 저장 뒤에는 KC만 따로 저장한다. */
  const kcSlot: ReactNode = selected
    ? (selected.archivedAt ? null : <GoodOperationSection id="kc" title={OPERATION.kc[0]} description={OPERATION.kc[1]} separateLabel defaultOpen={kcStartsOpen}><GoodsKcPanel goodId={selected.id} refreshKey={state.attempt ?? 0} templateRequest={kcTemplate.request} onTemplateApplied={kcTemplate.consume} key={`kc-${selected.id}-${selected.publishedAt}-${selected.archivedAt}`} /></GoodOperationSection>)
    : <GoodOperationSection id="kc" title={OPERATION.kc[0]} mode="inline" defaultOpen><GoodWorkspaceKcCard serverError={state.errors?.workspaceKc} disabled={pending} /></GoodOperationSection>;
  /* 저장 뒤 이어서 설정 카드에 들어가는 패널. 내용은 그대로이고 묶음만 새로 나눴다. */
  const operationPanels: Partial<Record<OperationId, ReactNode>> = !selected ? {} : {
    ...(selected.archivedAt ? {} : { stock: <GoodOperationSection key="stock" id="stock" title={OPERATION.stock[0]} description={OPERATION.stock[1]}><VariantStockAdjustmentForm adjustmentId={adjustmentId} good={selected} variants={variants} key={`stock-${selected.id}`} /></GoodOperationSection> }),
    ...(ownership?.group ? {} : { variants: <GoodOperationSection key="variants" id="variants" title={OPERATION.variants[0]} description={OPERATION.variants[1]}><GoodVariantsPanel goodId={selected.id} variants={variants} basePrice={selected.price} /></GoodOperationSection> }),
    ...(selected.archivedAt ? {} : {
      ...(canManageCosts ? { costs: <GoodOperationSection key="costs" id="costs" title={OPERATION.costs[0]} description={OPERATION.costs[1]}><GoodsPurchaseCostsPanel goodId={selected.id} variants={variants} key={`costs-${selected.id}`} /></GoodOperationSection> } : {}),
      'listing-colors': <GoodOperationSection key="listing-colors" id="listing-colors" title={OPERATION['listing-colors'][0]} description={OPERATION['listing-colors'][1]}><GoodsListingColorsPanel goodId={selected.id} key={`listing-colors-${selected.id}`} /></GoodOperationSection>,
      additional: <GoodOperationSection key="additional" id="additional" title={OPERATION.additional[0]} description={OPERATION.additional[1]}><GoodsAdditionalPanel goodId={selected.id} key={`additional-${selected.id}`} /></GoodOperationSection>,
      benefits: <GoodOperationSection key="benefits" id="benefits" title={OPERATION.benefits[0]} description={OPERATION.benefits[1]}><GoodsBenefitsPanel goodId={selected.id} key={`benefits-${accountId}-${selected.id}`} /></GoodOperationSection>,
      ...(ownership?.group ? {} : {
        /* ADM-004(복잡도 표 387행): 비어 있는 A/S 전화번호는 이 상품의 고시 A/S 연락처(저장값)로 미리 채운다. 저장은 안내 저장으로 따로 한다. */
        'after-sales': <GoodsAfterSalesPhoneSuggestion.Provider key="after-sales" value={selected.notice?.asContact ?? ''}><GoodOperationSection id="after-sales" title={OPERATION['after-sales'][0]} description={OPERATION['after-sales'][1]}><GoodsAfterSalesPanel goodId={selected.id} key={`after-sales-${accountId}-${selected.id}`} /></GoodOperationSection></GoodsAfterSalesPhoneSuggestion.Provider>,
        'size-chart': <GoodOperationSection key="size-chart" id="size-chart" title={OPERATION['size-chart'][0]} description={OPERATION['size-chart'][1]}><GoodSizeChartPanel goodId={selected.id} accountId={accountId} key={`size-chart-${accountId}-${selected.id}`} /></GoodOperationSection>,
      }),
      prices: <GoodOperationSection key="prices" id="prices" title={OPERATION.prices[0]} description={OPERATION.prices[1]}><GoodsPricePeriodsPanel goodId={selected.id} variants={variants} key={`prices-${selected.id}`} /></GoodOperationSection>,
      'transaction-terms': <GoodOperationSection key="transaction-terms" notice={transactionOwnReason ? undefined : policyNotice} id="transaction-terms" title={OPERATION['transaction-terms'][0]} description={OPERATION['transaction-terms'][1]}><GoodsTransactionTermsPanel goodId={selected.id} accountId={accountId} disabledReason={transactionOwnReason || policyDisabled} showDisabledReason={Boolean(transactionOwnReason)} onBusyChange={setTransactionBusy} key={`transaction-${accountId}-${selected.id}`} /></GoodOperationSection>,
      'shipping-charge-group': <GoodOperationSection key="shipping-charge-group" notice={chargeOwnReason ? undefined : policyNotice} id="shipping-charge-group" title={OPERATION['shipping-charge-group'][0]} description={OPERATION['shipping-charge-group'][1]}><GoodShippingChargeGroupPanel goodId={selected.id} accountId={accountId} disabledReason={chargeOwnReason || policyDisabled} showDisabledReason={Boolean(chargeOwnReason)} onBusyChange={setChargeBusy} key={`shipping-charge-${accountId}-${selected.id}`} /></GoodOperationSection>,
      'subscription-policy': <GoodOperationSection key="subscription-policy" notice={subscriptionOwnReason ? undefined : policyNotice} id="subscription-policy" title={OPERATION['subscription-policy'][0]} description={OPERATION['subscription-policy'][1]}><GoodsSubscriptionPolicyPanel goodId={selected.id} accountId={accountId} disabledReason={subscriptionOwnReason || policyDisabled} showDisabledReason={Boolean(subscriptionOwnReason)} onBusyChange={setSubscriptionBusy} key={`subscription-${accountId}-${selected.id}`} /></GoodOperationSection>,
      ...(accountId ? {
        fulfillment: <GoodOperationSection key="fulfillment" notice={policyNotice} id="fulfillment" title={OPERATION.fulfillment[0]} description={OPERATION.fulfillment[1]}><GoodsFulfillmentPanel key={`fulfillment-${accountId}-${selected.id}`} goodId={selected.id} accountId={accountId} disabledReason={policyDisabled} showDisabledReason={false} /></GoodOperationSection>,
        production: <GoodOperationSection key="production" notice={policyNotice} id="production" title={OPERATION.production[0]} description={OPERATION.production[1]}><GoodsProductionPanel key={`production-${accountId}-${selected.id}`} goodId={selected.id} accountId={accountId} disabledReason={policyDisabled} showDisabledReason={false} /></GoodOperationSection>,
      } : {}),
      /* D5② 판매 방식(랜덤 판매): 옵션·가격 저장과 낙관 잠금(goods.updated_at)을 나눠 쓰므로 기본 입력이 잠기면 함께 잠그고,
         상품을 저장해 수정 시각이 바뀌면 다시 읽는다. */
      'option-sale-mode': <GoodOperationSection key="option-sale-mode" notice={policyNotice} id="option-sale-mode" title={OPERATION['option-sale-mode'][0]} description={OPERATION['option-sale-mode'][1]}><GoodsOptionSaleModePanel key={`option-sale-mode-${selected.id}`} goodId={selected.id} revision={`${selected.updatedAt ?? ''}:${state.attempt ?? 0}`} disabled={Boolean(policyDisabled)} /></GoodOperationSection>,
      /* 1027T-023: 예약판매 패널은 판매 정보 카드의 판매기간 바로 뒤로 옮겼다. 옛 자리에는 그 위치로 가는 링크만 남긴다(판매 방식 바로 뒤 — D5②). */
      preorders: <div key="preorders" className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border px-4 py-3 text-sm" data-good-operation-moved="preorders">
        <span className="font-medium text-foreground">{OPERATION.preorders[0]}</span>
        <span className="min-w-0 flex-1 text-muted-foreground">판매 정보 카드의 판매기간 아래에서 설정합니다.</span>
        <a className={buttonVariants({ variant: 'outline', size: 'sm' })} data-slot="button" href="#good-operation-preorders" onClick={(event) => { event.preventDefault(); focusGoodWorkspaceTarget('good-operation-preorders'); }}>예약판매로 이동</a>
      </div>,
      ...(cloneOperationId ? { clone: <GoodOperationSection key="clone" id="clone" title={OPERATION.clone[0]} description={OPERATION.clone[1]}><GoodClonePanel operationId={cloneOperationId} goodId={selected.id} goodName={selected.name} goodCode={selected.code} categoryId={selected.categoryId ?? null} key={`clone-${selected.id}`} /></GoodOperationSection> } : {}),
    }),
    archive: <GoodOperationSection key="archive" id="archive" title={OPERATION.archive[0]} description={OPERATION.archive[1]}><CatalogArchiveControl archivedAt={selected.archivedAt} id={selected.id} key={`${selected.id}:${selected.archivedAt ?? 'active'}`} kind="good" /></GoodOperationSection>,
  };
  /*
   * 판매 정보 카드의 예약판매(1027T-023, 판매기간 바로 뒤). 등록 화면은 상품과 함께 저장하는 입력이고, 저장된 상품은 같은 자리(같은 id)의
   * 별도 저장 패널이다 — "등록 화면을 떠나지 않고 같은 자리에서"(10/27 R13). 보관된 상품은 예약판매를 다루지 않는다.
   */
  const preorderSlot: ReactNode = !selected
    ? <GoodWorkspacePreorderRow title={OPERATION.preorders[0]} canActivate={canManageCosts} serverError={state.errors?.workspacePreorders} disabled={pending} />
    : selected.archivedAt ? null
    : <GoodSavedPreorderSection title={OPERATION.preorders[0]}><GoodsPreordersPanel goodId={selected.id} variants={variants} canActivate={canManageCosts} canReadOrders={canReadOrders} canAllocate={canManageSales} randomSale={selected.optionSaleMode === 'random'} key={`preorders-${selected.id}`} /></GoodSavedPreorderSection>;
  /* 저장 전 목록: 이 계정·상품에서 저장 뒤 실제로 보일 항목만, 같은 묶음·같은 순서로. 게시 상태는 판매 운영 맨 앞, 예약판매는 판매 정보 카드에 입력 칸이 있다. */
  const pendingOperations: Partial<Record<OperationId, boolean>> = { stock: true, publish: true, variants: !ownership?.group, costs: canManageCosts, 'listing-colors': true, additional: true, benefits: true, 'after-sales': !ownership?.group, 'size-chart': !ownership?.group, prices: true, 'transaction-terms': true, 'shipping-charge-group': true, 'subscription-policy': true, fulfillment: Boolean(accountId), production: Boolean(accountId), 'option-sale-mode': true, clone: Boolean(cloneOperationId), archive: true };
  const pendingOperationGroups = OPERATION_GROUPS.map((group) => ({ ...group, operations: (group.id === 'sales' ? ['stock', 'publish', 'variants', 'option-sale-mode'] as const : group.operations).filter((id) => pendingOperations[id]) })).filter((group) => group.operations.length);

  return (
    <GoodWorkspaceProvider completedKey={completedKey}>
    <div className={hideRecordList ? 'flex min-w-0 flex-col gap-4' : 'grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(15rem,0.34fr)_minmax(0,1fr)]'} data-good-workspace="">
      {!hideRecordList && <div className="flex min-w-0 flex-col gap-3">
        <label className="flex flex-col gap-2 text-sm font-medium">
          <span>{ADMIN_VOCABULARY.goods}명·{ADMIN_VOCABULARY.goodsCode}·ERP 코드·ERP 품명·바코드·검색 키워드</span>
          <input className={GOOD_INPUT_CLASS} data-slot="input" onChange={(event)=>setQuery(event.target.value)} placeholder={`${ADMIN_VOCABULARY.goods}명·${ADMIN_VOCABULARY.goodsCode}·검색 키워드`} type="search" value={query}/>
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
      {/* 아래 여백은 고정 저장 영역(GoodEditor)에 마지막 카드가 가리지 않게 한다. */}
      <div className="flex min-w-0 flex-col gap-4 pb-40 xl:pb-20">
        {/* 다른 등록 화면처럼 보조 동작은 제목 줄 오른쪽에 한 줄로 묶어 입력이 바로 시작하게 한다. */}
        <AdminPageHeader title={selected?.name ?? `${ADMIN_VOCABULARY.goods} 등록`} description={selected?.id} actions={<>
          {!selected && accountId ? <GoodCopySourcePicker accountId={accountId} disabledReason={pending || editingState?.busy ? '현재 입력을 저장하는 중입니다.'
            : editingState?.dirty ? '작성 중인 입력은 먼저 임시저장한 뒤 복사할 상품을 선택해주세요.' : ''} /> : null}
          {selected && canManageMedia ? <Link className={buttonVariants({ variant: 'outline', size: 'sm' })} data-slot="button" href={`/admin/catalog/goods/media?goodId=${encodeURIComponent(selected.id)}`}>동영상·숏클립 관리</Link> : null}
          <Link className={buttonVariants({ variant: 'outline', size: 'sm' })} data-slot="button" href={listHref}><ArrowLeft aria-hidden="true" />{ADMIN_VOCABULARY.goods} 목록으로</Link>
        </>} />
        {ownership?.group ? <section data-good-lock=""><AdminNotice title={`${ownership.group.name} · 그룹상품`} tone="neutral">상품명과 옵션 구성은 <a className="underline underline-offset-4" href={goodsGroupHref(ownership.group.id)}>그룹 구성</a>에서, 카테고리·속성·IP·유형·고시·상세설명·A/S·사이즈는 <a className="underline underline-offset-4" href={goodsGroupCommonHref(ownership.group)}>공통정보 편집</a>에서 수정합니다.</AdminNotice></section> : null}
        {ownership && !ownership.aggregation.editable ? <AdminNotice tone="neutral">배송비·주문 수량·회원 누적 한도·복수구매 할인은 <a className="underline underline-offset-4" href={`/admin/catalog/goods?goodId=${encodeURIComponent(ownership.aggregation.ownerGoodId)}`}>합산 기준 상품</a>에서 관리합니다.</AdminNotice> : null}
        {/* 입력칸을 밀어내지 않게 상태는 한 줄, 처리할 일은 하나만 펼쳐 둔다. 긴 안내는 판매 준비 안내에 접혀 있다. */}
        {selected && <section aria-label="판매 준비 상태" className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 text-sm text-card-foreground sm:p-5" data-good-readiness="">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
            <h3 className="text-base leading-snug font-medium">판매 준비</h3>
            {readiness ? <>
              <AdminStatusBadge tone={statusTone('publication', readiness.publication)}>게시 · {{ draft: '초안', published: '공개', archived: '보관', unknown: '확인 필요' }[readiness.publication]}</AdminStatusBadge>
              <AdminStatusBadge tone={statusTone('operation', readiness.operation)}>운영 · {{ active: '정상', stopped: '판매 중지', unknown: '확인 필요' }[readiness.operation]}</AdminStatusBadge>
              <AdminStatusBadge tone={statusTone('readiness', saleSettings)}>판매 설정 · {saleSettings === 'ready' ? '준비 완료' : '확인 필요'}</AdminStatusBadge>
              <AdminStatusBadge tone={statusTone('readiness', { current: 'ready', required: 'review_required', legacy_unrecorded: 'review_required', unknown: 'unknown' }[readiness.publicReview])}>공개 검토 · {{ current: 'KC 검토 완료', required: 'KC 검토 필요', legacy_unrecorded: '기존 공개 · KC 미기록', unknown: '확인 필요' }[readiness.publicReview]}</AdminStatusBadge>
              <span className="ml-auto text-sm tabular-nums">판매 가능 재고 {readiness.availableQty === null ? '확인 필요' : `${readiness.availableQty.toLocaleString('ko-KR')}개`}</span>
            </> : null}
          </div>
          {readiness ? null : <AdminNotice tone="warning">판매 준비 정보를 확인하지 못했습니다. 다시 불러와 확인해주세요.</AdminNotice>}
          <GoodPublishControls id={selected.id} publishedAt={selected.publishedAt} archivedAt={selected.archivedAt} readiness={readiness} unsaved={policyUnsaved} publishOnSave={publishOnSave} priceZero={selected.price <= 0} key={`publish-${selected.id}-${selected.publishedAt}-${selected.archivedAt}`}/>
        </section>}
        <fieldset className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0" disabled={transactionBusy || subscriptionBusy || chargeBusy}>
        <GoodEditor
          ownership={ownership}
          onEditingStateChange={setEditingState}
          onPublishOnSaveChange={setPublishOnSave}
          listHref={listHref}
          canSearchErp={canSearchErp}
          canOpenIp={canOpenIp}
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
          readiness={readiness}
          kcSlot={kcSlot}
          preorderSlot={preorderSlot}
        />
        </fieldset>
        {selected ? <section aria-labelledby="good-operation-hub-title" className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 text-sm text-card-foreground sm:p-5" data-good-operation-hub="saved">
          <div className="flex flex-col gap-1">
            <h3 className="text-base leading-snug font-medium" id="good-operation-hub-title">이어서 설정</h3>
            <p className="text-muted-foreground">각 항목은 따로 저장합니다. 기본 상품 입력은 함께 저장되지 않습니다.</p>
          </div>
          {OPERATION_GROUPS.map((group) => {
            const visible = group.operations.filter((id) => operationPanels[id]);
            return visible.length ? <GoodOperationGroup id={group.id} key={group.id} title={group.title} names={visible.map((id) => OPERATION[id][0]).join(' · ')}>{visible.map((id) => operationPanels[id])}</GoodOperationGroup> : null;
          })}
        </section> : <section aria-labelledby="good-operation-hub-title" className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 text-sm text-card-foreground sm:p-5" data-good-operation-hub="pending">
          <div className="flex flex-col gap-1">
            <h3 className="text-base leading-snug font-medium" id="good-operation-hub-title">저장하면 이어서 설정할 수 있어요</h3>
            <p className="text-muted-foreground" role="note">{GOOD_OPERATION_PLACEHOLDER_COPY}</p>
          </div>
          {/* 저장 전 18개 운영 항목은 이름만 저장 뒤와 같은 묶음·같은 순서로 보인다(D6·R13). 입력은 저장 뒤 이 자리에서 한다. */}
          <dl className="m-0 grid min-w-0 gap-x-4 gap-y-1.5 sm:grid-cols-[6rem_minmax(0,1fr)]">
            {pendingOperationGroups.map((group) => <div className="contents" key={group.id}>
              <dt className="text-muted-foreground">{group.title}</dt>
              <dd className="m-0 min-w-0"><ul className="m-0 flex list-none flex-wrap gap-x-1 p-0" data-good-operation-names="">{group.operations.map((id, index) => <li id={`good-operation-${id}`} key={id} data-good-operation-name={id}>{OPERATION[id][0]}{index < group.operations.length - 1 ? <span aria-hidden="true" className="text-muted-foreground"> · </span> : null}</li>)}</ul></dd>
            </div>)}
          </dl>
        </section>}
      </div>
    </div>
    </GoodWorkspaceProvider>
  );
}
