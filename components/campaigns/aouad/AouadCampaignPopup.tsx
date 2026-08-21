'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AOUAD_AVATAR_COLORS,
  AOUAD_AVATAR_IDS,
  AOUAD_DESK_RECORDS,
  AOUAD_IF_ENDINGS,
  AOUAD_IMAGES,
  AOUAD_POPUP_PATH,
  AOUAD_RALLY_ZONE_IDS,
  AOUAD_STORE_PREVIEW,
  AOUAD_ZONE_IDS,
  AOUAD_ZONES,
  type AouadAvatarId,
  type AouadZoneId,
} from '@/lib/campaigns/aouad/content';
import { trackAouadCampaignEvent } from '@/lib/campaigns/aouad/analytics';
import { cafeteriaActionForPreference } from '@/lib/campaigns/aouad/accessibility';
import { isAouadOpeningReady } from '@/lib/campaigns/aouad/opening';
import { shareAouadResult } from '@/lib/campaigns/aouad/share';
import { aouadRallyCount, isAouadRallyComplete } from '@/lib/campaigns/aouad/state';
import { AouadCampaignProvider, useAouadCampaign } from './AouadCampaignProvider';
import { useAouadCampaignAudio } from './useAouadCampaignAudio';
import styles from './aouad-campaign.module.css';

type AouadCampaignPopupProps = { zone?: AouadZoneId };
type OpeningMode = 'full' | 'skip' | 'reduced';

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return reduced;
}

function Avatar({ avatar, size = 44 }: { avatar: AouadAvatarId | null; size?: number }) {
  const [background, foreground] = avatar ? AOUAD_AVATAR_COLORS[avatar] : ['#262825', '#8d8b81'];
  return (
    <span className={styles.avatar} style={{ width: size, height: size, backgroundColor: background }} aria-hidden="true">
      <i className={styles.avatarHead} style={{ backgroundColor: foreground }} />
      <i className={styles.avatarBody} style={{ backgroundColor: foreground }} />
    </span>
  );
}

function StudentIdCard({ compact = false }: { compact?: boolean }) {
  const { state, lastBellCompletion } = useAouadCampaign();
  const rallyCount = aouadRallyCount(state);
  return (
    <section className={`${styles.studentId} ${compact ? styles.studentIdCompact : ''}`} aria-label="내 학생증">
      <div className={styles.studentIdHeader}><b>효산고등학교</b><span>학생증</span></div>
      <div className={styles.studentIdBody}>
        <Avatar avatar={state.student.avatar} size={compact ? 76 : 112} />
        <div className={styles.studentIdInfo}>
          <span>성명</span><b>{state.student.name ?? '미기재'}</b>
          <span>학년/반</span><b>2학년 5반</b>
          <span>개인 수색</span><b>{rallyCount} / {AOUAD_RALLY_ZONE_IDS.length}</b>
        </div>
      </div>
      <div className={styles.sealRow}>
        <span className={lastBellCompletion ? styles.sealOn : styles.seal}>마지막 종</span>
        <span className={isAouadRallyComplete(state) ? styles.sealOn : styles.seal}>개인 수색</span>
      </div>
    </section>
  );
}

function OpeningCeremony() {
  const { state, markOpeningSeen } = useAouadCampaign();
  const reduced = useReducedMotion();
  const [ready, setReady] = useState(reduced);
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState<AouadAvatarId | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const primaryFocusRef = useRef<HTMLButtonElement>(null);
  const skipFocusRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const openingReady = isAouadOpeningReady(ready, reduced);

  useEffect(() => {
    if (state.openingSeen) return undefined;
    if (reduced) {
      const frame = window.requestAnimationFrame(() => setReady(true));
      return () => window.cancelAnimationFrame(frame);
    }
    const timer = window.setTimeout(() => setReady(true), 10_000);
    return () => window.clearTimeout(timer);
  }, [state.openingSeen, reduced]);

  useEffect(() => {
    if (state.openingSeen) return undefined;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', trapFocus);
    return () => {
      document.removeEventListener('keydown', trapFocus);
      previousFocusRef.current?.focus();
    };
  }, [state.openingSeen]);

  useEffect(() => {
    if (state.openingSeen) return undefined;
    const frame = window.requestAnimationFrame(() => {
      (openingReady ? primaryFocusRef.current : skipFocusRef.current)?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [state.openingSeen, openingReady]);

  if (state.openingSeen) return null;

  const complete = (mode: OpeningMode) => {
    markOpeningSeen({ name: name.trim() || null, avatar });
    trackAouadCampaignEvent({ type: 'opening_completed', mode });
  };

  return (
    <div ref={dialogRef} className={`${styles.opening} ${reduced ? styles.openingReduced : ''}`} role="dialog" aria-modal="true" aria-labelledby="aouad-opening-title">
      <div className={styles.openingImage} aria-hidden="true"><Image src={AOUAD_IMAGES.theater} alt="" fill sizes="100vw" /></div>
      <div className={styles.openingFrame}>
        <p className={styles.openingKicker}>효산시, 사태 이후</p>
        <h1 id="aouad-opening-title">…들려?<br />들리면 대답해 줘.</h1>
        <p>옥상에 모닥불을 켰어.<br />우리, 다시 모이자.</p>
        {openingReady ? (
          <div className={styles.openingForm}>
            <label htmlFor="aouad-name">내 학생증에 적을 이름 <span>선택</span></label>
            <input id="aouad-name" value={name} maxLength={12} placeholder="이름 없이 등교할 수도 있어" onChange={(event) => setName(event.target.value)} />
            <div className={styles.avatarChoices} role="group" aria-label="학생증 기본 사진 선택">
              {AOUAD_AVATAR_IDS.map((id) => (
                <button key={id} type="button" className={avatar === id ? styles.avatarChoiceSelected : styles.avatarChoice} onClick={() => setAvatar(avatar === id ? null : id)} aria-label={`${id} 기본 사진`} aria-pressed={avatar === id}>
                  <Avatar avatar={id} size={32} />
                </button>
              ))}
            </div>
            <button ref={primaryFocusRef} type="button" className={styles.primaryButton} onClick={() => complete(reduced ? 'reduced' : 'full')}>등교하기</button>
          </div>
        ) : <p className={styles.openingWait} aria-live="polite">신호를 복원하는 중…</p>}
      </div>
      {!reduced && <button ref={skipFocusRef} type="button" className={styles.skipButton} onClick={() => complete('skip')}>건너뛰기</button>}
    </div>
  );
}

function ZoneTile({ zone }: { zone: AouadZoneId }) {
  const { state } = useAouadCampaign();
  const item = AOUAD_ZONES[zone];
  const complete = zone !== 'store' && state.zones[zone];
  return (
    <Link href={`${AOUAD_POPUP_PATH}/${zone}`} className={styles.zoneTile} data-tone={item.tone}>
      <Image src={item.image} alt="" fill sizes="(max-width: 640px) 48vw, (max-width: 1040px) 33vw, 20vw" />
      <span className={styles.zoneShade} />
      <span className={styles.zoneTileCopy}><b>{item.name}</b><small>{item.subtitle}</small></span>
      {complete ? <span className={styles.zoneComplete}>수색 완료</span> : null}
    </Link>
  );
}

function LastBellRecord() {
  const { lastBellCompletion } = useAouadCampaign();
  const [status, setStatus] = useState('');

  const share = async () => {
    const result = await shareAouadResult({
      title: 'ALL OF US ARE DEAD: LAST BELL',
      text: '효산고에서 나의 생존 기록을 남겼습니다.',
      url: typeof window === 'undefined' ? AOUAD_POPUP_PATH : window.location.href,
      routeLabel: '효산고등학교 · 마지막 수업',
      durationLabel: lastBellCompletion ? `${formatDuration(lastBellCompletion.activeDurationMs)} · ${playStyleLabel(lastBellCompletion.playStyle)}` : '기록을 준비 중입니다',
    });
    trackAouadCampaignEvent({ type: 'share_clicked', method: result });
    setStatus(result === 'web-share' ? '공유 창을 열었습니다.' : result === 'clipboard' ? '공유 문구를 복사했습니다.' : result === 'download' ? '기록 카드를 저장했습니다.' : '이 기기에서는 공유를 지원하지 않습니다.');
  };

  return (
    <section className={styles.recordPanel}>
      <Image src={AOUAD_IMAGES.record} alt="" fill sizes="(max-width: 640px) 100vw, 40vw" />
      <div className={styles.recordPanelShade} />
      <div className={styles.recordPanelContent}>
        <span>내 생존 기록</span>
        <b>{lastBellCompletion ? '마지막 종을 지나온 학생' : '아직 남겨지지 않은 기록'}</b>
        <p>{lastBellCompletion ? `${routeLabel(lastBellCompletion.routeId)} · ${formatDuration(lastBellCompletion.activeDurationMs)} · ${playStyleLabel(lastBellCompletion.playStyle)}` : '게임을 마치면 여기에 생존 인장이 찍힙니다.'}</p>
        <div className={styles.recordActions}>
          <Link href="/games/prototype-last-bell" prefetch={false} className={styles.outlineButton} onClick={() => trackAouadCampaignEvent({ type: 'game_continue_clicked' })}>{lastBellCompletion ? '기록 다시 보기' : '게임 시작'}</Link>
          <button type="button" className={styles.textButton} onClick={() => void share()} disabled={!lastBellCompletion}>기록 공유</button>
        </div>
        {status ? <p className={styles.statusText} role="status">{status}</p> : null}
      </div>
    </section>
  );
}

function formatDuration(durationMs: number): string {
  const seconds = Math.max(0, Math.floor(durationMs / 1000));
  return `${Math.floor(seconds / 60)}분 ${String(seconds % 60).padStart(2, '0')}초`;
}

function playStyleLabel(style: 'listener' | 'shadow' | 'runner' | 'resilient'): string {
  return { listener: '듣는 사람', shadow: '숨는 사람', runner: '달리는 사람', resilient: '버틴 사람' }[style];
}

function routeLabel(route: 'central' | 'rear' | 'systems'): string {
  return { central: '중앙 복도', rear: '후면 계단', systems: '설비 통로' }[route];
}

function Hub() {
  const { state } = useAouadCampaign();
  useEffect(() => { trackAouadCampaignEvent({ type: 'campaign_view', surface: 'hub' }); }, []);

  return (
    <main className={styles.campaignMain}>
      <header className={styles.campaignHeader}>
        <Link href={AOUAD_POPUP_PATH} className={styles.wordmark}>지금, 우리 학교로</Link>
        <span>효산고등학교</span>
      </header>
      <section className={styles.hero}>
        <Image className={styles.heroImage} src={AOUAD_IMAGES.hero} alt="비 내린 밤의 효산고등학교" fill preload sizes="100vw" />
        <div className={styles.heroShade} />
        <div className={styles.heroCopy}>
          <p>지금, 우리 학교로</p>
          <h1>마지막 종</h1>
          <span>5–7분의 생존 이야기<br />선택은 기록이 되고, 기록은 당신을 증명한다.</span>
          <div className={styles.heroActions}>
            <Link href="/games/prototype-last-bell" prefetch={false} className={styles.primaryButton} onClick={() => trackAouadCampaignEvent({ type: 'game_start_clicked' })}>게임 시작</Link>
            <Link href="/games/prototype-last-bell" prefetch={false} className={styles.secondaryButton} onClick={() => trackAouadCampaignEvent({ type: 'game_continue_clicked' })}>이어하기</Link>
            <a href="#survival-record" className={styles.subtleButton}>내 생존 기록</a>
            <Link href={`${AOUAD_POPUP_PATH}/store`} className={styles.storeButton} onClick={() => trackAouadCampaignEvent({ type: 'store_preview_viewed' })}>상품 바로 보기</Link>
          </div>
        </div>
        <div className={styles.heroStudentId}><StudentIdCard /></div>
      </section>
      <section className={styles.zoneRail} aria-label="효산고 수색 구역">
        {(['classroom', 'cafeteria', 'broadcast', 'theater', 'rooftop'] as const).map((zone) => <ZoneTile key={zone} zone={zone} />)}
      </section>
      <section className={styles.detailGrid}>
        <Link href={`${AOUAD_POPUP_PATH}/store`} className={styles.storePanel} onClick={() => trackAouadCampaignEvent({ type: 'store_preview_viewed' })}>
          <Image src={AOUAD_IMAGES.store} alt="" fill sizes="(max-width: 760px) 100vw, 34vw" />
          <span className={styles.panelShade} />
          <span><b>매점 — 보급소</b><small>굿즈 진열 미리보기 · 위시만 저장됩니다</small></span>
          {state.wishlist.length ? <em>위시 {state.wishlist.length}</em> : null}
        </Link>
        <div id="survival-record"><LastBellRecord /></div>
        <section className={styles.newsPanel}>
          <span>캠페인 안내 — 방송실</span>
          <b>게임과 팝업을 오가며, 내가 남긴 기록을 다시 확인하세요.</b>
          <p>공동 수치와 방명록은 아직 열지 않습니다. 지금의 진행은 이 기기에만 보관됩니다.</p>
        </section>
      </section>
      <section className={styles.rallyPanel}>
        <div><span>개인 수색 진행</span><b>{aouadRallyCount(state)} / {AOUAD_RALLY_ZONE_IDS.length}</b></div>
        <p>교실, 급식실, 방송실, IF 극장, 옥상을 모두 지나면 학생증에 개인 수색 인장이 남습니다.</p>
        <div className={styles.rallyDots}>{AOUAD_RALLY_ZONE_IDS.map((zone) => <i key={zone} className={state.zones[zone] ? styles.rallyDotOn : styles.rallyDot} />)}</div>
      </section>
    </main>
  );
}

function ZoneHeader({ zone }: { zone: AouadZoneId }) {
  const item = AOUAD_ZONES[zone];
  return (
    <header className={styles.zoneHeader}>
      <Link href={AOUAD_POPUP_PATH} className={styles.backLink}>← 팝업 허브</Link>
      <div><span>{item.subtitle}</span><h1>{item.name}</h1></div>
      <Image src={item.image} alt="" fill sizes="100vw" preload />
      <i />
    </header>
  );
}

function ClassroomZone() {
  const { state, collectClassroomRecord } = useAouadCampaign();
  const playAudio = useAouadCampaignAudio();
  return (
    <section className={styles.zoneContent}>
      <p className={styles.zoneLead}>책상과 게시판에 남은 기록을 세 개 이상 살펴보세요. 수색한 기록은 이 기기에만 남습니다.</p>
      <div className={styles.deskGrid}>
        {AOUAD_DESK_RECORDS.map((record) => {
          const found = state.classroomRecords.includes(record.id);
          return <button type="button" key={record.id} className={found ? styles.deskFound : styles.deskCard} onClick={() => { collectClassroomRecord(record.id); if (!found && state.classroomRecords.length >= 2) playAudio('zoneUnlock'); }}>
            <span>{record.place}</span><b>{record.item}</b><p>{found ? '수색 기록에 남겼습니다.' : record.note}</p>
          </button>;
        })}
      </div>
    </section>
  );
}

function CafeteriaZone() {
  const { completeZone } = useAouadCampaign();
  const reduced = useReducedMotion();
  const [running, setRunning] = useState(false);
  const [position, setPosition] = useState(0);
  const [message, setMessage] = useState('조용한 구간에서 발을 멈춰 보세요.');
  const startRef = useRef(0);

  useEffect(() => {
    if (!running || reduced) return undefined;
    let frame = 0;
    const update = (now: number) => {
      if (!startRef.current) startRef.current = now;
      setPosition(((now - startRef.current) / 21) % 100);
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [running, reduced]);

  const attempt = () => {
    const action = cafeteriaActionForPreference(reduced, running);
    if (action === 'complete') {
      setRunning(false);
      completeZone('cafeteria');
      trackAouadCampaignEvent({ type: 'zone_completed', zone: 'cafeteria' });
      setMessage('정적인 대체 입력으로 배식대를 지나왔습니다. 수색 인장을 남겼어요.');
      return;
    }
    if (action === 'start') {
      startRef.current = 0;
      setRunning(true);
      setMessage('발소리를 죽이고, 중앙의 조용한 구간을 기다리세요.');
      return;
    }
    if (position >= 43 && position <= 57) {
      setRunning(false);
      completeZone('cafeteria');
      trackAouadCampaignEvent({ type: 'zone_completed', zone: 'cafeteria' });
      setMessage('배식대 뒤를 지나왔습니다. 수색 인장을 남겼어요.');
    } else {
      setMessage('철제 식판이 흔들렸습니다. 다시 호흡을 고르세요.');
    }
  };

  return <section className={styles.zoneContent}><p className={styles.zoneLead}>위협을 과장하지 않고, 소리의 타이밍을 읽는 짧은 체험입니다.</p><div className={styles.timingGame}><span className={styles.timingTarget}>{reduced ? '정적 대체 입력' : '조용한 구간'}</span><div className={styles.timingTrack}><i style={{ left: `${position}%` }} /></div><button type="button" className={styles.primaryButton} onClick={attempt}>{reduced ? '조용히 지나가기' : running ? '발을 멈춘다' : '이동 시작'}</button><p role="status">{message}</p></div></section>;
}

function BroadcastZone() {
  const { completeZone } = useAouadCampaign();
  const playAudio = useAouadCampaignAudio();
  const [signal, setSignal] = useState(0);
  const tune = () => {
    const next = Math.min(100, signal + 25);
    setSignal(next);
    playAudio(next === 100 ? 'radioResponse' : 'radioStatic', next === 100 ? 0.46 : 0.24);
    if (next === 100) {
      completeZone('broadcast');
      trackAouadCampaignEvent({ type: 'zone_completed', zone: 'broadcast' });
    }
  };
  return <section className={styles.zoneContent}><p className={styles.zoneLead}>단절된 무전 신호를 맞추면 짧은 응답이 돌아옵니다.</p><div className={styles.signalGame}><div className={styles.signalMeter} aria-label={`신호 복구 ${signal}%`}><i style={{ width: `${signal}%` }} /></div><b>{signal === 100 ? '신호 복구 완료' : `신호 ${signal}%`}</b><button type="button" className={styles.primaryButton} onClick={tune} disabled={signal === 100}>{signal === 100 ? '응답 수신' : '주파수 조정'}</button><p>{signal === 100 ? '“들리면 대답해 줘.” 수색 인장을 남겼습니다.' : '한 번씩 조정해 신호를 선명하게 만드세요.'}</p></div></section>;
}

function TheaterZone() {
  const { state, selectTheaterEnding } = useAouadCampaign();
  return <section className={styles.zoneContent}><p className={styles.zoneLead}>정사가 아닌, 그날의 다른 선택을 상상하는 짧은 기록입니다.</p><div className={styles.endingGrid}>{AOUAD_IF_ENDINGS.map((ending) => <button key={ending.id} type="button" className={state.theaterEndings.includes(ending.id) ? styles.endingChosen : styles.endingCard} onClick={() => { selectTheaterEnding(ending.id); trackAouadCampaignEvent({ type: 'zone_completed', zone: 'theater' }); }}><span>IF 기록</span><b>{ending.name}</b><p>{ending.description}</p></button>)}</div></section>;
}

function StoreZone() {
  const { state, toggleWishlist } = useAouadCampaign();
  useEffect(() => { trackAouadCampaignEvent({ type: 'store_preview_viewed' }); }, []);
  return <section className={styles.zoneContent}><p className={styles.zoneLead}>판매 전 미리보기입니다. 가격, 재고, 판매 일정은 아직 표시하지 않으며 위시만 이 기기에 저장합니다.</p><div className={styles.storeGrid}>{AOUAD_STORE_PREVIEW.map((item) => { const wished = state.wishlist.includes(item.id); return <article key={item.id} className={styles.productCard}><div className={styles.productImage}><Image src={item.image} alt="" fill sizes="(max-width: 640px) 50vw, 25vw" /></div><span>{item.category}</span><b>{item.name}</b><button type="button" className={wished ? styles.wishActive : styles.wishButton} onClick={() => { toggleWishlist(item.id); trackAouadCampaignEvent({ type: 'wishlist_toggled', itemId: item.id, active: !wished }); }}>{wished ? '위시 해제' : '위시에 담기'}</button></article>; })}</div></section>;
}

function RooftopZone() {
  const { state, addRooftopEmber } = useAouadCampaign();
  const playAudio = useAouadCampaignAudio();
  const complete = isAouadRallyComplete(state);
  return <section className={styles.zoneContent}><p className={styles.zoneLead}>이곳의 불씨와 수색 기록은 개인 로컬 진행입니다. 공동 수치나 방명록은 아직 열지 않습니다.</p><div className={styles.rooftop}><div className={styles.ember} aria-hidden="true">✦</div><span>내가 남긴 불씨</span><b>{state.rooftopEmbers}</b><button type="button" className={styles.primaryButton} onClick={() => { addRooftopEmber(); playAudio(state.rooftopEmbers === 0 ? 'survivorStamp' : 'rooftopWind'); trackAouadCampaignEvent({ type: 'zone_completed', zone: 'rooftop' }); }}>불씨 남기기</button><p>{complete ? '개인 수색 인장이 학생증에 남았습니다.' : '다른 수색 구역도 지나면 개인 수색 인장이 완성됩니다.'}</p></div></section>;
}

function ZoneView({ zone }: { zone: AouadZoneId }) {
  useEffect(() => { trackAouadCampaignEvent({ type: 'campaign_view', surface: 'zone' }); trackAouadCampaignEvent({ type: 'popup_viewed', zone }); }, [zone]);
  const content = useMemo(() => {
    switch (zone) {
      case 'classroom': return <ClassroomZone />;
      case 'cafeteria': return <CafeteriaZone />;
      case 'broadcast': return <BroadcastZone />;
      case 'theater': return <TheaterZone />;
      case 'store': return <StoreZone />;
      case 'rooftop': return <RooftopZone />;
    }
  }, [zone]);
  return <main className={styles.campaignMain}><ZoneHeader zone={zone} />{content}<nav className={styles.zoneNav} aria-label="다른 수색 구역">{AOUAD_ZONE_IDS.map((id) => <Link key={id} href={`${AOUAD_POPUP_PATH}/${id}`} aria-current={zone === id ? 'page' : undefined}>{AOUAD_ZONES[id].name}</Link>)}</nav></main>;
}

function AouadCampaignExperience({ zone }: AouadCampaignPopupProps) {
  const { hydrated } = useAouadCampaign();
  if (!hydrated) return <main className={styles.loading} aria-live="polite">효산고 재소집을 준비하고 있습니다.</main>;
  return <><OpeningCeremony />{zone ? <ZoneView zone={zone} /> : <Hub />}</>;
}

export function AouadCampaignPopup(props: AouadCampaignPopupProps) {
  return <AouadCampaignProvider><AouadCampaignExperience {...props} /></AouadCampaignProvider>;
}
