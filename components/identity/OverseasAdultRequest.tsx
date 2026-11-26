'use client';

import { Check, ChevronDown, CircleCheck, Clock3, Eye, EyeOff, FileCheck2, Globe2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import { cancelOverseasRequest } from '@/app/my/adult-verification/overseas/actions';
import type { OverseasIntakeStatus, OverseasRequest } from '@/lib/identity/overseas-adult';
import { documentCopy, type DocumentLanguage } from './overseas-document-copy';
import { OverseasPhotoForm } from './OverseasPhotoForm';

export function OverseasAdultRequest({ intakeStatus, request, birthDate, initialLanguage, next }: {
  intakeStatus: OverseasIntakeStatus | 'domestic' | 'error';
  request: OverseasRequest | null;
  birthDate: string;
  initialLanguage: DocumentLanguage;
  next: string;
}) {
  const router = useRouter();
  const [lang, setLang] = useState(initialLanguage);
  const [guideOpen, setGuideOpen] = useState(false);
  const guideId = useId();
  const [failed, setFailed] = useState(false);
  const [pending, start] = useTransition();
  const t = documentCopy[lang];
  const active = request && request.state !== 'closed' && request.state !== 'draft';
  const approved = Boolean(request?.validUntil);
  const canApply = intakeStatus === 'open' && !active && !approved;
  const previous = request?.state === 'closed' && !approved && request.outcome
    ? t[request.outcome === 'approved' ? 'ended' : request.outcome] : null;
  const closedText = { policy_pending: t.policyPending, store_closed: t.storeClosed, review_paused: t.paused, error: t.readError, domestic: t.domestic, open: '' }[intakeStatus];
  const cancel = () => start(async () => {
    if (!request) return;
    try { setFailed(!(await cancelOverseasRequest(request.id))); } catch { setFailed(true); }
    router.refresh();
  });
  const refresh = () => start(() => router.refresh());
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
              <dt><Eye size={16} aria-hidden="true" />{t.show}</dt><dd>{t.visibleFields}</dd>
              <dt><EyeOff size={16} aria-hidden="true" />{t.hide}</dt><dd>{t.hiddenFields}</dd>
              </dl>
            </div>
          </aside>
          <OverseasPhotoForm copy={t} birthDate={birthDate} onRefresh={refresh} />
        </div>
      </> : (
        <div className="wc-overseas__status" role={intakeStatus === 'error' ? 'alert' : 'status'}>
          {approved || intakeStatus === 'domestic' ? <CircleCheck aria-hidden="true" /> : <Clock3 aria-hidden="true" />}
          {active && request && <p className="wc-overseas__reference">{t.number} {request.number}</p>}
          <h2>{approved ? t.approved : active ? request.state === 'purging' ? t.purging : request.state === 'uploading' ? t.uploading : t.received : closedText}</h2>
          {approved && request?.validUntil && <p>{new Intl.DateTimeFormat(lang === 'ko' ? 'ko-KR' : 'en-US', { dateStyle: 'long', timeZone: 'Asia/Seoul' }).format(new Date(request.validUntil))}{t.valid}</p>}
          {active && <p>{request.state === 'pending' || request.state === 'reviewing' ? t.pending : t.processing}</p>}
          <div className="wc-overseas__actions">
            {approved || intakeStatus === 'domestic' ? <Link className="wc-btn primary" href={next}><Check size={16} aria-hidden="true" />{t.continue}</Link> :
              <button className="wc-btn" type="button" disabled={pending} onClick={refresh}>{t.reload}</button>}
            {active && request.state !== 'purging' && <button className="wc-overseas__text-button" type="button" disabled={pending} onClick={cancel}>{t.cancel}</button>}
          </div>
          {failed && <p role="alert">{t.cancelFailed}</p>}
        </div>
      )}
    </section>
  );
}
