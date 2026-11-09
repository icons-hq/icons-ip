/* eslint-disable @next/next/no-img-element -- Review images use short-lived storage URLs. */
'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { archiveReviewEventAction, publishReviewEventAction, revokeReviewEventAwardAction, saveReviewEventAction, selectReviewEventEntriesAction } from '@/app/admin/review-event-actions';
import { REVIEW_EVENTS_ADMIN_PATH, REVIEW_EVENTS_PATH, REVIEW_EVENT_CREDIT_POLICY_OFF, isReviewEventDate, newReviewEventValues, parseReviewEventValues, reviewEventCreditPolicyLabel, reviewEventCreditPolicyProblem, reviewEventDayOffset, reviewEventFieldErrors,
  reviewEventToday, reviewEventStateLabel, reviewEventProblemLabel, trimReviewEventText, withReviewEventEndsOn, withReviewEventStartsOn,
  type ReviewEventCreditPolicy, type ReviewEventField, type ReviewEventFieldErrors, type ReviewEventValues, type ReviewEventWorkspace, type ReviewEventSelection, type ReviewEventTarget } from '@/lib/review-events';
import { AdminNotice, AdminPageHeader, AdminStatusBadge } from '../console/AdminKit';
import { ConsolePagination } from '../console';
import { statusTone } from '@/lib/admin/status-tone';
import { ReviewEventTargetPicker } from '../ReviewEventTargetPicker';
import { ReviewEventBanner } from '@/components/reviews/ReviewEventBanner';
import { ReviewEventExportButton } from '../ReviewEventExportButton';
import { REVIEW_EVENT_ENTRY_FILTERS, reviewEventExportHref } from '@/lib/admin/review-event-export';
import { AdminSelect } from '../console/AdminSelect';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { FIELD_LABEL_CLASS, KIT_INPUT_CLASS, KIT_TEXTAREA_CLASS, ROW_DANGER_BUTTON_CLASS } from './cs-kit-classes';

const PANEL_CLASS = 'flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-4 text-card-foreground sm:p-5';
const PANEL_TITLE_CLASS = 'text-base font-semibold text-foreground';
const LABEL_CLASS = 'flex min-w-0 flex-col gap-1.5';
const HELP_CLASS = 'text-sm leading-relaxed text-muted-foreground';
const TEXT_LINK_CLASS = 'font-medium text-foreground underline underline-offset-4 hover:text-muted-foreground';

type Request = { operationId: string; revision: number } & ({ kind: 'save'; values: ReviewEventValues } | { kind: 'archive'; archived: boolean } | { kind: 'select'; entries: ReviewEventSelection[]; reason: string } | { kind: 'publish' } | { kind: 'revoke'; entryId: string; reason: string });
/*
 * R6(10/27 회의): 등록이 막히는 이유를 저장 전에 보인다.
 * - 상단에 적립금 정책 상태(cs.manage로 읽는 admin_review_event_credit_policy, 상세는 같은 값을 workspace로 받는다).
 *   설정 링크는 그 화면을 열 수 있는 운영자에게만(policyHref).
 * - 1인당 적립금·유효기간은 정책과 바로 비교해 필드 옆에 알리고, 저장을 누르면 나머지 필드도 필드별로 알린다.
 * - 제목·내용 앞뒤 공백은 잘라서 검증한다. 시작일을 바꾸면 종료·발표일이 범위 안으로 따라 움직인다.
 */
export function ReviewEventEditorScreen({ id, workspace, targetLabels = [], query = '', filter = 'all', creditPolicy, policyHref = null }: {
  id: string; workspace: ReviewEventWorkspace | null; targetLabels?: ReviewEventTarget[]; query?: string; filter?: string;
  /** 생략하면 workspace.creditPolicy. null은 정책을 읽지 못한 상태(저장 판단은 서버가 한다). */
  creditPolicy?: ReviewEventCreditPolicy | null;
  policyHref?: string | null;
}) {
  const router = useRouter(), [saved, setSaved] = useState(workspace?.event ?? null), [values, setValues] = useState<ReviewEventValues>(workspace?.event ?? newReviewEventValues());
  const [selected, setSelected] = useState(workspace?.selected ?? []), [reason, setReason] = useState(''), [dirtySelection, setDirtySelection] = useState(false), [dirtyTerms, setDirtyTerms] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [retry, setRetry] = useState<Request | null>(null), [pending, start] = useTransition();
  const [attempted, setAttempted] = useState(false);
  const blocked = pending || !!retry, editable = !saved || saved.canEdit, canSelect = !!saved && ['closed', 'ready'].includes(saved.state), selectedAmount = selected.length * values.creditAmount;
  const policy = creditPolicy === undefined ? workspace?.creditPolicy ?? null : creditPolicy;
  const fieldErrors: ReviewEventFieldErrors = editable ? { ...(attempted ? reviewEventFieldErrors(trimReviewEventText(values)) : {}), ...reviewEventCreditPolicyProblem(values, policy) } : {};
  const invalid = (name: ReviewEventField) => fieldErrors[name] ? { 'aria-invalid': true as const, 'aria-describedby': `review-event-${name}-error` } : {};
  const fieldError = (name: ReviewEventField) => fieldErrors[name] ? <small className="text-xs text-destructive" id={`review-event-${name}-error`}>{fieldErrors[name]}</small> : null;
  function change<K extends keyof ReviewEventValues>(key: K, value: ReviewEventValues[K]) { setValues(current => ({ ...current, [key]: value })); setDirtyTerms(true); }
  function request(kind: Request['kind']) { return { kind, operationId: crypto.randomUUID(), revision: saved?.revision ?? 0 }; }
  function run(input: Request) { setError(''); setNotice(''); start(async () => {
    const result = input.kind === 'save' ? await saveReviewEventAction(id, input.revision, input.operationId, input.values)
      : input.kind === 'archive' ? await archiveReviewEventAction(id, input.revision, input.operationId, input.archived)
      : input.kind === 'select' ? await selectReviewEventEntriesAction(id, input.revision, input.operationId, input.entries, input.reason)
      : input.kind === 'publish' ? await publishReviewEventAction(id, input.revision, input.operationId)
      : await revokeReviewEventAwardAction(input.entryId, input.operationId, input.reason);
    if ('error' in result) { setError(result.error); setRetry(result.uncertain ? input : null); return; }
    setRetry(null); setSaved(result.event); if (input.kind === 'save') { setValues(result.event); setDirtyTerms(false); } if (input.kind === 'select') setDirtySelection(false);
    setNotice(input.kind === 'publish' ? '발표와 적립금 지급을 저장 후 다시 확인했습니다.' : input.kind === 'revoke' ? '선정 혜택 회수를 저장 후 다시 확인했습니다.' : '저장한 내용을 다시 확인했습니다.');
    if (!workspace) router.replace(`${REVIEW_EVENTS_ADMIN_PATH}/${id}`); router.refresh();
  }); }
  function save() {
    const trimmed = trimReviewEventText(values);
    const errors = { ...reviewEventFieldErrors(trimmed), ...reviewEventCreditPolicyProblem(trimmed, policy) };
    setAttempted(true); setValues(trimmed); setNotice('');
    if (Object.keys(errors).length) { setError(errors.form ?? '표시된 항목을 확인해주세요.'); return; }
    const normalized = parseReviewEventValues(trimmed);
    if (!normalized) { setError('제목·내용·대상·기간·선정수·혜택 금액을 확인해주세요.'); return; }
    run({ ...request('save'), kind: 'save', values: normalized });
  }
  function select(entry: ReviewEventWorkspace['rows'][number], checked: boolean) { if (checked && entry.reviewUpdatedAt) setSelected(current => [...current.filter(item => item.id !== entry.id), { id: entry.id, reviewUpdatedAt: entry.reviewUpdatedAt!, reviewFingerprint: entry.reviewFingerprint }]); else setSelected(current => current.filter(item => item.id !== entry.id)); setDirtySelection(true); }
  const detailPath = `${REVIEW_EVENTS_ADMIN_PATH}/${id}`;
  /* 응모마감·발표대기 이벤트는 이 화면에서 할 일이 맨 아래 있다 — 머리에서 바로 그 자리로 보낸다(판정은 서버 상태 그대로). */
  const nextStep = !workspace || !saved || saved.announcedAt || saved.archivedAt ? null
    : saved.state === 'closed' ? { href: '#review-event-selection', label: '당첨자 선정·발표로 이동' }
    : saved.state === 'ready' ? { href: '#review-event-publish', label: '발표 및 지급으로 이동' }
    : null;
  const policyLabel = <>{policy ? reviewEventCreditPolicyLabel(policy) : '적립금 정책 상태를 확인하지 못했습니다. 저장할 때 다시 확인합니다.'}{policyHref ? <> · <Link className={TEXT_LINK_CLASS} href={policyHref}>적립금 정책 설정</Link></> : null}</>;
  /* 네이티브 label·input·select·button에 kit 모양을 입힌다 — 필드 오류 연결(aria-describedby)과 테스트가 네이티브 요소에 기댄다.
     공개 배너 미리보기는 공개 부품이라 손대지 않고, 강조형의 굵은 글자만 배너 색을 따르게 한다(관리자 strong 색 규칙 상쇄). */
  return <div className="flex min-w-0 flex-col gap-4" data-review-events="editor">
    <AdminPageHeader title={saved ? saved.title : '리뷰이벤트 등록'} description={saved ? `#${saved.number} · 리뷰이벤트 상세` : '시작 전에는 수정할 수 있으며, 시작 후에는 조건이 고정됩니다.'} actions={<>{saved ? <AdminStatusBadge tone={statusTone('reviewEvent', saved.state)}>{reviewEventStateLabel[saved.state]}</AdminStatusBadge> : null}<Link className={buttonVariants({ variant: 'outline' })} data-slot="button" href={REVIEW_EVENTS_ADMIN_PATH}>목록</Link>{nextStep ? <a className={buttonVariants()} data-slot="button" href={nextStep.href}>{nextStep.label}</a> : null}</>} />
    {/* 정책은 입력을 막을 때만 주의로 보인다. 켜져 있는데 조건을 고칠 수도 없으면 이 화면의 일이 아니라 한 줄로 물러난다. */}
    <div role="group" aria-label="적립금 정책 상태">
      {editable || !policy?.enabled ? <AdminNotice title={policyLabel} tone={policy?.enabled ? 'neutral' : 'warning'}>
        {policy && !policy.enabled && editable ? REVIEW_EVENT_CREDIT_POLICY_OFF : null}
      </AdminNotice> : <p className="text-xs text-muted-foreground">{policyLabel}</p>}
    </div>
    {error ? <AdminNotice tone="danger"><span className="[&_a]:underline [&_a]:underline-offset-4" role="alert">{error} {saved ? <a href={detailPath} target="_blank" rel="noopener noreferrer">최신 내용 별도 창에서 확인</a> : null}</span></AdminNotice> : null}{notice ? <p className="text-sm text-success" role="status">{notice}</p> : null}
    {retry ? <button type="button" disabled={pending} className={`${buttonVariants()} self-start`} data-slot="button" onClick={() => run(retry)}>같은 요청으로 저장 결과 확인</button> : null}
    {!editable ? <AdminNotice tone="neutral">시작한 이벤트의 조건은 수정할 수 없습니다.</AdminNotice> : null}
    <fieldset className="flex min-w-0 flex-col gap-4" disabled={blocked || !editable}>
      <section className={PANEL_CLASS}><h2 className={PANEL_TITLE_CLASS}>이벤트 정보</h2><div className="grid gap-4 md:grid-cols-2"><label className={LABEL_CLASS}><span className={FIELD_LABEL_CLASS}>이벤트명 ({[...values.title].length}/15)</span><input className={KIT_INPUT_CLASS} data-slot="input" value={values.title} onChange={event => change('title', event.target.value)} placeholder="최대 15자" {...invalid('title')} />{fieldError('title')}</label><label className={LABEL_CLASS}><span className={FIELD_LABEL_CLASS}>내용 ({[...values.description].length}/30)</span><input className={KIT_INPUT_CLASS} data-slot="input" value={values.description} onChange={event => change('description', event.target.value)} placeholder="최대 30자" {...invalid('description')} />{fieldError('description')}</label></div>
        <label className={`${LABEL_CLASS} md:max-w-xs`}><span className={FIELD_LABEL_CLASS}>이벤트 대상</span><AdminSelect value={values.targetType} onChange={event => { const targetType = event.target.value as ReviewEventValues['targetType']; setValues(current => ({ ...current, targetType, goodIds: [], categoryIds: [] })); setDirtyTerms(true); }}><option value="all">전체 상품</option><option value="goods">상품 지정</option><option value="categories">카테고리 지정</option></AdminSelect></label>
        {values.targetType !== 'all' ? <ReviewEventTargetPicker key={values.targetType} type={values.targetType} ids={values.targetType === 'goods' ? values.goodIds : values.categoryIds} initialLabels={targetLabels} onChange={ids => change(values.targetType === 'goods' ? 'goodIds' : 'categoryIds', ids)} /> : null}
        {fieldError('target')}
        {editable ? <p className={HELP_CLASS}>공개된 상품의 유효 결제·배송완료 주문으로 기간 안에 새로 작성한 리뷰가 자동 응모됩니다. 같은 리뷰는 적립금이 가장 큰 이벤트 한 건에만 응모됩니다.</p> : null}
      </section>
      <section className={PANEL_CLASS}><h2 className={PANEL_TITLE_CLASS}>기간과 선정 혜택</h2><div className="grid gap-4 md:grid-cols-3"><label className={LABEL_CLASS}><span className={FIELD_LABEL_CLASS}>시작일 (한국 시각)</span><input className={KIT_INPUT_CLASS} data-slot="input" type="date" min={reviewEventDayOffset(reviewEventToday(), 1)} value={values.startsOn} onChange={event => { const next = event.target.value; setValues(current => withReviewEventStartsOn(current, next)); setDirtyTerms(true); }} {...invalid('startsOn')} />{fieldError('startsOn')}</label>
        <label className={LABEL_CLASS}><span className={FIELD_LABEL_CLASS}>종료일 (시작일 +1~31일)</span><input className={KIT_INPUT_CLASS} data-slot="input" type="date" min={isReviewEventDate(values.startsOn) ? reviewEventDayOffset(values.startsOn, 1) : undefined} max={isReviewEventDate(values.startsOn) ? reviewEventDayOffset(values.startsOn, 31) : undefined} value={values.endsOn} onChange={event => { const next = event.target.value; setValues(current => withReviewEventEndsOn(current, next)); setDirtyTerms(true); }} {...invalid('endsOn')} />{fieldError('endsOn')}</label>
        <label className={LABEL_CLASS}><span className={FIELD_LABEL_CLASS}>발표일 (종료일 +3~10일)</span><input className={KIT_INPUT_CLASS} data-slot="input" type="date" min={isReviewEventDate(values.endsOn) ? reviewEventDayOffset(values.endsOn, 3) : undefined} max={isReviewEventDate(values.endsOn) ? reviewEventDayOffset(values.endsOn, 10) : undefined} value={values.announcesOn} onChange={event => change('announcesOn', event.target.value)} {...invalid('announcesOn')} />{fieldError('announcesOn')}</label>
        <label className={LABEL_CLASS}><span className={FIELD_LABEL_CLASS}>선정 예정 인원</span><input className={KIT_INPUT_CLASS} data-slot="input" type="number" min={1} max={1000} value={values.plannedWinners} onChange={event => change('plannedWinners', Number(event.target.value))} {...invalid('plannedWinners')} />{fieldError('plannedWinners')}</label>
        <label className={LABEL_CLASS}><span className={FIELD_LABEL_CLASS}>1인당 적립금 (원)</span><input className={KIT_INPUT_CLASS} data-slot="input" type="number" min={1} max={policy?.enabled && policy.maxBalance !== null ? policy.maxBalance : 999999999999} value={values.creditAmount} onChange={event => change('creditAmount', Number(event.target.value))} {...invalid('creditAmount')} />{fieldError('creditAmount')}</label>
        <label className={LABEL_CLASS}><span className={FIELD_LABEL_CLASS}>지급 후 유효기간 (일)</span><input className={KIT_INPUT_CLASS} data-slot="input" type="number" min={1} max={policy?.enabled && policy.validityDays !== null ? policy.validityDays : 36500} value={values.creditValidityDays} onChange={event => change('creditValidityDays', Number(event.target.value))} {...invalid('creditValidityDays')} />{fieldError('creditValidityDays')}</label></div>
        <p className="text-sm">예상 지급액 <strong className="font-semibold text-foreground tabular-nums">{(values.plannedWinners * values.creditAmount).toLocaleString('ko-KR')}원</strong></p>{editable ? <><AdminNotice tone="warning">별점과 무관하게 선정하세요. 발표일 이후 지급 권한이 있는 운영자가 발표·지급을 실행해야 합니다.</AdminNotice><p className={HELP_CLASS}>실제 선정 수는 예정 인원과 달라도 되며, 고객 한 명당 한 번 지급합니다. 적립금 정책의 상한과 유효기간 제한이 적용됩니다.</p></> : null}
        <label className={`${LABEL_CLASS} md:max-w-xs`}><span className={FIELD_LABEL_CLASS}>배너 디자인</span><AdminSelect value={values.bannerStyle} onChange={event => change('bannerStyle', event.target.value as 'basic' | 'emphasis')}><option value="basic">기본형</option><option value="emphasis">강조형</option></AdminSelect></label>
      </section>
    </fieldset>
    <section className={PANEL_CLASS}><h2 className={PANEL_TITLE_CLASS}>상품 상세 배너 미리보기</h2><div className="[&_[data-style=emphasis]_b]:text-inherit [&_[data-style=emphasis]_strong]:text-inherit"><ReviewEventBanner preview event={{ ...values, id, state: 'active', announcedAt: null, nextChangeAt: null }} /></div><p className={HELP_CLASS}>상품 상세·리뷰 작성·작성 가능한 리뷰 목록에는 진행 중인 이벤트를 안내합니다. 공개 이벤트 목록은 시작 3일 전부터 발표 예정일 1년 후까지 제공됩니다.</p></section>
    <div className="flex flex-wrap items-center gap-2">{editable ? <button type="button" className={buttonVariants()} data-slot="button" disabled={blocked} onClick={save}>이벤트 저장</button> : null}{saved?.canEdit ? <button type="button" className={buttonVariants({ variant: 'outline' })} data-slot="button" disabled={blocked || dirtyTerms} onClick={() => { if (window.confirm(saved.archivedAt ? '이 이벤트를 다시 공개 일정에 포함할까요?' : '시작 전 이벤트를 보관할까요? 공개 화면에서 제외됩니다.')) run({ ...request('archive'), kind: 'archive', archived: !saved.archivedAt }); }}>{saved.archivedAt ? '보관 해제' : '이벤트 보관'}</button> : null}{saved && saved.state !== 'archived' ? <Link className={buttonVariants({ variant: 'ghost' })} data-slot="button" href={`${REVIEW_EVENTS_PATH}/${id}`} target="_blank">공개 화면 확인 ↗</Link> : null}</div>
    {workspace && saved ? <section className={`${PANEL_CLASS} scroll-mt-16`} id="review-event-selection"><h2 className={PANEL_TITLE_CLASS}>응모 및 당첨자 선정</h2><p className="text-sm text-muted-foreground tabular-nums">응모 {saved.entryCount}건 · 저장된 선정 {saved.selectedCount}명 · 지급 {saved.awardedCount}명 · 회수 {saved.revokedCount}명</p>
      <form method="get"><fieldset className="flex min-w-0 flex-wrap items-end gap-3 disabled:opacity-60" disabled={blocked || dirtySelection}><label className="flex min-w-[min(100%,14rem)] flex-1 flex-col gap-1.5"><span className={FIELD_LABEL_CLASS}>리뷰·고객·상품 검색</span><input className={KIT_INPUT_CLASS} data-slot="input" name="q" defaultValue={query} maxLength={100} /></label><label className={`${LABEL_CLASS} w-40`}><span className={FIELD_LABEL_CLASS}>응모 상태</span><AdminSelect name="filter" defaultValue={filter}><option value="all">전체</option><option value="eligible">선정 가능</option><option value="selected">선정됨</option><option value="awarded">지급 완료</option><option value="revoked">회수됨</option><option value="unavailable">선정 불가</option></AdminSelect></label><button className={buttonVariants({ variant: 'soft' })} data-slot="button" type="submit">검색</button></fieldset></form>
      {dirtySelection ? <p className={HELP_CLASS}>변경한 선정을 저장하면 다른 페이지로 이동할 수 있습니다.</p> : null}
      <ReviewEventExportButton entries total={workspace.total} disabled={blocked || dirtySelection || dirtyTerms} href={reviewEventExportHref({ mode: 'entries', eventId: id, query: query.trim(), filter: Object.hasOwn(REVIEW_EVENT_ENTRY_FILTERS, filter) ? filter as keyof typeof REVIEW_EVENT_ENTRY_FILTERS : 'all' })} />
      <div className="flex flex-col gap-3">{workspace.rows.map(entry => <article key={entry.id} className="flex min-w-0 flex-col gap-2 rounded-lg border p-4 text-sm wrap-anywhere"><header className="flex flex-wrap items-center justify-between gap-3"><label className="flex items-center gap-2 font-medium"><input type="checkbox" aria-label={`${entry.nickname} 리뷰 선정`} checked={selected.some(item => item.id === entry.id)} disabled={blocked || !canSelect || !!entry.grantedAt || !selected.some(item => item.id === entry.id) && !!entry.problem} onChange={event => select(entry, event.target.checked)} />@{entry.nickname}</label><span className="text-xs text-muted-foreground">{entry.rating ?? '-'}점 · {entry.goodName}</span></header><p className="leading-relaxed whitespace-pre-wrap">{entry.body ?? '삭제된 리뷰입니다.'}</p>{entry.imageUrls?.length ? <div className="flex flex-wrap gap-2.5">{entry.imageUrls.map(url => <img alt="응모 리뷰 사진" className="size-25 rounded-md border object-cover" src={url} key={url} loading="lazy" />)}</div> : null}<small className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"><AdminStatusBadge tone={entry.revokedAt ? 'neutral' : entry.grantedAt ? 'success' : entry.problem ? 'warning' : 'neutral'}>{entry.revokedAt ? '회수 완료' : entry.grantedAt ? '지급 완료' : reviewEventProblemLabel(entry.problem)}</AdminStatusBadge>{entry.selectionChanged ? <span className="text-warning">선정 후 리뷰가 수정되었습니다. 체크 해제 후 다시 선정·저장하세요.</span> : null}</small>{entry.selectionReason ? <small className="text-xs text-muted-foreground">선정 사유: {entry.selectionReason}</small> : null}{entry.grantedAt ? <p className="text-xs tabular-nums">지급 {new Date(entry.grantedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} · {entry.creditAmount.toLocaleString('ko-KR')}원{entry.revokedAt ? <><br />회수: {entry.revokeReason}</> : <> · 유효기한 {entry.expiresAt ? new Date(entry.expiresAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '-'}</>}</p> : null}{entry.grantedAt && !entry.revokedAt && workspace.canPay ? <button type="button" className={buttonVariants({ size: 'sm', variant: 'outline', className: `self-start ${ROW_DANGER_BUTTON_CLASS}` })} data-slot="button" disabled={blocked} onClick={() => { const note = window.prompt('혜택 회수 사유를 입력하세요. 이미 사용한 금액은 차감 예정액으로 기록됩니다. (2~500자)'); if (note !== null) run({ ...request('revoke'), kind: 'revoke', entryId: entry.id, reason: note }); }}>선정 혜택 회수</button> : null}</article>)}</div>
      {!workspace.rows.length ? <p className="py-6 text-center text-sm text-muted-foreground">조건에 맞는 응모 리뷰가 없습니다.</p> : null}{!dirtySelection ? <ConsolePagination page={workspace.page} pageSize={50} total={workspace.total} hrefForPage={page => `${detailPath}?${new URLSearchParams({ q: query, filter, page: String(page) })}`} /> : null}
      {canSelect ? <div className="flex flex-col items-start gap-3 border-t pt-4"><p className="text-sm">현재 선택 <strong className="font-semibold text-foreground tabular-nums">{selected.length}명 · {selectedAmount.toLocaleString('ko-KR')}원</strong></p><label className={`${LABEL_CLASS} w-full`}><span className={FIELD_LABEL_CLASS}>선정 사유</span><textarea className={`${KIT_TEXTAREA_CLASS} min-h-20`} data-slot="textarea" value={reason} disabled={blocked} onChange={event => setReason(event.target.value)} maxLength={500} placeholder="별점과 무관한 선정 기준과 사유를 2자 이상 작성하세요" /></label><button type="button" className={buttonVariants({ variant: 'soft' })} data-slot="button" disabled={blocked || selected.length > 1000 || reason.trim().length < 2} onClick={() => run({ ...request('select'), kind: 'select', entries: selected, reason })}>선정 저장</button><p className={HELP_CLASS}>선정 저장은 발표나 지급을 하지 않습니다. 고객당 리뷰 하나만 선정할 수 있습니다.</p></div> : null}
      {!saved.announcedAt && !saved.archivedAt ? <div className="flex scroll-mt-16 flex-col items-start gap-3 border-t pt-4" id="review-event-publish"><h3 className="text-base font-semibold text-foreground">당첨자 발표 및 적립금 지급</h3><p className="text-sm">저장된 {saved.selectedCount}명에게 총 {(saved.selectedCount * saved.creditAmount).toLocaleString('ko-KR')}원을 지급합니다. 발표와 전체 지급은 함께 처리됩니다.</p>{!workspace.canPay ? <AdminNotice tone="warning">현재 계정에는 혜택 지급 권한이 없습니다.</AdminNotice> : !workspace.creditPolicy.enabled ? <AdminNotice tone="warning">적립금 정책이 비활성 상태입니다.</AdminNotice> : null}<button type="button" className={buttonVariants()} data-slot="button" disabled={blocked || dirtySelection || dirtyTerms || !workspace.canPay || !workspace.creditPolicy.enabled || saved.state !== 'ready'} onClick={() => { if (window.confirm(saved.selectedCount ? `저장된 ${saved.selectedCount}명에게 총 ${(saved.selectedCount * saved.creditAmount).toLocaleString('ko-KR')}원 지급과 당첨자 공개를 확정할까요?` : '선정된 고객이 0명입니다. 당첨자 없음으로 발표를 확정할까요?')) run({ ...request('publish'), kind: 'publish' }); }}>발표 및 지급 확정</button><p className={HELP_CLASS}>리뷰 삭제·비공개·구매 취소·반품 완료 시 이 이벤트에서 지급한 혜택을 회수합니다. 이미 사용된 금액은 이후 적립금에서 차감되며, 현금 결제액은 바뀌지 않습니다.</p></div> : null}
    </section> : null}
  </div>;
}
