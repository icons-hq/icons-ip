'use client';
import Link from 'next/link';
import { useLayoutEffect, useRef, useState, useTransition, type ReactNode } from 'react';
import { resolveGoodsAnnouncementSaveAction, saveGoodsAnnouncementAction, type GoodsAnnouncementActionState } from '@/app/admin/goods-announcement-actions';
import { announcementKstInput, GOODS_ANNOUNCEMENT_CATEGORIES, GOODS_ANNOUNCEMENT_DEVICES, GOODS_ANNOUNCEMENT_GOOD_LIMIT, GOODS_ANNOUNCEMENT_PLACEMENTS, GOODS_ANNOUNCEMENTS_PATH, type GoodsAnnouncement } from '@/lib/admin/goods-announcements';
import { sanitizeGoodsDescription } from '@/lib/goods-description';
import { GoodsDescription } from '@/components/shop/GoodsDescription';
import { createGoodsAnnouncementPendingSave, goodsAnnouncementPendingForm, goodsAnnouncementPendingDisplayValue, GOODS_ANNOUNCEMENT_PENDING_LABELS,
  parseGoodsAnnouncementPendingSave, retainGoodsAnnouncementPendingSave, type GoodsAnnouncementPendingSave } from '@/lib/admin/goods-announcement-pending';
import { ADMIN_LEAVE_RECOVERABLE_MESSAGE } from '@/lib/admin/leave-guard';
import { useCsEditorDraft } from '../useCsEditorDraft';
import { useAdminLeaveGuard } from '../useAdminLeaveGuard';
import { AdminNotice, AdminPageHeader } from '../console/AdminKit';
import { AdminSelect } from '../console/AdminSelect';
import { Button, buttonVariants } from '../kit/ui/button';
import { Input } from '../kit/ui/input';
import { Textarea } from '../kit/ui/textarea';
import { CustomerServiceDialog } from './CustomerServiceDialog';
import { GoodsAnnouncementProductPicker } from './GoodsAnnouncementProductPicker';

const EMPTY: GoodsAnnouncementActionState = {};
/* 스마트스토어 공지 등록의 행 구성(라벨 | 입력)을 kit 카드 안에 그린다(템플릿 룩, ADR-0028). */
const INLINE = 'flex flex-wrap items-center gap-x-4 gap-y-2';
const CHOICE = 'inline-flex cursor-pointer items-center gap-2 text-sm';
const PERIOD = 'flex flex-wrap items-end gap-3';
const PERIOD_FIELD = 'flex min-w-0 flex-col gap-1.5 text-xs font-medium text-muted-foreground';
const NOTE = 'text-sm text-muted-foreground';
function Field({ label, htmlFor, error, children }: { label: string; htmlFor?: string; error?: string; children: ReactNode }) {
  return <div className="grid gap-2.5 border-b px-4 py-4 last:border-b-0 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-5 sm:px-5" data-announcement-field=""><label className="text-sm font-medium sm:pt-1.5" htmlFor={htmlFor}>{label}</label><div className="flex min-w-0 flex-col gap-2.5">{children}{error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}</div></div>;
}
function EditorFields({ announcement, action, pending, state, backHref, uncertain, locked, canResolve, resolve, retry }: {
  announcement: GoodsAnnouncement; action: (form: FormData) => void; pending: boolean; state: GoodsAnnouncementActionState; backHref: string;
  uncertain: boolean; locked: boolean; canResolve: boolean; resolve: () => void; retry: () => void;
}) {
  const [title, setTitle] = useState(announcement.title); const [body, setBody] = useState(announcement.body);
  const [format, setFormat] = useState(announcement.format); const [category, setCategory] = useState(announcement.category);
  const [device, setDevice] = useState(announcement.device); const [placement, setPlacement] = useState(announcement.placement);
  const [enabled, setEnabled] = useState(announcement.enabled);
  const [important, setImportant] = useState(announcement.important); const [allGoods, setAllGoods] = useState(announcement.allGoods);
  const [goods, setGoods] = useState(announcement.goods); const [picker, setPicker] = useState(false); const [preview, setPreview] = useState(false);
  const [usePeriod, setUsePeriod] = useState(Boolean(announcement.startsAt || announcement.endsAt));
  const [startsAt, setStartsAt] = useState(announcementKstInput(announcement.startsAt)); const [endsAt, setEndsAt] = useState(announcementKstInput(announcement.endsAt));
  const [useImportantPeriod, setUseImportantPeriod] = useState(Boolean(announcement.importantStartsAt));
  const [importantStartsAt, setImportantStartsAt] = useState(announcementKstInput(announcement.importantStartsAt));
  const [importantEndsAt, setImportantEndsAt] = useState(announcementKstInput(announcement.importantEndsAt));
  const [popupSelected, setPopupSelected] = useState(announcement.popup.selected);
  const [popupStartsAt, setPopupStartsAt] = useState(announcementKstInput(announcement.popup.startsAt));
  const [popupEndsAt, setPopupEndsAt] = useState(announcementKstInput(announcement.popup.endsAt));
  const popupChanged = popupSelected !== announcement.popup.selected || popupStartsAt !== announcementKstInput(announcement.popup.startsAt) || popupEndsAt !== announcementKstInput(announcement.popup.endsAt);
  const popupIntent = popupSelected && popupChanged ? 'set' : !popupSelected && announcement.popup.selected ? 'clear' : 'preserve';
  const errors = state.errors ?? {}; const warnings = format === 'html' ? sanitizeGoodsDescription(body, { imagePaths: [] }).warnings : [];
  /* 결과를 모르는 저장 요청은 이 탭에 보관되어 다시 열면 확인할 수 있다. 입력이 사라진다고 단정하지 않는다. */
  const { formRef } = useAdminLeaveGuard({ dirty: uncertain, blocked: pending, message: uncertain ? ADMIN_LEAVE_RECOVERABLE_MESSAGE : undefined });
  return <form ref={formRef} onSubmit={event => { event.preventDefault(); action(new FormData(event.currentTarget)); }} className="flex min-w-0 flex-col gap-4" aria-busy={pending}>
    <input type="hidden" name="id" value={announcement.id} /><input type="hidden" name="revision" value={announcement.revision} />
    <input type="hidden" name="goodIds" value={JSON.stringify(goods.map(good => good.id))} />
    <input type="hidden" name="important" value={String(important)} /><input type="hidden" name="usePeriod" value={String(usePeriod)} />
    <input type="hidden" name="useImportantPeriod" value={String(useImportantPeriod)} />
    <input type="hidden" name="popupIntent" value={popupIntent} /><input type="hidden" name="popupRevision" value={announcement.popup.revision} />
    <fieldset className="min-w-0 rounded-xl border bg-card text-card-foreground" disabled={pending || uncertain || locked || state.reloadRequired}>
      <Field label="공지 분류" htmlFor="announcement-category" error={errors.category}><AdminSelect id="announcement-category" name="category" value={category} onChange={event => setCategory(event.target.value as typeof category)} wrapperClassName="w-full sm:w-80">{GOODS_ANNOUNCEMENT_CATEGORIES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</AdminSelect></Field>
      <Field label="공지 제목" htmlFor="announcement-title" error={errors.title}><Input id="announcement-title" name="title" maxLength={50} required value={title} onChange={event => setTitle(event.target.value)} /><small className="text-xs text-muted-foreground tabular-nums">{title.length} / 50자</small></Field>
      <Field label="공지 내용" htmlFor="announcement-body" error={errors.body}>
        <div className={INLINE}><label className={CHOICE}><input type="radio" name="format" value="plain" checked={format === 'plain'} onChange={() => setFormat('plain')} />직접 입력</label><label className={CHOICE}><input type="radio" name="format" value="html" checked={format === 'html'} onChange={() => setFormat('html')} />HTML</label><Button size="sm" variant="outline" onClick={() => setPreview(true)} type="button">미리보기</Button></div>
        <Textarea className="min-h-60 resize-y field-sizing-fixed" id="announcement-body" name="body" maxLength={30000} required rows={14} value={body} onChange={event => setBody(event.target.value)} />
        <small className="text-xs text-muted-foreground tabular-nums">{body.length.toLocaleString('ko-KR')} / 30,000자{format === 'html' ? ' · 지원하지 않는 코드와 검증되지 않은 저장소 이미지는 제거됩니다.' : ''}</small>
        {warnings.map(warning => <p className={NOTE} key={warning}>{warning}</p>)}
      </Field>
      <Field label="노출 화면" htmlFor="announcement-device" error={errors.device}><AdminSelect id="announcement-device" name="device" value={device} onChange={event => setDevice(event.target.value as typeof device)} wrapperClassName="w-full sm:w-80">{GOODS_ANNOUNCEMENT_DEVICES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</AdminSelect></Field>
      <Field label="노출 위치" error={errors.placement}><div className={INLINE} role="radiogroup" aria-label="노출 위치">{GOODS_ANNOUNCEMENT_PLACEMENTS.map(item => <label className={CHOICE} key={item.value}><input type="radio" name="placement" value={item.value} checked={placement === item.value} onChange={() => setPlacement(item.value)} />{item.label}</label>)}</div>
        <p className={NOTE}>상세 상단은 상품 상세의 탭 위 공지 영역에, 상세 하단은 상세정보 탭의 상세설명 바로 아래에 표시합니다. 전 상품 공통 교환·반품·배송 안내처럼 상세 끝에 둘 내용은 상세 하단을 고릅니다. 홈 팝업에는 영향을 주지 않습니다.</p>
      </Field>
      <Field label="중요 공지" error={errors.importantPeriod || errors.importantStartsAt || errors.importantEndsAt}>
        <label className={CHOICE}><input checked={important} type="checkbox" onChange={event => setImportant(event.target.checked)} />중요 공지로 표시</label>
        <label className={CHOICE}><input checked={useImportantPeriod} type="checkbox" onChange={event => setUseImportantPeriod(event.target.checked)} />중요 표시 기간 설정</label>
        {useImportantPeriod ? <div className={PERIOD}><label className={PERIOD_FIELD}>중요 표시 시작일시<Input className="w-56" type="datetime-local" name="importantStartsAt" value={importantStartsAt} onChange={event => setImportantStartsAt(event.target.value)} /></label><span aria-hidden="true" className="pb-1.5 text-muted-foreground">~</span><label className={PERIOD_FIELD}>중요 표시 종료일시<Input className="w-56" type="datetime-local" name="importantEndsAt" value={importantEndsAt} onChange={event => setImportantEndsAt(event.target.value)} /></label></div> : null}
        <p className={NOTE}>중요 표시 기간에는 같은 상품의 일반 공지보다 먼저 표시됩니다. 기간 밖에는 일반 공지로 표시하며 전시 기간은 따로 적용합니다.</p>
      </Field>
      <Field label="전시 여부" error={errors.enabled}><div className={INLINE}><label className={CHOICE}><input type="radio" name="enabled" value="true" checked={enabled} onChange={() => setEnabled(true)} />전시</label><label className={CHOICE}><input type="radio" name="enabled" value="false" checked={!enabled} onChange={() => setEnabled(false)} />전시중지</label></div></Field>
      <Field label="전시 기간" error={errors.startsAt || errors.endsAt}><label className={CHOICE}><input checked={usePeriod} type="checkbox" onChange={event => setUsePeriod(event.target.checked)} />기간 설정</label>
        {usePeriod ? <div className={PERIOD}><label className={PERIOD_FIELD}>시작일시<Input className="w-56" type="datetime-local" name="startsAt" value={startsAt} onChange={event => setStartsAt(event.target.value)} /></label><span aria-hidden="true" className="pb-1.5 text-muted-foreground">~</span><label className={PERIOD_FIELD}>종료일시<Input className="w-56" type="datetime-local" name="endsAt" value={endsAt} onChange={event => setEndsAt(event.target.value)} /></label></div> : null}
        <p className={NOTE}>한국 시각 기준입니다. 시작 일시부터 표시하고 종료 일시에는 내려갑니다. 비워 둔 경계는 제한하지 않습니다.</p>
      </Field>
      <Field label="스토어홈 팝업" error={errors.popup || errors.popupStartsAt || errors.popupEndsAt}>
        <label className={CHOICE}><input type="checkbox" checked={popupSelected} onChange={event => setPopupSelected(event.target.checked)} />이 공지를 홈 팝업으로 표시</label>
        {popupSelected ? <div className={PERIOD}><label className={PERIOD_FIELD}>팝업 시작일시<Input className="w-56" type="datetime-local" name="popupStartsAt" value={popupStartsAt} onChange={event => setPopupStartsAt(event.target.value)} /></label><span aria-hidden="true" className="pb-1.5 text-muted-foreground">~</span><label className={PERIOD_FIELD}>팝업 종료일시<Input className="w-56" type="datetime-local" name="popupEndsAt" value={popupEndsAt} onChange={event => setPopupEndsAt(event.target.value)} /></label></div> : null}
        <p className={NOTE}>홈 팝업은 한 건만 선택합니다. 새 공지를 선택하면 이전 선택을 대체합니다. 전시 여부·노출 화면·전시 기간과 팝업 기간이 모두 맞을 때 홈에 표시됩니다. 연결 상품은 상품 상세 노출에만 적용합니다.</p>
      </Field>
      <Field label="적용 상품" error={errors.goodIds}><div className={INLINE}><label className={CHOICE}><input type="radio" name="allGoods" value="true" checked={allGoods} onChange={() => setAllGoods(true)} />전체 상품</label><label className={CHOICE}><input type="radio" name="allGoods" value="false" checked={!allGoods} onChange={() => setAllGoods(false)} />선택 상품</label></div>
        {!allGoods ? <><div className={INLINE}><span className="text-sm tabular-nums">선택 {goods.length}개 / 최대 {GOODS_ANNOUNCEMENT_GOOD_LIMIT}개</span><Button size="sm" variant="outline" type="button" onClick={() => setPicker(true)}>상품찾기</Button></div><ul className="m-0 flex max-h-[300px] list-none flex-col overflow-auto rounded-lg border p-0 empty:hidden">{goods.map(good => <li className="flex items-center justify-between gap-3 border-b px-3 py-2.5 text-sm last:border-b-0" key={good.id}><span className="flex min-w-0 flex-col gap-0.5">{good.name} <small className="text-xs text-muted-foreground">{good.code}{good.archived ? ' · 보관 상품' : ''}</small></span><Button size="xs" variant="outline" aria-label={`${good.name} 연결 해제`} type="button" onClick={() => setGoods(items => items.filter(item => item.id !== good.id))}>해제</Button></li>)}</ul></> : <p className={NOTE}>현재와 앞으로 공개할 모든 상품에 적용됩니다.</p>}
      </Field>
    </fieldset>
    <div className="sticky bottom-0 z-10 flex flex-col gap-4 rounded-xl border bg-background p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between print:static" data-announcement="savebar">
      <div className="flex min-w-0 flex-col gap-1.5 text-sm">{errors.form ? <p className="text-destructive" role="alert">{errors.form}</p> : null}{state.message ? <p className="text-success" role="status">{state.message}</p> : null}{state.outcome === 'saved' && state.savedId ? <a className="w-fit underline underline-offset-4" href={`${GOODS_ANNOUNCEMENTS_PATH}?edit=${state.savedId}`}>저장된 공지 다시 열기</a> : null}<small className="text-xs text-muted-foreground">{announcement.reference ? `공지번호 ${announcement.reference} · 저장 버전 ${announcement.revision}` : '신규 공지'}{enabled ? ' · 저장 후 조건에 맞는 상품에 표시됩니다.' : ' · 저장해도 상품에 표시되지 않습니다.'}</small></div>
      <div className="flex shrink-0 flex-wrap justify-end gap-2">{uncertain ? <><Button variant="outline" disabled={pending || !canResolve} type="button" onClick={resolve}>저장 결과 확인</Button><Button disabled={pending || !canResolve} type="button" onClick={retry}>같은 요청 다시 저장</Button></> : <Button disabled={pending || locked || state.reloadRequired} type="submit">{pending ? '저장 중…' : '저장'}</Button>}{!pending && !uncertain ? <Link className={buttonVariants({ variant: 'outline' })} data-slot="button" href={backHref}>목록</Link> : null}</div>
    </div>
    {picker ? <GoodsAnnouncementProductPicker value={goods} onClose={() => setPicker(false)} onApply={items => { setGoods(items); setPicker(false); }} /> : null}
    {preview ? <CustomerServiceDialog title="공지 노출 미리보기" onClose={() => setPreview(false)}><article className="flex flex-col gap-3 text-sm leading-relaxed [&_img]:h-auto [&_img]:max-w-full"><h3 className="text-base font-medium">{important ? '[중요] ' : ''}{title || '공지 제목'}</h3><GoodsDescription description={body} format={format} /></article></CustomerServiceDialog> : null}
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
  function restore() {
    if (busy.current || !active()) return;
    const operation = draft.restore();
    if (!operation || operation.accountId !== accountId || operation.id !== announcement.id) {
      setUncertain(true); setState({ errors: { form: '보관된 저장 요청을 확인하지 못했습니다. 원래 요청의 편집을 잠근 상태로 유지합니다.' } }); return;
    }
    request.current = { operation, form: goodsAnnouncementPendingForm(operation) };
    setUncertain(true); setState({ message: '앞서 보낸 입력을 복구했습니다. 원문을 확인하고 저장 결과 확인 또는 같은 요청 다시 저장을 선택해주세요.' });
  }
  function execute(form?: FormData, resolveOnly = false) {
    if (busy.current || !active() || recovered || state.reloadRequired) return;
    const snapshot = persistPending ? draft.getCurrentSnapshot() : null;
    if (snapshot?.recovery) return;
    const hadRequest = Boolean(request.current || snapshot?.value);
    if (!request.current && snapshot?.value) request.current = { operation: snapshot.value, form: goodsAnnouncementPendingForm(snapshot.value) };
    if (!request.current && form) {
      const operation = createGoodsAnnouncementPendingSave(form, accountId, announcement.id, crypto.randomUUID());
      if (!operation) { setState({ saved: state.saved, errors: { form: '저장할 입력을 확인하지 못했습니다. 내용을 확인하고 다시 시도해주세요.' } }); return; }
      if (persistPending && (!draft.change(operation) || !draft.getCurrentSnapshot().saved)) {
        draft.discard(); setState({ saved: state.saved, errors: { form: '이 브라우저에서 저장 요청을 보관할 수 없어 서버에 보내지 않았습니다. 입력을 복사하고 브라우저 저장소 설정을 확인해주세요.' } }); return;
      }
      request.current = { operation, form: goodsAnnouncementPendingForm(operation) };
      if (!persistPending) setFixtureRequest(operation);
    }
    const fixed = request.current;
    if (!fixed || fixed.operation.accountId !== accountId || fixed.operation.id !== announcement.id) return;
    busy.current = true;
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
        if (active()) { setState({ saved: state.saved, outcome: 'unknown', errors: { form: '저장 응답을 확인하지 못했습니다. 원래 입력과 요청을 유지합니다.' } }); setUncertain(true); }
      }
      finally { busy.current = false; }
    });
  }
  return <section className="flex min-w-0 flex-col gap-4" data-admin-screen="goods-announcement-editor"><AdminPageHeader title={current.revision ? '상품공지사항 수정' : '상품공지사항 등록'} actions={!pending && !unresolved ? <Link className={buttonVariants({ variant: 'outline' })} data-slot="button" href={backHref}>목록</Link> : undefined} />
    {persistPending && draft.blocked ? <p className="text-sm text-destructive" role="alert">로그인 계정 또는 세션이 바뀌어 이전 요청을 지우고 편집을 잠갔습니다. 화면을 새로고침해주세요.</p> : <>
      {persistPending && !draft.ready ? <p className="text-sm text-muted-foreground" role="status">현재 로그인과 보관된 저장 요청을 확인하고 있습니다.</p> : null}
      {persistPending && draft.unavailable ? <p className="text-sm text-destructive" role="alert">이 브라우저에서 저장 요청을 보관할 수 없습니다. 보관이 가능해지기 전에는 서버에 저장하지 않습니다.</p> : null}
      {recovered ? <AdminNotice tone="warning"><p role="status">이 공지에 앞서 보낸 저장 요청이 있습니다. 편집을 잠갔습니다. 결과를 확인할 때까지 이 탭의 같은 로그인에서 보관합니다. 로그아웃·계정 또는 로그인 세션 변경 후에는 복구되지 않습니다.</p><Button className="mt-2" size="sm" variant="outline" type="button" disabled={pending || locked} onClick={restore}>고정된 저장 요청 복구</Button></AdminNotice> : null}
      {stored ? <details className="rounded-lg border bg-muted/40 px-4 py-3 text-sm"><summary className="cursor-pointer font-medium">확인 중인 최초 입력</summary><dl className="mt-3 grid gap-3">{stored.entries.filter(([field]) => GOODS_ANNOUNCEMENT_PENDING_LABELS[field]).map(([field, value]) => <div className="grid gap-1" key={field}><dt className="text-xs text-muted-foreground">{GOODS_ANNOUNCEMENT_PENDING_LABELS[field]}</dt><dd className="whitespace-pre-wrap wrap-anywhere">{goodsAnnouncementPendingDisplayValue(field, value)}</dd></div>)}</dl></details> : null}
      <EditorFields key={`${current.id}:${current.revision}`} announcement={current} action={form => execute(form)} pending={pending} state={state} backHref={backHref} uncertain={unresolved} locked={locked} canResolve={!locked && !recovered && Boolean(stored)} resolve={() => execute(undefined, true)} retry={() => execute()} />
    </>}
  </section>;
}
