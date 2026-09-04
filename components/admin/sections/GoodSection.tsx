'use client';

import Link from 'next/link';
import { useActionState, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  adjustAdminStockAction,
  type AdminCatalogActionState,
} from '@/app/admin/actions';
import { GOODS_DESCRIPTION_MAX_LENGTH, GOODS_GALLERY_MAX, type AdminFieldErrors } from '@/lib/admin/catalog';
import type { AdminGoodRecord } from '@/lib/admin/catalog.server';
import { buildGoodPreview, goodFormValues } from '@/lib/admin/good-preview';
import {
  GOODS_DRAFT_STORAGE_KEY,
  formatGoodsDraftSavedAt,
  goodsDraftValues,
  isGoodsDraftBlank,
  parseGoodsDraft,
  serializeGoodsDraft,
} from '@/lib/admin/goods-draft';
import type { Ip } from '@/lib/data';
import type { GoodDetailContent } from '@/lib/goods-detail';
import { GOOD_BADGES, GOOD_TYPES, goodDisplayBadges } from '@/lib/goods-taxonomy';
import { GOODS_NOTICE_FIELDS, type GoodsNoticeInfo } from '@/lib/goods-notice';
import { formatAdminCatalogRecordLabel } from '../../../lib/admin/catalog-archive';
import { GoodDetailView } from '@/components/screens/GoodDetail';
import { ProductCard } from '@/components/wc/ProductCard';
import { Icon } from '@/components/ui/Icon';
import { ArtworkUploadField } from '../ArtworkUploadField';
import { CatalogArchiveControl } from '../CatalogArchiveControls';
import { useBrowserStoredValue, writeBrowserStoredValue } from '../catalog/browser-store';
import { CatalogEditorHeader } from '../catalog/CatalogEditorHeader';
import {
  GoodBasicPlaceholders,
  GoodExposurePlaceholders,
  GoodSalesPlaceholders,
  GoodShippingPlaceholders,
  GoodStockTablePlaceholder,
} from '../catalog/GoodFormPlaceholders';
import {
  firstGoodFormErrorTab,
  GoodFormTabList,
  GoodFormTabPanel,
  goodFormErrorCounts,
  goodFormTabForField,
  type GoodFormTabId,
} from '../catalog/GoodFormTabs';
import { GoodsDraftBanner } from '../catalog/GoodsDraftBanner';
import { GoodVariantsPanel } from '../catalog/GoodVariantsPanel';
import type { AdminGoodVariantEditorData } from '@/lib/admin/variants';
import { GoodsNoticePresetBar } from '../catalog/GoodsNoticePresetBar';
import { GoodBankTransferControl } from '../GoodBankTransferControl';
import { ErrorText, Field, FormShell, InlineNotice, SelectField, TextArea } from '../fields';

const emptyStockState: AdminCatalogActionState = {};

/*
 * 고시정보 입력 (#171). 항목·라벨·폼 이름은 lib/goods-notice.ts 하나에서 나온다.
 * 여기에 필드를 직접 늘리면 공개 상세페이지 표와 어긋난다.
 */
function GoodsNoticeFields({
  notice,
  onApplyPreset,
  seed,
  seedRef,
  state,
}: {
  notice: GoodsNoticeInfo | null;
  /** 프리셋을 채웠을 때 미리보기 값을 같이 갱신하라는 신호. */
  onApplyPreset: (values: Record<string, string>) => void;
  seed: Record<string, string>;
  /** 실패 시드의 정체성. 새 실패가 오면 그 전에 채운 프리셋보다 제출값이 우선한다. */
  seedRef: Record<string, string> | null;
  state: AdminCatalogActionState;
}) {
  const [applied, setApplied] = useState<{
    seedRef: Record<string, string> | null;
    values: Record<string, string>;
    version: number;
  } | null>(null);
  /* 프리셋 뒤에 실패 시드가 새로 왔으면 시드(운영자가 마지막에 제출한 값)가 이긴다. */
  const active = applied && applied.seedRef === seedRef ? applied.values : null;

  function applyPreset(values: Record<string, string>) {
    setApplied((current) => ({ seedRef, values, version: (current?.version ?? 0) + 1 }));
    onApplyPreset(values);
  }

  return (
    <fieldset style={{ border: '1px solid var(--line)', borderRadius: 10, margin: 0, padding: 14 }}>
      <legend className="mono" style={{ color: 'var(--dim)', fontSize: 11, padding: '0 6px' }}>
        고시정보 (전자상거래 필수 표기)
      </legend>
      <p className="muted" style={{ fontSize: 12, lineHeight: 1.6, margin: '0 0 12px' }}>
        전 항목이 필수입니다. 하나라도 비면 저장되지 않고, 입력한 값은 굿즈 상세페이지에 그대로 표시됩니다.
      </p>
      <GoodsNoticePresetBar onApply={applyPreset} />
      <div className="admin-form-grid">
        {GOODS_NOTICE_FIELDS.map((field) => (
          /* 비제어 입력이라 프리셋 값은 key 를 바꿔 다시 마운트해야 defaultValue 로 들어간다
             (select 시드와 같은 규칙). */
          <Field
            defaultValue={active?.[field.formName] ?? seed[field.formName] ?? notice?.[field.key] ?? ''}
            error={state.errors?.[field.formName]}
            key={`${field.key}:${active ? applied?.version ?? 0 : 0}`}
            label={field.label}
            name={field.formName}
            placeholder={field.placeholder}
            required
          />
        ))}
      </div>
    </fieldset>
  );
}

function StockAdjustmentForm({
  adjustmentId,
  good,
}: {
  adjustmentId: string;
  good: AdminGoodRecord;
}) {
  const [state, action, pending] = useActionState(adjustAdminStockAction, emptyStockState);
  const formRef = useRef<HTMLFormElement>(null);
  const effectiveStock = good.stockQty <= 0 ? 'soldout' : good.stock;

  useEffect(() => {
    if (state.message) {
      formRef.current?.reset();
    }
  }, [state]);

  return (
    <section aria-labelledby={`stock-adjustment-${good.id}`} className="card col" style={{ borderRadius: 10, gap: 14, padding: 18 }}>
      <div className="row" style={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <span className="eyebrow">INVENTORY</span>
          <h2 id={`stock-adjustment-${good.id}`} style={{ fontSize: 18, margin: '6px 0 0' }}>실재고 조정</h2>
        </div>
        <strong className="mono" style={{ color: 'var(--cyan)', fontSize: 22 }}>{good.stockQty.toLocaleString('ko-KR')}개</strong>
      </div>
      <div
        className="admin-stock-summary"
        style={{
          display: 'grid',
          gap: 8,
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        }}
      >
        <span className="card mono" style={{ borderRadius: 8, color: 'var(--dim)', padding: 10 }}>현재 실재고 {good.stockQty.toLocaleString('ko-KR')}개</span>
        <span className="card mono" style={{ borderRadius: 8, color: 'var(--dim)', padding: 10 }}>운영 상태 {good.stock}</span>
        <span className="card mono" style={{ borderRadius: 8, color: 'var(--dim)', padding: 10 }}>유효 표시 상태 {effectiveStock}</span>
      </div>
      <p className="muted" style={{ fontSize: 12, lineHeight: 1.6, margin: 0 }}>
        수량이 0이면 공개 화면은 자동 품절로 표시됩니다. 운영 상태 soldout은 수량과 무관한 판매 중지로 유지됩니다.
      </p>
      <form action={action} className="col" ref={formRef} style={{ gap: 12 }}>
        <input name="adjustmentId" readOnly type="hidden" value={adjustmentId} />
        <input name="goodId" readOnly type="hidden" value={good.id} />
        <input name="ipId" readOnly type="hidden" value={good.ipId} />
        <input name="expectedStockQty" readOnly type="hidden" value={good.stockQty} />
        <div className="admin-form-grid">
          <Field
            error={state.errors?.delta}
            label="조정 수량 (+입고 / -보정)"
            name="delta"
            placeholder="10 또는 -3"
            required
            step={1}
            type="number"
          />
          <TextArea
            error={state.errors?.reason}
            label="조정 사유"
            maxLength={200}
            name="reason"
            placeholder="입고, 파손, 재고 조사 등"
            required
          />
        </div>
        <InlineNotice state={state} />
        <button className="btn btn-holo" disabled={pending} style={{ justifySelf: 'start', minWidth: 150 }}>
          <Icon name="plus" size={15} /> {pending ? '조정 중' : '재고 조정'}
        </button>
      </form>
    </section>
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

function initialGoodFormValues(selected: AdminGoodRecord | null): Record<string, string> {
  return {
    id: selected?.id ?? '',
    ipId: selected?.ipId ?? '',
    name: selected?.name ?? '',
    type: selected?.type ?? '',
    price: String(selected?.price ?? 0),
    compareAtPrice: selected?.compareAtPrice == null ? '' : String(selected.compareAtPrice),
    badge: selected?.badge ?? '',
    stock: selected?.stock ?? 'ok',
    description: selected?.description ?? '',
    initialStockQty: '',
    ...Object.fromEntries(
      GOODS_NOTICE_FIELDS.map((field) => [field.formName, selected?.notice[field.key] ?? '']),
    ),
  };
}

/* 신규 굿즈의 미리보기 재고는 아직 저장되지 않은 초기 재고 칸을 따른다 — 0이면 품절로 그려진다. */
function previewInitialStockQty(values: Record<string, string>) {
  const raw = (values.initialStockQty ?? '').trim();
  return /^\d+$/.test(raw) ? Number(raw) : 0;
}

function initialGoodImageUrls(selected: AdminGoodRecord | null): Record<string, string | null> {
  const urls: Record<string, string | null> = {
    imagePath: selected?.imageUrl ?? null,
    detailImagePath: selected?.detailImageUrl ?? null,
  };
  for (let slot = 0; slot < GOODS_GALLERY_MAX; slot += 1) {
    urls[`galleryPath${slot}`] = selected?.galleryUrls[slot] ?? null;
  }
  return urls;
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
              soldOut={good.stock === 'soldout' || good.stockQty <= 0}
            />
          </div>
        </div>
        <div className="col" style={{ gap: 8 }}>
          <span className="mono" style={{ color: 'var(--dim)', fontSize: 11 }}>굿즈 상세페이지</span>
          <div className="wc-root">
            <GoodDetailView detail={detail} embedded />
          </div>
        </div>
      </div>
    </details>
  );
}

const DRAFT_SAVE_DELAY_MS = 400;

function GoodEditor({
  action,
  adjustmentId,
  catalogIps,
  ipOptions,
  pending,
  selected,
  state,
  template,
}: {
  action: (payload: FormData) => void;
  /** 초기 재고 반영의 멱등 키. 서버 컴포넌트가 요청당 하나 만든다(신규 등록에서만 쓴다). */
  adjustmentId: string;
  catalogIps: Ip[];
  ipOptions: { id: string; title: string; archivedAt: string | null }[];
  pending: boolean;
  selected: AdminGoodRecord | null;
  state: AdminCatalogActionState;
  /** 「복사해서 등록」 원본. 새 등록에서만 쓰고 ID·이미지·재고는 옮기지 않는다. */
  template: AdminGoodRecord | null;
}) {
  const creating = selected === null;
  /* 값의 출처: 수정이면 그 레코드, 복사면 원본, 둘 다 아니면 빈 폼. */
  const base = selected ?? template;
  const [values, setValues] = useState<Record<string, string>>(() => ({
    ...initialGoodFormValues(base),
    ...(template ? { id: '' } : {}),
  }));
  const [imageUrls, setImageUrls] = useState(() => initialGoodImageUrls(selected));
  /* 임시본을 되살리면 폼 전체를 다시 마운트해 defaultValue 를 갈아 끼운다. */
  const [formVersion, setFormVersion] = useState(0);
  const [restored, setRestored] = useState<{
    seedRef: Record<string, string> | null;
    values: Record<string, string>;
  } | null>(null);
  const [draftDecision, setDraftDecision] = useState<'own' | 'restored' | 'discarded' | null>(null);
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  /* 탭 선택은 그때의 오류 묶음에 묶인다 — 새 실패가 오면 첫 오류 탭이 사용자 선택을 이긴다. */
  const [tabChoice, setTabChoice] = useState<{ tab: GoodFormTabId; errorsRef: AdminFieldErrors | undefined } | null>(null);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftRaw = useBrowserStoredValue(GOODS_DRAFT_STORAGE_KEY);
  const draft = useMemo(() => (creating ? parseGoodsDraft(draftRaw) : null), [creating, draftRaw]);
  /* 되살릴지 버릴지 정하기 전에는 자동 저장을 멈춘다 — 옛 임시본을 새 입력으로 덮지 않는다. */
  const draftPending = Boolean(draft) && draftDecision === null;
  const canAutosave = creating && !draftPending;

  /* 저장이 실패하면 액션이 제출값을 돌려준다 — 그 값이 레코드보다 우선한다.
     되살린 임시본은 그 시점의 실패 시드와 같은 세대일 때만 시드 위에 선다. */
  const seed: Record<string, string> = state.values ?? {};
  const seedRef = state.values ?? null;
  const restoredActive = restored && restored.seedRef === seedRef ? restored.values : null;
  const defaults: Record<string, string> = {
    ...initialGoodFormValues(base),
    ...(template ? { id: '' } : {}),
    ...seed,
    ...(restoredActive ?? {}),
  };

  /* 신규 등록이 성공하면 임시본은 할 일을 다 했다. */
  useEffect(() => {
    if (creating && state.message) writeBrowserStoredValue(GOODS_DRAFT_STORAGE_KEY, '');
  }, [creating, state.message]);

  useEffect(() => () => {
    if (draftTimer.current) clearTimeout(draftTimer.current);
  }, []);

  function scheduleDraftSave(next: Record<string, string>) {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      if (!canAutosave) return;
      const picked = goodsDraftValues(next);
      if (isGoodsDraftBlank(picked)) return;
      const now = new Date();
      writeBrowserStoredValue(GOODS_DRAFT_STORAGE_KEY, serializeGoodsDraft(picked, now));
      setDraftSavedAt(now.toISOString());
      setDraftDecision((current) => current ?? 'own');
    }, DRAFT_SAVE_DELAY_MS);
  }

  /* 폼 전체에서 올라오는 change 를 한 번에 읽는다 — 필드마다 상태를 두면
     입력 하나 추가할 때마다 미리보기 배선을 잊게 된다. */
  function syncValues(event: FormEvent<HTMLFormElement>) {
    const next = goodFormValues(new FormData(event.currentTarget));
    setValues(next);
    if (creating) scheduleDraftSave(next);
  }

  function setImageUrl(name: string, url: string | null) {
    setImageUrls((current) => ({ ...current, [name]: url }));
  }

  /* 프리셋은 DOM 재마운트로 들어가므로 change 가 오르지 않는다 — 미리보기 값을 직접 맞춘다. */
  function applyNoticePreset(preset: Record<string, string>) {
    setValues((current) => ({ ...current, ...preset }));
  }

  function restoreDraft() {
    if (!draft) return;
    setRestored({ seedRef, values: draft.values });
    setValues((current) => ({ ...current, ...draft.values }));
    setDraftDecision('restored');
    setFormVersion((version) => version + 1);
  }

  function discardDraft() {
    writeBrowserStoredValue(GOODS_DRAFT_STORAGE_KEY, '');
    setDraftDecision('discarded');
  }

  const errorCounts = goodFormErrorCounts(state.errors);
  const errorTab = firstGoodFormErrorTab(state.errors);
  const activeTab: GoodFormTabId = tabChoice && tabChoice.errorsRef === state.errors
    ? tabChoice.tab
    : errorTab ?? tabChoice?.tab ?? 'basic';
  const tabPrefix = `good-form-${selected?.id ?? 'new'}`;

  /* 브라우저 기본 검증은 숨은 탭의 required 칸을 포커스하지 못해 제출을 조용히 막는다.
     그래서 폼은 noValidate 로 두고 여기서 직접 검사한다 — 첫 오류 칸의 탭을 연 뒤
     같은 말풍선(reportValidity)을 띄우면 운영자가 보던 검증 경험은 그대로다. */
  function guardSubmit(event: FormEvent<HTMLFormElement>) {
    const form = event.currentTarget;
    if (form.checkValidity()) return;
    event.preventDefault();
    /* fieldset 도 :invalid 에 걸린다(안에 오류 칸이 있으면) — 입력 요소만 고른다. */
    const invalid = form.querySelector<HTMLInputElement>('input:invalid, select:invalid, textarea:invalid');
    const tab = invalid?.name ? goodFormTabForField(invalid.name) : null;
    if (tab && tab !== activeTab) setTabChoice({ tab, errorsRef: state.errors });
    window.setTimeout(() => form.reportValidity(), 0);
  }

  const previewIp = catalogIps.find((ip) => ip.id === values.ipId) ?? null;
  const preview = buildGoodPreview({
    fallbackBg: selected?.bg ?? null,
    imageUrls,
    ip: previewIp,
    stockQty: selected ? selected.stockQty : previewInitialStockQty(values),
    values,
  });
  /* 할인 표기는 판매가보다 큰 정가에서만 파생된다(PriceBlock·DB CHECK 와 같은 규칙).
     그 조건을 만족하지 않는 입력은 미리보기에서도 할인으로 그리지 않는다. */
  const compareAtPriceInput = Number((values.compareAtPrice ?? '').trim());
  const previewDetail: GoodDetailContent = {
    ...preview,
    good: {
      ...preview.good,
      compareAtPrice: Number.isInteger(compareAtPriceInput)
        && compareAtPriceInput > preview.good.price
        ? compareAtPriceInput
        : null,
    },
  };

  return (
    <>
      {template ? (
        <p className="muted" role="status" style={{ fontSize: 12.5, margin: 0 }}>
          <span className="mono">{template.id}</span> · {template.name} 을(를) 복사한 새 등록입니다. ID를 새로 입력하세요 — 이미지·실재고·무통장 설정은 복사되지 않습니다.
        </p>
      ) : null}
      {draftPending && draft ? (
        <GoodsDraftBanner draft={draft} onDiscard={discardDraft} onRestore={restoreDraft} />
      ) : null}
      <form action={action} className="card col" key={`good-form:${formVersion}`} noValidate onChange={syncValues} onSubmit={guardSubmit} style={{ borderRadius: 10, gap: 14, padding: 18 }}>
        <input name="previousId" type="hidden" value={selected?.id ?? ''} />
        <input name="previousIpId" type="hidden" value={selected?.ipId ?? ''} />
        {/* 배경 CSS 자유입력을 운영자 폼에서 뺐다 (#183). 아트워크가 없는 레거시
            레코드는 이 값으로 렌더되므로 그대로 실어 보내 보존한다. */}
        <input name="bg" type="hidden" value={selected?.bg ?? ''} />
        {!selected ? <input name="initialStockAdjustmentId" type="hidden" value={adjustmentId} /> : null}

        {/* 탭 7 (설계서 4-3). 패널은 전부 이 <form> 안에 있고 안 보이는 패널도 값을 제출한다. */}
        <GoodFormTabList
          active={activeTab}
          errorCounts={errorCounts}
          idPrefix={tabPrefix}
          onSelect={(tab) => setTabChoice({ tab, errorsRef: state.errors })}
        />

        <GoodFormTabPanel active={activeTab} id="basic" idPrefix={tabPrefix}>
          <div className="admin-form-grid">
            <Field defaultValue={defaults.id} error={state.errors?.id} label="ID (자체 코드)" name="id" placeholder="g100" readOnly={Boolean(selected)} />
            {/* select 는 defaultValue 갱신을 무시하므로 시드값을 key 로 삼아 다시 마운트한다. */}
            <SelectField defaultValue={defaults.ipId} error={state.errors?.ipId} key={`ipId:${defaults.ipId}`} label="연결 IP" name="ipId">
              <option value="">선택</option>
              {ipOptions.map((ip) => (
                <option
                  disabled={Boolean(ip.archivedAt && ip.id !== base?.ipId)}
                  key={ip.id}
                  value={ip.id}
                >
                  {ip.archivedAt ? `[보관] ${ip.title}` : ip.title}
                </option>
              ))}
            </SelectField>
            <Field defaultValue={defaults.name} error={state.errors?.name} label="굿즈 이름" name="name" />
            {/* 유형·배지는 자유 입력에서 표준 값 select 로 좁혔다 (#326). 자유 문자열은
                굿즈샵 필터 축으로 쓸 수 없고, DB CHECK 도 같은 목록을 강제한다. */}
            <SelectField defaultValue={defaults.type} error={state.errors?.type} key={`type:${defaults.type}`} label="유형" name="type">
              <option value="">선택</option>
              {GOOD_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
            </SelectField>
          </div>
          <TextArea
            defaultValue={defaults.description}
            error={state.errors?.description}
            label="상세 설명 (최대 2,000자)"
            maxLength={GOODS_DESCRIPTION_MAX_LENGTH}
            name="description"
            placeholder="굿즈 구성과 특징을 짧게 설명해주세요."
          />
          <GoodBasicPlaceholders />
        </GoodFormTabPanel>

        <GoodFormTabPanel active={activeTab} id="sales" idPrefix={tabPrefix}>
          <div className="admin-form-grid">
            <Field defaultValue={defaults.price} error={state.errors?.price} label="판매가" name="price" type="number" />
            {/* 정가는 할인 표기 전용이다 — 비우면 할인 아님, 채우면 판매가보다 커야 한다. */}
            <Field
              defaultValue={defaults.compareAtPrice}
              error={state.errors?.compareAtPrice}
              label="정가 (할인 표기용, 비우면 할인 없음)"
              name="compareAtPrice"
              placeholder="26000"
              type="number"
            />
            <SelectField defaultValue={defaults.badge} error={state.errors?.badge} key={`badge:${defaults.badge}`} label="배지" name="badge">
              <option value="">없음</option>
              {GOOD_BADGES.map((badge) => <option key={badge} value={badge}>{badge}</option>)}
            </SelectField>
            <SelectField defaultValue={defaults.stock} error={state.errors?.stock} key={`stock:${defaults.stock}`} label="운영 상태 (판매 상태 덮어쓰기)" name="stock">
              <option value="ok">ok</option>
              <option value="low">low</option>
              <option value="soldout">soldout</option>
            </SelectField>
          </div>
          <p className="muted" style={{ fontSize: 12, lineHeight: 1.6, margin: 0 }}>
            판매 상태는 실재고에서 파생된다(수량 0 = 품절). 운영 상태 soldout 은 수량과 무관한 판매 중지다.
            {selected ? ' 무통장 입금 허용은 아래 카드에서 바로 바꿀 수 있다.' : ''}
          </p>
          <GoodSalesPlaceholders />
        </GoodFormTabPanel>

        <GoodFormTabPanel active={activeTab} id="stock" idPrefix={tabPrefix}>
          {!selected ? (
            <>
              <div className="admin-form-grid">
                {/* 초기 재고는 신규 등록에서만. 기존 굿즈의 재고는 실재고 조정이 감사 기록과 함께 맡는다. */}
                <Field
                  defaultValue={defaults.initialStockQty}
                  error={state.errors?.initialStockQty}
                  label="초기 재고 수량 (선택)"
                  min={0}
                  name="initialStockQty"
                  placeholder="0"
                  step={1}
                  type="number"
                />
              </div>
              <p className="muted" style={{ fontSize: 12, lineHeight: 1.6, margin: 0 }}>
                초기 재고는 저장 직후 실재고 이력에 「등록 시 초기 재고」 사유로 남습니다. 비우면 0개(품절 표시)로 등록됩니다.
              </p>
            </>
          ) : (
            <p className="muted" style={{ fontSize: 12, lineHeight: 1.6, margin: 0 }}>
              판매 가능 <strong className="mono">{selected.stockQty.toLocaleString('ko-KR')}개</strong>
              {selected.archivedAt
                ? ' — 보관된 굿즈는 복원한 뒤에 재고를 조정할 수 있다.'
                : ' — 옵션·품목·출고지별 재고와 조정은 아래 「품목 · 재고」 카드에서 다룬다. 저장 직후 품목 표를 고칠 수 있다.'}
            </p>
          )}
          {!selected ? (
            <GoodStockTablePlaceholder
              creating
              id={values.id ?? ''}
              initialStockQty={values.initialStockQty ?? ''}
              name={values.name ?? ''}
              stockQty={null}
            />
          ) : null}
        </GoodFormTabPanel>

        <GoodFormTabPanel active={activeTab} id="images" idPrefix={tabPrefix}>
          <ArtworkUploadField
            currentPath={selected?.imagePath ?? null}
            currentUrl={selected?.imageUrl ?? null}
            fieldId="good-main"
            helpText="굿즈샵 목록 카드와 상세페이지 대표 이미지로 쓰입니다."
            kind="good"
            label="대표 이미지"
            onPreviewChange={(url) => setImageUrl('imagePath', url)}
          />
          <GoodsGalleryFields
            galleryPaths={selected?.galleryPaths ?? []}
            galleryUrls={selected?.galleryUrls ?? []}
            onPreviewChange={setImageUrl}
            state={state}
          />
          <ArtworkUploadField
            allowRemove
            currentPath={selected?.detailImagePath ?? null}
            currentUrl={selected?.detailImageUrl ?? null}
            fieldId="good-detail"
            helpText="상세페이지 아래에 원래 비율로 길게 표시되는 이미지 1장입니다."
            kind="good"
            label="상세 이미지"
            name="detailImagePath"
            onPreviewChange={(url) => setImageUrl('detailImagePath', url)}
          />
        </GoodFormTabPanel>

        <GoodFormTabPanel active={activeTab} id="notice" idPrefix={tabPrefix}>
          <GoodsNoticeFields
            notice={base?.notice ?? null}
            onApplyPreset={applyNoticePreset}
            seed={defaults}
            seedRef={seedRef}
            state={state}
          />
        </GoodFormTabPanel>

        <GoodFormTabPanel active={activeTab} id="shipping" idPrefix={tabPrefix}>
          <GoodShippingPlaceholders />
        </GoodFormTabPanel>

        <GoodFormTabPanel active={activeTab} id="exposure" idPrefix={tabPrefix}>
          <GoodExposurePlaceholders archived={Boolean(selected?.archivedAt)} />
        </GoodFormTabPanel>

        <FormShell pending={pending} state={state} />
        {creating && draftSavedAt ? (
          <span className="muted admin-draft-status" role="status">
            브라우저에 임시 저장됨 · {formatGoodsDraftSavedAt(draftSavedAt)} — 이미지는 저장되지 않습니다.
          </span>
        ) : null}
      </form>
      <GoodPreviewPanel detail={previewDetail} ip={previewIp} />
    </>
  );
}

/*
 * 굿즈 편집 화면. 목록은 GoodConsole 이 맡고(`?selected=` 없음), 여기는 한 굿즈의
 * 저장·재고 조정·무통장·보관을 한 기둥으로 쌓는다. 목록으로 돌아가는 링크는
 * 검색·필터·페이지를 그대로 품는다.
 */
export function GoodSection({
  action,
  adjustmentId,
  catalogIps,
  copyHref = null,
  ipOptions,
  listHref,
  pending,
  selected,
  state,
  template = null,
  variantBatchId = null,
  variantEditor = null,
}: {
  action: (payload: FormData) => void;
  adjustmentId: string;
  catalogIps: Ip[];
  /** 기존 굿즈를 원본으로 새 등록을 여는 링크(`?selected=new&copyFrom=`). 수정 화면에서만 뜬다. */
  copyHref?: string | null;
  ipOptions: { id: string; title: string; archivedAt: string | null }[];
  listHref: string;
  pending: boolean;
  selected: AdminGoodRecord | null;
  state: AdminCatalogActionState;
  /** 「복사해서 등록」 원본. 새 등록일 때만 뜻이 있다. */
  template?: AdminGoodRecord | null;
  /** 품목 일괄 저장의 배치 멱등 키(요청당 하나). 품목 표가 있을 때만 쓴다. */
  variantBatchId?: string | null;
  /** 옵션·품목·출고지별 재고(D-1). 없으면 상품 단위 실재고 조정 카드로 대신한다. */
  variantEditor?: AdminGoodVariantEditorData | null;
}) {
  return (
    <div className="col" style={{ gap: 16, minWidth: 0 }}>
      <CatalogEditorHeader
        actions={selected && copyHref ? (
          <Link className="btn btn-sm btn-ghost" href={copyHref}>복사해서 등록</Link>
        ) : null}
        eyebrow="GOODS"
        listHref={listHref}
        title={selected
          ? formatAdminCatalogRecordLabel(`${selected.id} · ${selected.name} · ${selected.stockQty}개`, selected.archivedAt)
          : template ? `새 굿즈 등록 · ${template.id} 복사` : '새 굿즈 등록'}
      />
      <GoodEditor
        action={action}
        adjustmentId={adjustmentId}
        catalogIps={catalogIps}
        ipOptions={ipOptions}
        key={selected ? JSON.stringify(selected) : template ? `copy:${template.id}` : 'new-good'}
        pending={pending}
        selected={selected}
        state={state}
        template={selected ? null : template}
      />
      {selected && !selected.archivedAt && variantEditor && variantBatchId ? (
        <GoodVariantsPanel batchId={variantBatchId} editor={variantEditor} goodName={selected.name} key={`variants-${selected.id}:${JSON.stringify(variantEditor.variants)}`} />
      ) : null}
      {selected && !selected.archivedAt && !(variantEditor && variantBatchId) && (
        <StockAdjustmentForm adjustmentId={adjustmentId} good={selected} key={`stock-${selected.id}`} />
      )}
      {selected && !selected.archivedAt && (
        <GoodBankTransferControl
          allowBankTransfer={selected.allowBankTransfer}
          id={selected.id}
          key={`bank-${selected.id}:${selected.allowBankTransfer}`}
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
  );
}
