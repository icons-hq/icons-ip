'use client';

import { useCallback, useRef, useState, type FormEvent } from 'react';
import type { AdminCatalogActionState } from '@/app/admin/actions';
import { GOODS_DESCRIPTION_MAX_LENGTH, GOODS_GALLERY_MAX } from '@/lib/admin/catalog';
import type { AdminGoodRecord } from '@/lib/admin/catalog.server';
import type { AdminGoodsVariant } from '@/lib/admin/goods-variants';
import type { FulfillmentOrigin } from '@/lib/admin/fulfillment-origins';
import { goodEditorValues, GOOD_LOCAL_DRAFT_FIELDS, type GoodNoticeDefaults } from '@/lib/admin/good-editor';
import { initialGoodsOptionRows, restoreGoodsOptionRows, type GoodsOptionRow } from '@/lib/admin/goods-option-editor';
import { adminFormRemountKey, preservedFormValues } from '@/lib/admin/form-state';
import { withLocalRecoveryValues } from '@/lib/admin/local-autosave';
import { publicMediaUrl } from '@/lib/media';
import { AdminSectionCard, AdminStatusBadge } from '../console/AdminKit';
import { GoodsFulfillmentFields } from '../GoodsFulfillmentFields';
import { GoodsOptionEditor } from '../GoodsOptionEditor';
import { GoodNoticePicker } from '../GoodNoticePicker';
import { useAdminLocalAutosave } from '../useAdminLocalAutosave';
import { AdminLocalDraftNotice } from '../AdminLocalDraftNotice';
import { buildGoodPreview, goodFormValues } from '@/lib/admin/good-preview';
import type { Ip } from '@/lib/data';
import type { GoodDetailContent } from '@/lib/goods-detail';
import { GOOD_BADGES, GOOD_TYPES, goodDisplayBadges } from '@/lib/goods-taxonomy';
import { GOODS_NOTICE_FIELDS, missingGoodsNoticeKeys, type GoodsNoticeInfo } from '@/lib/goods-notice';
import {
  adminCatalogArchiveCounts,
  filterAdminCatalogRecords,
  formatAdminCatalogRecordLabel,
  type AdminCatalogArchiveFilter,
} from '../../../lib/admin/catalog-archive';
import { GoodDetailView } from '@/components/screens/GoodDetail';
import { ProductCard } from '@/components/wc/ProductCard';
import { VariantStockAdjustmentForm } from '../VariantStockAdjustmentForm';
import { ArtworkUploadField } from '../ArtworkUploadField';
import { CatalogArchiveControl, CatalogArchiveFilter } from '../CatalogArchiveControls';
import { GoodBankTransferControl } from '../GoodBankTransferControl';
import { GoodSaleRestrictionControl } from '../GoodSaleRestrictionControl';
import { GoodVariantsPanel } from '../GoodVariantsPanel';
import { GoodIdentifierFields } from '../GoodIdentifierFields';
import { GoodPublishControls } from '../GoodPublishControls';
import { canSellAdminGood } from '@/lib/admin/goods-publish';
import { ADMIN_STOCK_LABELS, ADMIN_VOCABULARY, adminGoodsCopy } from '@/lib/admin/vocabulary';
import { ActionNotice, ErrorText, Field, RecordList, SelectField, TextArea } from '../fields';


/*
 * 고시정보 입력 (#171). 항목·라벨·폼 이름은 lib/goods-notice.ts 하나에서 나온다.
 * 여기에 필드를 직접 늘리면 공개 상세페이지 표와 어긋난다.
 */
function GoodsNoticeFields({
  notice,
  state,
  required,
}: {
  notice: GoodsNoticeInfo | null;
  state: AdminCatalogActionState;
  required: boolean;
}) {
  return (
    <fieldset style={{ border: '1px solid var(--line)', borderRadius: 10, margin: 0, padding: 14 }}>
      <legend className="mono" style={{ color: 'var(--dim)', fontSize: 11, padding: '0 6px' }}>
        {ADMIN_VOCABULARY.noticeInfo} (전자상거래 필수 표기)
      </legend>
      <p className="muted" style={{ fontSize: 12, lineHeight: 1.6, margin: '0 0 12px' }}>
        공개하려면 전 항목을 채워주세요. 초안에는 일부만 저장할 수 있고, 공개한 내용은 상품 상세페이지에 표시됩니다.
      </p>
      <div className="admin-form-grid">
        {GOODS_NOTICE_FIELDS.map((field) => (
          <Field
            defaultValue={notice?.[field.key] ?? ''}
            error={state.errors?.[field.formName]}
            key={field.key}
            label={field.label}
            name={field.formName}
            placeholder={field.placeholder}
            required={required}
          />
        ))}
      </div>
    </fieldset>
  );
}

/*
 * 갤러리 (#172). 번호 붙은 슬롯 4칸이고 슬롯 순서가 곧 노출 순서다.
 * 드래그 정렬 대신 슬롯을 고르게 하면 운영자가 순서를 정하는 목적은 그대로
 * 달성하면서 업로드 칸은 이미 검증된 ArtworkUploadField 를 그대로 쓴다 —
 * 이미지 제약(JPEG/PNG/WebP · 5MB · 8192px)도 자동으로 같이 적용된다.
 */
function GoodsGalleryFields({
  galleryPaths,
  galleryUrls,
  onPreviewChange,
  state,
}: {
  galleryPaths: string[];
  galleryUrls: string[];
  onPreviewChange: (name: string, url: string | null) => void;
  state: AdminCatalogActionState;
}) {
  return (
    <fieldset style={{ border: '1px solid var(--line)', borderRadius: 10, margin: 0, padding: 14 }}>
      <legend className="mono" style={{ color: 'var(--dim)', fontSize: 11, padding: '0 6px' }}>
        갤러리 (최대 {GOODS_GALLERY_MAX}장)
      </legend>
      <p className="muted" style={{ fontSize: 12, lineHeight: 1.6, margin: '0 0 12px' }}>
        슬롯 번호 순서대로 상세페이지에 표시됩니다. 비워둔 슬롯은 건너뜁니다.
      </p>
      <div className="col" style={{ gap: 12 }}>
        {Array.from({ length: GOODS_GALLERY_MAX }, (_, slot) => (
          <div className="col" key={slot} style={{ gap: 6 }}>
            <ArtworkUploadField
              autoUpload
              allowRemove
              currentPath={galleryPaths[slot] ?? null}
              currentUrl={galleryUrls[slot] ?? null}
              fieldId={`good-gallery-${slot}`}
              kind="good"
              label={`갤러리 ${slot + 1}`}
              name={`galleryPath${slot}`}
              onPreviewChange={(url) => onPreviewChange(`galleryPath${slot}`, url)}
            />
            <ErrorText id={`galleryPath${slot}-error`}>{state.errors?.[`galleryPath${slot}`]}</ErrorText>
          </div>
        ))}
      </div>
    </fieldset>
  );
}

/*
 * 저장 전 입력값 미리보기 (#184).
 *
 * 공개 화면 컴포넌트를 그대로 쓴다 — 따로 그리면 "실제 상세페이지와 동일하게"라는
 * 조건이 첫 수정에서 깨진다. `embedded` 가 구매 패널·위시 하트를 비활성으로 그려
 * 미리보기가 장바구니나 카탈로그를 건드리지 않게 한다.
 */
function GoodPreviewPanel({ detail, ip }: { detail: GoodDetailContent; ip: Ip | null }) {
  const good = detail.good;
  /* 아직 저장하지 않은 신규 굿즈는 갈 곳이 없다 — 없는 상세로 보내는 대신 목록으로 둔다. */
  const href = good.id ? `/shop/${good.id}` : '/shop';

  return (
    /* details 에 display 를 덮어쓰면 접힘이 깨지는 브라우저가 있어 기본 display 를 유지한다. */
    <details className="card" style={{ borderRadius: 10, padding: 18 }}>
      <summary style={{ cursor: 'pointer', fontWeight: 700 }}>공개 화면 미리보기</summary>
      <div className="col" style={{ gap: 14, marginTop: 14 }}>
        <p className="muted" style={{ fontSize: 12, lineHeight: 1.6, margin: 0 }}>
          지금 폼에 입력된 값으로 그린 화면입니다. 저장하기 전 모습이며, 미리보기는 카탈로그를 바꾸지 않습니다.
        </p>
        <div className="col" style={{ gap: 8 }}>
          <span className="mono" style={{ color: 'var(--dim)', fontSize: 11 }}>굿즈샵 목록 카드</span>
          {/* wc 토큰은 .wc-root 스코프 안에서만 산다 — 어드민 표면에서도 같은 래퍼가 필요하다. */}
          <div className="wc-root" style={{ maxWidth: 280 }}>
            <ProductCard
              badges={goodDisplayBadges(good)}
              brand={ip?.title ?? null}
              compareAtPrice={good.compareAtPrice}
              href={href}
              imageBackground={good.img}
              name={good.name}
              price={good.price}
              priceMax={good.priceMax}
              soldOut={good.stock === 'soldout' || good.stockQty <= 0}
            />
          </div>
        </div>
        <div className="col" style={{ gap: 8 }}>
          <span className="mono" style={{ color: 'var(--dim)', fontSize: 11 }}>{ADMIN_VOCABULARY.goods} 상세페이지</span>
          <div className="wc-root">
            <GoodDetailView detail={detail} embedded />
          </div>
        </div>
      </div>
    </details>
  );
}

function GoodEditor({ action, catalogIps, ipOptions, pending, selected, state, initialIpId, variants, origins, noticeDefaults, formRef, onSubmitCapture }: {
  action: (payload: FormData) => void; catalogIps: Ip[];
  ipOptions: { id: string; title: string; archivedAt: string | null }[];
  pending: boolean; selected: AdminGoodRecord | null; state: AdminCatalogActionState;
  initialIpId?: string; variants: AdminGoodsVariant[]; origins: FulfillmentOrigin[]; noticeDefaults?: GoodNoticeDefaults;
  formRef: (form: HTMLFormElement | null) => void | (() => void); onSubmitCapture: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const initial = goodEditorValues(selected, state, initialIpId, noticeDefaults);
  const editorRef = useRef<HTMLFormElement | null>(null);
  const rows = restoreGoodsOptionRows(initial.variants) ?? initialGoodsOptionRows(variants, Number(initial.price));
  const [values, setValues] = useState<Record<string, string>>(() => ({ ...initial, variants: JSON.stringify(rows) }));
  const [suggestedCode, setSuggestedCode] = useState(selected?.code ?? '');
  const syncOptions = useCallback((options: GoodsOptionRow[]) => setValues((current) => ({ ...current, variants: JSON.stringify(options) })), []);
  const imageUrl = (name: string, savedPath?: string | null, savedUrl?: string | null) => initial[name] === (savedPath ?? '') ? savedUrl ?? null : publicMediaUrl(initial[name]);
  const [imageUrls, setImageUrls] = useState<Record<string, string | null>>(() => ({
    imagePath: imageUrl('imagePath', selected?.imagePath, selected?.imageUrl),
    detailImagePath: imageUrl('detailImagePath', selected?.detailImagePath, selected?.detailImageUrl),
    ...Object.fromEntries(Array.from({ length: GOODS_GALLERY_MAX }, (_, i) => [`galleryPath${i}`, imageUrl(`galleryPath${i}`, selected?.galleryPaths[i], selected?.galleryUrls[i])])),
  }));
  let baseline = variants.filter((v) => !v.archivedAt).map((v) => v.id);
  try { if (initial.variantBaseline) baseline = JSON.parse(initial.variantBaseline); } catch { /* server validation reports malformed input */ }
  function syncValues(event: FormEvent<HTMLFormElement>) { setValues(goodFormValues(new FormData(event.currentTarget))); }
  function setImageUrl(name: string, url: string | null) { setImageUrls((current) => ({ ...current, [name]: url })); }
  function applyNotice(notice: GoodsNoticeInfo) {
    const form = editorRef.current;
    if (!form) return;
    for (const field of GOODS_NOTICE_FIELDS) {
      const input = form.elements.namedItem(field.formName);
      if (input instanceof HTMLInputElement) { input.value = notice[field.key] ?? ''; input.dispatchEvent(new Event('input', { bubbles: true })); }
    }
    setValues(goodFormValues(new FormData(form)));
  }
  const previewIp = catalogIps.find((ip) => ip.id === values.ipId) ?? null;
  const preview = buildGoodPreview({ fallbackBg: selected?.bg ?? null, imageUrls, ip: previewIp, stockQty: selected?.stockQty ?? 0, values });
  const compare = Number(values.compareAtPrice);
  const previewDetail: GoodDetailContent = { ...preview, good: { ...preview.good, compareAtPrice: Number.isInteger(compare) && compare > preview.good.price ? compare : null } };
  const notice = Object.fromEntries(GOODS_NOTICE_FIELDS.map((field) => [field.key, initial[field.formName]])) as GoodsNoticeInfo;
  return <>
    <form action={action} className="wc-admin-kit col" onChange={syncValues} onSubmitCapture={onSubmitCapture} ref={(form) => { editorRef.current = form; return formRef(form); }} style={{ gap: 20 }}>
      <input name="previousId" type="hidden" value={selected?.id ?? ''} />
      <input name="previousIpId" type="hidden" value={selected?.ipId ?? ''} />
      <input name="published" type="hidden" value={String(Boolean(selected?.publishedAt))} />
      <input name="bg" type="hidden" value={selected?.bg ?? ''} />
      <AdminSectionCard title="기본 정보">
        <p role="status"><AdminStatusBadge>{selected?.archivedAt ? '보관' : selected?.publishedAt ? '공개' : '초안'}</AdminStatusBadge> · {selected && canSellAdminGood({ ...selected, noticeComplete: missingGoodsNoticeKeys(selected.notice).length === 0 }) ? '판매 가능' : '판매 준비 중'}</p>
        <div className="admin-form-grid">
          <SelectField defaultValue={initial.ipId} error={state.errors?.ipId} label="연결 IP" name="ipId"><option value="">선택</option>{ipOptions.map((ip) => <option disabled={Boolean(ip.archivedAt && ip.id !== selected?.ipId)} key={ip.id} value={ip.id}>{ip.archivedAt ? `[보관] ${ip.title}` : ip.title}</option>)}</SelectField>
          <Field defaultValue={initial.name} error={state.errors?.name} label={`${ADMIN_VOCABULARY.goods} 이름`} name="name" />
          <SelectField defaultValue={initial.type} error={state.errors?.type} label="유형" name="type"><option value="">선택</option>{GOOD_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</SelectField>
          <Field defaultValue={initial.price} error={state.errors?.price} label="기본 가격" name="price" min={0} type="number" />
          <Field defaultValue={initial.compareAtPrice} error={state.errors?.compareAtPrice} label="정가 (할인 표기용, 비우면 할인 없음)" name="compareAtPrice" type="number" />
          <SelectField defaultValue={initial.badge} error={state.errors?.badge} label="배지" name="badge"><option value="">없음</option>{GOOD_BADGES.map((badge) => <option key={badge} value={badge}>{badge}</option>)}</SelectField>
          <SelectField defaultValue={initial.stock} error={state.errors?.stock} label="운영 상태" name="stock">{Object.entries(ADMIN_STOCK_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectField>
        </div>
        <GoodIdentifierFields code={initial.code} defaultVariantCode={initial.defaultVariantCode ?? variants.find((v) => v.isDefault)?.code} hideVariantCode onCodeSuggestion={setSuggestedCode} errors={state.errors ?? {}} ipId={values.ipId} name={values.name} slug={initial.id} slugLocked={Boolean(selected?.firstPublishedAt)} />
      </AdminSectionCard>
      <AdminSectionCard title="이미지와 상세 설명">
        <ArtworkUploadField autoUpload currentPath={initial.imagePath || null} currentUrl={imageUrls.imagePath} fieldId="good-main" helpText="파일을 선택하면 바로 업로드됩니다. 상품 저장 후 공개 화면에 적용됩니다." kind="good" label="대표 이미지" onPreviewChange={(url) => setImageUrl('imagePath', url)} />
        <ErrorText>{state.errors?.imagePath}</ErrorText>
        <TextArea defaultValue={initial.description} error={state.errors?.description} label="상세 설명 (최대 2,000자)" maxLength={GOODS_DESCRIPTION_MAX_LENGTH} name="description" placeholder={adminGoodsCopy('굿즈 구성과 특징을 짧게 설명해주세요.')} />
        <GoodsGalleryFields galleryPaths={Array.from({ length: GOODS_GALLERY_MAX }, (_, i) => initial[`galleryPath${i}`])} galleryUrls={Array.from({ length: GOODS_GALLERY_MAX }, (_, i) => imageUrls[`galleryPath${i}`] ?? '')} onPreviewChange={setImageUrl} state={state} />
        <ArtworkUploadField autoUpload allowRemove currentPath={initial.detailImagePath || null} currentUrl={imageUrls.detailImagePath} fieldId="good-detail" helpText="상세페이지 아래에 원래 비율로 길게 표시되는 이미지 1장입니다." kind="good" label="상세 이미지" name="detailImagePath" onPreviewChange={(url) => setImageUrl('detailImagePath', url)} />
        <ErrorText>{state.errors?.detailImagePath}</ErrorText>
      </AdminSectionCard>
      <AdminSectionCard title="옵션과 재고"><GoodsOptionEditor onRowsChange={syncOptions} codePrefix={values.code || suggestedCode} initialRows={rows} baseline={baseline} basePrice={Number(values.price) || 0} error={state.errors?.variants} axisValues={initial} /></AdminSectionCard>
      <AdminSectionCard title="배송 정보"><GoodsFulfillmentFields origins={origins} value={{ originId: initial.originId || null, shippingFeeType: initial.shippingFeeType as 'policy' | 'free' | 'individual', individualFee: Number(initial.individualFee) }} errors={state.errors} /></AdminSectionCard>
      <AdminSectionCard title={ADMIN_VOCABULARY.noticeInfo}>
        <GoodNoticePicker onApply={applyNotice} /><GoodsNoticeFields notice={notice} required={Boolean(selected?.publishedAt)} state={state} />
      </AdminSectionCard>
      <ActionNotice state={state} />
      <div className="row"><button className="btn btn-holo" disabled={pending} name="intent" value="save">{pending ? '저장 중…' : selected?.publishedAt ? '저장' : '초안으로 저장'}</button>{!selected?.publishedAt && !selected?.archivedAt && <button className="btn btn-ghost" disabled={pending} name="intent" value="publish">저장 후 공개</button>}</div>
      {!selected?.publishedAt && <p className="muted">저장은 초안으로 남습니다. 상품명과 IP만 있어도 이어서 작성할 수 있습니다.</p>}
    </form>
    <GoodPreviewPanel detail={previewDetail} ip={previewIp} />
  </>;
}

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
  accountId='', origins=[], noticeDefaults,
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
}) {
  const [archiveFilter, setArchiveFilter] = useState<AdminCatalogArchiveFilter>(
    selected?.archivedAt ? 'archived' : 'active',
  );
  const local = useAdminLocalAutosave({ scope: { accountId, formId: 'good', recordId: selected?.id ?? null }, fields: GOOD_LOCAL_DRAFT_FIELDS, serverState: state });
  const inputState = withLocalRecoveryValues(state, selected?.id ?? null, local.snapshot.restoredValues);
  const [query,setQuery]=useState(initialQuery);
  const normalizedQuery=query.trim().toLocaleLowerCase();
  const visibleRecords = filterAdminCatalogRecords(records, archiveFilter).filter((good)=>!normalizedQuery
    || `${good.name} ${good.code}`.toLocaleLowerCase().includes(normalizedQuery)
    || variants.some((variant)=>variant.goodId===good.id && variant.code.toLocaleLowerCase().includes(normalizedQuery)));

  return (
    <div className={hideRecordList?'col':'admin-master-detail'}>
      {!hideRecordList && <div className="col" style={{ gap: 12, minWidth: 0 }}>
        <label className="col" style={{gap:7}}>
          <span>{ADMIN_VOCABULARY.goods}명·{ADMIN_VOCABULARY.goodsCode} 검색</span>
          <input className="admin-field-control" onChange={(event)=>setQuery(event.target.value)} placeholder={`${ADMIN_VOCABULARY.goods}명 또는 ${ADMIN_VOCABULARY.goodsCode}`} type="search" value={query}/>
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
        <AdminLocalDraftNotice onDiscard={local.discard} onRestore={local.restore} pending={pending} recovery={Boolean(local.snapshot.recovery) && !preservedFormValues(state, selected?.id)} unavailable={local.snapshot.unavailable} />
        <GoodEditor
          origins={origins} noticeDefaults={noticeDefaults} formRef={local.formRef} onSubmitCapture={local.onSubmitCapture}
          variants={variants.filter((variant) => variant.goodId === selected?.id)}
          action={action}
          catalogIps={catalogIps}
          ipOptions={ipOptions}
          key={`${local.scopeKey}:${adminFormRemountKey(state, selected ? { ...selected, stockQty: undefined, firstPublishedAt: undefined } : null)}:${local.snapshot.revision}`}
          pending={pending}
          selected={selected}
          state={inputState}
          initialIpId={initialIpId}
        />
        {selected && !selected.archivedAt && (
          <VariantStockAdjustmentForm adjustmentId={adjustmentId} good={selected} variants={variants} key={`stock-${selected.id}`} />
        )}
        {selected && <GoodPublishControls id={selected.id} publishedAt={selected.publishedAt} archivedAt={selected.archivedAt} key={`publish-${selected.id}-${selected.publishedAt}-${selected.archivedAt}`}/>}
        {selected && <GoodVariantsPanel goodId={selected.id} variants={variants} />}
        {selected && !selected.archivedAt && (
          <GoodBankTransferControl
            allowBankTransfer={selected.allowBankTransfer}
            id={selected.id}
            key={`bank-${selected.id}:${selected.allowBankTransfer}`}
          />
        )}
        {selected && !selected.archivedAt && (
          <GoodSaleRestrictionControl
            id={selected.id}
            key={`sale-restriction-${selected.id}:${selected.saleRestriction}`}
            saleRestriction={selected.saleRestriction}
          />
        )}
        {selected && (
          <CatalogArchiveControl
            archivedAt={selected.archivedAt}
            id={selected.id}
            key={`${selected.id}:${selected.archivedAt ?? 'active'}`}
            kind="good"
          />
        )}
      </div>
    </div>
  );
}
