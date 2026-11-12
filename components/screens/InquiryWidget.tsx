'use client';

import { InquiryMessageBody } from './InquiryMessageBody';
import { InquiryMessageFiles } from './InquiryMessageFiles';
import { inquiryMessageAuthorLabel } from '@/lib/inquiries';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useActionState, useCallback, useEffect, useRef, useState } from 'react';
import { createWidgetInquiryAction, replyToInquiryAction, type InquiryActionState } from '@/app/my/inquiries/actions';
import { OverlayPortal } from '@/components/shell/OverlayPortal';
import { useOverlayA11y } from '@/components/shell/useOverlayA11y';
import { WcButton } from '@/components/wc/WcButton';
import { isStandaloneShellPath } from '@/lib/routes';
import { FAQ_WIDGET_TOPICS, type FaqEntry, type FaqWidgetTopic, type FaqWidgetTopicAnswer } from '@/lib/faq';
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

/*
 * 버튼형 자주 묻는 질문(0901-044). FAQ 위 유형 버튼을 누르면 운영자가 FAQ 관리에서 지정한 대표 답을 바로 보이고,
 * 지정이 없으면 서버가 고른 목록(질문에 버튼 낱말이 든 공개 FAQ, 없으면 그 카테고리의 공개 FAQ)을 보인다. 답변 문구는 운영 FAQ가 정본이고, 아래 기본 안내는
 * 공개 FAQ가 하나도 없을 때만 쓴다. 내 주문 배송 조회 바로가기는 로그인 고객에게만 열고, 비로그인은 로그인 안내다.
 */
const WIDGET_TOPIC_DEFAULT_ANSWERS: Record<FaqWidgetTopic, string> = {
  delivery: '주문한 굿즈의 배송 상태는 내 주문에서 확인할 수 있습니다.',
  cancel: '주문 취소는 내 주문의 주문 상세에서 요청할 수 있습니다.',
  return: '교환·반품은 내 주문의 주문 상세에서 요청할 수 있습니다.',
};
const ORDERS_HREF = '/orders';
const ORDERS_LOGIN_HREF = `/login?next=${encodeURIComponent(ORDERS_HREF)}`;

export function WidgetFaqTopicAnswer({ topic, answer, error, signedIn, onNavigate }: {
  topic: FaqWidgetTopic; answer?: FaqWidgetTopicAnswer; error?: string; signedIn: boolean; onNavigate: () => void;
}) {
  return <div className="wc-inquiry-widget__topic-answer" data-topic={topic}>
    {/* 바깥 영역이 aria-live라 안쪽 문구에는 role을 겹치지 않는다. */}
    {error ? <p>{error}</p>
      : !answer ? <p>답변을 불러오는 중입니다.</p>
        : answer.entry ? <><h4>{answer.entry.question}</h4><p className="wc-inquiry-widget__topic-text">{answer.entry.answer}</p></>
          : answer.entries.length ? <FaqSuggestionList entries={answer.entries} />
            : <p className="wc-inquiry-widget__topic-text">{WIDGET_TOPIC_DEFAULT_ANSWERS[topic]}</p>}
    {signedIn
      ? <Link className="wc-inquiry-widget__topic-link" href={ORDERS_HREF} onClick={onNavigate}>내 주문 배송 조회</Link>
      : <p className="wc-inquiry-widget__topic-login">내 주문 배송 조회는 로그인 후 이용할 수 있습니다. <Link href={ORDERS_LOGIN_HREF} onClick={onNavigate}>로그인하고 배송 조회</Link></p>}
  </div>;
}

export function WidgetFaqTopics({ signedIn, onNavigate, initialTopic = null }: { signedIn: boolean; onNavigate: () => void; initialTopic?: FaqWidgetTopic | null }) {
  const [topic, setTopic] = useState<FaqWidgetTopic | null>(initialTopic);
  const [result, setResult] = useState<{ topic: FaqWidgetTopic; answer?: FaqWidgetTopicAnswer; error?: string }>();
  useEffect(() => {
    if (!topic) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/help?topic=${topic}`, { signal: controller.signal });
        if (!response.ok) throw new Error('faq_topic_unavailable');
        const answer = await response.json() as FaqWidgetTopicAnswer;
        if (!controller.signal.aborted) setResult({ topic, answer });
      } catch {
        if (!controller.signal.aborted) setResult({ topic, error: '답변을 불러오지 못했습니다. 아래 FAQ 검색이나 문의를 이용해주세요.' });
      }
    })();
    return () => controller.abort();
  }, [topic]);
  const current = topic && result?.topic === topic ? result : undefined;
  return <section className="wc-inquiry-widget__topics" aria-labelledby="inquiry-widget-topics-title">
    <h3 id="inquiry-widget-topics-title">자주 찾는 문의</h3>
    <div className="wc-inquiry-widget__topic-buttons" role="group" aria-labelledby="inquiry-widget-topics-title">
      {FAQ_WIDGET_TOPICS.map((entry) => <button key={entry.id} type="button" aria-pressed={topic === entry.id}
        aria-controls="inquiry-widget-topic-answer" onClick={() => setTopic((value) => value === entry.id ? null : entry.id)}>{entry.label}</button>)}
    </div>
    <div id="inquiry-widget-topic-answer" aria-live="polite">
      {topic ? <WidgetFaqTopicAnswer topic={topic} answer={current?.answer} error={current?.error} signedIn={signedIn} onNavigate={onNavigate} /> : null}
    </div>
  </section>;
}

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
        <span>{inquiryMessageAuthorLabel(message.author,message.authorName)} · {formatInquiryDateTime(message.createdAt)}</span>
        <p><InquiryMessageBody body={message.body} automatic={message.author==='system'}/></p>{message.imageUrls.map((url, index) =>
          // eslint-disable-next-line @next/next/no-img-element
          <img key={url} src={url} alt={`첨부 이미지 ${index + 1}`} />)}<InquiryMessageFiles files={message.files} messageId={message.id} />
      </li>)}
    </ol>
    {inquiry.status === 'closed' ? <p role="status">종결된 문의입니다. 더 궁금한 점은 새 문의로 남겨주세요.</p> :
      <form action={action} className="wc-inquiry-widget__form" key={state.resultKey ?? inquiry.id}>
        <input type="hidden" name="inquiryId" value={inquiry.id} />
        <fieldset disabled={pending}><label className="wc-inquiry-widget__field">추가 문의
          <textarea name="body" value={body} onChange={(event) => setBody(event.target.value)} maxLength={MAX_INQUIRY_BODY_LENGTH} rows={3} />
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
      onChange: refresh, onReady: () => { setDisconnected(false); refresh(); }, onDisconnected: () => setDisconnected(true), onResync: refresh });
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
        {view === 'faq' ? <><WidgetFaqTopics signedIn={Boolean(userId)} onNavigate={onClose} /><WidgetFaq /></> : null}
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

/*
 * 아래로 스크롤하는 동안 문의 런처를 비킨다(QA1 고객 — 모바일에서 떠 있는 [FAQ · 문의]가 요약 금액·배송비 안내를 가렸다).
 * 위로 스크롤하거나 맨 위 가까이면 다시 보인다. 숨김 모양은 990px 미만에서만 그린다(CSS) — 데스크톱은 런처가 여백에 선다.
 */
/** 런처 사각형이 가리면 안 되는 영역(요약 금액 등) 가운데 하나라도 겹치는지. 순수 함수라 화면 없이 시험한다. */
export function launcherCoversAvoidZone(
  launcher: { left: number; top: number; right: number; bottom: number },
  zones: readonly { left: number; top: number; right: number; bottom: number }[],
): boolean {
  return zones.some(zone => zone.right > launcher.left && zone.left < launcher.right && zone.bottom > launcher.top && zone.top < launcher.bottom);
}

/** 런처가 서는 자리(고정 위치) 기준 사각형. transform으로 숨기는 동안에도 값이 흔들리지 않도록 계산한 위치와 offset 크기만 쓴다. */
function launcherFixedRect(button: HTMLElement) {
  const bottom = Number.parseFloat(window.getComputedStyle(button).bottom) || 0;
  const right = Number.parseFloat(window.getComputedStyle(button).right) || 0;
  const bottomEdge = window.innerHeight - bottom;
  const rightEdge = window.innerWidth - right;
  return { left: rightEdge - button.offsetWidth, top: bottomEdge - button.offsetHeight, right: rightEdge, bottom: bottomEdge };
}

function useLauncherTucked(startTucked: boolean): boolean {
  /* 장바구니는 첫 화면 아래에 요약 금액·배송비 안내와 하단 주문 바가 겹쳐 서 있다 — 런처가 처음부터 비켜 있고 위로 스크롤하면 돌아온다(T22i).
     스크롤이 한 번이라도 판정하면(override) 그 값을 따른다. */
  const [override, setTucked] = useState<boolean | null>(null);
  /* 위로 스크롤해 돌아오는 런처가 요약 금액을 가리지 않게(QA2 고객 S-W1m-03): 화면에 `data-inquiry-avoid` 영역(장바구니·주문서 요약)이
     런처 자리와 겹치는 동안은 스크롤 방향과 상관없이 비켜 둔다. */
  const [covering, setCovering] = useState(false);
  const tucked = covering || (override ?? startTucked);
  useEffect(() => {
    let last = window.scrollY;
    let frame = 0;
    const measure = () => {
      const button = document.querySelector<HTMLElement>('.wc-inquiry-widget__launcher');
      const zones = [...document.querySelectorAll<HTMLElement>('[data-inquiry-avoid]')].map(element => element.getBoundingClientRect());
      setCovering(Boolean(button) && zones.length > 0 && launcherCoversAvoidZone(launcherFixedRect(button!), zones));
    };
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        measure();
        const y = window.scrollY;
        if (Math.abs(y - last) < 8) return;
        setTucked(y > last && y > 120);
        last = y;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    /* 요약 영역은 화면이 그려진 뒤(견적·장바구니를 읽은 뒤)에 생긴다 — 새로 붙거나 떨어지면 다시 잰다. */
    const observer = new MutationObserver(onScroll);
    observer.observe(document.body, { childList: true, subtree: true });
    onScroll();
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);
  return tucked;
}

export function InquiryWidget() {
  const pathname = usePathname();
  const tucked = useLauncherTucked(pathname === '/cart' || pathname.startsWith('/cart/'));
  const [overlay, setOverlay] = useState({ pathname, open: false });
  if (overlay.pathname !== pathname) setOverlay({ pathname, open: false });
  /* /login은 전역 셸 안에서 열리지만(L3) 입력에 집중하는 흐름이라 런처를 띄우지 않는다 — 모바일에서 소셜 버튼을 가린다. */
  if (isStandaloneShellPath(pathname) || pathname === '/login') return null;
  const open = overlay.pathname === pathname && overlay.open;
  return <div className="wc-root wc-inquiry-widget">
    <button className="wc-inquiry-widget__launcher" data-tucked={tucked && !open ? 'true' : undefined} type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOverlay({ pathname, open: true })}>FAQ · 문의</button>
    {open ? <OverlayPortal><InquiryWidgetDialog onClose={() => setOverlay({ pathname, open: false })} /></OverlayPortal> : null}
  </div>;
}
