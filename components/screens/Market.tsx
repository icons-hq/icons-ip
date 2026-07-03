'use client';

import Link from 'next/link';
import { useState } from 'react';
import { DATA } from '@/lib/data';
import { ipAccent } from '@/lib/ip-display';

/* v2 플레이스홀더 — 매물·검수·에스크로는 mock. 실거래 배선은 v2 범위 */
const krw = (n: number) => '₩' + n.toLocaleString('ko-KR');
const CTA_HREF = '/login?next=%2Fmarket';

const TRUST = [
  { n: '01', t: '검수센터 입고', d: '판매 굿즈는 ICONS 검수센터로 먼저 보내요. 가품·상태를 확인해요.' },
  { n: '02', t: '에스크로 결제', d: '구매 대금은 에스크로에 보관되고, 검수 통과 후 배송돼요.' },
  { n: '03', t: '확정 후 정산', d: '구매자가 수령을 확정하면 판매자에게 정산돼요.' },
];

export function Market() {
  const [ipF, setIpF] = useState('all');
  const ipsById = new Map(DATA.IPS.map((ip) => [ip.id, ip]));
  const list = DATA.MARKET.filter((m) => ipF === 'all' || m.ip === ipF);
  const ipsWithItems = DATA.IPS.filter((ip) => DATA.MARKET.some((m) => m.ip === ip.id));

  return (
    <div style={{ minHeight: '100vh' }}>
      {/* header */}
      <header style={{ padding: 'clamp(108px, 12vw, 140px) 0 0' }}>
        <div className="wrap" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 24 }}>
          <div>
            <div className="eyebrow rise" style={{ color: 'var(--amber)' }}>사요 · FAN-TO-FAN</div>
            <h1 className="rise" style={{ margin: '14px 0 0', fontFamily: 'var(--ff-display)', fontWeight: 700, fontSize: 'clamp(36px, 5vw, 64px)', lineHeight: 1.04, letterSpacing: '-0.04em', animationDelay: '.08s' }}>중고 마켓</h1>
            <p className="rise" style={{ margin: '14px 0 0', fontSize: 15, color: '#C9C3E4', maxWidth: 480, textWrap: 'pretty', animationDelay: '.16s' }}>
              검수센터를 거친 정품 굿즈만 올라옵니다. 결제는 에스크로로, 정산은 검수 통과 후에.
            </p>
          </div>
          <div className="rise" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 9, animationDelay: '.22s' }}>
            <Link className="btn btn-holo" href={CTA_HREF} style={{ height: 48, padding: '0 26px' }}>＋ 판매 등록</Link>
            <span className="money-caption">판매 대금은 구매자 검수 확정 후 정산</span>
          </div>
        </div>
      </header>

      {/* filters */}
      <div className="wrap" style={{ paddingTop: 28, display: 'flex', flexWrap: 'wrap', gap: 8 }} role="group" aria-label="IP 필터">
        <button className={'chip' + (ipF === 'all' ? ' on' : '')} aria-pressed={ipF === 'all'} onClick={() => setIpF('all')}>전체 IP</button>
        {ipsWithItems.map((ip) => {
          const active = ipF === ip.id;
          const accent = ipAccent(ip);
          return (
            <button key={ip.id} className={'chip' + (active ? ' on accent' : '')} aria-pressed={active} onClick={() => setIpF(ip.id)} style={active ? { background: accent, borderColor: accent, color: '#0A0813' } : {}}>
              {ip.title}
            </button>
          );
        })}
      </div>

      {/* grid */}
      <section style={{ padding: '24px 0 clamp(40px, 6vw, 60px)' }}>
        <div className="wrap">
          {list.length > 0 ? (
            <div className="market-grid">
              {list.map((m) => {
                const ip = ipsById.get(m.ip);
                return (
                  <div key={m.id} className="market-card" style={{ borderRadius: 20, border: '1px solid var(--line)', background: 'linear-gradient(180deg, var(--surface), var(--bg-2))', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ aspectRatio: '4 / 3', position: 'relative', background: m.bg, backgroundSize: 'cover', backgroundPosition: 'center' }}>
                      <div style={{ position: 'absolute', top: 12, left: 12, display: 'flex', gap: 6, zIndex: 2 }}>
                        <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', height: 24, padding: '0 10px', borderRadius: 999, fontSize: 10.5, fontWeight: 700, color: '#0A0813', background: 'var(--amber)' }}>{m.cond}</span>
                        {m.verified && (
                          <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 24, padding: '0 10px', borderRadius: 999, fontSize: 10.5, fontWeight: 700, color: 'var(--mint)', background: 'rgba(8,6,15,.65)', backdropFilter: 'blur(6px)' }}>✓ 검수완료</span>
                        )}
                      </div>
                      <div aria-hidden style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, transparent 60%, rgba(12,10,24,.7) 100%)' }} />
                    </div>
                    <div style={{ padding: '16px 18px 18px', display: 'flex', flexDirection: 'column', flex: 1 }}>
                      <div className="mono" style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11 }}>
                        <span style={{ color: ip ? ipAccent(ip) : 'var(--dim)' }}>{ip?.title ?? ''}</span>
                        <span style={{ color: 'var(--faint)' }}>@{m.seller}</span>
                      </div>
                      <div style={{ fontWeight: 700, fontSize: 15.5, marginTop: 7, textWrap: 'pretty' }}>{m.name}</div>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, marginTop: 10 }}>
                        <span style={{ fontFamily: 'var(--ff-display)', fontWeight: 700, fontSize: 20, letterSpacing: '-0.02em' }}>{krw(m.price)}</span>
                        <span className="mono" style={{ fontSize: 11, color: 'var(--faint)' }}>{m.type}</span>
                      </div>
                      <Link href={CTA_HREF} className="btn btn-ghost" style={{ marginTop: 14, height: 40, fontSize: 13.5, fontWeight: 700 }}>
                        에스크로 구매
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '70px 20px', border: '1px dashed var(--line-2)', borderRadius: 20 }}>
              <div style={{ fontSize: 17, fontWeight: 700 }}>이 IP의 매물이 아직 없어요</div>
              <div className="mono" style={{ fontSize: 12, color: 'var(--faint)', marginTop: 8 }}>다른 IP를 보거나, 첫 매물을 등록해 보세요</div>
            </div>
          )}
        </div>
      </section>

      {/* trust */}
      <section style={{ borderTop: '1px solid var(--line)', background: 'rgba(12,10,24,.5)', padding: 'clamp(44px, 6vw, 70px) 0' }}>
        <div className="wrap">
          <div className="eyebrow" style={{ color: 'var(--amber)' }}>안전 거래 프로세스</div>
          <div className="event-guide-grid" style={{ marginTop: 22 }}>
            {TRUST.map((t) => (
              <div key={t.n} style={{ padding: '22px 24px', borderRadius: 18, border: '1px solid var(--line)', background: 'linear-gradient(180deg, var(--surface), var(--bg-2))' }}>
                <span className="mono" style={{ fontSize: 12, color: 'var(--faint)' }}>{t.n}</span>
                <div style={{ fontWeight: 700, fontSize: 16, marginTop: 10 }}>{t.t}</div>
                <div style={{ fontSize: 13.5, color: 'var(--dim)', marginTop: 6, textWrap: 'pretty' }}>{t.d}</div>
              </div>
            ))}
          </div>
          <p className="money-caption" style={{ margin: '18px 0 0' }}>검수·정산·분쟁 처리 정책은 마켓 정식 오픈 시 공지됩니다</p>
        </div>
      </section>
    </div>
  );
}
