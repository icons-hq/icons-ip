'use client';

import Link from 'next/link';
import { useCallback, useId, useRef, useState, type ReactNode } from 'react';
import { prepareDigitalAssetAction, verifyDigitalAssetAction } from '@/app/admin/goods-fulfillment-actions';
import { ClaimContactSession, type ClaimContactIdentity, type ClaimContactScope } from '@/components/claim-contact/ClaimContactSession';
import { createClient } from '@/lib/supabase/client';
import { DIGITAL_BUCKET, parseDigitalFile, type DigitalFile } from '@/lib/goods-fulfillment';
import { GOODS_AFTER_SALES_TEMPLATES_PATH } from '@/lib/goods-after-sales';
import { GOODS_SIZE_TEMPLATES_PATH, parseGoodsSizeChart } from '@/lib/goods-size-chart';
import { PURCHASE_TAX_BASIS_LABELS, type PurchaseTaxBasis } from '@/lib/admin/goods-purchase-costs';
import { goodsOptionRowKey } from '@/lib/admin/goods-option-editor';
import {
  goodWorkspaceExtraDefault, goodWorkspaceExtraErrorField, type GoodWorkspaceExtraDraft,
  type GoodWorkspaceExtraKey, type GoodWorkspacePricePeriodDraft,
} from '@/lib/admin/good-workspace-extra-sections';
import { GOOD_PICKERS_B_HELP } from '@/lib/admin/help/good-pickers-b';
import { GoodSizeChart } from '@/components/shop/GoodSizeChart';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { Label } from '@/components/admin/kit/ui/label';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { useGoodWorkspaceSections } from './GoodWorkspace';
import { AdminLabelWithHelp } from './console/AdminHelpTip';
import { GOOD_INPUT_CLASS, GOOD_NUMBER_INPUT_CLASS, GOOD_SUBPANEL_CLASS, GoodChoiceCard, GoodChoiceCards } from './GoodEditorParts';
import { GOODS_ADDITIONAL_INTRO, GoodsAdditionalLinks } from './GoodsAdditionalLinks';
import { GoodsBenefitFields, withGiftImage } from './GoodsBenefitsPanel';
import { GoodsAfterSalesFields } from './GoodsAfterSalesFields';
import { GoodsSizeChartFields } from './GoodsSizeChartFields';
import { GoodsListingColorFields } from './GoodsListingColorsPanel';
import { GoodsDeliveryRuleFields, GoodsVolumeDiscountFields } from './GoodsTransactionTermsPanel';
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

/** 판매 방식(옵션 선택 / 랜덤 판매). 랜덤 조건은 저장할 때 DB가 판정한다(기존 전환 RPC). 고르기 전에 차이를 알아야 해서 카드로 보인다. */
export function GoodWorkspaceSaleModeSection({ serverError }: { serverError?: string }) {
  const { value, set, error } = useExtra('optionSaleMode');
  const name = useId();
  return <DraftBody testId="option-sale-mode">
    <GoodChoiceCards legend={<span className="sr-only">판매 방식</span>}>
      <GoodChoiceCard checked={value === 'select'} description="고객이 옵션을 직접 고릅니다." name={name} onChange={() => set('select')} title="옵션 선택 판매" />
      <GoodChoiceCard checked={value === 'random'} description="고객은 옵션을 고르지 않고, 주문할 때 남은 재고에 비례해 옵션이 무작위로 정해집니다." name={name} onChange={() => set('random')} title="랜덤 판매" />
    </GoodChoiceCards>
    {value === 'random' ? <p className="text-muted-foreground">주문 상세와 출고 파일에는 정해진 옵션이 보이고, 고객 화면에는 ‘랜덤’으로만 보입니다. 판매 중인 옵션이 2개 이상이고 판매가가 모두 같아야 하며, 정기배송과는 함께 쓸 수 없습니다.</p> : null}
    <SectionError message={error ?? serverError} />
  </DraftBody>;
}

/** 공급가(매입단가) · 관리자 전용. 옵션목록의 지금 옵션마다 금액과 세금 처리를 함께 넣는다(둘 다 비우면 정하지 않음). */
export function GoodWorkspacePurchaseCostsSection({ serverError }: { serverError?: string }) {
  const { value, set, error, workspace } = useExtra('purchaseCosts');
  const rows = workspace?.optionRows ?? [];
  const entryFor = (optionKey: string) => value.find((entry) => entry.optionKey === optionKey) ?? { optionKey, unitCostKrw: '', taxBasis: '' as const };
  const update = (optionKey: string, patch: { unitCostKrw?: string; taxBasis?: '' | PurchaseTaxBasis }) => set((current) => {
    const others = current.filter((entry) => entry.optionKey !== optionKey);
    return [...others, { ...entryFor(optionKey), ...patch }];
  });
  return <DraftBody testId="costs">
    <p className="text-muted-foreground">옵션 1개를 공급처에서 사 오는 가격입니다. 금액과 세금 처리는 함께 넣거나 함께 비웁니다. 0원도 넣을 수 있습니다.</p>
    {rows.map((row, index) => {
      const key = goodsOptionRowKey(row), entry = entryFor(key), label = row.name.trim() || `옵션 ${index + 1}`;
      return <div key={key} className="grid min-w-0 gap-3 border-t pt-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] sm:items-end">
        <strong className="min-w-0 font-medium wrap-anywhere">{label}{row.isActive === false ? ' · 사용 중지' : ''}</strong>
        <label className={FIELD_LABEL_CLASS}>공급가(매입단가) (원)<input className={GOOD_NUMBER_INPUT_CLASS} data-slot="input" type="number" min={0} max={2147483647} step={1}
          aria-label={`${label} 공급가(매입단가)`} value={entry.unitCostKrw} placeholder="비우면 정하지 않음" onChange={(event) => update(key, { unitCostKrw: event.target.value })} /></label>
        <div className={FIELD_LABEL_CLASS}>
          {/* 옵션마다 "?"를 달면 어수선하다 — 첫 줄에만 단다. */}
          <AdminLabelWithHelp help={index === 0 ? GOOD_PICKERS_B_HELP.purchaseTaxBasis : undefined} label="세금 처리"><label htmlFor={`cost-basis-${index}`}>세금 처리</label></AdminLabelWithHelp>
          <NativeSelect className="w-full" id={`cost-basis-${index}`} aria-label={`${label} 공급가(매입단가) 세금 처리`} value={entry.taxBasis}
            onChange={(event) => update(key, { taxBasis: event.target.value as '' | PurchaseTaxBasis })}>
            <option value="">선택 안 함</option>
            {Object.entries(PURCHASE_TAX_BASIS_LABELS).map(([basis, text]) => <option key={basis} value={basis}>{text}</option>)}
          </NativeSelect></div>
      </div>;
    })}
    <SectionError message={error ?? serverError} />
  </DraftBody>;
}

let periodSequence = 0;
/** 기간 할인. 옵션목록의 지금 옵션을 대상으로 넣고, 상품을 저장하면 바로 적용된다(2026-11-19 — 초안 선택 없음). */
export function GoodWorkspacePricePeriodsSection({ serverError }: { serverError?: string }) {
  const { value, set, error, workspace } = useExtra('pricePeriods');
  const rows = workspace?.optionRows ?? [];
  const options = rows.map((row, index) => ({ key: goodsOptionRowKey(row), label: `${row.name.trim() || `옵션 ${index + 1}`}${row.isActive === false ? ' (사용 중지)' : ''}` }));
  const update = (key: string, patch: Partial<GoodWorkspacePricePeriodDraft>) => set((current) => current.map((entry) => entry.key === key ? { ...entry, ...patch } : entry));
  return <DraftBody testId="prices">
    <p className="text-muted-foreground">정한 기간에만 옵션을 기간 할인가로 팝니다. 같은 옵션의 기간은 겹칠 수 없습니다.</p>
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
      <div><button type="button" className={buttonVariants({ variant: 'outline', size: 'sm' })} data-slot="button" onClick={() => set((current) => current.filter((item) => item.key !== entry.key))}>이 기간 할인 빼기</button></div>
    </fieldset>)}
    <div><button type="button" className={buttonVariants({ variant: 'outline' })} data-slot="button" disabled={!options.length || value.length >= 100}
      onClick={() => { periodSequence += 1; set((current) => [...current, { key: `period-${periodSequence}`, optionKey: options[0]?.key ?? '', state: 'active', discountPrice: '', startsAt: '', endsAt: '' }]); }}>기간 할인 추가</button></div>
    <SectionError message={error ?? serverError} />
  </DraftBody>;
}

/** 추가 구성 상품. 판매 중인 다른 상품을 공용 상품 선택창에서 골라 연결 순서대로 담는다(저장된 상품의 독립 패널과 같은 목록 부품). */
export function GoodWorkspaceAdditionalSection({ serverError }: { serverError?: string }) {
  const { value, set, error } = useExtra('additional');
  return <DraftBody testId="additional">
    <p className="text-muted-foreground">{GOODS_ADDITIONAL_INTRO}</p>
    <GoodsAdditionalLinks baseGoodId={null} items={value} onChange={set} />
    <SectionError message={error ?? serverError} />
  </DraftBody>;
}

/** 사은품·이벤트 안내. */
export function GoodWorkspaceBenefitsSection({ serverError }: { serverError?: string }) {
  const { value, set, error } = useExtra('benefits');
  const [picker, setPicker] = useState<number | null>(null), [templates, setTemplates] = useState(false);
  return <DraftBody testId="benefits">
    <p className="text-muted-foreground">상품 상세에 보이는 안내입니다. 사은품 재고와 출고는 따로 챙겨야 합니다.</p>
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
    <GoodsAfterSalesFields values={value} onChange={set} />
    {prefilled ? <small className="text-xs text-muted-foreground" data-good-workspace-after-sales-prefill="">전화번호는 스토어 기본 A/S 연락처로 채웠습니다. A/S 안내를 쓰면 함께 저장됩니다.</small> : null}
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2"><button className={buttonVariants({ variant: 'outline' })} data-slot="button" type="button" onClick={() => setTemplates(true)}>A/S 템플릿</button><Link className="text-sm underline underline-offset-4" href={GOODS_AFTER_SALES_TEMPLATES_PATH} target="_blank" rel="noreferrer">A/S 템플릿 관리 ↗</Link></div>
    <SectionError message={error ?? serverError} />
    {templates ? <GoodsAfterSalesTemplatePicker onClose={() => setTemplates(false)} onSelect={(template) => { set({ phone: template.phone, guide: template.guide, sellerSpecialNotes: template.sellerSpecialNotes }); setTemplates(false); }} /> : null}
  </DraftBody>;
}

/** 사이즈 안내. 고객 화면 표시와 측정 치수(저장된 상품의 패널과 같은 이름을 쓴다). */
export function GoodWorkspaceSizeChartSection({ serverError }: { serverError?: string }) {
  const { value, set, error } = useExtra('sizeChart');
  const [templates, setTemplates] = useState(false);
  const displayId = useId();
  const preview = parseGoodsSizeChart(value.chart);
  return <DraftBody testId="size-chart">
    <p className="text-muted-foreground">상품의 치수를 표로 보여 줍니다. 표의 사이즈 이름은 구매 옵션과 따로 적습니다.</p>
    <div className="flex min-w-0 flex-col gap-2"><Label htmlFor={displayId}>고객 화면 표시</Label><NativeSelect className="w-full sm:w-72" id={displayId} value={value.enabled ? 'enabled' : 'disabled'} onChange={(event) => set((current) => ({ ...current, enabled: event.target.value === 'enabled' }))}><option value="disabled">표시 안 함 · 표는 그대로 보관</option><option value="enabled">표시</option></NativeSelect></div>
    <GoodsSizeChartFields chart={value.chart} onChange={(chart) => set((current) => ({ ...current, chart }))} />
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2"><button className={buttonVariants({ variant: 'outline' })} data-slot="button" type="button" onClick={() => setTemplates(true)}>사이즈 템플릿에서 가져오기</button><Link className="text-sm underline underline-offset-4" href={GOODS_SIZE_TEMPLATES_PATH} target="_blank" rel="noreferrer">사이즈 템플릿 관리 ↗</Link></div>
    {preview ? <details className="min-w-0 rounded-lg border"><summary className="cursor-pointer rounded-lg px-3 py-2.5 text-sm font-medium outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50">저장 전 사이즈 안내 미리보기</summary><div className="flex min-w-0 flex-col gap-3 border-t p-3">{!value.enabled ? <p className="text-muted-foreground">고객 화면 표시를 ‘표시 안 함’으로 두었습니다. 저장해도 보이지 않습니다.</p> : null}<GoodSizeChart chart={preview} /></div></details> : null}
    <SectionError message={error ?? serverError} />
    {templates ? <GoodsSizeTemplatePicker onClose={() => setTemplates(false)} onSelect={(template) => { set((current) => ({ enabled: current.enabled, chart: structuredClone(template.chart) })); setTemplates(false); }} /> : null}
  </DraftBody>;
}

/** 목록 색상칩. */
export function GoodWorkspaceListingColorsSection({ serverError }: { serverError?: string }) {
  const { value, set, error } = useExtra('listingColors');
  return <DraftBody testId="listing-colors">
    <div className="flex min-w-0 flex-col gap-3"><GoodsListingColorFields colors={value} onChange={set} /></div>
    <SectionError message={error ?? serverError} />
  </DraftBody>;
}

/** 복수구매 할인·착불·수량별 배송비. '사용'으로 둔 항목만 결제에 적용된다(2026-11-19 — 초안 선택 없음). */
export function GoodWorkspaceTransactionTermsSection({ serverError }: { serverError?: string }) {
  const { value, set, error } = useExtra('transactionTerms');
  return <DraftBody testId="transaction-terms">
    <section aria-label="복수구매 할인" className={GOOD_SUBPANEL_CLASS}><h3 className="text-base leading-snug font-medium">복수구매 할인</h3>
      <GoodsVolumeDiscountFields value={value.volume} onChange={(volume) => set((current) => ({ ...current, volume }))} /></section>
    <section aria-label="착불·수량별 배송비" className={GOOD_SUBPANEL_CLASS}><h3 className="text-base leading-snug font-medium">착불·수량별 배송비</h3>
      <GoodsDeliveryRuleFields value={value.delivery} onChange={(delivery) => set((current) => ({ ...current, delivery }))} /></section>
    <SectionError message={error ?? serverError} />
  </DraftBody>;
}

/** 배송비 묶음그룹. 기본 정보의 지금 출고지에 속한 그룹만 고를 수 있다(공용 선택창). 고른 그룹의 뜻은 필드의 요약 상자가 예시 금액과 함께 보이고, "?"는 섹션 제목(GoodSection)에 있다. */
export function GoodWorkspaceShippingChargeGroupSection({ accountId, serverError }: { accountId: string; serverError?: string }) {
  const { value, set, error, workspace } = useExtra('shippingChargeGroup');
  const { identity, blocked } = useShippingChargeGroupSession(accountId);
  const originId = workspace?.originId || null;
  return <DraftBody testId="shipping-charge-group">
    {identity ? <ShippingChargeGroupField identity={identity} originId={originId} value={value?.id ?? null}
      selectedGroup={(value?.display as ShippingChargeGroupSummaryValue | undefined) ?? null}
      onChange={(id, group) => set(id && group ? { id, revision: group.revision, originId: group.originId, display: group } : null)} />
      : <p className={blocked ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'} role={blocked ? 'alert' : 'status'}>{blocked ? '로그인한 계정이 바뀌었거나 다시 로그인했습니다. 지금 계정으로 화면을 새로고침해주세요.' : '현재 로그인 상태를 확인하고 있습니다.'}</p>}
    <SectionError message={error ?? serverError} />
  </DraftBody>;
}

/** 정기배송. */
export function GoodWorkspaceSubscriptionSection({ serverError }: { serverError?: string }) {
  const { value, set, error } = useExtra('subscriptionPolicy');
  return <DraftBody testId="subscription-policy">
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
      if (sent.error) { setMessage('파일이 올라갔는지 확인하지 못했습니다. 아래 같은 업로드 결과 확인을 눌러주세요.'); return; }
      await verify(candidate);
    } catch { if (scope.canApply(ticket)) setMessage(prepared ? '파일이 올라갔는지 확인하지 못했습니다. 아래 같은 업로드 결과 확인을 눌러주세요.' : '업로드 준비에 실패했습니다. 다시 선택해주세요.'); }
    finally { busy.current = false; setPending(false); }
  }
  async function verify(candidate = pendingFile) {
    if (!candidate) return;
    const result = await verifyDigitalAssetAction(candidate.id, identity);
    if (result.ok) { set((current) => ({ ...current, files: [...current.files.filter((file) => file.id !== result.file.id), result.file] })); setPendingFile(null); setMessage('파일을 확인했습니다. 상품을 저장하면 함께 연결됩니다.'); }
    else { setMessage(result.error); if (!result.uncertain) setPendingFile(null); }
  }
  return <DraftBody testId="fulfillment">
    <p className="text-muted-foreground">택배만 쓰면 바꿀 것이 없습니다. 다른 수령 방식을 쓰려면 아래 ‘설정 근거’와 확인 체크도 채워야 합니다.</p>
    <fieldset className="m-0 flex min-w-0 flex-col gap-4 rounded-lg border p-4" disabled={pending || Boolean(pendingFile)}>
      <legend className="sr-only">상품 제공 방식</legend>
      <GoodsFulfillmentDraftFields draft={value} onChange={(draft) => set(draft as GoodWorkspaceExtraDraft['fulfillment'])} onUpload={(file) => { void upload(file); }} fieldId={fieldId} />
    </fieldset>
    {pendingFile ? <p className="flex flex-wrap items-center gap-2 text-sm" role="status">{pendingFile.name}이(가) 올라갔는지 아직 확인하지 못했습니다. <button type="button" className={buttonVariants({ variant: 'outline', size: 'sm' })} data-slot="button" disabled={pending} onClick={() => { void verify(); }}>같은 업로드 결과 확인</button></p> : null}
    {message ? <p className="text-sm font-medium" role="status">{message}</p> : null}
    <SectionError message={error ?? serverError} />
  </DraftBody>;
}

/** 주문 후 제작. */
export function GoodWorkspaceProductionSection({ serverError }: { serverError?: string }) {
  const { value, set, error } = useExtra('production');
  return <DraftBody testId="production">
    <p className="text-muted-foreground">쓰지 않으면 바꿀 것이 없습니다. 쓰려면 아래 ‘설정 근거’와 확인 체크도 채워야 합니다.</p>
    <fieldset className="m-0 flex min-w-0 flex-col gap-4 rounded-lg border p-4"><legend className="sr-only">주문 후 제작</legend>
      <GoodsProductionFields draft={value} onChange={(draft) => set(draft)} idPrefix="workspace-production" />
    </fieldset>
    <SectionError message={error ?? serverError} />
  </DraftBody>;
}
