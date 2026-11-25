'use client';
import Link from 'next/link';
import { useLayoutEffect, useRef, useState, useTransition, type FormEvent, type ReactNode } from 'react';
import { resolveGoodsAnnouncementSaveAction, saveGoodsAnnouncementAction, type GoodsAnnouncementActionState } from '@/app/admin/goods-announcement-actions';
import { announcementKstInput, GOODS_ANNOUNCEMENT_CATEGORIES, GOODS_ANNOUNCEMENT_CHECK_LABEL, GOODS_ANNOUNCEMENT_DEVICES, GOODS_ANNOUNCEMENT_GOOD_LIMIT, GOODS_ANNOUNCEMENT_PLACEMENTS,
  GOODS_ANNOUNCEMENT_POPUP_CONFIRM, GOODS_ANNOUNCEMENT_RETRY_LABEL, GOODS_ANNOUNCEMENT_UNKNOWN_MESSAGE, GOODS_ANNOUNCEMENTS_PATH, goodsAnnouncementOutcome,
  type GoodsAnnouncement, type GoodsAnnouncementDevice, type GoodsAnnouncementPlacement } from '@/lib/admin/goods-announcements';
import { sanitizeGoodsDescription } from '@/lib/goods-description';
import { GoodsDescription } from '@/components/shop/GoodsDescription';
import { createGoodsAnnouncementPendingSave, goodsAnnouncementPendingForm, goodsAnnouncementPendingRows,
  parseGoodsAnnouncementPendingSave, retainGoodsAnnouncementPendingSave, type GoodsAnnouncementPendingSave } from '@/lib/admin/goods-announcement-pending';
import { adminConfirm } from '@/lib/admin/confirm';
import { ADMIN_LEAVE_RECOVERABLE_MESSAGE } from '@/lib/admin/leave-guard';
import { useCsEditorDraft } from '../useCsEditorDraft';
import { useAdminLeaveGuard } from '../useAdminLeaveGuard';
import { AdminNotice, AdminPageHeader } from '../console/AdminKit';
import { AdminSelect } from '../console/AdminSelect';
import { GoodChoiceCard } from '../GoodEditorParts';
import { Button, buttonVariants } from '../kit/ui/button';
import { Input } from '../kit/ui/input';
import { Textarea } from '../kit/ui/textarea';
import { CustomerServiceDialog } from './CustomerServiceDialog';
import { GoodsAnnouncementProductPicker } from './GoodsAnnouncementProductPicker';

const EMPTY: GoodsAnnouncementActionState = {};
/* 스마트스토어 공지 등록의 행 구성(라벨 | 입력)을 kit 카드 안에 그린다(템플릿 룩, ADR-0028). */
const INLINE = 'flex flex-wrap items-center gap-x-4 gap-y-2';
const CHOICE = 'inline-flex cursor-pointer items-center gap-2 text-sm';
/* 선택 카드 줄(GoodChoiceCards와 같은 격자). 칸 이름은 왼쪽 라벨이 맡아 legend를 한 번 더 두지 않는다. */
const CARDS = 'grid min-w-0 gap-2 [grid-template-columns:repeat(auto-fit,minmax(min(100%,13rem),1fr))]';
const PERIOD = 'flex flex-wrap items-end gap-3';
const PERIOD_FIELD = 'flex min-w-0 flex-col gap-1.5 text-xs font-medium text-muted-foreground';
const NOTE = 'text-sm text-muted-foreground';
/* 선택지마다 고르면 어떻게 보이는지 한 줄. 설명 문단 대신 카드가 말한다(docs/admin-screen-rules.md '글보다 화면'). 이름만으로 알 수 있는 선택지에는 적지 않는다. */
const DEVICE_NOTES: Partial<Record<GoodsAnnouncementDevice, string>> = { pc: 'PC처럼 넓은 화면에서만 보입니다.', mobile: '휴대폰처럼 좁은 화면에서만 보입니다.' };
const PLACEMENT_NOTES: Record<GoodsAnnouncementPlacement, string> = { top: '상품 상세의 탭 위에 보입니다.', bottom: '상세정보 탭의 상세설명 바로 아래에 보입니다.' };
type ImportantMode = 'off' | 'always' | 'period';
const IMPORTANT_CARDS: readonly { value: ImportantMode; title: string; description?: string }[] = [
  { value: 'off', title: '안 함' },
  { value: 'always', title: '계속', description: '‘중요’ 표시가 붙고 일반 공지보다 위에 보입니다.' },
  { value: 'period', title: '기간 동안만', description: '정한 기간에만 중요 공지이고, 그 밖에는 일반 공지입니다.' },
];
/* 중요 공지 카드의 라디오 이름. 화면에서 고르기 위한 값이라 저장할 때는 빼고, 숨은 칸 important·useImportantPeriod가 실제 값을 싣는다. */
const IMPORTANT_MODE_FIELD = 'importantMode';

function Field({ label, htmlFor, error, children }: { label: string; htmlFor?: string; error?: string; children: ReactNode }) {
  return <div className="grid gap-2.5 border-b px-4 py-4 last:border-b-0 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-5 sm:px-5" data-announcement-field=""><label className="text-sm font-medium sm:pt-1.5" htmlFor={htmlFor}>{label}</label><div className="flex min-w-0 flex-col gap-2.5">{children}{error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}</div></div>;
}
/** 시작·종료 한 쌍. 세 기간(전시·중요 공지·홈 팝업)이 같은 이름과 모양을 쓴다. 부품이 아니라 함수라 화면 시험이 입력을 바로 찾는다. */
function periodFields({ label, startName, endName, start, end, onStart, onEnd, required = false }: {
  label: string; startName: string; endName: string; start: string; end: string; onStart: (value: string) => void; onEnd: (value: string) => void; required?: boolean;
}) {
  return <div className={PERIOD} role="group" aria-label={label}>
    <label className={PERIOD_FIELD}>시작 (KST)<Input className="w-56" type="datetime-local" name={startName} required={required} value={start} onChange={event => onStart(event.target.value)} /></label>
    <span aria-hidden="true" className="pb-1.5 text-muted-foreground">~</span>
    <label className={PERIOD_FIELD}>종료 (KST)<Input className="w-56" type="datetime-local" name={endName} required={required} value={end} onChange={event => onEnd(event.target.value)} /></label>
  </div>;
}
/** 상품 상세에서 공지가 놓이는 자리를 작은 그림으로 보인다. 위에서부터 고객 화면의 순서다. */
function PlacementSketch({ placement }: { placement: GoodsAnnouncementPlacement }) {
  const notice = <span className="rounded-sm bg-primary-soft px-1.5 font-medium text-primary-soft-foreground">공지</span>;
  return <span aria-hidden="true" className="flex w-full max-w-44 flex-col gap-1 rounded-md border bg-background p-1.5 text-[0.625rem] leading-4 text-muted-foreground" data-announcement-sketch={placement}>
    <span className="rounded-sm bg-muted px-1.5">상품 사진 · 가격</span>
    {placement === 'top' ? notice : null}
    <span className="border-b px-1.5">{'상세정보 · 리뷰 · Q&A 탭'}</span>
    <span className="rounded-sm bg-muted px-1.5">상세설명</span>
    {placement === 'bottom' ? notice : null}
  </span>;
}
function EditorFields({ announcement, action, pending, checking, state, backHref, uncertain, locked, canResolve, resolve, retry }: {
  announcement: GoodsAnnouncement; action: (form: FormData) => void; pending: boolean; checking: boolean; state: GoodsAnnouncementActionState; backHref: string;
  uncertain: boolean; locked: boolean; canResolve: boolean; resolve: () => void; retry: () => void;
}) {
  const [title, setTitle] = useState(announcement.title); const [body, setBody] = useState(announcement.body);
  const [format, setFormat] = useState(announcement.format); const [category, setCategory] = useState(announcement.category);
  const [device, setDevice] = useState(announcement.device); const [placement, setPlacement] = useState(announcement.placement);
  const [enabled, setEnabled] = useState(announcement.enabled);
  /* 중요 공지가 아니면 기간 칸이 없다 — 꺼 둔 채 넣은 기간이 아무 일도 하지 않는 일이 없다. 중요 공지를 끈 채 기간만 남아 있던 공지는 '안 함'으로 열리고 저장하면 기간이 지워진다. */
  const [importantMode, setImportantMode] = useState<ImportantMode>(announcement.important ? (announcement.importantStartsAt ? 'period' : 'always') : 'off');
  const [allGoods, setAllGoods] = useState(announcement.allGoods);
  const [goods, setGoods] = useState(announcement.goods); const [picker, setPicker] = useState(false); const [preview, setPreview] = useState(false);
  const [usePeriod, setUsePeriod] = useState(Boolean(announcement.startsAt || announcement.endsAt));
  const [startsAt, setStartsAt] = useState(announcementKstInput(announcement.startsAt)); const [endsAt, setEndsAt] = useState(announcementKstInput(announcement.endsAt));
  const [importantStartsAt, setImportantStartsAt] = useState(announcementKstInput(announcement.importantStartsAt));
  const [importantEndsAt, setImportantEndsAt] = useState(announcementKstInput(announcement.importantEndsAt));
  const [popupSelected, setPopupSelected] = useState(announcement.popup.selected);
  const [popupStartsAt, setPopupStartsAt] = useState(announcementKstInput(announcement.popup.startsAt));
  const [popupEndsAt, setPopupEndsAt] = useState(announcementKstInput(announcement.popup.endsAt));
  const important = importantMode !== 'off';
  const popupChanged = popupSelected !== announcement.popup.selected || popupStartsAt !== announcementKstInput(announcement.popup.startsAt) || popupEndsAt !== announcementKstInput(announcement.popup.endsAt);
  const popupIntent = popupSelected && popupChanged ? 'set' : !popupSelected && announcement.popup.selected ? 'clear' : 'preserve';
  const errors = state.errors ?? {}; const warnings = format === 'html' ? sanitizeGoodsDescription(body, { imagePaths: [] }).warnings : [];
  const outcome = goodsAnnouncementOutcome({ enabled, allGoods, goodCount: goods.length, placement, device, period: usePeriod ? { startsAt, endsAt } : null,
    popup: popupSelected ? { startsAt: popupStartsAt, endsAt: popupEndsAt } : null, popupSelectedNow: announcement.popup.selected });
  /* 결과를 모르는 저장은 이 탭에 보관되어 다시 열면 확인할 수 있다. 입력이 사라진다고 단정하지 않는다.
     칸을 고친 것은 formRef가 잡는다 — 적용 상품처럼 숨은 칸(goodIds)만 바뀌어도 값 속성이 바뀌어 미저장으로 본다(lib/admin/leave-guard의 MutationObserver). */
  const { formRef } = useAdminLeaveGuard({ dirty: uncertain, blocked: pending, message: uncertain ? ADMIN_LEAVE_RECOVERABLE_MESSAGE : undefined });
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget); form.delete(IMPORTANT_MODE_FIELD);
    /* 홈 팝업은 쇼핑몰에 하나뿐이다. 이 공지가 아직 팝업이 아닌데 켜서 저장하면 다른 공지의 팝업이 내려가므로 먼저 묻는다. */
    if (popupSelected && !announcement.popup.selected && !await adminConfirm(GOODS_ANNOUNCEMENT_POPUP_CONFIRM)) return;
    action(form);
  }
  return <form ref={formRef} onSubmit={event => { void submit(event); }} className="flex min-w-0 flex-col gap-4" aria-busy={pending}>
    <input type="hidden" name="id" value={announcement.id} /><input type="hidden" name="revision" value={announcement.revision} />
    <input type="hidden" name="goodIds" value={JSON.stringify(goods.map(good => good.id))} />
    <input type="hidden" name="important" value={String(important)} /><input type="hidden" name="usePeriod" value={String(usePeriod)} />
    <input type="hidden" name="useImportantPeriod" value={String(importantMode === 'period')} />
    <input type="hidden" name="popupIntent" value={popupIntent} /><input type="hidden" name="popupRevision" value={announcement.popup.revision} />
    <fieldset className="min-w-0 rounded-xl border bg-card text-card-foreground" disabled={pending || uncertain || locked || state.reloadRequired}>
      <Field label="공지 분류" htmlFor="announcement-category" error={errors.category}><AdminSelect id="announcement-category" name="category" value={category} onChange={event => setCategory(event.target.value as typeof category)} wrapperClassName="w-full sm:w-80">{GOODS_ANNOUNCEMENT_CATEGORIES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</AdminSelect></Field>
      <Field label="공지 제목" htmlFor="announcement-title" error={errors.title}><Input id="announcement-title" name="title" maxLength={50} required value={title} onChange={event => setTitle(event.target.value)} /><small className="text-xs text-muted-foreground tabular-nums">{title.length} / 50자</small></Field>
      <Field label="공지 내용" htmlFor="announcement-body" error={errors.format || errors.body}>
        <div className={INLINE}><label className={CHOICE}><input type="radio" name="format" value="plain" checked={format === 'plain'} onChange={() => setFormat('plain')} />직접 입력</label><label className={CHOICE}><input type="radio" name="format" value="html" checked={format === 'html'} onChange={() => setFormat('html')} />HTML</label><Button size="sm" variant="outline" onClick={() => setPreview(true)} type="button">미리보기</Button></div>
        <Textarea className="min-h-60 resize-y field-sizing-fixed" id="announcement-body" name="body" maxLength={30000} required rows={14} value={body} onChange={event => setBody(event.target.value)} />
        <small className="text-xs text-muted-foreground tabular-nums">{body.length.toLocaleString('ko-KR')} / 30,000자{format === 'html' ? ' · 쓸 수 없는 HTML 코드와 확인되지 않은 업로드 이미지는 저장할 때 지워집니다.' : ''}</small>
        {warnings.map(warning => <p className={NOTE} key={warning}>{warning}</p>)}
      </Field>
      <Field label="보이는 기기" error={errors.device}><div className={CARDS} role="radiogroup" aria-label="보이는 기기">{GOODS_ANNOUNCEMENT_DEVICES.map(item => <GoodChoiceCard key={item.value} name="device" value={item.value} checked={device === item.value} onChange={() => setDevice(item.value)} title={item.label} description={DEVICE_NOTES[item.value]} />)}</div></Field>
      <Field label="보이는 자리" error={errors.placement}><div className={CARDS} role="radiogroup" aria-label="보이는 자리">{GOODS_ANNOUNCEMENT_PLACEMENTS.map(item => <GoodChoiceCard key={item.value} name="placement" value={item.value} checked={placement === item.value} onChange={() => setPlacement(item.value)} title={item.label} description={PLACEMENT_NOTES[item.value]}><PlacementSketch placement={item.value} /></GoodChoiceCard>)}</div></Field>
      <Field label="중요 공지" error={errors.important || errors.importantPeriod || errors.importantStartsAt || errors.importantEndsAt}>
        <div className={CARDS} role="radiogroup" aria-label="중요 공지">{IMPORTANT_CARDS.map(item => <GoodChoiceCard key={item.value} name={IMPORTANT_MODE_FIELD} value={item.value} checked={importantMode === item.value} onChange={() => setImportantMode(item.value)} title={item.title} description={item.description} />)}</div>
        {importantMode === 'period' ? periodFields({ label: '중요 공지 기간', startName: 'importantStartsAt', endName: 'importantEndsAt', start: importantStartsAt, end: importantEndsAt, onStart: setImportantStartsAt, onEnd: setImportantEndsAt, required: true }) : null}
      </Field>
      <Field label="전시 여부" error={errors.enabled}><div className={INLINE}><label className={CHOICE}><input type="radio" name="enabled" value="true" checked={enabled} onChange={() => setEnabled(true)} />전시</label><label className={CHOICE}><input type="radio" name="enabled" value="false" checked={!enabled} onChange={() => setEnabled(false)} />전시중지</label></div></Field>
      <Field label="전시 기간" error={errors.startsAt || errors.endsAt}><label className={CHOICE}><input checked={usePeriod} type="checkbox" onChange={event => setUsePeriod(event.target.checked)} />기간 설정</label>
        {usePeriod ? periodFields({ label: '전시 기간', startName: 'startsAt', endName: 'endsAt', start: startsAt, end: endsAt, onStart: setStartsAt, onEnd: setEndsAt }) : null}
      </Field>
      <Field label="홈 팝업" error={errors.popup || errors.popupStartsAt || errors.popupEndsAt}>
        <label className={CHOICE}><input type="checkbox" checked={popupSelected} onChange={event => setPopupSelected(event.target.checked)} />이 공지를 홈 팝업으로 띄우기</label>
        {popupSelected ? periodFields({ label: '홈 팝업 기간', startName: 'popupStartsAt', endName: 'popupEndsAt', start: popupStartsAt, end: popupEndsAt, onStart: setPopupStartsAt, onEnd: setPopupEndsAt, required: true }) : null}
      </Field>
      <Field label="적용 상품" error={errors.allGoods || errors.goodIds}>
        <div className={CARDS} role="radiogroup" aria-label="적용 상품">
          <GoodChoiceCard name="allGoods" value="true" checked={allGoods} onChange={() => setAllGoods(true)} title="전체 상품" description="지금 공개된 상품과 앞으로 공개할 상품 모두에 보입니다." />
          <GoodChoiceCard name="allGoods" value="false" checked={!allGoods} onChange={() => setAllGoods(false)} title="선택 상품" description={`고른 상품에만 보입니다. 최대 ${GOODS_ANNOUNCEMENT_GOOD_LIMIT}개까지 고릅니다.`} />
        </div>
        {!allGoods ? <><div className={INLINE}><Button size="sm" variant="outline" type="button" onClick={() => setPicker(true)}>상품 고르기</Button><span className="text-sm text-muted-foreground tabular-nums">고른 상품 {goods.length}개</span></div><ul className="m-0 flex max-h-[300px] list-none flex-col overflow-auto rounded-lg border p-0 empty:hidden">{goods.map(good => <li className="flex items-center justify-between gap-3 border-b px-3 py-2.5 text-sm last:border-b-0" key={good.id}><span className="flex min-w-0 flex-col gap-0.5">{good.name} <small className="text-xs text-muted-foreground">{good.code}{good.archived ? ' · 보관 상품' : ''}</small></span><Button size="xs" variant="outline" aria-label={`${good.name} 빼기`} type="button" onClick={() => setGoods(items => items.filter(item => item.id !== good.id))}>빼기</Button></li>)}</ul></> : null}
      </Field>
    </fieldset>
    <div className="sticky bottom-0 z-10 flex flex-col gap-4 rounded-xl border bg-background p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between print:static" data-announcement="savebar">
      <div className="flex min-w-0 flex-col gap-1.5 text-sm">{errors.form ? <p className="text-destructive" role="alert">{errors.form}</p> : null}{state.message ? <p className="text-success" role="status">{state.message}</p> : null}{state.reloadRequired && state.savedId ? <a className="w-fit underline underline-offset-4" href={`${GOODS_ANNOUNCEMENTS_PATH}?edit=${state.savedId}`}>저장된 공지 다시 열기</a> : null}
        {/* 결과 한 줄: 지금 입력대로 저장하면 고객 화면에 어떻게 보이는지. 결과를 모르는 동안에는 화면의 칸이 앞서 저장하려던 내용과 다를 수 있고, 다시 열어야 하는 동안에는 저장할 수 없어 보이지 않는다. */}
        {!uncertain && !state.reloadRequired ? <p data-announcement="outcome">{outcome}</p> : null}
        <small className="text-xs text-muted-foreground">{announcement.reference ? `공지번호 ${announcement.reference}` : '새 공지'}</small></div>
      <div className="flex shrink-0 flex-wrap justify-end gap-2">{pending ? <Button disabled type="button">{checking ? '확인 중…' : '저장 중…'}</Button>
        : uncertain ? (canResolve ? <><Button type="button" onClick={resolve}>{GOODS_ANNOUNCEMENT_CHECK_LABEL}</Button><Button variant="outline" type="button" onClick={retry}>{GOODS_ANNOUNCEMENT_RETRY_LABEL}</Button></> : null)
        : <Button disabled={locked || state.reloadRequired} type="submit">저장</Button>}{!pending && !uncertain ? <Link className={buttonVariants({ variant: 'outline' })} data-slot="button" href={backHref}>목록</Link> : null}</div>
    </div>
    {picker ? <GoodsAnnouncementProductPicker value={goods} onClose={() => setPicker(false)}
      onSelect={good => setGoods(items => items.some(item => item.id === good.id) || items.length >= GOODS_ANNOUNCEMENT_GOOD_LIMIT ? items : [...items, good])}
      onDeselect={good => setGoods(items => items.filter(item => item.id !== good.id))} /> : null}
    {preview ? <CustomerServiceDialog title="공지 미리보기" onClose={() => setPreview(false)}><article className="flex flex-col gap-3 text-sm leading-relaxed [&_img]:h-auto [&_img]:max-w-full"><h3 className="text-base font-medium">{important ? '[중요] ' : ''}{title || '공지 제목'}</h3><GoodsDescription description={body} format={format} /></article></CustomerServiceDialog> : null}
  </form>;
}
export function GoodsAnnouncementEditor({ announcement, backHref, accountId, persistPending = true }: {
  announcement: GoodsAnnouncement; backHref: string; accountId: string;
  /** Synthetic, non-server visual fixtures only. Real routes always use session recovery. */
  persistPending?: boolean;
}) {
  const [state, setState] = useState<GoodsAnnouncementActionState>(EMPTY); const [pending, startTransition] = useTransition();
  const [uncertain, setUncertain] = useState(false);
  const [fixtureRequest, setFixtureRequest] = useState<GoodsAnnouncementPendingSave | null>(null);
  /* 지금 기다리는 일이 저장인지 확인인지. 버튼 글자만 바꾼다. */
  const [checking, setChecking] = useState(false);
  const request = useRef<{ operation: GoodsAnnouncementPendingSave; form: FormData } | null>(null);
  const busy = useRef(false), mounted = useRef(true);
  const draft = useCsEditorDraft({ accountId, scope: 'goods-announcement-save', recordId: announcement.id,
    parse: parseGoodsAnnouncementPendingSave, retainUntilResolved: retainGoodsAnnouncementPendingSave, enabled: persistPending });
  const targetKey = `${accountId}:${announcement.id}`; const activeTarget = useRef(targetKey);
  const active = () => mounted.current && activeTarget.current === targetKey && (!persistPending || draft.isActive());
  const recovered = persistPending ? draft.recovery : null;
  const stored = persistPending ? draft.value : fixtureRequest;
  const unresolved = uncertain || Boolean(recovered || stored);
  const locked = persistPending && (!draft.ready || draft.blocked);
  const current = state.saved ?? announcement;
  useLayoutEffect(() => {
    mounted.current = true; activeTarget.current = targetKey;
    return () => { mounted.current = false; };
  }, [targetKey]);
  /* 화면을 다시 열었을 때: 보관해 둔 '앞서 저장하려던 내용'을 불러오고 곧바로 저장됐는지 확인한다(누르는 것은 한 번).
     확인은 읽기만 한다. 다시 보내는 [다시 저장]은 불러온 내용이 화면에 보인 뒤에야 누를 수 있다. */
  function restoreAndCheck() {
    if (busy.current || !active()) return;
    const operation = draft.restore();
    if (!operation || operation.accountId !== accountId || operation.id !== announcement.id) {
      setUncertain(true); setState({ errors: { form: '앞서 저장하려던 내용을 읽지 못했습니다. 화면을 새로고침한 뒤 공지 내용을 확인하고 다시 저장해 주세요.' } }); return;
    }
    request.current = { operation, form: goodsAnnouncementPendingForm(operation) };
    setUncertain(true);
    execute(undefined, true);
  }
  function execute(form?: FormData, resolveOnly = false) {
    if (busy.current || !active() || state.reloadRequired) return;
    /* 불러오지 않은 보관 내용이 남아 있으면 아무것도 보내지 않는다. 방금 불러왔을 수 있어 그려진 값이 아니라 보관소의 지금 상태로 본다. */
    const snapshot = persistPending ? draft.getCurrentSnapshot() : null;
    if (snapshot?.recovery) return;
    const hadRequest = Boolean(request.current || snapshot?.value);
    if (!request.current && snapshot?.value) request.current = { operation: snapshot.value, form: goodsAnnouncementPendingForm(snapshot.value) };
    if (!request.current && form) {
      const operation = createGoodsAnnouncementPendingSave(form, accountId, announcement.id, crypto.randomUUID());
      if (!operation) { setState({ saved: state.saved, errors: { form: '저장할 내용을 읽지 못했습니다. 제목과 내용의 글자 수를 확인한 뒤 다시 저장해 주세요.' } }); return; }
      /* 이 브라우저에 보관하지 못해도 저장은 보낸다. 보관은 화면을 떠났다 돌아와 결과를 다시 확인하려는 장치일 뿐이라 저장을 막지 않는다
         (보관하지 못하면 draft.unavailable이 켜져 위쪽 한 줄이 보인다). change가 거절하는 것은 로그인 확인이 끝나지 않았거나 계정이 바뀐 때뿐이다. */
      if (persistPending && !draft.change(operation)) {
        setState({ saved: state.saved, errors: { form: '로그인 상태를 확인하지 못해 저장하지 않았습니다. 적은 내용을 복사해 두고 화면을 새로고침한 뒤 다시 저장해 주세요.' } }); return;
      }
      request.current = { operation, form: goodsAnnouncementPendingForm(operation) };
      if (!persistPending) setFixtureRequest(operation);
    }
    const fixed = request.current;
    if (!fixed || fixed.operation.accountId !== accountId || fixed.operation.id !== announcement.id) return;
    busy.current = true;
    setChecking(resolveOnly);
    setState(state.saved ? { saved: state.saved } : EMPTY);
    startTransition(async () => {
      try {
        const result = resolveOnly ? await resolveGoodsAnnouncementSaveAction(state, fixed.operation.operationId, fixed.operation.id, fixed.operation.accountId) : await saveGoodsAnnouncementAction(state, fixed.form);
        if (!active()) return;
        setState(result);
        if (result.outcome === 'saved' || (result.outcome === 'rejected' && !hadRequest)) {
          if (persistPending) draft.discard(); else setFixtureRequest(null);
          request.current = null; setUncertain(false);
        }
        else setUncertain(true);
      } catch {
        if (active()) { setState({ saved: state.saved, outcome: 'unknown', errors: { form: GOODS_ANNOUNCEMENT_UNKNOWN_MESSAGE } }); setUncertain(true); }
      }
      finally { busy.current = false; }
    });
  }
  return <section className="flex min-w-0 flex-col gap-4" data-admin-screen="goods-announcement-editor"><AdminPageHeader title={current.revision ? '상품공지사항 수정' : '상품공지사항 등록'} actions={!pending && !unresolved ? <Link className={buttonVariants({ variant: 'outline' })} data-slot="button" href={backHref}>목록</Link> : undefined} />
    {persistPending && draft.blocked ? <p className="text-sm text-destructive" role="alert">로그인 계정이 바뀌었거나 다시 로그인해서 편집을 잠갔습니다. 앞서 저장하려던 내용은 이 브라우저에서 지웠습니다. 화면을 새로고침해 주세요.</p> : <>
      {persistPending && !draft.ready ? <p className="text-sm text-muted-foreground" role="status">로그인 상태를 확인하고 있습니다.</p> : null}
      {/* 보관하지 못해도 저장은 된다. 화면을 떠났다 돌아와 결과를 다시 확인하지 못한다는 것만 알린다. */}
      {persistPending && draft.unavailable ? <p className="text-sm text-muted-foreground" role="status" data-announcement="storage-unavailable">이 브라우저에서는 저장 결과를 다시 확인할 수 없습니다.</p> : null}
      {recovered ? <AdminNotice tone="warning"><p role="status">앞서 누른 저장이 됐는지 아직 모릅니다. [{GOODS_ANNOUNCEMENT_CHECK_LABEL}]을 눌러 주세요. 로그아웃하거나 다시 로그인하면 확인할 수 없게 됩니다.</p><Button className="mt-2" size="sm" variant="outline" type="button" disabled={pending || locked} onClick={restoreAndCheck}>{GOODS_ANNOUNCEMENT_CHECK_LABEL}</Button></AdminNotice> : null}
      {/* 저장을 보내는 동안에는 접어 둔 내용을 보이지 않는다(곧 사라진다). 결과를 모를 때와 화면을 다시 연 뒤에만 보인다. */}
      {stored && (uncertain || !pending) ? <details className="rounded-lg border bg-muted/40 px-4 py-3 text-sm"><summary className="cursor-pointer font-medium">앞서 저장하려던 내용</summary><dl className="mt-3 grid gap-3">{goodsAnnouncementPendingRows(stored.entries).map(row => <div className="grid gap-1" key={row.field}><dt className="text-xs text-muted-foreground">{row.label}</dt><dd className="whitespace-pre-wrap wrap-anywhere">{row.value}</dd></div>)}</dl></details> : null}
      <EditorFields key={`${current.id}:${current.revision}`} announcement={current} action={form => execute(form)} pending={pending} checking={checking} state={state} backHref={backHref} uncertain={unresolved} locked={locked} canResolve={!locked && !recovered && Boolean(stored)} resolve={() => execute(undefined, true)} retry={() => execute()} />
    </>}
  </section>;
}
