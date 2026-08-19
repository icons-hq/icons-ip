'use client';

import { useActionState, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  adjustAdminStockAction,
  type AdminCatalogActionState,
} from '@/app/admin/actions';
import { GOODS_DESCRIPTION_MAX_LENGTH, GOODS_GALLERY_MAX } from '@/lib/admin/catalog';
import type { AdminGoodRecord } from '@/lib/admin/catalog.server';
import { buildGoodPreview, goodFormValues } from '@/lib/admin/good-preview';
import type { Ip } from '@/lib/data';
import type { GoodDetailContent } from '@/lib/goods-detail';
import { GOODS_NOTICE_FIELDS, type GoodsNoticeInfo } from '@/lib/goods-notice';
import {
  adminCatalogArchiveCounts,
  filterAdminCatalogRecords,
  formatAdminCatalogRecordLabel,
  type AdminCatalogArchiveFilter,
} from '../../../lib/admin/catalog-archive';
import { GoodDetailView } from '@/components/screens/GoodDetail';
import { GoodsCard } from '@/components/shop/GoodsCard';
import { Icon } from '@/components/ui/Icon';
import { ArtworkUploadField } from '../ArtworkUploadField';
import {
  CatalogArchiveControl,
  CatalogArchiveFilter,
  GoodBankTransferControl,
} from '../CatalogArchiveControls';
import { ErrorText, Field, FormShell, InlineNotice, RecordList, SelectField, TextArea } from '../fields';

const emptyStockState: AdminCatalogActionState = {};

/*
 * 고시정보 입력 (#171). 항목·라벨·폼 이름은 lib/goods-notice.ts 하나에서 나온다.
 * 여기에 필드를 직접 늘리면 공개 상세페이지 표와 어긋난다.
 */
function GoodsNoticeFields({
  notice,
  state,
}: {
  notice: GoodsNoticeInfo | null;
  state: AdminCatalogActionState;
}) {
  return (
    <fieldset style={{ border: '1px solid var(--line)', borderRadius: 10, margin: 0, padding: 14 }}>
      <legend className="mono" style={{ color: 'var(--dim)', fontSize: 11, padding: '0 6px' }}>
        고시정보 (전자상거래 필수 표기)
      </legend>
      <p className="muted" style={{ fontSize: 12, lineHeight: 1.6, margin: '0 0 12px' }}>
        전 항목이 필수입니다. 하나라도 비면 저장되지 않고, 입력한 값은 굿즈 상세페이지에 그대로 표시됩니다.
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
    badge: selected?.badge ?? '',
    stock: selected?.stock ?? 'ok',
    description: selected?.description ?? '',
    ...Object.fromEntries(
      GOODS_NOTICE_FIELDS.map((field) => [field.formName, selected?.notice[field.key] ?? '']),
    ),
  };
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
 * 조건이 첫 수정에서 깨진다. 담기 자리에는 동작하지 않는 표시를 꽂아 미리보기가
 * 장바구니나 카탈로그를 건드리지 않게 한다.
 */
function GoodPreviewPanel({ detail, ip }: { detail: GoodDetailContent; ip: Ip | null }) {
  const inertAction = (
    <span className="mono" style={{ color: 'var(--dim)', fontSize: 12 }}>담기 (미리보기)</span>
  );

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
          <div className="goods-detail-scope" style={{ maxWidth: 280 }}>
            <GoodsCard action={inertAction} good={detail.good} ip={ip} />
          </div>
        </div>
        <div className="col" style={{ gap: 8 }}>
          <span className="mono" style={{ color: 'var(--dim)', fontSize: 11 }}>굿즈 상세페이지</span>
          <GoodDetailView cartAction={inertAction} detail={detail} embedded showBackLink={false} />
        </div>
      </div>
    </details>
  );
}

function GoodEditor({
  action,
  catalogIps,
  ipOptions,
  pending,
  selected,
  state,
}: {
  action: (payload: FormData) => void;
  catalogIps: Ip[];
  ipOptions: { id: string; title: string; archivedAt: string | null }[];
  pending: boolean;
  selected: AdminGoodRecord | null;
  state: AdminCatalogActionState;
}) {
  const [values, setValues] = useState(() => initialGoodFormValues(selected));
  const [imageUrls, setImageUrls] = useState(() => initialGoodImageUrls(selected));

  /* 폼 전체에서 올라오는 change 를 한 번에 읽는다 — 필드마다 상태를 두면
     입력 하나 추가할 때마다 미리보기 배선을 잊게 된다. */
  function syncValues(event: FormEvent<HTMLFormElement>) {
    setValues(goodFormValues(new FormData(event.currentTarget)));
  }

  function setImageUrl(name: string, url: string | null) {
    setImageUrls((current) => ({ ...current, [name]: url }));
  }

  const previewIp = catalogIps.find((ip) => ip.id === values.ipId) ?? null;
  const preview = buildGoodPreview({
    fallbackBg: selected?.bg ?? null,
    imageUrls,
    ip: previewIp,
    stockQty: selected?.stockQty ?? 0,
    values,
  });

  return (
    <>
      <form action={action} className="card col" onChange={syncValues} style={{ borderRadius: 10, gap: 14, padding: 18 }}>
        <input name="previousId" type="hidden" value={selected?.id ?? ''} />
        <input name="previousIpId" type="hidden" value={selected?.ipId ?? ''} />
        <div className="admin-form-grid">
          <Field defaultValue={selected?.id} error={state.errors?.id} label="ID" name="id" placeholder="g100" readOnly={Boolean(selected)} />
          <SelectField defaultValue={selected?.ipId} error={state.errors?.ipId} label="연결 IP" name="ipId">
            <option value="">선택</option>
            {ipOptions.map((ip) => (
              <option
                disabled={Boolean(ip.archivedAt && ip.id !== selected?.ipId)}
                key={ip.id}
                value={ip.id}
              >
                {ip.archivedAt ? `[보관] ${ip.title}` : ip.title}
              </option>
            ))}
          </SelectField>
          <Field defaultValue={selected?.name} error={state.errors?.name} label="굿즈 이름" name="name" />
          <Field defaultValue={selected?.type} error={state.errors?.type} label="유형" name="type" />
          <Field defaultValue={selected?.price ?? 0} error={state.errors?.price} label="가격" name="price" type="number" />
          <Field defaultValue={selected?.badge} label="배지" name="badge" />
          <SelectField defaultValue={selected?.stock ?? 'ok'} error={state.errors?.stock} label="운영 상태" name="stock">
            <option value="ok">ok</option>
            <option value="low">low</option>
            <option value="soldout">soldout</option>
          </SelectField>
        </div>
        {/* 배경 CSS 자유입력을 운영자 폼에서 뺐다 (#183). 아트워크가 없는 레거시
            레코드는 이 값으로 렌더되므로 그대로 실어 보내 보존한다. */}
        <input name="bg" type="hidden" value={selected?.bg ?? ''} />
        <GoodsNoticeFields notice={selected?.notice ?? null} state={state} />
        <ArtworkUploadField
          currentPath={selected?.imagePath ?? null}
          currentUrl={selected?.imageUrl ?? null}
          fieldId="good-main"
          helpText="굿즈샵 목록 카드와 상세페이지 대표 이미지로 쓰입니다."
          kind="good"
          label="대표 이미지"
          onPreviewChange={(url) => setImageUrl('imagePath', url)}
        />
        <TextArea
          defaultValue={selected?.description}
          error={state.errors?.description}
          label="상세 설명 (최대 2,000자)"
          maxLength={GOODS_DESCRIPTION_MAX_LENGTH}
          name="description"
          placeholder="굿즈 구성과 특징을 짧게 설명해주세요."
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
        <FormShell pending={pending} state={state} />
      </form>
      <GoodPreviewPanel detail={preview} ip={previewIp} />
    </>
  );
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
}) {
  const [archiveFilter, setArchiveFilter] = useState<AdminCatalogArchiveFilter>(
    selected?.archivedAt ? 'archived' : 'active',
  );
  const visibleRecords = filterAdminCatalogRecords(records, archiveFilter);

  return (
    <div className="admin-master-detail">
      <div className="col" style={{ gap: 12, minWidth: 0 }}>
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
          labelFor={(good) => formatAdminCatalogRecordLabel(
            `${good.id} · ${good.name} · ${good.stockQty}개`,
            good.archivedAt,
          )}
          onNew={() => onSelect(null)}
          onSelect={onSelect}
          thumbnailKind="good"
          thumbnailUrlFor={(good) => good.imageUrl}
        />
      </div>
      <div className="col" style={{ gap: 16, minWidth: 0 }}>
        <GoodEditor
          action={action}
          catalogIps={catalogIps}
          ipOptions={ipOptions}
          key={selected ? JSON.stringify(selected) : 'new-good'}
          pending={pending}
          selected={selected}
          state={state}
        />
        {selected && !selected.archivedAt && (
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
    </div>
  );
}
