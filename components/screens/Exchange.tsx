'use client';

import Link from 'next/link';
import { useState } from 'react';
import { DATA, type Exchange as ExchangeItem } from '@/lib/data';
import { RARITY_META, type RarityKey } from '@/lib/rarity';
import { hrefFor } from '@/lib/routes';

/* v2 플레이스홀더 — 매물·입찰은 mock. 실거래 배선은 v2 범위 */
const CTA_HREF = '/login?next=%2Fexchange';

function rarityTag(rarity: RarityKey): { color: string; bg: string; ring: string } {
  if (rarity === 'HOLO') return { color: '#0A0813', bg: 'var(--holo)', ring: `${RARITY_META.HOLO.color}99` };
  if (rarity === 'N') return { color: 'var(--text)', bg: 'rgba(8,6,15,.75)', ring: 'rgba(255,255,255,.18)' };
  const c = RARITY_META[rarity].color;
  const ink = rarity === 'R';
  return { color: ink ? '#0A0813' : 'var(--text)', bg: `${c}${ink ? 'E6' : 'D9'}`, ring: `${c}73` };
}

function ExchangeCard({ x }: { x: ExchangeItem }) {
  const tag = rarityTag(x.rarity);
  const auction = x.kind === '경매';

  return (
    <div className="exchange-card" style={{ display: 'flex', gap: 16, padding: 16, borderRadius: 20, border: '1px solid var(--line)', background: 'linear-gradient(180deg, var(--surface), var(--bg-2))' }}>
      <div style={{ flex: '0 0 auto', width: 98, aspectRatio: '5 / 7', borderRadius: 12, position: 'relative', overflow: 'hidden', background: x.bg, backgroundSize: 'cover', backgroundPosition: 'center', boxShadow: `0 0 0 1.5px ${tag.ring}, 0 14px 30px -14px rgba(0,0,0,.8)` }}>
        <span className="mono" style={{ position: 'absolute', top: 7, left: 7, fontSize: 9, letterSpacing: '.06em', padding: '3px 6px', borderRadius: 5, fontWeight: 700, color: tag.color, background: tag.bg }}>{x.rarity}</span>
      </div>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', height: 23, padding: '0 10px', borderRadius: 999, fontSize: 10.5, fontWeight: 700, color: '#0A0813', background: auction ? 'var(--amber)' : 'var(--cyan)' }}>{x.kind}</span>
          <span className="mono" style={{ fontSize: 11, color: 'var(--faint)' }}>@{x.user}</span>
        </div>
        <div style={{ fontWeight: 700, fontSize: 15.5, marginTop: 9 }}>{x.card}</div>
        {auction ? (
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginTop: 8 }}>
              <span className="mono" style={{ fontSize: 11, color: 'var(--dim)' }}>현재가 · {x.bids}입찰</span>
              <span className="mono" style={{ fontSize: 12, color: 'var(--amber)' }}>◷ {x.endsIn}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 'auto', paddingTop: 8 }}>
              <span style={{ fontFamily: 'var(--ff-display)', fontWeight: 700, fontSize: 19 }}>{x.bid?.toLocaleString('ko-KR')}</span>
              <Link className="btn btn-holo btn-sm" href={CTA_HREF} style={{ height: 38, fontSize: 13 }}>입찰</Link>
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 13, color: 'var(--dim)', marginTop: 6 }}>
              <span style={{ color: 'var(--faint)' }}>원함 · </span>{x.want}
            </div>
            <Link className="btn btn-ghost btn-sm" href={CTA_HREF} style={{ marginTop: 'auto', height: 38, fontSize: 13 }}>
              교환 제안하기
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

export function Exchange() {
  const [kind, setKind] = useState('전체');
  const counts = {
    전체: DATA.EXCHANGES.length,
    직거래: DATA.EXCHANGES.filter((x) => x.kind === '직거래').length,
    경매: DATA.EXCHANGES.filter((x) => x.kind === '경매').length,
  };
  const list = DATA.EXCHANGES.filter((x) => kind === '전체' || x.kind === kind);

  return (
    <div style={{ minHeight: '100vh' }}>
      {/* header */}
      <header style={{ padding: 'clamp(108px, 12vw, 140px) 0 0' }}>
        <div className="wrap" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 24 }}>
          <div>
            <div className="eyebrow rise" style={{ color: 'var(--cyan)' }}>모아요 · CARD EXCHANGE</div>
            <h1 className="rise" style={{ margin: '14px 0 0', fontFamily: 'var(--ff-display)', fontWeight: 700, fontSize: 'clamp(36px, 5vw, 64px)', lineHeight: 1.04, letterSpacing: '-0.04em', animationDelay: '.08s' }}>카드 교환 마켓</h1>
            <p className="rise" style={{ margin: '14px 0 0', fontSize: 15, color: '#C9C3E4', maxWidth: 480, textWrap: 'pretty', animationDelay: '.16s' }}>
              팬들끼리 직거래·경매로 한정 카드를 교환하세요.
            </p>
          </div>
          <div className="rise" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 9, animationDelay: '.22s' }}>
            <Link className="btn btn-holo" href={hrefFor('binder')} style={{ height: 48, padding: '0 26px' }}>＋ 교환 등록</Link>
            <span className="money-caption">등록 수수료는 정식 오픈 시 안내됩니다</span>
          </div>
        </div>
      </header>

      {/* filters */}
      <div className="wrap" style={{ paddingTop: 28, display: 'flex', flexWrap: 'wrap', gap: 8 }} role="group" aria-label="거래 유형 필터">
        {(['전체', '직거래', '경매'] as const).map((k) => (
          <button key={k} className={'chip' + (kind === k ? ' on' : '')} aria-pressed={kind === k} onClick={() => setKind(k)}>
            {k} <span className="mono" style={{ fontSize: 10.5, opacity: 0.7 }}>{counts[k]}</span>
          </button>
        ))}
      </div>

      {/* grid */}
      <section style={{ padding: '24px 0 clamp(48px, 7vw, 80px)' }}>
        <div className="wrap">
          <div className="exchange-grid">
            {list.map((x) => (
              <ExchangeCard key={x.id} x={x} />
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 26, padding: '15px 18px', borderRadius: 14, border: '1px solid rgba(56,240,192,.2)', background: 'rgba(56,240,192,.05)' }}>
            <span style={{ flex: '0 0 auto', width: 24, height: 24, borderRadius: 99, display: 'grid', placeItems: 'center', background: 'rgba(56,240,192,.14)', color: 'var(--mint)', fontSize: 12, fontWeight: 700 }}>✓</span>
            <span className="mono" style={{ fontSize: 11.5, color: 'var(--dim)', letterSpacing: '.02em' }}>
              교환 체결 방식(소유권 동시 이전)과 수수료는 정식 오픈 시 확정·공지됩니다
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
