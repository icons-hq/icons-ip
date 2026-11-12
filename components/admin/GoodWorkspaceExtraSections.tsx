'use client';

import Link from 'next/link';
import { useCallback, useId, useRef, useState, useTransition, type FormEvent, type ReactNode } from 'react';
import { searchGoodsAdditionalAction } from '@/app/admin/goods-additional-actions';
import { prepareDigitalAssetAction, verifyDigitalAssetAction } from '@/app/admin/goods-fulfillment-actions';
import { ClaimContactSession, type ClaimContactIdentity, type ClaimContactScope } from '@/components/claim-contact/ClaimContactSession';
import { createClient } from '@/lib/supabase/client';
import { DIGITAL_BUCKET, parseDigitalFile, type DigitalFile } from '@/lib/goods-fulfillment';
import { GOODS_AFTER_SALES_TEMPLATES_PATH } from '@/lib/goods-after-sales';
import { GOODS_SIZE_TEMPLATES_PATH, parseGoodsSizeChart } from '@/lib/goods-size-chart';
import { MAX_ADDITIONAL_GOODS, type AdminAdditionalGood } from '@/lib/admin/goods-additional';
import { PURCHASE_TAX_BASIS_LABELS, type PurchaseTaxBasis } from '@/lib/admin/goods-purchase-costs';
import { goodsOptionRowKey } from '@/lib/admin/goods-option-editor';
import {
  goodWorkspaceExtraDefault, goodWorkspaceExtraErrorField, type GoodWorkspaceExtraDraft,
  type GoodWorkspaceExtraKey, type GoodWorkspacePricePeriodDraft,
} from '@/lib/admin/good-workspace-extra-sections';
import { adminGoodsCopy } from '@/lib/admin/vocabulary';
import { GoodSizeChart } from '@/components/shop/GoodSizeChart';
import { Button, buttonVariants } from '@/components/admin/kit/ui/button';
import { Label } from '@/components/admin/kit/ui/label';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { useGoodWorkspaceSections } from './GoodWorkspace';
import { GOOD_INPUT_CLASS, GOOD_NUMBER_INPUT_CLASS, GOOD_SUBPANEL_CLASS } from './GoodEditorParts';
import { GoodsBenefitFields, withGiftImage } from './GoodsBenefitsPanel';
import { GoodsAfterSalesFields } from './GoodsAfterSalesFields';
import { GoodsSizeChartFields } from './GoodsSizeChartFields';
import { GoodsListingColorFields } from './GoodsListingColorsPanel';
import { GoodsDeliveryPricingFields, GoodsVolumeDiscountFields } from './GoodsTransactionTermsPanel';
import { GoodsSubscriptionPolicyFields } from './GoodsSubscriptionPolicyPanel';
import { GoodsFulfillmentDraftFields } from './GoodsFulfillmentPanel';
import { GoodsProductionFields } from './GoodsProductionPanel';
import { ShippingChargeGroupField, type ShippingChargeGroupSummaryValue } from './ShippingChargeGroupField';
import { useShippingChargeGroupSession } from './shipping-charge-groups/useShippingChargeGroupOperation';
import { GoodsPhotoPicker } from './screens/GoodsPhotoLibraryScreen';
import { GoodsEventTemplatePicker } from './screens/GoodsEventTemplatesScreen';
import { GoodsAfterSalesTemplatePicker } from './screens/GoodsAfterSalesTemplatesScreen';
import { GoodsSizeTemplatePicker } from './screens/GoodsSizeTemplatesScreen';

/*
 * 상품 등록 화면의 나머지 설정(11/11 묶음 10 1027T-024 "저장 전 전부 입력" — T15b).
 *
 * 저장된 상품의 같은 자리 독립 패널과 같은 입력 부품을 쓰되, 값은 GoodWorkspaceProvider(폼 키 밖)에 두고 저장 버튼이 없다.
 * 기본 상품을 저장할 때 KC·예약판매와 함께 한 번에 저장된다(admin_save_good_workspace). 이 영역은 기본 폼 밖이라 폼 제출·자동복구·
 * 임시저장에 실리지 않는다. 저장에 성공하면 provider가 비우고, 같은 자리의 독립 패널이 저장값을 읽는다.
 */

type Updater<T> = T | ((current: T) => T);
function useExtra<K extends GoodWorkspaceExtraKey>(key: K) {
  const workspace = useGoodWorkspaceSections();
  const setSections = workspace?.setSections;
  const value = (workspace?.sections.extras?.[key] ?? goodWorkspaceExtraDefault(key)) as GoodWorkspaceExtraDraft[K];
  const set = useCallback((update: Updater<GoodWorkspaceExtraDraft[K]>) => setSections?.((current) => {
    const previous = (current.extras?.[key] ?? goodWorkspaceExtraDefault(key)) as GoodWorkspaceExtraDraft[K];
    const next = typeof update === 'function' ? (update as (value: GoodWorkspaceExtraDraft[K]) => GoodWorkspaceExtraDraft[K])(previous) : update;
    return { ...current, extras: { ...current.extras, [key]: next } };
  }), [setSections, key]);
  const error = workspace?.sectionErrors[goodWorkspaceExtraErrorField(key)];
  return { value, set, error, workspace } as const;
}

function SectionError({ message }: { message?: string }) {
  return message ? <p className="text-sm text-destructive" role="alert">{message}</p> : null;
}
/** 섹션 본문. 기본 폼 밖이라 이 안의 입력은 상품 저장의 FormData·브라우저 검증·Enter 제출에 섞이지 않는다. */
function DraftBody({ children, testId }: { children: ReactNode; testId: string }) {
  return <div className="flex min-w-0 flex-col gap-4 text-sm" data-good-workspace-extra={testId}>{children}</div>;
}

const FIELD_LABEL_CLASS = 'flex min-w-0 flex-col gap-1.5 text-sm font-medium text-foreground';
const MODE_LABEL_CLASS = 'flex min-w-0 cursor-pointer items-start gap-2 rounded-lg border px-3 py-2.5 text-sm text-foreground transition-colors has-checked:border-primary has-checked:bg-muted/40 [&>input]:mt-0.5';

/** 판매 방식(옵션 선택 / 랜덤 판매). 랜덤 조건은 저장할 때 DB가 판정한다(기존 전환 RPC). */
export function GoodWorkspaceSaleModeSection({ serverError }: { serverError?: string }) {
  const { value, set, error } = useExtra('optionSaleMode');
  const name = useId();
  return <DraftBody testId="option-sale-mode">
    <p className="text-muted-foreground">랜덤 판매는 고객이 옵션을 고르지 않고 &apos;랜덤&apos;으로 주문합니다. 주문할 때 남은 재고에 비례해 옵션이 무작위로 정해지고,
      고객 화면에는 &apos;랜덤&apos;으로만 보입니다. 랜덤 판매 조건(판매 중 옵션·정기배송 등)은 저장할 때 확인합니다.</p>
    <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0"><legend className="sr-only">판매 방식</legend>
      <label className={MODE_LABEL_CLASS}><input type="radio" name={name} checked={value === 'select'} onChange={() => set('select')} /> 옵션 선택 판매</label>
      <label className={MODE_LABEL_CLASS}><input type="radio" name={name} checked={value === 'random'} onChange={() => set('random')} /> 랜덤 판매</label>
    </fieldset>
    <SectionError message={error ?? serverError} />
  </DraftBody>;
}

/** 공급가(매입단가) · 관리자 전용. 옵션목록의 지금 옵션마다 금액과 세금 구분을 함께 넣는다(둘 다 비우면 미설정). */
export function GoodWorkspacePurchaseCostsSection({ serverError }: { serverError?: string }) {
  const { value, set, error, workspace } = useExtra('purchaseCosts');
  const rows = workspace?.optionRows ?? [];
  const entryFor = (optionKey: string) => value.find((entry) => entry.optionKey === optionKey) ?? { optionKey, unitCostKrw: '', taxBasis: '' as const };
  const update = (optionKey: string, patch: { unitCostKrw?: string; taxBasis?: '' | PurchaseTaxBasis }) => set((current) => {
    const others = current.filter((entry) => entry.optionKey !== optionKey);
    return [...others, { ...entryFor(optionKey), ...patch }];
  });
  return <DraftBody testId="costs">
    <p className="text-muted-foreground">공급처에서 사오는 옵션 1개의 공급가(매입단가)를 원 단위로 입력합니다. 금액과 세금 구분을 함께 저장하며 실제 0원도 기록할 수 있습니다.
      금액을 정하지 않은 옵션은 두 값을 모두 비워 두세요.</p>
    {rows.map((row, index) => {
      const key = goodsOptionRowKey(row), entry = entryFor(key), label = row.name.trim() || `옵션 ${index + 1}`;
      return <div key={key} className="grid min-w-0 gap-3 border-t pt-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] sm:items-end">
        <strong className="min-w-0 font-medium wrap-anywhere">{label}{row.isActive === false ? ' · 사용 중지' : ''}</strong>
        <label className={FIELD_LABEL_CLASS}>공급가(매입단가) (원)<input className={GOOD_NUMBER_INPUT_CLASS} data-slot="input" type="number" min={0} max={2147483647} step={1}
          aria-label={`${label} 공급가(매입단가)`} value={entry.unitCostKrw} placeholder="미설정" onChange={(event) => update(key, { unitCostKrw: event.target.value })} /></label>
        <div className={FIELD_LABEL_CLASS}><label htmlFor={`cost-basis-${index}`}>세금 구분</label>
          <NativeSelect className="w-full" id={`cost-basis-${index}`} aria-label={`${label} 공급가(매입단가) 세금 구분`} value={entry.taxBasis}
            onChange={(event) => update(key, { taxBasis: event.target.value as '' | PurchaseTaxBasis })}>
            <option value="">미설정</option>
            {Object.entries(PURCHASE_TAX_BASIS_LABELS).map(([basis, text]) => <option key={basis} value={basis}>{text}</option>)}
          </NativeSelect></div>
      </div>;
    })}
    <SectionError message={error ?? serverError} />
  </DraftBody>;
}

let periodSequence = 0;
/** 기간 할인. 옵션목록의 지금 옵션을 대상으로 초안 또는 활성 할인을 넣는다. */
export function GoodWorkspacePricePeriodsSection({ serverError }: { serverError?: string }) {
  const { value, set, error, workspace } = useExtra('pricePeriods');
  const rows = workspace?.optionRows ?? [];
  const options = rows.map((row, index) => ({ key: goodsOptionRowKey(row), label: `${row.name.trim() || `옵션 ${index + 1}`}${row.isActive === false ? ' (사용 중지)' : ''}` }));
  const update = (key: string, patch: Partial<GoodWorkspacePricePeriodDraft>) => set((current) => current.map((entry) => entry.key === key ? { ...entry, ...patch } : entry));
  return <DraftBody testId="prices">
    <p className="text-muted-foreground">옵션별 기간 할인을 함께 저장합니다. 초안은 가격에 반영되지 않고, 활성은 시작~종료 동안 기간 할인가로 판매합니다. 같은 옵션의 활성 기간은 겹칠 수 없습니다.</p>
    {!value.length ? <p className="text-muted-foreground">입력한 기간 할인이 없습니다. 필요 없으면 비워 두세요.</p> : null}
    {value.map((entry, index) => <fieldset key={entry.key} className="m-0 flex min-w-0 flex-col gap-3 rounded-lg border p-4">
      <legend className="float-left w-full p-0 text-sm font-medium">기간 할인 {index + 1}</legend>
      <div className={FIELD_LABEL_CLASS}><label htmlFor={`${entry.key}-option`}>대상 옵션</label>
        <NativeSelect className="w-full" id={`${entry.key}-option`} value={entry.optionKey} onChange={(event) => update(entry.key, { optionKey: event.target.value })}>
          {options.some((option) => option.key === entry.optionKey) ? null : <option value={entry.optionKey} disabled>옵션을 다시 선택해주세요</option>}
          {options.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
        </NativeSelect></div>
      <div className="grid min-w-0 gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,11.25rem),1fr))]">
        <label className={FIELD_LABEL_CLASS}>기간 할인가 (원)<input className={GOOD_NUMBER_INPUT_CLASS} data-slot="input" type="number" min={1} step={1} value={entry.discountPrice} onChange={(event) => update(entry.key, { discountPrice: event.target.value })} /></label>
        <label className={FIELD_LABEL_CLASS}>시작 (KST)<input className={GOOD_INPUT_CLASS} data-slot="input" type="datetime-local" value={entry.startsAt} onChange={(event) => update(entry.key, { startsAt: event.target.value })} /></label>
        <label className={FIELD_LABEL_CLASS}>종료 (KST)<input className={GOOD_INPUT_CLASS} data-slot="input" type="datetime-local" value={entry.endsAt} onChange={(event) => update(entry.key, { endsAt: event.target.value })} /></label>
      </div>
      <div className={FIELD_LABEL_CLASS}><label htmlFor={`${entry.key}-state`}>사용 상태</label>
        <NativeSelect className="w-full sm:w-fit" id={`${entry.key}-state`} value={entry.state} onChange={(event) => update(entry.key, { state: event.target.value === 'active' ? 'active' : 'draft' })}>
          <option value="draft">초안 · 가격 미반영</option><option value="active">활성 · 기간 할인 적용</option>
        </NativeSelect></div>
      <div><button type="button" className={buttonVariants({ variant: 'outline', size: 'sm' })} data-slot="button" onClick={() => set((current) => current.filter((item) => item.key !== entry.key))}>이 기간 할인 빼기</button></div>
    </fieldset>)}
    <div><button type="button" className={buttonVariants({ variant: 'outline' })} data-slot="button" disabled={!options.length || value.length >= 100}
      onClick={() => { periodSequence += 1; set((current) => [...current, { key: `period-${periodSequence}`, optionKey: options[0]?.key ?? '', state: 'draft', discountPrice: '', startsAt: '', endsAt: '' }]); }}>기간 할인 추가</button></div>
    <SectionError message={error ?? serverError} />
  </DraftBody>;
}

/** 추가 구성 상품. 판매 중인 다른 상품을 찾아 연결 순서대로 담는다. */
export function GoodWorkspaceAdditionalSection({ serverError }: { serverError?: string }) {
  const { value, set, error } = useExtra('additional');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AdminAdditionalGood[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); event.stopPropagation(); setSearchError(null);
    startTransition(async () => {
      const result = await searchGoodsAdditionalAction(null, query);
      if (result.ok) setResults(result.items); else setSearchError(result.error);
    });
  }
  const move = (index: number, direction: -1 | 1) => set((current) => {
    const destination = index + direction;
    if (destination < 0 || destination >= current.length) return current;
    const next = [...current]; [next[index], next[destination]] = [next[destination], next[index]]; return next;
  });
  return <DraftBody testId="additional">
    <p className="text-muted-foreground">{adminGoodsCopy('상세 화면에서 함께 고를 상품을 연결합니다. 각 상품은 자체 옵션 가격과 수량으로 구매하며, 품절·판매 중지 상품은 구매 화면에 표시하지 않습니다.')}</p>
    <form className="flex min-w-0 flex-wrap items-end gap-2" onSubmit={search}>
      <label className="flex min-w-0 flex-[1_1_12.5rem] flex-col gap-1.5 text-sm font-medium text-foreground">추가할 상품 검색
        <input className={GOOD_INPUT_CLASS} data-slot="input" value={query} onChange={(event) => setQuery(event.target.value)} maxLength={100} required disabled={pending} placeholder="상품명 또는 판매자상품코드" />
      </label>
      <Button type="submit" variant="outline" disabled={pending}>{pending ? '처리 중…' : '검색'}</Button>
    </form>
    {results ? <div className="flex min-w-0 flex-col gap-2">
      {results.length === 0 ? <p className="text-muted-foreground">일치하는 판매 중 상품이 없습니다.</p> : results.map((item) => <div key={item.goodId} className="flex min-w-0 items-center justify-between gap-2 rounded-lg border px-3 py-2">
        <span className="min-w-0 wrap-anywhere">{item.name} <small className="text-xs text-muted-foreground">{item.goodId}</small></span>
        <Button size="sm" type="button" variant="outline" disabled={value.length >= MAX_ADDITIONAL_GOODS || value.some((selected) => selected.goodId === item.goodId)}
          onClick={() => set((current) => [...current, item])}>{value.some((selected) => selected.goodId === item.goodId) ? '선택됨' : '추가'}</Button>
      </div>)}
    </div> : null}
    {searchError ? <p className="text-sm text-destructive" role="alert">{searchError}</p> : null}
    <div className="flex min-w-0 flex-col gap-2">
      <strong className="font-medium tabular-nums">연결 순서 · {value.length}/{MAX_ADDITIONAL_GOODS}</strong>
      {value.length === 0 ? <p className="text-muted-foreground">{adminGoodsCopy('연결된 추가상품이 없습니다.')}</p> : <ol className="flex list-decimal flex-col gap-3 pl-6">
        {value.map((item, index) => <li key={item.goodId}><div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <span className="min-w-0 wrap-anywhere">{item.name} <small className="block text-xs text-muted-foreground">{item.goodId}</small></span>
          <div className="flex gap-1">
            <Button size="sm" type="button" variant="outline" aria-label={`${item.name} 위로 이동`} disabled={index === 0} onClick={() => move(index, -1)}>위로</Button>
            <Button size="sm" type="button" variant="outline" aria-label={`${item.name} 아래로 이동`} disabled={index === value.length - 1} onClick={() => move(index, 1)}>아래로</Button>
            <Button size="sm" type="button" variant="ghost" aria-label={`${item.name} 연결 해제`} onClick={() => set((current) => current.filter((entry) => entry.goodId !== item.goodId))}>해제</Button>
          </div>
        </div></li>)}
      </ol>}
    </div>
    <SectionError message={error ?? serverError} />
  </DraftBody>;
}

/** 사은품·이벤트 안내. */
export function GoodWorkspaceBenefitsSection({ serverError }: { serverError?: string }) {
  const { value, set, error } = useExtra('benefits');
  const [picker, setPicker] = useState<number | null>(null), [templates, setTemplates] = useState(false);
  return <DraftBody testId="benefits">
    <p className="text-muted-foreground">상품 상세에 표시할 안내입니다. 실제 사은품 제공 조건을 설명에 적고 재고·출고는 별도로 준비해주세요.</p>
    <GoodsBenefitFields values={value} onChange={set} onPickPhoto={setPicker} onOpenTemplates={() => setTemplates(true)} fieldPrefix="goods-workspace-benefit-image" />
    <SectionError message={error ?? serverError} />
    {picker !== null ? <GoodsPhotoPicker onClose={() => setPicker(null)} onSelect={(photo) => { set((current) => withGiftImage(current, picker, photo.imagePath)); setPicker(null); }} /> : null}
    {templates ? <GoodsEventTemplatePicker onClose={() => setTemplates(false)} onSelect={(template) => { set((current) => ({ ...current, eventText: template.eventText })); setTemplates(false); }} /> : null}
  </DraftBody>;
}

/** A/S 안내·판매자 특이사항. 비워 두면 저장하지 않는다. */
export function GoodWorkspaceAfterSalesSection({ serverError, phoneDefault = '' }: { serverError?: string; phoneDefault?: string }) {
  const { value: stored, set, error, workspace } = useExtra('afterSales');
  /* 스토어 기본 A/S 연락처(설정)가 있으면 새 상품의 전화번호 칸에 미리 보인다(T22i). 값은 안내를 입력하기 전까지 저장 대상에 넣지 않는다 —
     전화번호만 든 안내는 저장 검사(전화번호·안내 모두 필요)에 걸리기 때문이다. 직접 고치면 그때부터 입력한 값으로 저장된다. */
  const touched = Boolean(workspace?.sections.extras?.afterSales);
  const prefilled = Boolean(phoneDefault) && !touched;
  const value = prefilled ? { ...stored, phone: phoneDefault } : stored;
  const [templates, setTemplates] = useState(false);
  return <DraftBody testId="after-sales">
    <p className="text-muted-foreground">상품별 A/S 안내입니다. 입력하면 전화번호와 A/S 안내가 모두 필요하고, 필요 없으면 세 칸을 비워 두세요.</p>
    <GoodsAfterSalesFields values={value} onChange={set} />
    {prefilled ? <small className="text-xs text-muted-foreground" data-good-workspace-after-sales-prefill="">스토어 기본 A/S 연락처를 미리 채웠습니다. A/S 안내를 입력하면 이 번호와 함께 저장됩니다.</small> : null}
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2"><button className={buttonVariants({ variant: 'outline' })} data-slot="button" type="button" onClick={() => setTemplates(true)}>A/S 템플릿</button><Link className="text-sm underline underline-offset-4" href={GOODS_AFTER_SALES_TEMPLATES_PATH} target="_blank" rel="noreferrer">A/S 템플릿 관리 ↗</Link></div>
    <SectionError message={error ?? serverError} />
    {templates ? <GoodsAfterSalesTemplatePicker onClose={() => setTemplates(false)} onSelect={(template) => { set({ phone: template.phone, guide: template.guide, sellerSpecialNotes: template.sellerSpecialNotes }); setTemplates(false); }} /> : null}
  </DraftBody>;
}

/** 사이즈 안내. 공개 표시와 측정 치수. */
export function GoodWorkspaceSizeChartSection({ serverError }: { serverError?: string }) {
  const { value, set, error } = useExtra('sizeChart');
  const [templates, setTemplates] = useState(false);
  const displayId = useId();
  const preview = parseGoodsSizeChart(value.chart);
  return <DraftBody testId="size-chart">
    <p className="text-muted-foreground">상품의 측정 치수입니다. 사이즈명은 구매 옵션과 자동으로 연결되지 않습니다. 템플릿은 자주 쓰는 표를 복사하는 기능입니다.</p>
    <div className="flex min-w-0 flex-col gap-2"><Label htmlFor={displayId}>공개 표시</Label><NativeSelect className="w-full sm:w-40" id={displayId} value={value.enabled ? 'enabled' : 'disabled'} onChange={(event) => set((current) => ({ ...current, enabled: event.target.value === 'enabled' }))}><option value="disabled">설정안함</option><option value="enabled">설정함</option></NativeSelect></div>
    <GoodsSizeChartFields chart={value.chart} onChange={(chart) => set((current) => ({ ...current, chart }))} />
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2"><button className={buttonVariants({ variant: 'outline' })} data-slot="button" type="button" onClick={() => setTemplates(true)}>사이즈 템플릿 불러오기</button><Link className="text-sm underline underline-offset-4" href={GOODS_SIZE_TEMPLATES_PATH} target="_blank" rel="noreferrer">사이즈 템플릿 관리 ↗</Link></div>
    {preview ? <details className="min-w-0 rounded-lg border"><summary className="cursor-pointer rounded-lg px-3 py-2.5 text-sm font-medium outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50">저장 전 사이즈 안내 미리보기</summary><div className="flex min-w-0 flex-col gap-3 border-t p-3"><GoodSizeChart chart={preview} /></div></details> : null}
    <SectionError message={error ?? serverError} />
    {templates ? <GoodsSizeTemplatePicker onClose={() => setTemplates(false)} onSelect={(template) => { set((current) => ({ enabled: current.enabled, chart: structuredClone(template.chart) })); setTemplates(false); }} /> : null}
  </DraftBody>;
}

/** 목록 색상칩. */
export function GoodWorkspaceListingColorsSection({ serverError }: { serverError?: string }) {
  const { value, set, error } = useExtra('listingColors');
  return <DraftBody testId="listing-colors">
    <p className="text-muted-foreground">실제 상품에 제공하는 색만 등록하세요. 표시 여부는 스토어 전시 설정에서 정하며, 옵션·재고는 바뀌지 않습니다.</p>
    <div className="flex min-w-0 flex-col gap-3"><GoodsListingColorFields colors={value} onChange={set} /></div>
    <SectionError message={error ?? serverError} />
  </DraftBody>;
}

/** 복수구매 할인·착불·수량별 배송비. 초안은 결제에 적용되지 않는다. */
export function GoodWorkspaceTransactionTermsSection({ serverError }: { serverError?: string }) {
  const { value, set, error } = useExtra('transactionTerms');
  return <DraftBody testId="transaction-terms">
    <p className="text-muted-foreground">입력한 할인·확장 배송비를 상품과 함께 저장합니다. 초안은 결제에 적용되지 않습니다.</p>
    <section aria-label="복수구매 할인" className={GOOD_SUBPANEL_CLASS}><h3 className="text-base leading-snug font-medium">복수구매 할인</h3>
      <GoodsVolumeDiscountFields value={value.volume} onChange={(volume) => set((current) => ({ ...current, volume }))} /></section>
    <section aria-label="착불·수량별 배송비" className={GOOD_SUBPANEL_CLASS}><h3 className="text-base leading-snug font-medium">착불·수량별 배송비</h3>
      <GoodsDeliveryPricingFields value={value.delivery} onChange={(delivery) => set((current) => ({ ...current, delivery }))} /></section>
    <SectionError message={error ?? serverError} />
  </DraftBody>;
}

/** 배송비 묶음그룹. 기본 정보의 지금 출고지에 속한 그룹만 고를 수 있다. */
export function GoodWorkspaceShippingChargeGroupSection({ accountId, serverError }: { accountId: string; serverError?: string }) {
  const { value, set, error, workspace } = useExtra('shippingChargeGroup');
  const { identity, blocked } = useShippingChargeGroupSession(accountId);
  const originId = workspace?.originId || null;
  return <DraftBody testId="shipping-charge-group">
    <p className="text-muted-foreground">고른 묶음그룹을 상품과 함께 배정합니다. 묶음 기본료는 같은 주문의 대상 상품 수량·금액으로 계산합니다. 출고지를 먼저 고른 뒤 그 출고지의 그룹을 고르세요.</p>
    {identity ? <ShippingChargeGroupField identity={identity} originId={originId} value={value?.id ?? null}
      selectedGroup={(value?.display as ShippingChargeGroupSummaryValue | undefined) ?? null}
      onChange={(id, group) => set(id && group ? { id, revision: group.revision, originId: group.originId, display: group } : null)} />
      : <p className={blocked ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'} role={blocked ? 'alert' : 'status'}>{blocked ? '로그인 계정 또는 세션이 바뀌었습니다. 현재 계정으로 화면을 다시 열어주세요.' : '현재 로그인 상태를 확인하고 있습니다.'}</p>}
    {value && originId && value.originId !== originId ? <p className="text-sm text-[var(--wc-warning)]" role="status">고른 묶음그룹의 출고지가 지금 출고지와 다릅니다. 출고지를 맞추거나 묶음그룹을 다시 골라주세요.</p> : null}
    <SectionError message={error ?? serverError} />
  </DraftBody>;
}

/** 정기배송. */
export function GoodWorkspaceSubscriptionSection({ serverError }: { serverError?: string }) {
  const { value, set, error } = useExtra('subscriptionPolicy');
  return <DraftBody testId="subscription-policy">
    <p className="text-muted-foreground">상품별 정기배송 주기와 안내를 저장합니다. 카드 자동결제 연결과 서비스 공개 준비가 완료된 상품만 고객에게 신청 버튼이 표시됩니다.</p>
    <GoodsSubscriptionPolicyFields value={value} onChange={set} />
    <SectionError message={error ?? serverError} />
  </DraftBody>;
}

/** 수령 방식·설치비·디지털 파일. 파일은 이 계정·세션으로 전송·확인한 뒤 상품과 함께 연결한다. */
export function GoodWorkspaceFulfillmentSection({ accountId, serverError }: { accountId: string; serverError?: string }) {
  return <ClaimContactSession actorId={accountId} pendingMessage="로그인 상태를 확인하고 있습니다.">
    {(identity, scope) => <FulfillmentDraft identity={identity} scope={scope} serverError={serverError} />}
  </ClaimContactSession>;
}
function FulfillmentDraft({ identity, scope, serverError }: { identity: ClaimContactIdentity; scope: ClaimContactScope; serverError?: string }) {
  const { value, set, error } = useExtra('fulfillment');
  const fieldId = useId();
  const [pending, setPending] = useState(false), [message, setMessage] = useState(''), [pendingFile, setPendingFile] = useState<DigitalFile | null>(null);
  const busy = useRef(false);
  async function upload(file?: File) {
    if (busy.current || !file || value.files.length >= 10 || pendingFile) return;
    const candidate = parseDigitalFile({ id: crypto.randomUUID(), name: file.name, mimeType: file.type, size: file.size });
    if (!candidate) { setMessage('PDF·ZIP·PNG·JPG·MP3·MP4·TXT 파일을 50MB 이하로 선택해주세요.'); return; }
    const ticket = scope.capture(); if (!ticket) return;
    busy.current = true; setPending(true);
    let prepared = false;
    try {
      const grant = await prepareDigitalAssetAction(candidate, identity); if (!scope.canApply(ticket)) return;
      if (!grant.ok) { setMessage(grant.error); return; }
      prepared = true; setPendingFile(candidate);
      const sent = await createClient().storage.from(DIGITAL_BUCKET).upload(grant.path, file, { contentType: candidate.mimeType, upsert: false });
      if (!scope.canApply(ticket)) return;
      if (sent.error) { setMessage('전송 결과를 확인하지 못했습니다. 같은 파일의 업로드 결과를 확인해주세요.'); return; }
      await verify(candidate);
    } catch { if (scope.canApply(ticket)) setMessage(prepared ? '전송 결과를 확인하지 못했습니다. 같은 파일의 업로드 결과를 확인해주세요.' : '업로드 준비에 실패했습니다. 다시 선택해주세요.'); }
    finally { busy.current = false; setPending(false); }
  }
  async function verify(candidate = pendingFile) {
    if (!candidate) return;
    const result = await verifyDigitalAssetAction(candidate.id, identity);
    if (result.ok) { set((current) => ({ ...current, files: [...current.files.filter((file) => file.id !== result.file.id), result.file] })); setPendingFile(null); setMessage('파일을 확인했습니다. 상품을 저장하면 함께 연결됩니다.'); }
    else { setMessage(result.error); if (!result.uncertain) setPendingFile(null); }
  }
  return <DraftBody testId="fulfillment">
    <p className="text-muted-foreground">고객이 주문서에서 선택할 수령 방식과 선결제 비용입니다. 택배만 쓰면 바꿀 것이 없습니다. 바꾸면 설정 근거와 확인 체크가 필요합니다.</p>
    <fieldset className="m-0 flex min-w-0 flex-col gap-4 rounded-lg border p-4" disabled={pending || Boolean(pendingFile)}>
      <legend className="float-left w-full p-0 text-sm font-medium text-foreground">상품 제공 방식</legend>
      <GoodsFulfillmentDraftFields draft={value} onChange={(draft) => set(draft as GoodWorkspaceExtraDraft['fulfillment'])} onUpload={(file) => { void upload(file); }} fieldId={fieldId} />
    </fieldset>
    {pendingFile ? <p className="flex flex-wrap items-center gap-2 text-sm" role="status">{pendingFile.name}의 전송·검증 결과를 확인해주세요. <button type="button" className={buttonVariants({ variant: 'outline', size: 'sm' })} data-slot="button" disabled={pending} onClick={() => { void verify(); }}>같은 업로드 결과 확인</button></p> : null}
    {message ? <p className="text-sm font-medium" role="status">{message}</p> : null}
    <SectionError message={error ?? serverError} />
  </DraftBody>;
}

/** 주문 후 제작. */
export function GoodWorkspaceProductionSection({ serverError }: { serverError?: string }) {
  const { value, set, error } = useExtra('production');
  return <DraftBody testId="production">
    <p className="text-muted-foreground">주문 후 제작하는 상품의 발송 예정 기간입니다. 쓰지 않으면 바꿀 것이 없습니다. 바꾸면 설정 근거와 확인 체크가 필요합니다.</p>
    <fieldset className="m-0 flex min-w-0 flex-col gap-4 rounded-lg border p-4"><legend className="float-left w-full p-0 text-sm font-medium text-foreground">주문 후 제작</legend>
      <GoodsProductionFields draft={value} onChange={(draft) => set(draft)} idPrefix="workspace-production" />
    </fieldset>
    <SectionError message={error ?? serverError} />
  </DraftBody>;
}
