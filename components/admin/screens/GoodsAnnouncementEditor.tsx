'use client';
import Link from 'next/link';
import { useEffect, useLayoutEffect, useRef, useState, useTransition, type ReactNode } from 'react';
import { resolveGoodsAnnouncementSaveAction, saveGoodsAnnouncementAction, type GoodsAnnouncementActionState } from '@/app/admin/goods-announcement-actions';
import { announcementKstInput, GOODS_ANNOUNCEMENT_CATEGORIES, GOODS_ANNOUNCEMENT_DEVICES, GOODS_ANNOUNCEMENT_GOOD_LIMIT, GOODS_ANNOUNCEMENTS_PATH, type GoodsAnnouncement } from '@/lib/admin/goods-announcements';
import { sanitizeGoodsDescription } from '@/lib/goods-description';
import { GoodsDescription } from '@/components/shop/GoodsDescription';
import { createGoodsAnnouncementPendingSave, goodsAnnouncementPendingForm, goodsAnnouncementPendingDisplayValue, GOODS_ANNOUNCEMENT_PENDING_LABELS,
  parseGoodsAnnouncementPendingSave, retainGoodsAnnouncementPendingSave, type GoodsAnnouncementPendingSave } from '@/lib/admin/goods-announcement-pending';
import { useCsEditorDraft } from '../useCsEditorDraft';
import { AdminPageHeader } from '../console/AdminKit';
import { CustomerServiceDialog } from './CustomerServiceDialog';
import { GoodsAnnouncementProductPicker } from './GoodsAnnouncementProductPicker';

const EMPTY: GoodsAnnouncementActionState = {};
function Field({ label, htmlFor, error, children }: { label: string; htmlFor?: string; error?: string; children: ReactNode }) {
  return <div className="admin-announcement-field"><label htmlFor={htmlFor}>{label}</label><div>{children}{error ? <p className="admin-announcement-error" role="alert">{error}</p> : null}</div></div>;
}
function EditorFields({ announcement, action, pending, state, backHref, uncertain, locked, canResolve, resolve, retry }: {
  announcement: GoodsAnnouncement; action: (form: FormData) => void; pending: boolean; state: GoodsAnnouncementActionState; backHref: string;
  uncertain: boolean; locked: boolean; canResolve: boolean; resolve: () => void; retry: () => void;
}) {
  const [title, setTitle] = useState(announcement.title); const [body, setBody] = useState(announcement.body);
  const [format, setFormat] = useState(announcement.format); const [category, setCategory] = useState(announcement.category);
  const [device, setDevice] = useState(announcement.device); const [enabled, setEnabled] = useState(announcement.enabled);
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
  return <form onSubmit={event => { event.preventDefault(); action(new FormData(event.currentTarget)); }} className="admin-announcement-editor" aria-busy={pending}>
    <input type="hidden" name="id" value={announcement.id} /><input type="hidden" name="revision" value={announcement.revision} />
    <input type="hidden" name="goodIds" value={JSON.stringify(goods.map(good => good.id))} />
    <input type="hidden" name="important" value={String(important)} /><input type="hidden" name="usePeriod" value={String(usePeriod)} />
    <input type="hidden" name="useImportantPeriod" value={String(useImportantPeriod)} />
    <input type="hidden" name="popupIntent" value={popupIntent} /><input type="hidden" name="popupRevision" value={announcement.popup.revision} />
    <fieldset disabled={pending || uncertain || locked || state.reloadRequired}>
      <Field label="공지 분류" htmlFor="announcement-category" error={errors.category}><select id="announcement-category" name="category" value={category} onChange={event => setCategory(event.target.value as typeof category)}>{GOODS_ANNOUNCEMENT_CATEGORIES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field>
      <Field label="공지 제목" htmlFor="announcement-title" error={errors.title}><input id="announcement-title" name="title" maxLength={50} required value={title} onChange={event => setTitle(event.target.value)} /><small>{title.length} / 50자</small></Field>
      <Field label="공지 내용" htmlFor="announcement-body" error={errors.body}>
        <div className="admin-announcement-inline"><label><input type="radio" name="format" value="plain" checked={format === 'plain'} onChange={() => setFormat('plain')} />직접 입력</label><label><input type="radio" name="format" value="html" checked={format === 'html'} onChange={() => setFormat('html')} />HTML</label><button className="btn btn-sm btn-ghost" onClick={() => setPreview(true)} type="button">미리보기</button></div>
        <textarea id="announcement-body" name="body" maxLength={30000} required rows={14} value={body} onChange={event => setBody(event.target.value)} />
        <small>{body.length.toLocaleString('ko-KR')} / 30,000자{format === 'html' ? ' · 지원하지 않는 코드와 검증되지 않은 저장소 이미지는 제거됩니다.' : ''}</small>
        {warnings.map(warning => <p className="muted" key={warning}>{warning}</p>)}
      </Field>
      <Field label="노출 화면" htmlFor="announcement-device" error={errors.device}><select id="announcement-device" name="device" value={device} onChange={event => setDevice(event.target.value as typeof device)}>{GOODS_ANNOUNCEMENT_DEVICES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field>
      <Field label="중요 공지" error={errors.importantPeriod || errors.importantStartsAt || errors.importantEndsAt}>
        <label className="admin-announcement-inline"><input checked={important} type="checkbox" onChange={event => setImportant(event.target.checked)} />중요 공지로 표시</label>
        <label className="admin-announcement-inline"><input checked={useImportantPeriod} type="checkbox" onChange={event => setUseImportantPeriod(event.target.checked)} />중요 표시 기간 설정</label>
        {useImportantPeriod ? <div className="admin-announcement-period"><label>중요 표시 시작일시<input type="datetime-local" name="importantStartsAt" value={importantStartsAt} onChange={event => setImportantStartsAt(event.target.value)} /></label><span>~</span><label>중요 표시 종료일시<input type="datetime-local" name="importantEndsAt" value={importantEndsAt} onChange={event => setImportantEndsAt(event.target.value)} /></label></div> : null}
        <p className="muted">중요 표시 기간에는 같은 상품의 일반 공지보다 먼저 표시됩니다. 기간 밖에는 일반 공지로 표시하며 전시 기간은 따로 적용합니다.</p>
      </Field>
      <Field label="전시 여부" error={errors.enabled}><div className="admin-announcement-inline"><label><input type="radio" name="enabled" value="true" checked={enabled} onChange={() => setEnabled(true)} />전시</label><label><input type="radio" name="enabled" value="false" checked={!enabled} onChange={() => setEnabled(false)} />전시중지</label></div></Field>
      <Field label="전시 기간" error={errors.startsAt || errors.endsAt}><label className="admin-announcement-inline"><input checked={usePeriod} type="checkbox" onChange={event => setUsePeriod(event.target.checked)} />기간 설정</label>
        {usePeriod ? <div className="admin-announcement-period"><label>시작일시<input type="datetime-local" name="startsAt" value={startsAt} onChange={event => setStartsAt(event.target.value)} /></label><span>~</span><label>종료일시<input type="datetime-local" name="endsAt" value={endsAt} onChange={event => setEndsAt(event.target.value)} /></label></div> : null}
        <p className="muted">한국 시각 기준입니다. 시작 일시부터 표시하고 종료 일시에는 내려갑니다. 비워 둔 경계는 제한하지 않습니다.</p>
      </Field>
      <Field label="스토어홈 팝업" error={errors.popup || errors.popupStartsAt || errors.popupEndsAt}>
        <label className="admin-announcement-inline"><input type="checkbox" checked={popupSelected} onChange={event => setPopupSelected(event.target.checked)} />이 공지를 홈 팝업으로 표시</label>
        {popupSelected ? <div className="admin-announcement-period"><label>팝업 시작일시<input type="datetime-local" name="popupStartsAt" value={popupStartsAt} onChange={event => setPopupStartsAt(event.target.value)} /></label><span>~</span><label>팝업 종료일시<input type="datetime-local" name="popupEndsAt" value={popupEndsAt} onChange={event => setPopupEndsAt(event.target.value)} /></label></div> : null}
        <p className="muted">홈 팝업은 한 건만 선택합니다. 새 공지를 선택하면 이전 선택을 대체합니다. 전시 여부·노출 화면·전시 기간과 팝업 기간이 모두 맞을 때 홈에 표시됩니다. 연결 상품은 상품 상세 노출에만 적용합니다.</p>
      </Field>
      <Field label="적용 상품" error={errors.goodIds}><div className="admin-announcement-inline"><label><input type="radio" name="allGoods" value="true" checked={allGoods} onChange={() => setAllGoods(true)} />전체 상품</label><label><input type="radio" name="allGoods" value="false" checked={!allGoods} onChange={() => setAllGoods(false)} />선택 상품</label></div>
        {!allGoods ? <><div className="admin-announcement-inline"><span>선택 {goods.length}개 / 최대 {GOODS_ANNOUNCEMENT_GOOD_LIMIT}개</span><button className="btn btn-sm btn-ghost" type="button" onClick={() => setPicker(true)}>상품찾기</button></div><ul className="admin-announcement-goods">{goods.map(good => <li key={good.id}><span>{good.name} <small>{good.code}{good.archived ? ' · 보관 상품' : ''}</small></span><button aria-label={`${good.name} 연결 해제`} type="button" onClick={() => setGoods(items => items.filter(item => item.id !== good.id))}>해제</button></li>)}</ul></> : <p className="muted">현재와 앞으로 공개할 모든 상품에 적용됩니다.</p>}
      </Field>
    </fieldset>
    <div className="admin-announcement-savebar">
      <div>{errors.form ? <p role="alert">{errors.form}</p> : null}{state.message ? <p role="status">{state.message}</p> : null}{state.outcome === 'saved' && state.savedId ? <a href={`${GOODS_ANNOUNCEMENTS_PATH}?edit=${state.savedId}`}>저장된 공지 다시 열기</a> : null}<small>{announcement.reference ? `공지번호 ${announcement.reference} · 저장 버전 ${announcement.revision}` : '신규 공지'}{enabled ? ' · 저장 후 조건에 맞는 상품에 표시됩니다.' : ' · 저장해도 상품에 표시되지 않습니다.'}</small></div>
      <div>{uncertain ? <><button className="btn btn-ghost" disabled={pending || !canResolve} type="button" onClick={resolve}>저장 결과 확인</button><button className="btn" disabled={pending || !canResolve} type="button" onClick={retry}>같은 요청 다시 저장</button></> : <button className="btn" disabled={pending || locked || state.reloadRequired} type="submit">{pending ? '저장 중…' : '저장'}</button>}{!pending && !uncertain ? <Link className="btn btn-ghost" href={backHref}>목록</Link> : null}</div>
    </div>
    {picker ? <GoodsAnnouncementProductPicker value={goods} onClose={() => setPicker(false)} onApply={items => { setGoods(items); setPicker(false); }} /> : null}
    {preview ? <CustomerServiceDialog title="공지 노출 미리보기" onClose={() => setPreview(false)}><article className="admin-announcement-preview"><h3>{important ? '[중요] ' : ''}{title || '공지 제목'}</h3><GoodsDescription description={body} format={format} /></article></CustomerServiceDialog> : null}
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
  useEffect(() => {
    if (!pending && !unresolved) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [pending, unresolved]);
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
  return <section className="wc-admin-kit wc-admin-kit__screen admin-goods-announcements"><AdminPageHeader title={current.revision ? '상품공지사항 수정' : '상품공지사항 등록'} actions={!pending && !unresolved ? <Link className="wc-admin-kit__button" href={backHref}>목록</Link> : undefined} />
    {persistPending && draft.blocked ? <p role="alert">로그인 계정 또는 세션이 바뀌어 이전 요청을 지우고 편집을 잠갔습니다. 화면을 새로고침해주세요.</p> : <>
      {persistPending && !draft.ready ? <p role="status">현재 로그인과 보관된 저장 요청을 확인하고 있습니다.</p> : null}
      {persistPending && draft.unavailable ? <p role="alert">이 브라우저에서 저장 요청을 보관할 수 없습니다. 보관이 가능해지기 전에는 서버에 저장하지 않습니다.</p> : null}
      {recovered ? <div className="admin-inquiry-draft"><p role="status">이 공지에 앞서 보낸 저장 요청이 있습니다. 편집을 잠갔습니다. 결과를 확인할 때까지 이 탭의 같은 로그인에서 보관합니다. 로그아웃·계정 또는 로그인 세션 변경 후에는 복구되지 않습니다.</p><button type="button" className="btn btn-ghost" disabled={pending || locked} onClick={restore}>고정된 저장 요청 복구</button></div> : null}
      {stored ? <details className="admin-inquiry-draft"><summary>확인 중인 최초 입력</summary><dl>{stored.entries.filter(([field]) => GOODS_ANNOUNCEMENT_PENDING_LABELS[field]).map(([field, value]) => <div key={field}><dt>{GOODS_ANNOUNCEMENT_PENDING_LABELS[field]}</dt><dd style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{goodsAnnouncementPendingDisplayValue(field, value)}</dd></div>)}</dl></details> : null}
      <EditorFields key={`${current.id}:${current.revision}`} announcement={current} action={form => execute(form)} pending={pending} state={state} backHref={backHref} uncertain={unresolved} locked={locked} canResolve={!locked && !recovered && Boolean(stored)} resolve={() => execute(undefined, true)} retry={() => execute()} />
    </>}
  </section>;
}
