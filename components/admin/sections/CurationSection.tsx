'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { startTransition, useActionState, useId, useMemo, useRef, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { upsertAdminCurationAction } from '@/app/admin/curation-actions';
import { AdminField } from '@/components/admin/console/AdminKit';
import { CurationPreview, type CurationPreviewDevice } from '@/components/admin/curation/CurationPreview';
import { CurationEditorDialog, CurationProductPicker } from '@/components/admin/curation/CurationProductPicker';
import { CurationMosaicFields } from '@/components/admin/curation/CurationMosaicFields';
import { CurationLayoutEditor } from '@/components/admin/curation/CurationLayoutEditor';
import { ArchivedHeroBanners, HeroBannerDeleteButton } from '@/components/admin/curation/HeroBannerArchive';
import { MarketingLinkIssuer } from '@/components/admin/marketing/MarketingLinkIssuer';
import type { AdminHomeLayout } from '@/lib/admin/home-layout';
import {
  buildDraftCurationPreview, createCurationEditorValues, curationKstInput, CURATION_KIND_LABELS,
  CURATION_KIND_ORDER, CURATION_STATUS_LABELS, curationValuesForKindChange, emptyCurationPreview, moveCurationProduct, NOTICE_PAGE_TYPE_LABELS,
  type CurationEditorValues, type CurationPublicPreview,
} from '@/lib/admin/curation-editor';
import { adminCurationTargetGroupsFor, type AdminCurationTargetRecord } from '@/lib/admin/curation-targets';
import { NOTICE_BAR_CTA_LIMIT, NOTICE_BAR_MESSAGE_LIMIT, type AdminCurationActionState, type AdminCurationKind } from '@/lib/admin/curations';
import type { AdminCurationRecord } from '@/lib/admin/curations.server';
import { eligibleHomeReviewStatistics, HOME_REVIEW_MANUAL_LIMIT, HOME_SALES_PERIOD_LABELS, HOME_SALES_PERIODS, type HomeSalesPeriod } from '@/lib/home-ranking';
import { HOME_HERO_CONTENT_LIMIT, HOME_HERO_LIMIT, HOME_HERO_TITLE_LIMIT, type HomeHeroImageDim, type HomeHeroTextColor } from '@/lib/home-hero';
import { HOME_FREE_PRODUCT_LIMIT, HOME_PRODUCT_CANDIDATE_LIMIT, HOME_PRODUCT_TITLE_LIMIT, homeProductCountRange,
  type HomeProductImageShape, type HomeProductLayout } from '@/lib/home-product-collection';
import { SHELL_NOTICE_PAGE_TYPES } from '@/lib/shell-notices';
import { ArtworkUploadField } from '../ArtworkUploadField';
import { ActionNotice, ErrorText } from '../fields';

const EMPTY_STATE: AdminCurationActionState = {};
const IMAGE_REQUIRED = new Set<AdminCurationKind>(['hero', 'notice_strip', 'editor_pick', 'band_banner']);
const IMAGE_FREE = new Set<AdminCurationKind>(['notice_bar', 'best_tab', 'benefit', 'sales_best', 'review_best', 'product_mosaic', 'product_collection']);
const isShellNoticeKind = (kind: AdminCurationKind) => kind === 'notice_bar' || kind === 'notice_strip';
const isFreeProductKind = (kind: AdminCurationKind | undefined) => kind === 'product_mosaic' || kind === 'product_collection';
const KIND_HELP: Record<AdminCurationKind, string> = {
  hero: '홈 첫 화면에 최대 10개의 배너를 차례로 보여줍니다. PC와 모바일 이미지를 따로 등록할 수 있습니다.',
  notice_bar: '스토어 맨 위에 문구와 이동 버튼으로 보이는 공지입니다. 고객이 닫으면 같은 탭에서는 다시 보이지 않고, 같은 화면에 여러 개가 있으면 순서가 앞선 하나를 보여줍니다.',
  notice_strip: '스토어 상단에 보이는 이미지 띠배너입니다. 같은 시간·화면에 여러 개가 있으면 스토어를 새로 열 때마다 하나를 무작위로 보여줍니다.',
  editor_pick: '이미지, 제목과 설명을 카드로 보여줍니다.',
  band_banner: '기획전 배너와 선택한 상품을 함께 보여줍니다.',
  best_tab: '직접 선택한 상품 또는 최신 등록 상품을 카테고리 BEST·인기템 탭으로 보여줍니다.',
  sales_best: '실시간·일간·주간·월간 판매량으로 각 최대 4개 상품을 자동 전시합니다.',
  product_mosaic: '8개 상품과 대표이미지를 지정한 위치에 콜라주로 보여줍니다.',
  product_collection: '직접 고른 상품을 리스트나 큰 이미지로 보여줍니다. 모자이크와 합계 5개까지 구성할 수 있습니다.',
  review_best: '공개 리뷰 평점이 높은 상품을 자동 또는 직접 선정합니다. 4개 이상일 때 전시합니다.',
  benefit: '카드팩·게임 혜택을 제목과 설명으로 보여줍니다.',
  featured_ip: '기존 특집 IP 설정입니다. 현재 홈 본문에는 특집 IP 영역이 없습니다.',
  announcement: '기존 공지 배너 설정입니다. 현재 홈 본문에 배너를 노출하려면 상단 띠배너를 사용하세요.',
};
const ARTWORK_HELP: Record<AdminCurationKind, string> = {
  hero: '히어로 이미지는 필수입니다.',
  featured_ip: '특집 IP 이미지는 선택입니다. 비우면 IP 키아트를 사용합니다.',
  announcement: '공지 배너 이미지는 선택입니다.',
  notice_strip: '공지 스트립 이미지는 필수입니다.',
  notice_bar: '텍스트 공지 바는 이미지를 쓰지 않습니다.',
  editor_pick: '에디터의 제안 카드 이미지는 필수입니다.',
  band_banner: '기획전 배너 이미지는 필수입니다.',
  best_tab: 'BEST 탭은 이미지를 쓰지 않습니다.',
  sales_best: '판매 상품의 대표이미지를 사용합니다.',
  product_mosaic: '각 위치에 별도 대표이미지를 등록합니다.',
  product_collection: '선택한 상품의 대표이미지를 사용합니다.',
  review_best: '리뷰 상품의 대표이미지를 사용합니다.',
  benefit: '혜택 타일은 이미지를 쓰지 않습니다.',
};
const DEFAULT_PREVIEW: CurationPublicPreview = { curation: emptyCurationPreview(), noticeStrip: null, goods: [], cardRewardsEnabled: false };

export function getCurationFormKey(selected: AdminCurationRecord | null, draftId: string) {
  return JSON.stringify([selected?.id ?? draftId, selected?.updatedAt ?? null]);
}

export function CurationSection({
  draftActiveFrom, draftId, eventOptions, goodOptions, ipOptions, onSelect, operationId, preview = DEFAULT_PREVIEW, records, selected, homeLayout, homeLayoutOperationId,
}: {
  draftActiveFrom: string;
  draftId: string;
  eventOptions: AdminCurationTargetRecord[];
  goodOptions: AdminCurationTargetRecord[];
  ipOptions: AdminCurationTargetRecord[];
  onSelect: (curation: { id: string } | null) => void;
  operationId: string;
  preview?: CurationPublicPreview;
  records: AdminCurationRecord[];
  selected: AdminCurationRecord | null;
  homeLayout?: AdminHomeLayout;
  homeLayoutOperationId?: string;
}) {
  const [device, setDevice] = useState<CurationPreviewDevice>('mobile');
  const [fullPreview, setFullPreview] = useState(false);
  const [adding, setAdding] = useState(false);
  const [initialKind, setInitialKind] = useState<AdminCurationKind>('hero');
  const [draftVersion, setDraftVersion] = useState(0);
  const [draftSeed, setDraftSeed] = useState({ draftId, draftActiveFrom, operationId });
  const [dirty, setDirty] = useState(false);
  const [pendingSelection, setPendingSelection] = useState<{ id: string | null; kind?: AdminCurationKind } | null>(null);
  const [savedMessage, setSavedMessage] = useState('');
  const [view, setView] = useState<'content' | 'layout'>('content');
  const [layoutDirty, setLayoutDirty] = useState(false);
  const [layoutSavedMessage, setLayoutSavedMessage] = useState('');
  const [pendingView, setPendingView] = useState<'content' | 'layout' | null>(null);
  const heroCount = records.filter(record => record.kind === 'hero').length;
  const freeProductCount = records.filter(record => isFreeProductKind(record.kind)).length;
  const ordered = useMemo(() => [...records].sort((a, b) => (
    CURATION_KIND_ORDER.indexOf(a.kind) - CURATION_KIND_ORDER.indexOf(b.kind)
    || a.displayOrder - b.displayOrder || a.activeFrom.localeCompare(b.activeFrom) || a.id.localeCompare(b.id)
  )), [records]);

  function applySelection(target: { id: string | null; kind?: AdminCurationKind }) {
    setDirty(false);
    setPendingSelection(null);
    setAdding(false);
    if (!target.id) {
      setInitialKind(target.kind ?? 'hero');
      setDraftSeed({ draftId: crypto.randomUUID(), operationId: crypto.randomUUID(), draftActiveFrom: new Date().toISOString() });
      setDraftVersion((value) => value + 1);
    }
    onSelect(target.id ? { id: target.id } : null);
  }
  function requestSelection(target: { id: string | null; kind?: AdminCurationKind }) {
    if (dirty) setPendingSelection(target);
    else applySelection(target);
  }
  function requestView(next: 'content' | 'layout') {
    if (next === view) return;
    if ((view === 'content' && dirty) || (view === 'layout' && layoutDirty)) setPendingView(next);
    else setView(next);
  }

  return <section aria-label="스토어 전시 편집기" className="admin-store-editor" data-full-preview={fullPreview}>
    <header className="admin-store-editor__toolbar">
      <div><h2>스토어 전시관리</h2><span>홈 큐레이션</span></div>
      <div aria-label="미리보기 기기" className="admin-store-editor__devices" role="group">
        <button aria-pressed={device === 'mobile' && !fullPreview} onClick={() => { setDevice('mobile'); setFullPreview(false); }} type="button">모바일</button>
        <button aria-pressed={device === 'desktop' && !fullPreview} onClick={() => { setDevice('desktop'); setFullPreview(false); }} type="button">PC</button>
        <button aria-pressed={fullPreview} onClick={() => { setDevice('desktop'); setFullPreview((value) => !value); }} type="button">{fullPreview ? '편집으로 돌아가기' : '전체보기'}</button>
      </div>
      <MarketingLinkIssuer source="home" targetIds={['home']} label="스토어 홈 마케팅 링크" />
      <Link href="/" target="_blank">스토어 보기 ↗</Link>
    </header>
    {homeLayout && homeLayoutOperationId ? <nav className="admin-store-editor__view-tabs" aria-label="전시 편집 방식">
      <button aria-pressed={view === 'content'} onClick={() => requestView('content')} type="button">구성 편집</button>
      <button aria-pressed={view === 'layout'} onClick={() => requestView('layout')} type="button">영역 순서·노출</button>
    </nav> : null}
    {savedMessage && view === 'content' ? <p className="admin-store-editor__saved" role="status">{savedMessage}</p> : null}
    {layoutSavedMessage && view === 'layout' ? <p className="admin-store-editor__saved" role="status">{layoutSavedMessage}</p> : null}
    {view === 'content' ? <div className="admin-store-editor__workspace">
      <aside className="admin-store-editor__composition" aria-label="홈 구성 목록">
        <div className="admin-store-editor__composition-heading"><h3>스토어 홈</h3><span>{records.length}개 구성</span></div>
        <p className="admin-store-editor__dialog-copy">프로모션 배너 {heroCount} / {HOME_HERO_LIMIT}개 · 비노출 포함</p>
        <p className="admin-store-editor__dialog-copy">자유상품 {freeProductCount} / {HOME_FREE_PRODUCT_LIMIT}개 · 모자이크·비노출·종료 포함</p>
        <nav aria-label="홈 구성 바로가기">
          <Link href="/admin/settings/store">기본정보</Link><Link href="/admin/catalog/categories">카테고리</Link><Link href="/admin/display/campaigns">기획전</Link>
        </nav>
        <ul className="admin-store-editor__list">
          {ordered.map((record) => <li key={record.id}>
            <button aria-current={selected?.id === record.id ? 'true' : undefined} className="admin-curation-record-button" onClick={() => requestSelection({ id: record.id })} type="button">
              <span className="admin-store-editor__record-top"><strong>{CURATION_KIND_LABELS[record.kind]}</strong><span data-active={record.status === 'active'}>{CURATION_STATUS_LABELS[record.status]}</span></span>
              <span className="admin-curation-record-title">{record.title || '제목 없는 배너'}</span>
              <span className="admin-curation-record-meta">순서 {record.displayOrder} · {curationKstInput(record.activeFrom).replace('T', ' ')} KST</span>
            </button>
          </li>)}
        </ul>
        {records.length === 0 ? <p className="admin-store-editor__empty">등록된 홈 큐레이션이 없습니다.</p> : null}
        <button className="admin-store-editor__add" onClick={() => setAdding(true)} type="button">＋ 구성 추가</button>
        <ArchivedHeroBanners onRestored={() => setSavedMessage('배너 복구 요청을 처리했습니다. 현재 목록과 노출 설정을 확인해주세요.')} />
      </aside>
      <CurationForm
        draftActiveFrom={draftSeed.draftActiveFrom} draftId={draftSeed.draftId} eventOptions={eventOptions} goodOptions={goodOptions}
        initialKind={initialKind} ipOptions={ipOptions} key={`${getCurationFormKey(selected, draftSeed.draftId)}:${draftVersion}`}
        onDirty={() => { setDirty(true); setSavedMessage(''); }}
        dirty={dirty} onDeleted={() => { setSavedMessage('배너 삭제 요청을 처리했습니다. 현재 목록을 확인해주세요.'); applySelection({ id: null }); }}
        onSaved={(id) => { setDirty(false); setSavedMessage('홈 큐레이션을 저장했습니다.'); onSelect({ id }); }}
        operationId={selected ? operationId : draftSeed.operationId} preview={preview} selected={selected} device={device} heroCount={heroCount} freeProductCount={freeProductCount}
      />
    </div> : homeLayout && homeLayoutOperationId ? <CurationLayoutEditor
      key={`${homeLayout.revision}:${homeLayoutOperationId}`} layout={homeLayout} operationId={homeLayoutOperationId}
      preview={preview} records={records} device={device} onDirty={() => { setLayoutDirty(true); setLayoutSavedMessage(''); }} onSaved={(message) => { setLayoutDirty(false); setLayoutSavedMessage(message); }}
    /> : null}
    {adding ? <CurationEditorDialog title="홈 구성 추가" onClose={() => setAdding(false)}>
      <div className="admin-store-editor__kind-grid">{CURATION_KIND_ORDER.filter((kind) => !['featured_ip', 'announcement'].includes(kind)).map((kind) => {
        const limited = (kind === 'hero' && heroCount >= HOME_HERO_LIMIT) || (isFreeProductKind(kind) && freeProductCount >= HOME_FREE_PRODUCT_LIMIT);
        return <button disabled={limited} key={kind} onClick={() => requestSelection({ id: null, kind })} type="button"><strong>{CURATION_KIND_LABELS[kind]}</strong><span>{limited ? '등록 한도에 도달했습니다. 기존 구성을 수정해주세요.' : KIND_HELP[kind]}</span></button>;
      })}</div>
      <footer><button onClick={() => setAdding(false)} type="button">취소</button></footer>
    </CurationEditorDialog> : null}
    {pendingSelection ? <CurationEditorDialog title="변경사항을 저장하지 않고 이동할까요?" onClose={() => setPendingSelection(null)}>
      <p className="admin-store-editor__dialog-copy">아직 적용하지 않은 입력 내용은 사라집니다.</p>
      <footer><button onClick={() => setPendingSelection(null)} type="button">계속 편집</button><button onClick={() => applySelection(pendingSelection)} type="button">변경 취소하고 이동</button></footer>
    </CurationEditorDialog> : null}
    {pendingView ? <CurationEditorDialog title="변경사항을 저장하지 않고 이동할까요?" onClose={() => setPendingView(null)}>
      <p className="admin-store-editor__dialog-copy">현재 편집 방식에서 적용하지 않은 변경사항은 사라집니다.</p>
      <footer><button onClick={() => setPendingView(null)} type="button">계속 편집</button><button onClick={() => { setDirty(false); setLayoutDirty(false); setSavedMessage(''); setView(pendingView); setPendingView(null); }} type="button">변경 취소하고 이동</button></footer>
    </CurationEditorDialog> : null}
  </section>;
}

function CurationInput({ label, error, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string }) {
  const id = useId();
  return <AdminField error={error} inputId={id} label={label}><input {...props} aria-describedby={error ? `${id}-error` : undefined} aria-invalid={Boolean(error)} className="admin-field-control" id={id} /></AdminField>;
}
function CurationSelect({ label, error, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { label: string; error?: string; children: ReactNode }) {
  const id = useId();
  return <AdminField error={error} inputId={id} label={label}><select {...props} aria-describedby={error ? `${id}-error` : undefined} aria-invalid={Boolean(error)} className="admin-field-control" id={id}>{children}</select></AdminField>;
}

function CurationCountedText({ name, label, value, onChange, limit, error, multiline = false, required = false }: {
  name: string; label: string; value: string; onChange: (value: string) => void; limit: number; error?: string; multiline?: boolean; required?: boolean;
}) {
  const id = useId();
  const common = { id, name, value, required, onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(event.target.value),
    className: 'admin-field-control', 'aria-invalid': Boolean(error), 'aria-describedby': `${id}-count${error ? ` ${id}-error` : ''}` };
  return <AdminField inputId={id} label={label} error={error}>
    {multiline ? <textarea {...common} rows={3} /> : <input {...common} />}
    <small id={`${id}-count`}>{Array.from(value).length} / {limit}자</small>
  </AdminField>;
}

function CurationForm({
  draftActiveFrom, draftId, eventOptions, goodOptions, initialKind, ipOptions, onDirty, onSaved, operationId, preview, selected, device, heroCount, freeProductCount, dirty, onDeleted,
}: {
  draftActiveFrom: string; draftId: string; eventOptions: AdminCurationTargetRecord[]; goodOptions: AdminCurationTargetRecord[];
  initialKind: AdminCurationKind; ipOptions: AdminCurationTargetRecord[]; onDirty: () => void; onSaved: (id: string) => void;
  operationId: string; preview: CurationPublicPreview; selected: AdminCurationRecord | null; device: CurationPreviewDevice;
  heroCount: number;
  freeProductCount: number;
  dirty: boolean;
  onDeleted: () => void;
}) {
  const router = useRouter();
  const [values, setValues] = useState(() => createCurationEditorValues(selected, draftActiveFrom, initialKind));
  const [kind, setKind] = useState<AdminCurationKind>(selected?.kind ?? initialKind);
  /* 운영자가 직접 고친 칸 — 새 구성에서 영역을 바꿔도 이 칸은 새 종류의 시작값으로 덮지 않는다. */
  const [touched, setTouched] = useState<ReadonlySet<keyof CurationEditorValues>>(() => new Set());
  const [picker, setPicker] = useState(false);
  const [saveOperationId] = useState(operationId);
  const [previewScope, setPreviewScope] = useState<'draft' | 'public'>('draft');
  const fixedRequest = useRef<FormData | null>(null);
  const [state, action, pending] = useActionState(async (previous: AdminCurationActionState, formData: FormData) => {
    fixedRequest.current ??= formData;
    let result: AdminCurationActionState;
    try { result = await upsertAdminCurationAction(previous, fixedRequest.current); }
    catch { result = { errors: { form: '저장 결과를 확인하지 못했습니다. 같은 요청 결과를 확인해주세요.' }, uncertain: true }; }
    if (result.message && !result.errors) {
      onSaved(String(fixedRequest.current.get('id')));
      fixedRequest.current = null;
      return result;
    }
    // A denied retry cannot disprove the first request's lost commit response.
    if (previous.uncertain) return { ...result, uncertain: true, conflict: false };
    if (!result.uncertain) fixedRequest.current = null;
    return result;
  }, EMPTY_STATE);
  const id = selected?.id ?? draftId;
  const productLimit = kind === 'product_collection' ? HOME_PRODUCT_CANDIDATE_LIMIT : kind === 'review_best' ? HOME_REVIEW_MANUAL_LIMIT : kind === 'best_tab' ? 12 : 4;
  const [productCountMin, productCountMax] = homeProductCountRange(values.productLayout);
  const productCountValid = Number(values.productItemCount) >= productCountMin && Number(values.productItemCount) <= productCountMax;
  const targetGroups = useMemo(() => adminCurationTargetGroupsFor({ events: eventOptions, goods: goodOptions, ips: ipOptions }, selected?.linkPath ?? null), [eventOptions, goodOptions, ipOptions, selected?.linkPath]);
  const names = useMemo(() => new Map(goodOptions.map((good) => [good.id, good.title])), [goodOptions]);
  const draft = buildDraftCurationPreview(id, { ...values, kind }, preview.goods, preview.latestGoods, preview.productRankings);
  const reviewStatistics = preview.productRankings?.reviewStatistics ?? [];
  const eligibleReviewIds = new Set(eligibleHomeReviewStatistics(reviewStatistics).map((row) => row.goodId));
  const showManualProducts = kind === 'band_banner' || (kind === 'best_tab' && values.selectionMode === 'manual')
    || (kind === 'review_best' && values.reviewSelectionMode === 'manual') || kind === 'product_collection';
  const legacyKind = kind === 'featured_ip' || kind === 'announcement';
  const optionalLink = kind === 'hero' || kind === 'notice_bar';
  const heroLimitReached = kind === 'hero' && selected?.kind !== 'hero' && heroCount >= HOME_HERO_LIMIT;
  const freeProductLimitReached = isFreeProductKind(kind) && !isFreeProductKind(selected?.kind) && freeProductCount >= HOME_FREE_PRODUCT_LIMIT;
  function update<K extends keyof CurationEditorValues>(key: K, value: CurationEditorValues[K]) {
    setTouched((current) => (current.has(key) ? current : new Set(current).add(key)));
    setValues((current) => ({ ...current, [key]: value }));
    onDirty();
  }
  function textField(name: 'title' | 'subtitle' | 'badge' | 'description' | 'subcopy' | 'displayOrder' | 'activeFrom' | 'activeTo', label: string, extra: InputHTMLAttributes<HTMLInputElement> = {}) {
    return <CurationInput {...extra} error={state.errors?.[name]} label={label} name={name} onChange={(event) => update(name, event.target.value)} value={values[name]} />;
  }

  return <>
    <form action={action} className="admin-store-editor__form wc-admin-kit" aria-label="홈 구성 편집" onReset={(event) => event.preventDefault()} onSubmit={(event) => {
      event.preventDefault();
      const formData = fixedRequest.current ?? new FormData(event.currentTarget);
      startTransition(() => action(formData));
    }}>
      <input name="operationId" type="hidden" value={saveOperationId} /><input name="id" type="hidden" value={id} />
      <input name="expectedUpdatedAt" type="hidden" value={selected?.updatedAt ?? ''} />
      <input name="originalTitle" type="hidden" value={selected?.kind === 'hero' ? selected.title : ''} />
      <input name="originalSubtitle" type="hidden" value={selected?.kind === 'hero' && typeof selected.payload?.subtitle === 'string' ? encodeURIComponent(selected.payload.subtitle) : ''} />
      <header><div><h3>{CURATION_KIND_LABELS[kind]} {selected ? '관리' : '추가'}</h3><p>{KIND_HELP[kind]}</p></div></header>
      <fieldset disabled={pending || state.uncertain || state.conflict}>
        <section className="admin-store-editor__form-section">
          <h4>기본 설정</h4>
          <CurationSelect error={state.errors?.kind} label="홈에 보일 영역" name="kind" onChange={(event) => {
            const next = event.target.value as AdminCurationKind;
            /* 새 구성은 바꾼 종류의 시작값(새 띠배너는 상품 목록 제외, 새 공지 바는 링크 없음·전 화면)을 손대지 않은 칸에 다시 적용한다. */
            const adjusted = curationValuesForKindChange(values, next, { isNew: !selected, touched, draftActiveFrom });
            setKind(next);
            setValues(next === 'hero' && selected?.kind !== 'hero' ? { ...adjusted, imageDim: 'none', textColor: 'white' } : adjusted);
            onDirty();
          }} value={kind}>
            {CURATION_KIND_ORDER.map((option) => <option disabled={(option === 'hero' && selected?.kind !== 'hero' && heroCount >= HOME_HERO_LIMIT)
              || (isFreeProductKind(option) && !isFreeProductKind(selected?.kind) && freeProductCount >= HOME_FREE_PRODUCT_LIMIT)
              || Boolean(selected && selected.kind !== option && (selected.kind === 'product_collection' || option === 'product_collection'))}
              key={option} value={option}>{CURATION_KIND_LABELS[option]}</option>)}
          </CurationSelect>
          {kind === 'notice_bar' ? <>
            <CurationCountedText name="title" label="공지 문구" value={values.title} limit={NOTICE_BAR_MESSAGE_LIMIT} required error={state.errors?.title} onChange={value => update('title', value)} />
            <p>한 줄 문구로 보여줍니다. 줄바꿈은 쓸 수 없고, 화면이 좁으면 문구가 다음 줄로 넘어갑니다.</p>
          </> : kind === 'hero' ? <>
            <CurationCountedText name="title" label="제목" value={values.title} limit={HOME_HERO_TITLE_LIMIT} error={state.errors?.title} onChange={value => update('title', value)} />
            <CurationCountedText name="subtitle" label="내용" value={values.subtitle} limit={HOME_HERO_CONTENT_LIMIT} multiline error={state.errors?.subtitle} onChange={value => update('subtitle', value)} />
            <p>제목과 내용은 선택항목입니다. 새 제목은 40자, 내용은 150자·최대 3줄까지 입력합니다. 이전에 등록한 긴 문구는 그대로 유지할 수 있습니다.</p>
          </> : kind === 'product_collection'
            ? <CurationCountedText name="title" label="제목" value={values.title} limit={HOME_PRODUCT_TITLE_LIMIT} required error={state.errors?.title} onChange={value => update('title', value)} />
            : textField('title', '제목', { required: true, maxLength: ['sales_best', 'review_best', 'product_mosaic'].includes(kind) ? 15 : 120, placeholder: '제목을 입력하세요' })}
          {kind === 'editor_pick' ? <>{textField('badge', '배지 문구', { maxLength: 20 })}{textField('description', '콘텐츠 설명', { maxLength: 200 })}</> : null}
          {kind === 'band_banner' ? textField('subcopy', '기획전 설명', { maxLength: 200 }) : null}
          {kind === 'benefit' ? textField('description', '혜택 설명', { maxLength: 200 }) : null}
          {kind === 'featured_ip' ? <CurationSelect error={state.errors?.ipId} label="특집할 IP" name="ipId" onChange={(event) => update('ipId', event.target.value)} required value={values.ipId}><option value="">IP 선택</option>{ipOptions.map((ip) => <option disabled={Boolean(ip.archivedAt)} key={ip.id} value={ip.id}>{ip.archivedAt ? '[보관] ' : ''}{ip.title}</option>)}</CurationSelect> : null}
          {kind === 'best_tab' ? <CurationSelect error={state.errors?.slot} label="상품 모음 위치" name="slot" onChange={(event) => update('slot', event.target.value)} required value={values.slot}><option value="category">카테고리 BEST</option><option value="popular">인기템</option></CurationSelect> : null}
          {kind === 'product_collection' ? <input name="linkPath" type="hidden" value="" /> : kind === 'sales_best' || kind === 'review_best' || kind === 'product_mosaic' ? <input name="linkPath" type="hidden" value="/shop" />
            : <CurationSelect error={state.errors?.linkPath} label={kind === 'notice_bar' ? '버튼을 눌렀을 때 이동할 화면' : '눌렀을 때 이동할 화면'} name="linkPath" onChange={(event) => update('linkPath', event.target.value)} required={!optionalLink} value={values.linkPath}>{optionalLink ? <option value="">링크 없음</option> : null}{targetGroups.map((group) => <optgroup key={group.label} label={group.label}>{group.options.map((option) => <option key={option.path} value={option.path}>{option.label}</option>)}</optgroup>)}</CurationSelect>}
          {kind === 'notice_bar' && values.linkPath ? <>
            <CurationCountedText name="ctaLabel" label="버튼 문구" value={values.ctaLabel} limit={NOTICE_BAR_CTA_LIMIT} required error={state.errors?.ctaLabel} onChange={value => update('ctaLabel', value)} />
            <p>문구 옆 버튼으로 보입니다. 링크 없음을 고르면 버튼 없이 문구와 닫기만 보입니다.</p>
          </> : null}
        </section>
        {!IMAGE_FREE.has(kind) ? <section className="admin-store-editor__form-section">
          <h4>이미지 관리</h4>
          <ArtworkUploadField allowRemove={!IMAGE_REQUIRED.has(kind)} currentPath={values.imagePath || null} currentUrl={values.imageUrl} helpText={ARTWORK_HELP[kind]} kind="curation" label="PC 이미지" onPathChange={(path) => update('imagePath', path)} onPreviewChange={(url) => update('imageUrl', url)} showCropGuide={false} showPath={false} />
          <ErrorText>{state.errors?.imagePath}</ErrorText>
          {kind === 'hero' || kind === 'notice_strip' ? <><ArtworkUploadField allowRemove currentPath={values.mobileImagePath || null} currentUrl={values.mobileImageUrl} fieldId="curation-mobile" helpText="등록하지 않으면 PC 이미지를 사용합니다." kind="curation" label="모바일 이미지" name="mobileImagePath" onPathChange={(path) => update('mobileImagePath', path)} onPreviewChange={(url) => update('mobileImageUrl', url)} showCropGuide={false} showPath={false} /><ErrorText>{state.errors?.mobileImagePath}</ErrorText></> : null}
        </section> : <input name="imagePath" type="hidden" value={isFreeProductKind(kind) || kind === 'notice_bar' ? '' : values.imagePath} />}
        {kind === 'product_collection' ? <section className="admin-store-editor__form-section">
          <h4>디자인과 사진</h4>
          <CurationSelect name="productLayout" label="디자인 유형" error={state.errors?.productLayout} value={values.productLayout} onChange={event => update('productLayout', event.target.value as HomeProductLayout)}>
            <option value="list">리스트형</option><option value="full_image">풀이미지형</option>
          </CurationSelect>
          <CurationSelect name="productImageShape" label="상품 사진 비율" error={state.errors?.productImageShape} value={values.productImageShape} onChange={event => update('productImageShape', event.target.value as HomeProductImageShape)}>
            <option value="square">정사각형 1:1</option><option value="portrait">세로직사각형 4:5</option><option value="landscape">가로직사각형 5:4</option>
          </CurationSelect>
          <CurationSelect name="productItemCount" label="전시 상품 수" error={state.errors?.productItemCount ?? (!productCountValid ? `${productCountMin}개부터 ${productCountMax}개까지 다시 선택해주세요.` : undefined)} value={values.productItemCount} onChange={event => update('productItemCount', event.target.value)}>
            {!productCountValid ? <option value={values.productItemCount}>{values.productItemCount}개 · 새 개수를 선택해주세요</option> : null}
            {Array.from({ length: productCountMax - productCountMin + 1 }, (_, index) => index + productCountMin).map(count => <option value={count} key={count}>{count}개</option>)}
          </CurationSelect>
          <p>상품 대표이미지의 가운데를 기준으로 잘라 표시합니다. 풀이미지형은 PC 2열·모바일 1열입니다. 사진 비율은 이 구성에만 적용됩니다.</p>
          <p>선택한 목록에서 공개 가능한 상품부터 설정한 개수까지 표시합니다. 상품이 없으면 제목을 포함해 영역 전체를 숨깁니다. 품절 상품은 품절 표시와 함께 전시하며, 매출이 없어도 직접 선택한 상품은 표시합니다.</p>
          <p>상품을 누르면 해당 상품 상세로 이동합니다. 디자인이나 전시 개수를 바꿔도 아래 후보 목록은 유지됩니다.</p>
        </section> : null}
        {kind === 'hero' ? <section className="admin-store-editor__form-section">
          <h4>딤과 텍스트 색상</h4>
          <CurationSelect name="imageDim" label="이미지 딤처리" error={state.errors?.imageDim} value={values.imageDim} onChange={event => update('imageDim', event.target.value as HomeHeroImageDim | '')}>
            {selected && !selected.payload?.image_dim ? <option value="">기존 표시 유지</option> : null}
            <option value="none">적용안함</option><option value="white">흰색</option><option value="black">검정색</option>
          </CurationSelect>
          <CurationSelect name="textColor" label="텍스트 색상" error={state.errors?.textColor} value={values.textColor} onChange={event => update('textColor', event.target.value as HomeHeroTextColor | '')}>
            {selected && !selected.payload?.text_color ? <option value="">기존 흰색 유지</option> : null}
            <option value="white">흰색</option><option value="black">검정색</option>
          </CurationSelect>
          <p>흰색·검정색 딤은 이미지 전체에 35%로 적용됩니다. 적용안함을 선택하면 기존 그라데이션도 사라집니다.</p>
          {values.imageDim === '' ? <p>기존 표시 유지에서는 문구가 있을 때 하단 그라데이션을 그대로 보여줍니다.</p> : null}
        </section> : null}
        {kind === 'hero' ? <section className="admin-store-editor__form-section">
          <h4>이미지 대체텍스트</h4>
          <p>이미지 안에 있는 문구나 의미를 스크린리더에 전달합니다. 화면에 보이는 제목·내용과 별도로 입력합니다.</p>
          <CurationSelect name="altEnabled" label="대체텍스트 설정" error={state.errors?.altEnabled} value={values.altEnabled ? 'on' : 'off'} onChange={event => update('altEnabled', event.target.value === 'on')}>
            <option value="off">설정 안함</option><option value="on">설정함</option>
          </CurationSelect>
          {values.altEnabled ? <>
            <CurationCountedText name="altTitle" label="대체텍스트 제목" value={values.altTitle} limit={HOME_HERO_TITLE_LIMIT} error={state.errors?.altTitle} onChange={value => update('altTitle', value)} />
            <CurationCountedText name="altContent" label="대체텍스트 내용" value={values.altContent} limit={HOME_HERO_CONTENT_LIMIT} multiline error={state.errors?.altContent} onChange={value => update('altContent', value)} />
          </> : null}
        </section> : null}
        {kind === 'product_mosaic' ? <CurationMosaicFields title={values.mosaicTitle} subtitle={values.mosaicSubtitle} slots={values.mosaicSlots} imageUrls={values.mosaicImageUrls}
          options={goodOptions} goods={preview.goods} error={state.errors?.mosaic}
          onTitle={value => update('mosaicTitle', value)} onSubtitle={value => update('mosaicSubtitle', value)}
          onSlots={value => update('mosaicSlots', value)} onImages={value => update('mosaicImageUrls', value)} /> : null}
        {kind === 'sales_best' ? <section className="admin-store-editor__form-section">
          <h4>판매량 자동 선정</h4>
          <CurationSelect error={state.errors?.salesExposure} label="베스트 노출 방식" name="salesExposure" onChange={(event) => update('salesExposure', event.target.value as 'single' | 'all')} value={values.salesExposure}>
            <option value="single">1개 베스트 유형 선택 노출</option><option value="all">4개 베스트 유형 모두 노출</option>
          </CurationSelect>
          <CurationSelect error={state.errors?.salesPeriod} label={values.salesExposure === 'all' ? '기본 베스트 유형' : '베스트 유형'} name="salesPeriod" onChange={(event) => update('salesPeriod', event.target.value as HomeSalesPeriod)} value={values.salesPeriod}>
            {HOME_SALES_PERIODS.map((period) => <option key={period} value={period}>{HOME_SALES_PERIOD_LABELS[period]} 베스트</option>)}
          </CurationSelect>
          <p>실시간은 오늘, 일간은 어제, 주간·월간은 어제까지 7일·30일을 한국시간으로 집계합니다. 확인된 결제 승인시각 기준 판매수량순이며 구매확정 전 결제도 포함합니다.</p>
          <p>취소·반품 완료 주문과 비노출 상품은 제외하고 품절 상품은 포함합니다. 같은 판매수량은 찜수·등록일순으로 정렬합니다. 부족하면 찜한 상품으로 보충하며 판매·찜이 모두 없으면 채우지 않습니다.</p>
          {values.salesExposure === 'all' ? <p>네 가지 유형을 모두 표시하고 선택한 기본 유형이 먼저 열립니다. 해당 기간에 상품이 없으면 빈 상태로 안내합니다.</p> : null}
        </section> : null}
        {kind === 'review_best' ? <section className="admin-store-editor__form-section">
          <h4>리뷰 상품 선정</h4>
          <CurationSelect error={state.errors?.reviewSelectionMode} label="리뷰 상품 선정 방식" name="reviewSelectionMode" onChange={(event) => update('reviewSelectionMode', event.target.value as 'rating' | 'manual')} value={values.reviewSelectionMode}>
            <option value="rating">평점순 자동등록</option><option value="manual">직접등록</option>
          </CurationSelect>
          <p>공개 리뷰 평균평점이 3점 이상인 상품만 전시합니다. 자동등록은 어제까지 7일간 리뷰가 작성된 상품 중 평균평점·최근 리뷰순 상위 6개를 표시합니다.</p>
          <p>직접등록은 선택한 순서대로 최대 20개를 표시합니다. 상품별 대표 후기는 공개 후기 중 별점·최신 작성순으로 선정하며, 삭제·블라인드하면 바로 다시 선정합니다.</p>
          <p>노출 가능한 상품이 4개 미만이면 영역 전체를 숨깁니다. 상품 비노출이나 리뷰 삭제·블라인드 후에도 같은 조건이 적용됩니다.</p>
        </section> : null}
        {kind === 'best_tab' || kind === 'band_banner' || showManualProducts ? <section className="admin-store-editor__form-section">
          {kind === 'best_tab' ? <>
            <CurationSelect error={state.errors?.selectionMode} label="상품 선정 방식" name="selectionMode" onChange={(event) => update('selectionMode', event.target.value as 'manual' | 'latest')} value={values.selectionMode}>
              <option value="manual">직접 선택</option><option value="latest">최신 등록순 자동</option>
            </CurationSelect>
            {values.selectionMode === 'latest' ? <>
              <CurationSelect error={state.errors?.itemCount} label="전시 상품 수" name="itemCount" onChange={(event) => update('itemCount', event.target.value)} value={values.itemCount}>
                {Array.from({ length: 8 }, (_, index) => index + 3).map((count) => <option key={count} value={count}>{count}개</option>)}
              </CurationSelect>
              <p>공개된 상품을 등록일이 최근인 순서로 자동 전시합니다. 상품이 추가되거나 비노출로 바뀌면 목록도 바뀝니다. 전시 가능한 상품이 설정 수보다 적으면 있는 상품만 표시합니다.</p>
            </> : null}
          </> : null}
          {showManualProducts ? <>
          <div className="admin-store-editor__section-title"><h4>전시할 상품 <span>{values.goodIds.length} / {productLimit}</span></h4><button onClick={() => setPicker(true)} type="button">상품 추가</button></div>
          <input name="goodIds" type="hidden" value={values.goodIds.join(', ')} />
          <p>선택한 순서대로 전시합니다. {kind === 'review_best' ? '공개 평점 3점 미만이거나 비노출인 상품은 자동으로 제외합니다.' : '비노출 상품은 공개 홈에 표시되지 않습니다.'}</p>
          <ol className="admin-store-editor__selected-products">{values.goodIds.map((goodId, index) => <li key={`${goodId}-${index}`}><span className="admin-store-editor__product-number">{index + 1}</span><span><strong>{names.get(goodId) ?? '현재 선택 상품'}</strong><small>{goodId}</small></span><div><button aria-label={`${names.get(goodId) ?? goodId} 위로`} disabled={index === 0} onClick={() => update('goodIds', moveCurationProduct(values.goodIds, index, -1))} type="button">↑</button><button aria-label={`${names.get(goodId) ?? goodId} 아래로`} disabled={index === values.goodIds.length - 1} onClick={() => update('goodIds', moveCurationProduct(values.goodIds, index, 1))} type="button">↓</button><button aria-label={`${names.get(goodId) ?? goodId} 삭제`} onClick={() => update('goodIds', values.goodIds.filter((_, current) => current !== index))} type="button">×</button></div></li>)}</ol>
          {values.goodIds.length === 0 ? <p className="admin-store-editor__empty">선택한 상품이 없습니다.</p> : null}<ErrorText>{state.errors?.goodIds}</ErrorText>
          </> : null}
        </section> : null}
        {isShellNoticeKind(kind) ? <section className="admin-store-editor__form-section">
          <h4 id={`${id}-page-types`}>공지를 보일 화면</h4>
          <input name="pageTypesField" type="hidden" value="1" />
          <div aria-labelledby={`${id}-page-types`} role="group">
            {SHELL_NOTICE_PAGE_TYPES.map((type) => <label className="admin-store-editor__enabled" key={type}>
              <input checked={values.pageTypes.includes(type)} name="pageTypes" onChange={(event) => update('pageTypes', event.target.checked
                ? SHELL_NOTICE_PAGE_TYPES.filter((option) => option === type || values.pageTypes.includes(option))
                : values.pageTypes.filter((option) => option !== type))} type="checkbox" value={type} />
              <span>{NOTICE_PAGE_TYPE_LABELS[type]}</span>
            </label>)}
          </div>
          <ErrorText>{state.errors?.pageTypes}</ErrorText>
          <p>{kind === 'notice_bar'
            ? '고른 화면의 맨 위, 상단 띠배너 위에 보입니다. 결제·마이 화면처럼 방해가 되는 곳은 빼 두세요.'
            : '고른 화면의 상단에 보입니다. 새로 만드는 띠배너는 상품 목록을 빼고 시작합니다.'} 노출 종료 시각이 되면 이미 열려 있는 화면에서도 사라집니다. 적용한 변경(문구·노출안함 등)과 예약한 노출 시작은 새로 여는 화면부터 보이며, 예약 시작은 최대 10분가량 늦게 나타날 수 있습니다.</p>
        </section> : null}
        <section className="admin-store-editor__form-section">
          <h4>노출 설정</h4>
          <label className="admin-store-editor__enabled"><span>홈 노출</span><input checked={values.enabled} name="enabled" onChange={(event) => update('enabled', event.target.checked)} type="checkbox" />{values.enabled ? '노출함' : '노출안함'}</label>
          {textField('displayOrder', '같은 영역 안의 노출 순서', { min: 0, step: 1, type: 'number', required: true })}
          {textField('activeFrom', '노출 시작 (KST)', { type: 'datetime-local', required: true })}
          {textField('activeTo', '노출 종료 (KST, 선택)', { type: 'datetime-local' })}
        </section>
      </fieldset>
      <footer className="admin-store-editor__form-footer"><ActionNotice state={state} />
        {heroLimitReached ? <p role="alert">프로모션 배너는 비노출을 포함해 최대 10개까지 등록합니다. 기존 배너를 수정해주세요.</p> : null}
        {freeProductLimitReached ? <p role="alert">자유상품은 모자이크·비노출·종료를 포함해 합계 5개까지 등록합니다. 기존 구성을 수정해주세요.</p> : null}
        <button className="admin-store-editor__primary" disabled={pending || state.conflict || heroLimitReached || freeProductLimitReached} type="submit">{pending ? '적용 중…' : state.uncertain ? '같은 요청 결과 확인' : '이 구성 적용하기'}</button>
        {state.conflict ? <button type="button" onClick={() => router.refresh()}>입력을 취소하고 최신 저장본 불러오기</button> : null}
        {selected?.kind === 'hero' ? <HeroBannerDeleteButton target={selected} dirty={dirty}
          disabled={pending || Boolean(state.uncertain) || Boolean(state.conflict)} onDeleted={onDeleted} /> : null}
        <Link className="admin-curation-notification-cta" href="/admin/messaging/notifications">인앱 공지 발송</Link></footer>
    </form>
    <aside className="admin-store-editor__preview" aria-label="스토어 미리보기">
      <header><h3>미리보기</h3><select aria-label="미리보기 범위" onChange={(event) => setPreviewScope(event.target.value as 'draft' | 'public')} value={previewScope}><option value="draft">편집 중인 구성</option><option value="public">현재 공개 홈</option></select><span>{device === 'mobile' ? '390px' : '1212px'}</span></header>
      {previewScope === 'draft' ? <div className="admin-store-editor__preview-note"><span>편집 중인 내용입니다. 적용하면 노출 설정에 따라 반영됩니다.</span>{!values.enabled ? <strong>현재 비노출로 설정되어 있습니다.</strong> : null}{draft.missingGoodIds.length && showManualProducts ? <strong>비노출 또는 없는 상품 {draft.missingGoodIds.length}개는 미리보기에 표시되지 않습니다.</strong> : null}{kind === 'benefit' && !preview.cardRewardsEnabled ? <strong>카드 리워드가 비활성 상태여서 혜택 타일은 노출되지 않습니다.</strong> : null}
        {isShellNoticeKind(kind) && !values.pageTypes.includes('home') ? <strong>홈이 노출 화면에 없어 공개 홈에서는 보이지 않습니다. 미리보기는 모양만 보여줍니다.</strong> : null}
        {kind === 'sales_best' && !preview.productRankings?.salesAvailable ? <strong>판매량을 불러오지 못했습니다. 새로고침 후 다시 확인해주세요.</strong> : null}
        {kind === 'review_best' ? !preview.productRankings?.reviewsAvailable ? <strong>리뷰 평점을 불러오지 못했습니다. 새로고침 후 다시 확인해주세요.</strong> : draft.reviewEligibleCount < 4 ? <strong>노출 가능한 리뷰 상품 {draft.reviewEligibleCount}개 · 4개 이상이어야 영역이 표시됩니다.</strong> : <span>노출 가능한 리뷰 상품 {draft.reviewEligibleCount}개</span> : null}
      </div> : null}
      {previewScope === 'draft' && legacyKind ? <p className="admin-store-editor__empty">{KIND_HELP[kind]}</p> : <CurationPreview cardRewardsEnabled={preview.cardRewardsEnabled} curation={previewScope === 'public' ? preview.curation : draft.curation} device={device} noticeBar={previewScope === 'public' ? preview.noticeBar ?? null : draft.noticeBar} noticeStrip={previewScope === 'public' ? preview.noticeStrip : draft.noticeStrip} />}
    </aside>
    {picker ? <CurationProductPicker goods={preview.goods} limit={productLimit} onApply={(ids) => { update('goodIds', ids); setPicker(false); }} onClose={() => setPicker(false)} options={kind === 'review_best' ? goodOptions.filter((good) => eligibleReviewIds.has(good.id)) : goodOptions} reviewStatistics={kind === 'review_best' ? reviewStatistics : undefined} selectedIds={values.goodIds} /> : null}
  </>;
}
