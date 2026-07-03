'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { CatalogSnapshot } from '@/lib/catalog';
import type { Card } from '@/lib/data';
import { ipAccent } from '@/lib/ip-display';
import { RARITY_META, type RarityKey } from '@/lib/rarity';
import { hrefFor } from '@/lib/routes';
import { Empty } from '@/components/ui/Empty';
import { useTilt } from '@/components/ui/motion';

/* mock 공시 가중치 — 실 카드풀 오픈 시 진실원은 DB 공시 테이블(ADR-0001) */
const RATES: Partial<Record<RarityKey, number>> = { HOLO: 1.5, SSR: 4.5, SR: 14, R: 80 };
const PITY_MAX = 60;

/* 디자인 핸드오프의 카드풀 소개 카피. 미등재 IP는 데이터에서 파생 */
const POOL_DESC: Record<string, string> = {
  rilakkuma: '느긋한 방의 순간들을 담은 카드풀. 낮잠 시간 HOLO가 시즌 최고 등급입니다.',
  maplestory: '몬스터즈 시즌 카드풀. 핑크빈 스테이지 HOLO를 노려보세요.',
  nongdamgom: '말랑한 농담 같은 카드풀. 오리친구 SSR이 현재 최고 등급입니다.',
  'kakao-friends': '피크닉 시즌 카드풀. 춘식이 낮잠 HOLO가 시즌 한정으로 등장합니다.',
  'attack-on-titan': '리바이 에디션 카드풀. 결전 전야 HOLO는 이번 시즌에만 뽑을 수 있어요.',
};

const RARITY_ORDER: RarityKey[] = ['HOLO', 'SSR', 'SR', 'R', 'N'];

function rarityTag(rarity: RarityKey): { color: string; bg: string; ring: string } {
  if (rarity === 'HOLO') return { color: '#0A0813', bg: 'var(--holo)', ring: `${RARITY_META.HOLO.color}99` };
  if (rarity === 'N') return { color: 'var(--text)', bg: 'rgba(8,6,15,.75)', ring: 'rgba(255,255,255,.18)' };
  const c = RARITY_META[rarity].color;
  const ink = rarity === 'R'; // cyan 위엔 잉크색이 읽힌다
  return { color: ink ? '#0A0813' : 'var(--text)', bg: `${c}${ink ? 'E6' : 'D9'}`, ring: `${c}73` };
}

function MachineCard({ card }: { card: Card }) {
  const { cardRef, glareRef, onMouseMove, onMouseLeave } = useTilt();
  return (
    <div onMouseMove={onMouseMove} onMouseLeave={onMouseLeave} className="home-float" style={{ perspective: 900 }}>
      <div
        ref={cardRef}
        style={{
          width: 'clamp(220px, 24vw, 300px)', aspectRatio: '5 / 7', borderRadius: 20, position: 'relative', overflow: 'hidden',
          background: card.bg,
          boxShadow: '0 44px 90px -30px rgba(0,0,0,.9), 0 0 0 1px rgba(255,255,255,.14), 0 0 70px -14px rgba(139,92,255,.65)',
          transformStyle: 'preserve-3d', transition: 'transform .35s ease', willChange: 'transform',
        }}
      >
        <div ref={glareRef} aria-hidden style={{ position: 'absolute', inset: 0, mixBlendMode: 'color-dodge', opacity: 0.55, background: 'linear-gradient(115deg, transparent 20%, rgba(45,226,255,.5), rgba(139,92,255,.4), rgba(255,77,157,.5), transparent 80%)', backgroundSize: '240% 240%', backgroundPosition: '20% 20%', transition: 'background-position .3s ease' }} />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, transparent 58%, rgba(8,6,15,.9) 100%)' }} />
        <span className="mono" style={{ position: 'absolute', top: 12, left: 12, fontSize: 11, letterSpacing: '.08em', padding: '4px 10px', borderRadius: 6, color: '#0A0813', fontWeight: 700, background: 'var(--holo)', backgroundSize: '200% 200%', animation: 'holoShift 5s ease infinite' }}>{card.rarity}</span>
        <span style={{ position: 'absolute', left: 14, right: 14, bottom: 14, fontWeight: 700, fontSize: 16, textAlign: 'left' }}>{card.name}</span>
      </div>
    </div>
  );
}

type PoolRate = { rarity: RarityKey; weight: number; rate: string };

/* 풀에 실제 존재하는 등급만 공시하고 합이 100%가 되도록 정규화 — 공시값과 추첨 확률을 일치시킨다 */
function poolRates(cards: Card[]): PoolRate[] {
  const present = RARITY_ORDER.filter((r) => cards.some((c) => c.rarity === r));
  const total = present.reduce((sum, r) => sum + (RATES[r] ?? 10), 0);
  return present.map((r) => {
    const weight = RATES[r] ?? 10;
    return { rarity: r, weight, rate: `${Number(((weight / total) * 100).toFixed(1))}%` };
  });
}

function pickUniform(group: Card[]): Card {
  return group[Math.floor(Math.random() * group.length)];
}

function pickCard(cards: Card[], rates: PoolRate[]): Card {
  const total = rates.reduce((sum, r) => sum + r.weight, 0);
  let roll = Math.random() * total;
  let rarity = rates[rates.length - 1].rarity;
  for (const r of rates) {
    roll -= r.weight;
    if (roll <= 0) {
      rarity = r.rarity;
      break;
    }
  }
  return pickUniform(cards.filter((c) => c.rarity === rarity));
}

export function Gacha({
  catalog,
  initialIpId,
}: {
  catalog: Pick<CatalogSnapshot, 'ips' | 'cards'>;
  initialIpId?: string;
}) {
  const pools = useMemo(
    () =>
      catalog.ips
        .map((ip) => ({ ip, cards: catalog.cards.filter((c) => c.ip === ip.id) }))
        .filter((p) => p.cards.length > 0),
    [catalog],
  );

  const [selId, setSelId] = useState(() =>
    pools.some((p) => p.ip.id === initialIpId) ? (initialIpId as string) : pools[0]?.ip.id,
  );
  const [pity, setPity] = useState(0);
  const [results, setResults] = useState<Card[]>([]);

  const pool = pools.find((p) => p.ip.id === selId) ?? pools[0];

  if (!pool) {
    return (
      <div className="screen">
        <div className="wrap" style={{ paddingTop: 48, paddingBottom: 80 }}>
          <div className="eyebrow" style={{ marginBottom: 14 }}>모아요 · 디지털 카드 뽑기</div>
          <h1 className="h-xl">뽑기</h1>
          <Empty icon="card" text="열려 있는 카드풀이 아직 없습니다" sub="카드가 등록되면 카드풀이 공개됩니다." />
        </div>
      </div>
    );
  }

  const { ip, cards } = pool;
  const rates = poolRates(cards);
  const top = RARITY_ORDER.map((r) => cards.find((c) => c.rarity === r)).find(Boolean) ?? cards[0];
  /* 천장 타깃 = 풀의 실제 최고 등급 — HOLO 없는 풀에서도 보장이 이행된다 */
  const pityCards = cards.filter((c) => c.rarity === top.rarity);
  const desc = POOL_DESC[ip.id] ?? `${ip.title} 카드풀. ${top.name} ${top.rarity}가 현재 최고 등급입니다.`;

  const selectPool = (id: string) => {
    setSelId(id);
    setResults([]);
    setPity(0);
  };

  const draw = (n: number) => {
    let p = pity;
    const res: Card[] = [];
    for (let i = 0; i < n; i++) {
      p++;
      let card = pickCard(cards, rates);
      if (p >= PITY_MAX) card = pickUniform(pityCards);
      if (card.rarity === top.rarity) p = 0;
      res.push(card);
    }
    setResults(res);
    setPity(p);
  };

  const nBest = results.filter((c) => c.rarity === 'HOLO').length;
  const nSsr = results.filter((c) => c.rarity === 'SSR').length;
  const summaryBits = [nBest ? `HOLO ×${nBest}` : null, nSsr ? `SSR ×${nSsr}` : null].filter(Boolean);

  return (
    <div style={{ minHeight: '100vh' }}>
      {/* pool switcher */}
      <div style={{ paddingTop: 68, borderBottom: '1px solid var(--line)' }}>
        <div className="wrap ipworld-switcher" role="group" aria-label="카드풀 선택">
          <span className="mono" style={{ fontSize: 11, letterSpacing: '.18em', color: 'var(--faint)', flex: '0 0 auto' }}>CARD POOLS</span>
          {pools.map(({ ip: p }) => {
            const active = p.id === ip.id;
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={active}
                onClick={() => selectPool(p.id)}
                style={{
                  flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', gap: 8, height: 38, padding: '0 16px 0 6px',
                  borderRadius: 999, fontSize: 13.5, fontWeight: active ? 700 : 500,
                  color: active ? 'var(--text)' : 'var(--dim)',
                  border: `1px solid ${active ? ipAccent(p) : 'var(--line-2)'}`,
                  background: active ? 'rgba(255,255,255,.05)' : 'rgba(255,255,255,.02)',
                  transition: 'all .25s ease',
                }}
              >
                <span style={{ width: 28, height: 28, borderRadius: 99, background: p.bg, backgroundSize: 'cover', backgroundPosition: 'center', boxShadow: '0 0 0 1px rgba(255,255,255,.15)' }} />
                {p.title}
              </button>
            );
          })}
        </div>
      </div>

      {/* hero / machine */}
      <section style={{ padding: 'clamp(40px, 5vw, 64px) 0 0' }}>
        <div className="wrap gacha-hero">
          <div>
            <div className="eyebrow rise">모아요 · 디지털 카드 뽑기</div>
            <h1 className="rise" style={{ margin: '14px 0 0', fontFamily: 'var(--ff-display)', fontWeight: 700, fontSize: 'clamp(36px, 5vw, 64px)', lineHeight: 1.04, letterSpacing: '-0.04em', animationDelay: '.08s' }}>
              {ip.title}<br />카드풀
            </h1>
            <p className="rise" style={{ margin: '14px 0 0', fontSize: 15, color: '#C9C3E4', maxWidth: 460, textWrap: 'pretty', animationDelay: '.16s' }}>{desc}</p>

            <div className="rise" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 22, animationDelay: '.22s' }}>
              {rates.map((r) => (
                <span key={r.rarity} className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, height: 32, padding: '0 13px', borderRadius: 999, fontSize: 11.5, border: `1px solid ${RARITY_META[r.rarity].color}55`, color: RARITY_META[r.rarity].color, background: 'rgba(255,255,255,.02)' }}>
                  <strong>{r.rarity}</strong> {r.rate}
                </span>
              ))}
            </div>

            {/* pity */}
            <div className="rise" style={{ marginTop: 26, maxWidth: 460, animationDelay: '.28s' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
                <span className="mono" style={{ fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--dim)' }}>천장까지</span>
                <span className="mono" style={{ fontSize: 13 }}>
                  <strong style={{ color: 'var(--violet-2)', fontSize: 17 }}>{PITY_MAX - pity}</strong> / {PITY_MAX}회
                </span>
              </div>
              <div style={{ height: 8, borderRadius: 99, background: 'rgba(255,255,255,.07)', marginTop: 9, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.min(100, Math.round((pity / PITY_MAX) * 100))}%`, borderRadius: 99, background: 'linear-gradient(90deg, #2DE2FF, #8B5CFF, #FF4D9D)', transition: 'width .5s cubic-bezier(.2,.6,.2,1)' }} />
              </div>
              <div className="money-caption" style={{ marginTop: 8 }}>{PITY_MAX}회 안에 {top.rarity} 미출현 시 다음 뽑기에서 {top.rarity} 확정</div>
            </div>

            <div className="rise" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 30, animationDelay: '.34s' }}>
              <button type="button" className="btn btn-holo" onClick={() => draw(1)} style={{ height: 52, padding: '0 28px', fontSize: 15 }}>
                1회 뽑기 ✦ ₩1,500
              </button>
              <button type="button" className="btn" onClick={() => draw(10)} style={{ height: 52, padding: '0 26px', fontSize: 15, fontWeight: 700, border: '1px solid rgba(139,92,255,.5)', background: 'rgba(139,92,255,.1)' }}>
                10연차 ₩14,000
              </button>
            </div>
            <div className="money-caption rise" style={{ lineHeight: 1.7, marginTop: 16, animationDelay: '.4s' }}>
              등급별 확률·천장 기준 전문 공시 · 미사용 충전금 전액 환불
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
            <MachineCard card={top} />
            <span className="mono" style={{ fontSize: 11.5, color: 'var(--dim)' }}>이번 카드풀 최고 등급 · No. {top.no}</span>
          </div>
        </div>
      </section>

      {/* results */}
      {results.length > 0 && (
        <section style={{ padding: 'clamp(44px, 6vw, 70px) 0 0' }}>
          <div className="wrap">
            <div style={{ borderRadius: 26, border: '1px solid rgba(139,92,255,.35)', background: 'linear-gradient(180deg, var(--surface-2), var(--bg-2))', padding: 'clamp(22px, 3vw, 34px)', position: 'relative', overflow: 'hidden' }}>
              <div aria-hidden style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: 'radial-gradient(600px 300px at 50% 0%, rgba(139,92,255,.18), transparent 70%)' }} />
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, position: 'relative' }}>
                <span className="mono" style={{ fontSize: 11, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--violet-2)' }}>뽑기 결과</span>
                <span className="mono" style={{ fontSize: 12, color: nBest ? RARITY_META.HOLO.color : nSsr ? RARITY_META.SSR.color : 'var(--dim)' }}>
                  {results.length}회 결과{summaryBits.length ? ` · ${summaryBits.join(' · ')}` : ' · 최고 등급 없음'}
                </span>
              </div>
              <div className="gacha-results" style={{ marginTop: 20, position: 'relative' }}>
                {results.map((c, i) => {
                  const tag = rarityTag(c.rarity);
                  return (
                    <div key={`${c.id}-${i}`} style={{ animation: `popIn .55s cubic-bezier(.2,.6,.2,1) ${i * 0.07}s both` }}>
                      <div className="gacha-result-card" style={{ aspectRatio: '5 / 7', borderRadius: 12, position: 'relative', overflow: 'hidden', background: c.bg, backgroundSize: 'cover', backgroundPosition: 'center', boxShadow: `0 0 0 1px ${tag.ring}, 0 18px 40px -18px rgba(0,0,0,.85)` }}>
                        <span className="mono" style={{ position: 'absolute', top: 8, left: 8, fontSize: 9.5, letterSpacing: '.06em', padding: '3px 7px', borderRadius: 5, fontWeight: 700, color: tag.color, background: tag.bg, zIndex: 2 }}>{c.rarity}</span>
                        <span style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, transparent 62%, rgba(8,6,15,.88) 100%)' }} />
                        <span style={{ position: 'absolute', left: 9, right: 9, bottom: 8, fontWeight: 700, fontSize: 11.5, lineHeight: 1.3 }}>{c.name}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="money-caption" style={{ marginTop: 18, position: 'relative' }}>
                뽑힌 카드는 <Link href={hrefFor('binder')} style={{ color: 'var(--dim)', textDecoration: 'underline' }}>내 바인더</Link>에 자동 저장됩니다
              </div>
            </div>
          </div>
        </section>
      )}

      {/* pool lineup */}
      <section style={{ padding: 'clamp(48px, 6vw, 76px) 0 clamp(70px, 9vw, 110px)' }}>
        <div className="wrap">
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
            <div>
              <div className="eyebrow">카드 도감</div>
              <h2 style={{ margin: '14px 0 0', fontFamily: 'var(--ff-display)', fontWeight: 700, fontSize: 'clamp(26px, 3.6vw, 40px)', letterSpacing: '-0.02em', lineHeight: 1.08 }}>{ip.title} 라인업</h2>
            </div>
            <Link className="mono" href={hrefFor('ip', ip.id)} style={{ fontSize: 12, color: 'var(--dim)' }}>이 세계 더 보기 →</Link>
          </div>
          <div className="gacha-lineup" style={{ marginTop: 26 }}>
            {cards.map((c) => {
              const tag = rarityTag(c.rarity);
              return (
                <div key={c.id} className="gacha-lineup-card">
                  <div style={{ aspectRatio: '5 / 7', borderRadius: 12, position: 'relative', overflow: 'hidden', background: c.bg, backgroundSize: 'cover', backgroundPosition: 'center', boxShadow: '0 0 0 1px rgba(255,255,255,.1)' }}>
                    <span className="mono" style={{ position: 'absolute', top: 8, left: 8, fontSize: 9.5, letterSpacing: '.06em', padding: '3px 7px', borderRadius: 5, fontWeight: 700, color: tag.color, background: tag.bg }}>{c.rarity}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontWeight: 700, fontSize: 13.5 }}>{c.name}</span>
                    <span className="mono" style={{ fontSize: 10.5, color: 'var(--faint)', flex: '0 0 auto' }}>{c.no}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
