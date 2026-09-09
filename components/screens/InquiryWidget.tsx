'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useActionState, useCallback, useEffect, useRef, useState } from 'react';
import { createWidgetInquiryAction, replyToInquiryAction, type InquiryActionState } from '@/app/my/inquiries/actions';
import { OverlayPortal } from '@/components/shell/OverlayPortal';
import { useOverlayA11y } from '@/components/shell/useOverlayA11y';
import { WcButton } from '@/components/wc/WcButton';
import { isStandaloneShellPath } from '@/lib/routes';
import type { FaqEntry } from '@/lib/faq';
import { formatInquiryDateTime, INQUIRY_CATEGORIES, INQUIRY_IMAGE_ACCEPT, INQUIRY_STATUS_LABELS, MAX_INQUIRY_BODY_LENGTH,
  MAX_INQUIRY_IMAGES, MAX_INQUIRY_TITLE_LENGTH, type InquiryCategory } from '@/lib/inquiries';
import type { InquiryListItem, InquiryThreadView } from '@/lib/inquiries.server';
import { observeInquiryChanges, type InquiryRealtimeClient } from '@/lib/inquiry-realtime';
import { createClient } from '@/lib/supabase/client';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { FaqSuggestionList } from './FaqSuggestions';

const EMPTY: InquiryActionState = {};
type WidgetView = 'faq' | 'list' | 'new' | 'thread';
interface WidgetData { userId: string; inquiries?: InquiryListItem[]; inquiry?: InquiryThreadView; error?: string }

function WidgetFaq() {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<{ query: string; entries: FaqEntry[]; error?: string }>();
  const normalized = query.trim();
  useEffect(() => {
    if (normalized.length === 1) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(normalized ? `/api/help?q=${encodeURIComponent(normalized)}` : '/api/help?featured=1', { signal: controller.signal });
        if (!response.ok) throw new Error('faq_unavailable');
        const data = await response.json() as { entries: FaqEntry[] };
        if (!controller.signal.aborted) setResult({ query: normalized, entries: data.entries });
      } catch {
        if (!controller.signal.aborted) setResult({ query: normalized, entries: [], error: 'FAQ를 불러오지 못했습니다. 문의를 계속할 수 있습니다.' });
      }
    }, normalized ? 250 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [normalized]);
  const current = result?.query === normalized ? result : undefined;
  return <section aria-label="자주 묻는 질문">
    <h3>자주 묻는 질문</h3>
    <label className="wc-inquiry-widget__field">궁금한 내용 검색<input type="search" value={query} maxLength={100} onChange={(event) => setQuery(event.target.value)} /></label>
    {current?.entries.length ? <FaqSuggestionList entries={current.entries} /> : <p role="status">
      {normalized.length === 1 ? '두 글자 이상 입력해주세요.' : !current ? 'FAQ를 불러오는 중입니다.' : current.error ?? '관련 질문이 없습니다. 새 문의를 남겨주세요.'}
    </p>}
    <Link href="/help" target="_blank" rel="noopener noreferrer">전체 FAQ 보기 (새 창)</Link>
  </section>;
}

function WidgetFeedback({ state }: { state: InquiryActionState }) {
  return <>{Object.entries(state.errors ?? {}).map(([key, value]) => value ? <p key={key} role="alert">{value}</p> : null)}
    {state.message ? <p role="status">{state.message}</p> : null}</>;
}
function WidgetImages() {
  return <label className="wc-inquiry-widget__field">이미지 첨부 · 최대 {MAX_INQUIRY_IMAGES}장
    <input type="file" name="images" accept={INQUIRY_IMAGE_ACCEPT} multiple />
  </label>;
}
function WidgetInquiryComposer({ onCreated }: { onCreated: (inquiryId: string) => void }) {
  const [state, action, pending] = useActionState(createWidgetInquiryAction, EMPTY);
  const [title, setTitle] = useState(''); const [body, setBody] = useState('');
  const [category, setCategory] = useState<InquiryCategory>('etc');
  useEffect(() => { if (state.inquiryId) onCreated(state.inquiryId); }, [onCreated, state.inquiryId]);
  return <form action={action} className="wc-inquiry-widget__form">
    <h3>새 문의</h3><p>영업일 기준 24시간 안에 첫 답변을 드립니다.</p>
    <fieldset disabled={pending}>
      <label className="wc-inquiry-widget__field">문의 유형<select name="category" value={category} onChange={(event) => setCategory(event.target.value as InquiryCategory)}>
        {INQUIRY_CATEGORIES.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
      </select></label>
      <label className="wc-inquiry-widget__field">제목<input name="title" value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={MAX_INQUIRY_TITLE_LENGTH} /></label>
      <label className="wc-inquiry-widget__field">문의 내용<textarea name="body" value={body} onChange={(event) => setBody(event.target.value)} required maxLength={MAX_INQUIRY_BODY_LENGTH} rows={5} /></label>
      <WidgetImages />
    </fieldset>
    <WidgetFeedback state={state} /><WcButton type="submit" variant="primary" disabled={pending}>{pending ? '접수 중' : '문의 접수'}</WcButton>
  </form>;
}

export function WidgetInquiryConversation({ inquiry, onSaved }: { inquiry: InquiryThreadView; onSaved: () => void }) {
  const [state, action, pending] = useActionState(replyToInquiryAction, EMPTY);
  const [body, setBody] = useState(''); const [completed, setCompleted] = useState<string>();
  if (state.resultKey && state.resultKey !== completed) { setCompleted(state.resultKey); setBody(''); }
  useEffect(() => { if (state.resultKey) onSaved(); }, [onSaved, state.resultKey]);
  return <section aria-label="문의 대화">
    <h3>{inquiry.title}</h3><p>{INQUIRY_STATUS_LABELS[inquiry.status]}</p>
    <ol className="wc-inquiry-widget__messages" aria-live="polite" aria-relevant="additions">
      {inquiry.messages.map((message) => <li key={message.id} data-author={message.author}>
        <span>{message.author === 'staff' ? message.authorName ?? 'ICONS 운영자' : '내 문의'} · {formatInquiryDateTime(message.createdAt)}</span>
        <p>{message.body}</p>{message.imageUrls.map((url, index) =>
          // eslint-disable-next-line @next/next/no-img-element
          <img key={url} src={url} alt={`첨부 이미지 ${index + 1}`} />)}
      </li>)}
    </ol>
    {inquiry.status === 'closed' ? <p role="status">종결된 문의입니다. 더 궁금한 점은 새 문의로 남겨주세요.</p> :
      <form action={action} className="wc-inquiry-widget__form" key={state.resultKey ?? inquiry.id}>
        <input type="hidden" name="inquiryId" value={inquiry.id} />
        <fieldset disabled={pending}><label className="wc-inquiry-widget__field">추가 문의
          <textarea name="body" value={body} onChange={(event) => setBody(event.target.value)} required maxLength={MAX_INQUIRY_BODY_LENGTH} rows={3} />
        </label><WidgetImages /></fieldset>
        <WidgetFeedback state={state} /><WcButton type="submit" variant="primary" disabled={pending}>{pending ? '보내는 중' : '추가 문의 보내기'}</WcButton>
      </form>}
  </section>;
}

/** A new identity remounts this panel; delayed responses also verify their owner. */
export function InquiryWidgetPanel({ userId, onClose, clientFactory = createClient }: {
  userId: string | null; onClose: () => void; clientFactory?: () => InquiryRealtimeClient;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useOverlayA11y({ open: true, onClose, panelRef });
  const [view, setView] = useState<WidgetView>('faq');
  const [inquiryId, setInquiryId] = useState<string>();
  const [result, setResult] = useState<{ key: string; data?: WidgetData; error?: string }>();
  const [revision, setRevision] = useState(0);
  const [disconnected, setDisconnected] = useState(false);
  const requestKey = `${userId}:${view}:${inquiryId ?? ''}`;
  useEffect(() => {
    if (!userId || !['list', 'thread'].includes(view)) return;
    let active = true; let controller: AbortController | undefined; let timer: ReturnType<typeof setTimeout> | undefined;
    const reload = async () => {
      controller?.abort(); controller = new AbortController(); const request = controller;
      try {
        const response = await fetch(view === 'thread' ? `/api/inquiries?inquiryId=${encodeURIComponent(inquiryId ?? '')}` : '/api/inquiries', { signal: request.signal });
        const data = await response.json() as WidgetData;
        if (!response.ok || data.userId !== userId) throw new Error('inquiry_unavailable');
        if (active && !request.signal.aborted) setResult({ key: requestKey, data });
      } catch {
        if (active && !request.signal.aborted) setResult({ key: requestKey, error: '문의를 불러오지 못했습니다. 로그인 상태를 확인하고 다시 시도해주세요.' });
      }
    };
    void reload();
    const refresh = () => { if (!timer) timer = setTimeout(() => { timer = undefined; void reload(); }, 100); };
    const stop = observeInquiryChanges(clientFactory(), { inquiryId: view === 'thread' ? inquiryId : undefined,
      onChange: refresh, onReady: () => { setDisconnected(false); refresh(); }, onDisconnected: () => setDisconnected(true) });
    return () => { active = false; controller?.abort(); clearTimeout(timer); stop(); };
  }, [clientFactory, inquiryId, requestKey, revision, userId, view]);
  const current = result?.key === requestKey ? result : undefined;
  // Stable callbacks keep a successful action from retriggering after every live read.
  const onCreated = useCallback((id: string) => { setInquiryId(id); setView('thread'); }, []);
  const onSaved = useCallback(() => setRevision((value) => value + 1), []);
  return <><div className="wc-inquiry-widget__backdrop" aria-hidden="true" onClick={onClose} />
    <div ref={panelRef} className="wc-inquiry-widget__panel" role="dialog" aria-modal="true" aria-label="ICONS 상담">
      <header><h2>ICONS 상담</h2><button type="button" aria-label="상담 닫기" onClick={onClose}>닫기</button></header>
      <nav aria-label="상담 메뉴"><button type="button" onClick={() => setView('faq')} aria-pressed={view === 'faq'}>FAQ</button>
        {userId ? <><button type="button" onClick={() => setView('list')} aria-pressed={view === 'list' || view === 'thread'}>내 문의</button>
          <button type="button" onClick={() => setView('new')} aria-pressed={view === 'new'}>새 문의</button></> : null}
      </nav>
      <div className="wc-inquiry-widget__content">
        {view === 'faq' ? <WidgetFaq /> : null}
        {!userId ? <div className="wc-inquiry-widget__login"><p>개인 문의와 답변은 로그인 후 확인할 수 있습니다.</p><WcButton href="/login?next=%2Fmy%2Finquiries" onClick={onClose}>로그인하고 문의하기</WcButton></div> : null}
        {userId && view === 'new' ? <WidgetInquiryComposer onCreated={onCreated} /> : null}
        {userId && ['list', 'thread'].includes(view) ? <>
          {disconnected ? <p role="status">실시간 연결을 다시 시도하고 있습니다.</p> : null}
          {!current ? <p role="status">문의를 불러오는 중입니다.</p> : current.error ? <p role="alert">{current.error}</p> : null}
          <button className="wc-inquiry-widget__refresh" type="button" onClick={onSaved}>지금 새로고침</button>
          {view === 'list' && current?.data?.inquiries ? <ul className="wc-inquiry-widget__threads">{current.data.inquiries.length ? current.data.inquiries.map((entry) =>
            <li key={entry.id}><button type="button" onClick={() => { setInquiryId(entry.id); setView('thread'); }}>
              <strong>{entry.title}</strong><span>{INQUIRY_STATUS_LABELS[entry.status]} · {formatInquiryDateTime(entry.lastMessageAt)}</span>
            </button></li>) : <li>아직 등록한 문의가 없습니다.</li>}</ul> : null}
          {view === 'thread' && current?.data?.inquiry ? <WidgetInquiryConversation key={current.data.inquiry.id} inquiry={current.data.inquiry} onSaved={onSaved} /> : null}
        </> : null}
      </div>
    </div>
  </>;
}

function InquiryWidgetDialog({ onClose }: { onClose: () => void }) {
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => {
    if (!getSupabaseConfig().isConfigured) return;
    const client = createClient(); let active = true; let observed = false;
    const { data } = client.auth.onAuthStateChange((_event, session) => { observed = true; if (active) setUserId(session?.user.id ?? null); });
    void client.auth.getUser().then(({ data: auth }) => { if (active && !observed) setUserId(auth.user?.id ?? null); }, () => {});
    return () => { active = false; data.subscription.unsubscribe(); };
  }, []);
  return <InquiryWidgetPanel key={userId ?? 'anonymous'} userId={userId} onClose={onClose} />;
}

export function InquiryWidget() {
  const pathname = usePathname();
  const [overlay, setOverlay] = useState({ pathname, open: false });
  if (overlay.pathname !== pathname) setOverlay({ pathname, open: false });
  if (isStandaloneShellPath(pathname)) return null;
  const open = overlay.pathname === pathname && overlay.open;
  return <div className="wc-root wc-inquiry-widget">
    <button className="wc-inquiry-widget__launcher" type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOverlay({ pathname, open: true })}>FAQ · 문의</button>
    {open ? <OverlayPortal><InquiryWidgetDialog onClose={() => setOverlay({ pathname, open: false })} /></OverlayPortal> : null}
  </div>;
}
