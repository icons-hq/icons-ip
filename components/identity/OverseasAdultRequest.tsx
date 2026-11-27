'use client';

import { Check, ChevronDown, CircleCheck, Clock3, CalendarDays, CircleAlert, FileCheck2, Globe2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import { cancelOverseasRequest, readOwnOverseasRequest } from '@/app/my/adult-verification/overseas/actions';
import type { OverseasRequestStatus } from '@/lib/identity/overseas-adult';
import { documentCopy, type DocumentLanguage } from './overseas-document-copy';
import { OverseasPhotoForm } from './OverseasPhotoForm';

export function OverseasAdultRequest({ initialStatus, initialLanguage, next }: {
  initialStatus: OverseasRequestStatus | null;
  initialLanguage: DocumentLanguage;
  next: string;
}) {
  const router = useRouter();
  const [lang, setLang] = useState(initialLanguage);
  const [guideOpen, setGuideOpen] = useState(false);
  const guideId = useId();
  const [failed, setFailed] = useState(false);
  const [pending, start] = useTransition();
  const [checking, startCheck] = useTransition();
  const [lastCheck, setLastCheck] = useState<OverseasRequestStatus | null>(null);
  const [checkFailed, setCheckFailed] = useState(false);
  const t = documentCopy[lang];
  const status = lastCheck && (!initialStatus || lastCheck.checkedAt >= initialStatus.checkedAt) ? lastCheck : initialStatus;
  const request = status?.request;
  const intakeStatus = status?.intakeStatus ?? 'error';
  const stages = {
    uploading: { title: t.uploading, detail: t.processing },
    pending: { title: t.waiting, detail: t.pending },
    reviewing: { title: t.reviewing, detail: t.awaitingResult },
    purging: { title: t.purging, detail: t.processing },
  };
  const stage = request && request.state !== 'closed' && request.state !== 'draft' ? stages[request.state] : null;
  const approved = Boolean(request?.validUntil);
  const canApply = intakeStatus === 'open' && !stage && !approved;
  const previous = request?.state === 'closed' && !approved && request.outcome
    ? t[request.outcome === 'approved' ? 'ended' : request.outcome] : null;
  const closedText = { policy_pending: t.policyPending, store_closed: t.storeClosed, review_paused: t.paused, error: t.readError, domestic: t.domestic, open: '' }[intakeStatus];
  const refresh = () => {
    setLastCheck(null);
    setCheckFailed(false);
    start(() => router.refresh());
  };
  const cancel = () => start(async () => {
    if (!request) return;
    setCheckFailed(false);
    setLastCheck(null);
    try { setFailed(!(await cancelOverseasRequest(request.id))); } catch { setFailed(true); }
    router.refresh();
  });
  const checkStatus = () => {
    setCheckFailed(false);
    startCheck(async () => {
      const latest = await readOwnOverseasRequest().catch(() => null);
      if (!latest) { setCheckFailed(true); return; }
      setLastCheck(latest);
      setFailed(false);
    });
  };
  const statusButton = (
    <button className="wc-btn" type="button" disabled={checking || pending} aria-busy={checking} onClick={checkStatus}>
      {checking ? t.checking : t.reload}
    </button>
  );
  const feedback = (
    <p className="wc-overseas__feedback" role="status" aria-atomic="true" data-error={checkFailed}>
      {!checking && (checkFailed ? t.checkFailed : lastCheck && <>
        {!request && intakeStatus === 'open' && <>{t.noRequest} </>}
        {t.checked} · <time dateTime={lastCheck.checkedAt}>{new Intl.DateTimeFormat(lang === 'ko' ? 'ko-KR' : 'en-GB', {
          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Seoul',
        }).format(new Date(lastCheck.checkedAt))}</time> ({t.kst})
      </>)}
    </p>
  );
  return (
    <section className="wc-overseas" lang={lang}>
      <header className="wc-overseas__heading">
        <h1>{t.title}</h1>
        <div className="wc-overseas__languages" role="group" aria-label="언어 / Language">
          <Globe2 size={15} aria-hidden="true" />
          {(['ko','en'] as const).map((key) => (
            <button key={key} type="button" lang={key} aria-pressed={key === lang} onClick={() => setLang(key)}>
              {key === 'ko' ? '한국어' : 'English'}
            </button>
          ))}
        </div>
      </header>
      {canApply ? <>
        <p className="wc-overseas__intro">{t.intro}</p>
        {previous && <p className="wc-overseas__notice" role="status">{previous}</p>}
        <div className="wc-overseas__layout">
          <aside className="wc-overseas__guide">
            <h2 className="wc-overseas__guide-title"><FileCheck2 size={20} aria-hidden="true" />{t.guide}</h2>
            <button className="wc-overseas__guide-toggle" type="button" aria-expanded={guideOpen} aria-controls={guideId} onClick={() => setGuideOpen(!guideOpen)}>
              <FileCheck2 size={18} aria-hidden="true" />{t.guide}<ChevronDown size={16} aria-hidden="true" />
            </button>
            <p className="wc-overseas__guide-short">{t.quickGuide}</p>
            <div id={guideId} className="wc-overseas__guide-detail" data-open={guideOpen}>
              <p>{t.documents}</p>
              <dl>
              <dt><CalendarDays size={16} aria-hidden="true" />{t.show}</dt><dd>{t.visibleFields}</dd>
              <dt><CircleAlert size={16} aria-hidden="true" />{t.hide}</dt><dd>{t.hiddenFields}</dd>
              </dl>
            </div>
          </aside>
          <OverseasPhotoForm copy={t} onRefresh={refresh} statusButton={statusButton} feedback={feedback} checking={checking} />
        </div>
      </> : (
        <div className="wc-overseas__status">
          {approved || intakeStatus === 'domestic' ? <CircleCheck aria-hidden="true" /> : <Clock3 aria-hidden="true" />}
          {stage && request && <p className="wc-overseas__reference">{t.number} {request.number}</p>}
          <h2 aria-live="polite">{approved ? t.approved : stage?.title ?? closedText}</h2>
          {previous && <p>{previous}</p>}
          {approved && request?.validUntil && <p>{new Intl.DateTimeFormat(lang === 'ko' ? 'ko-KR' : 'en-US', { dateStyle: 'long', timeZone: 'Asia/Seoul' }).format(new Date(request.validUntil))}{t.valid}</p>}
          {stage && <p>{stage.detail}</p>}
          <div className="wc-overseas__actions">
            {approved || intakeStatus === 'domestic' ? <Link className="wc-btn primary" href={next}><Check size={16} aria-hidden="true" />{t.continue}</Link> : statusButton}
            {stage && request?.state !== 'purging' && <button className="wc-overseas__text-button" type="button" disabled={pending || checking} onClick={cancel}>{t.cancel}</button>}
          </div>
          {feedback}
          {failed && <p role="alert">{t.cancelFailed}</p>}
        </div>
      )}
    </section>
  );
}
