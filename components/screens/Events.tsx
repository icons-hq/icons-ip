'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { CatalogSnapshot } from '@/lib/catalog';
import type { FandomEvent, Ip } from '@/lib/data';
import { ALL_IPS, ALL_MODES, ALL_STATUSES, eventModeOptions, eventStatusOptions, selectFandomEvents } from '@/lib/events-catalog';
import { ipAccent } from '@/lib/ip-display';
import { hrefFor } from '@/lib/routes';

const statusColor = (s: string) => (s === '진행중' ? 'var(--mint)' : s === '예매중' ? 'var(--cyan)' : 'var(--dim)');
const ctaFor = (s: string) => (s === '진행중' ? '현장 정보' : s === '예매중' ? '티켓 예매' : '오픈 알림 신청');
const footNoteFor = (s: string) => (s === '예매중' ? '잔여 회차 있음' : s === '진행중' ? '현장 발권 가능' : '오픈 예정');

/* 예매·알림은 보호 액션 — 실 티케팅 배선 전까지 로그인 게이트로 보낸다 */
const CTA_HREF = '/login?next=%2Fevents';

const GUIDE = [
  { n: '01', t: '예매', d: '회차와 인원을 고르고 토스페이먼츠로 결제해요.' },
  { n: '02', t: 'QR 전자티켓', d: '마이 티켓에 QR이 발급돼요. 종이 티켓은 없어요.' },
  { n: '03', t: '스캔 입장', d: '현장에서 QR을 스캔하면 줄 없이 바로 입장해요.' },
];

function FeaturedEvent({ e, ip }: { e: FandomEvent; ip: Ip | null }) {
  return (
    <section style={{ padding: 'clamp(28px, 4vw, 40px) 0 0' }}>
      <div className="wrap">
        <div className="event-featured" style={{ borderRadius: 26, border: '1px solid rgba(255,255,255,.09)', background: 'linear-gradient(180deg, var(--surface), var(--bg-2))', overflow: 'hidden', display: 'grid', minHeight: 320 }}>
          <div style={{ padding: 'clamp(26px, 4vw, 44px)', display: 'flex', flexDirection: 'column', justifyContent: 'center', position: 'relative', zIndex: 2 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              {ip && (
                <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', height: 26, padding: '0 11px', borderRadius: 999, fontSize: 11, color: ipAccent(ip), border: '1px solid rgba(255,255,255,.16)' }}>{ip.title}</span>
              )}
              <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', height: 26, padding: '0 11px', borderRadius: 999, fontSize: 11, fontWeight: 700, color: '#0A0813', background: e.accent }}>{e.mode}</span>
              <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, height: 26, padding: '0 11px', borderRadius: 999, fontSize: 11, color: statusColor(e.status), border: '1px solid rgba(255,255,255,.16)' }}>
                {e.status === '진행중' && <span style={{ width: 6, height: 6, borderRadius: 99, background: 'var(--mint)', animation: 'pulseDot 1.8s ease infinite' }} />}
                {e.status}
              </span>
            </div>
            <h2 style={{ margin: '18px 0 0', fontFamily: 'var(--ff-display)', fontWeight: 700, fontSize: 'clamp(26px, 3.4vw, 40px)', letterSpacing: '-0.02em', lineHeight: 1.1, maxWidth: 480, textWrap: 'pretty' }}>{e.title}</h2>
            <div className="mono" style={{ display: 'flex', flexWrap: 'wrap', gap: 18, marginTop: 16, fontSize: 12.5, color: 'var(--dim)' }}>
              <span>◷ {e.date || '일정 공개 예정'}</span>
              <span>◎ {e.loc || '장소 공개 예정'}</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 26 }}>
              <Link className="btn btn-holo" href={CTA_HREF} style={{ height: 48, padding: '0 26px' }}>
                {ctaFor(e.status)} →
              </Link>
              {e.ip && (
                <Link className="btn btn-ghost" href={hrefFor('ip', e.ip)} style={{ height: 48, padding: '0 22px', fontSize: 14 }}>
                  이 세계 더 보기
                </Link>
              )}
            </div>
          </div>
          <div style={{ position: 'relative', minHeight: 220, background: e.img, backgroundSize: 'cover', backgroundPosition: 'center' }}>
            <div aria-hidden style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, #100D20 0%, rgba(16,13,32,.25) 45%, transparent 100%)' }} />
            <div aria-hidden className="sheen" style={{ opacity: 0.3 }} />
          </div>
        </div>
      </div>
    </section>
  );
}

function EventCard({ e, ip }: { e: FandomEvent; ip: Ip | null }) {
  return (
    <div className="event-card" style={{ borderRadius: 20, border: '1px solid var(--line)', background: 'linear-gradient(180deg, var(--surface), var(--bg-2))', overflow: 'hidden' }}>
      <div style={{ aspectRatio: '16 / 9', position: 'relative', background: e.img, backgroundSize: 'cover', backgroundPosition: 'center' }}>
        <div style={{ position: 'absolute', top: 12, left: 12, display: 'flex', gap: 6, zIndex: 2 }}>
          <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', height: 24, padding: '0 10px', borderRadius: 999, fontSize: 10.5, fontWeight: 700, color: '#0A0813', background: e.accent }}>{e.mode}</span>
          <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', height: 24, padding: '0 10px', borderRadius: 999, fontSize: 10.5, color: 'var(--text)', background: 'rgba(8,6,15,.6)', backdropFilter: 'blur(6px)' }}>{e.status}</span>
        </div>
        <div aria-hidden style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, transparent 55%, rgba(12,10,24,.85) 100%)' }} />
      </div>
      <div style={{ padding: '16px 18px 18px' }}>
        {ip && <div className="mono" style={{ fontSize: 11, color: ipAccent(ip) }}>{ip.title}</div>}
        <div style={{ fontWeight: 700, fontSize: 15.5, marginTop: 6, textWrap: 'pretty' }}>{e.title}</div>
        <div className="mono" style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 10, fontSize: 11.5, color: 'var(--dim)' }}>
          <span>◷ {e.date || '일정 공개 예정'}</span>
          <span>◎ {e.loc || '장소 공개 예정'}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, paddingTop: 13, borderTop: '1px solid rgba(255,255,255,.06)' }}>
          <span className="mono" style={{ fontSize: 11, color: statusColor(e.status) }}>{footNoteFor(e.status)}</span>
          <Link className="event-card-cta" href={CTA_HREF} style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
            {ctaFor(e.status)} →
          </Link>
        </div>
      </div>
    </div>
  );
}

export function Events({
  catalog,
  initialIpId,
}: {
  catalog: Pick<CatalogSnapshot, 'ips' | 'events'>;
  initialIpId?: string;
}) {
  const [ipF, setIpF] = useState(initialIpId ?? ALL_IPS);
  const [modeF, setModeF] = useState(ALL_MODES);
  const [statusF, setStatusF] = useState(ALL_STATUSES);

  const ipsById = new Map(catalog.ips.map((ip) => [ip.id, ip]));
  const ipsWithEvents = catalog.ips.filter((ip) => catalog.events.some((e) => e.ip === ip.id));
  const modes = eventModeOptions(catalog.events);
  const statuses = eventStatusOptions(catalog.events);

  const list = selectFandomEvents(catalog.events, { ipId: ipF, mode: modeF, status: statusF });
  const featured = list[0];
  const rest = list.slice(1);

  return (
    <div style={{ minHeight: '100vh' }}>
      {/* header + filters */}
      <header style={{ padding: 'clamp(108px, 12vw, 140px) 0 0' }}>
        <div className="wrap">
          <div className="eyebrow rise" style={{ color: 'var(--mint)' }}>만나요 · POP-UP &amp; TICKETING</div>
          <h1 className="h-xl rise" style={{ marginTop: 14, animationDelay: '.08s' }}>팝업 · 이벤트</h1>
          <p className="rise" style={{ margin: '14px 0 0', fontSize: 15, color: '#C9C3E4', maxWidth: 480, textWrap: 'pretty', animationDelay: '.16s' }}>
            공식 온·오프라인 팝업스토어를 발견하고, 예매부터 QR 입장까지 한 번에.
          </p>

          <div className="rise" style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 26, animationDelay: '.24s' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }} role="group" aria-label="IP 필터">
              <button className={'chip' + (ipF === ALL_IPS ? ' on' : '')} aria-pressed={ipF === ALL_IPS} onClick={() => setIpF(ALL_IPS)}>전체 IP</button>
              {ipsWithEvents.map((ip) => {
                const active = ipF === ip.id;
                const accent = ipAccent(ip);
                return (
                  <button
                    key={ip.id}
                    className={'chip' + (active ? ' on accent' : '')}
                    aria-pressed={active}
                    onClick={() => setIpF(ip.id)}
                    style={active ? { background: accent, borderColor: accent, color: '#0A0813' } : {}}
                  >
                    {ip.title}
                  </button>
                );
              })}
            </div>
            {(statuses.length > 0 || modes.length > 0) && (
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                {statuses.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }} role="group" aria-label="상태 필터">
                    <button className={'chip chip-sm' + (statusF === ALL_STATUSES ? ' on' : '')} aria-pressed={statusF === ALL_STATUSES} onClick={() => setStatusF(ALL_STATUSES)}>전체 상태</button>
                    {statuses.map((s) => (
                      <button key={s} className={'chip chip-sm' + (statusF === s ? ' on' : '')} aria-pressed={statusF === s} onClick={() => setStatusF(s)}>{s}</button>
                    ))}
                  </div>
                )}
                {statuses.length > 0 && modes.length > 0 && (
                  <span aria-hidden style={{ width: 1, height: 30, background: 'rgba(255,255,255,.09)' }} />
                )}
                {modes.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }} role="group" aria-label="모드 필터">
                    <button className={'chip chip-sm' + (modeF === ALL_MODES ? ' on' : '')} aria-pressed={modeF === ALL_MODES} onClick={() => setModeF(ALL_MODES)}>전체 모드</button>
                    {modes.map((m) => (
                      <button key={m} className={'chip chip-sm' + (modeF === m ? ' on' : '')} aria-pressed={modeF === m} onClick={() => setModeF(m)}>{m}</button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* featured */}
      {featured && <FeaturedEvent e={featured} ip={featured.ip ? ipsById.get(featured.ip) ?? null : null} />}

      {/* grid / empty */}
      <section style={{ padding: 'clamp(28px, 4vw, 44px) 0 clamp(40px, 6vw, 60px)' }}>
        <div className="wrap">
          {rest.length > 0 && (
            <div className="event-grid">
              {rest.map((e) => (
                <EventCard key={e.id} e={e} ip={e.ip ? ipsById.get(e.ip) ?? null : null} />
              ))}
            </div>
          )}
          {list.length === 0 && (
            <div style={{ textAlign: 'center', padding: '70px 20px', border: '1px dashed var(--line-2)', borderRadius: 20 }}>
              <div style={{ fontSize: 17, fontWeight: 700 }}>
                {catalog.events.length ? '조건에 맞는 이벤트가 없어요' : '등록된 이벤트가 아직 없습니다'}
              </div>
              <div className="mono" style={{ fontSize: 12, color: 'var(--faint)', marginTop: 8 }}>
                {catalog.events.length ? '필터를 바꿔보세요' : 'Supabase 카탈로그 seed 또는 admin 등록 후 이벤트 목록에 공개됩니다.'}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* QR guide */}
      <section style={{ borderTop: '1px solid var(--line)', background: 'rgba(12,10,24,.5)', padding: 'clamp(44px, 6vw, 70px) 0' }}>
        <div className="wrap">
          <div className="eyebrow" style={{ color: 'var(--mint)' }}>전자티켓 · QR 입장</div>
          <div className="event-guide-grid" style={{ marginTop: 22 }}>
            {GUIDE.map((g) => (
              <div key={g.n} style={{ padding: '22px 24px', borderRadius: 18, border: '1px solid var(--line)', background: 'linear-gradient(180deg, var(--surface), var(--bg-2))' }}>
                <span className="mono" style={{ fontSize: 12, color: 'var(--faint)' }}>{g.n}</span>
                <div style={{ fontWeight: 700, fontSize: 16, marginTop: 10 }}>{g.t}</div>
                <div style={{ fontSize: 13.5, color: 'var(--dim)', marginTop: 6, textWrap: 'pretty' }}>{g.d}</div>
              </div>
            ))}
          </div>
          <p className="money-caption" style={{ margin: '18px 0 0' }}>취소·환불 규정은 예매 화면에서 안내됩니다</p>
        </div>
      </section>
    </div>
  );
}
