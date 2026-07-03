'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CatalogSnapshot } from '@/lib/catalog';
import type { Card, Ip } from '@/lib/data';
import { getHomeSelectableIps, type HomePostPreviewByIpId } from '@/lib/home-catalog';
import { ipAccent, ipEn } from '@/lib/ip-display';
import { RARITY_META, type RarityKey } from '@/lib/rarity';
import { hrefFor } from '@/lib/routes';
import { Empty } from '@/components/ui/Empty';
import { useHeroParallax, useTilt } from '@/components/ui/motion';

const compactNumber = (n: number) =>
  new Intl.NumberFormat('ko-KR', { notation: 'compact', maximumFractionDigits: 1 }).format(n);

function CrossfadeArt({ bg, className, baseOpacity = 1 }: { bg: string; className: string; baseOpacity?: number }) {
  const [layers, setLayers] = useState<{ id: number; bg: string }[]>(() => [{ id: 0, bg }]);
  const nextId = useRef(1);
  const prevBg = useRef(bg);

  useEffect(() => {
    if (bg === prevBg.current) return;
    prevBg.current = bg;
    const id = nextId.current++;
    setLayers((prev) => [...prev, { id, bg }]);
    const prune = window.setTimeout(
      () =>
        setLayers((prev) => {
          const index = prev.findIndex((layer) => layer.id === id);
          return index <= 0 ? prev : prev.slice(index);
        }),
      650,
    );
    return () => window.clearTimeout(prune);
  }, [bg]);

  // each newly-mounted layer fades in over the persistent one via the
  // `homeArtCrossfade` keyframe; the stale layer is pruned after the fade.
  return (
    <>
      {layers.map((layer) => (
        <div key={layer.id} className={className} style={{ background: layer.bg, opacity: baseOpacity }} />
      ))}
    </>
  );
}

function Hero({
  ips,
  selectedIp,
  onSelect,
}: {
  ips: Ip[];
  selectedIp: Ip;
  onSelect: (ipId: string) => void;
}) {
  const { artRef, onMouseMove, onMouseLeave } = useHeroParallax();
  const accent = ipAccent(selectedIp);

  return (
    <header
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      style={{ position: 'relative', minHeight: '100svh', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', overflow: 'hidden', isolation: 'isolate' }}
    >
      <div
        ref={artRef}
        aria-hidden
        style={{ position: 'absolute', inset: -48, zIndex: 0, transform: 'scale(1.04)', transition: 'transform .9s cubic-bezier(.2,.6,.2,1)' }}
      >
        <CrossfadeArt bg={selectedIp.bg} className="home-hero-art" />
      </div>
      <div aria-hidden style={{ position: 'absolute', inset: 0, zIndex: 1, background: 'linear-gradient(90deg, rgba(8,6,15,.92) 0%, rgba(8,6,15,.55) 42%, rgba(8,6,15,.12) 75%, rgba(8,6,15,.35) 100%)' }} />
      <div aria-hidden style={{ position: 'absolute', inset: 0, zIndex: 1, background: 'linear-gradient(180deg, rgba(8,6,15,.55) 0%, transparent 26%, transparent 55%, rgba(8,6,15,.94) 96%)' }} />

      <div style={{ position: 'absolute', top: 96, right: 'clamp(20px, 4vw, 56px)', zIndex: 2, textAlign: 'right' }}>
        <div className="mono" style={{ fontSize: 11, letterSpacing: '.22em', color: 'rgba(244,241,255,.75)' }}>NOW SHOWING</div>
        <div style={{ fontFamily: 'var(--ff-display)', fontSize: 'clamp(18px, 2.4vw, 28px)', fontWeight: 700, letterSpacing: '-0.02em', color: accent, transition: 'color .5s ease', marginTop: 4 }}>
          {ipEn(selectedIp)}
        </div>
      </div>

      <div className="wrap" style={{ position: 'relative', zIndex: 2, padding: '140px 24px 44px' }}>
        <div className="rise" style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 7, height: 7, borderRadius: 99, background: 'var(--mint)', boxShadow: '0 0 10px var(--mint)' }} />
          <span className="mono" style={{ fontSize: 12, letterSpacing: '.2em', textTransform: 'uppercase', color: 'var(--dim)' }}>ICONS · 공식 라이선스 팬덤 플랫폼</span>
        </div>

        <h1 className="h-xxl" style={{ margin: '26px 0 0' }}>
          <span className="rise" style={{ display: 'block', animationDelay: '.08s' }}>누구의</span>
          <span className="rise" style={{ display: 'block', animationDelay: '.18s' }}>
            <span className="holo-text" style={{ backgroundSize: '200% 200%' }}>팬</span>이세요?
          </span>
        </h1>
        <p className="rise" style={{ margin: '24px 0 0', maxWidth: 540, fontSize: 'clamp(16px, 1.8vw, 20px)', color: '#C9C3E4', animationDelay: '.28s', textWrap: 'pretty' }}>
          최애를 고르는 순간, 그 세계가 통째로 열립니다.<br />
          <strong style={{ color: 'var(--text)' }}>사고 · 모으고 · 만나고 · 떠들고</strong> — 흩어져 있던 덕질을 한 곳에서.
        </p>

        <div className="rise" style={{ marginTop: 40, animationDelay: '.38s' }}>
          <div className="eyebrow" style={{ marginBottom: 16 }}>최애를 골라보세요</div>
          <div style={{ display: 'flex', gap: 14, overflowX: 'auto', padding: '4px 4px 14px', scrollbarWidth: 'none' }} role="group" aria-label="최애 IP 선택">
            {ips.map((ip) => {
              const active = ip.id === selectedIp.id;
              const c = ipAccent(ip);
              return (
                <button key={ip.id} type="button" className="ip-pick" aria-pressed={active} onClick={() => onSelect(ip.id)}
                  style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start', padding: 0 }}>
                  <span
                    className="ip-pick-art"
                    style={{
                      display: 'block', width: 132, height: 84, borderRadius: 14, background: ip.bg,
                      position: 'relative', overflow: 'hidden',
                      boxShadow: active
                        ? `0 0 0 2px ${c}, 0 18px 44px -14px ${c}`
                        : '0 0 0 1px rgba(255,255,255,.14), 0 14px 30px -16px rgba(0,0,0,.8)',
                    }}
                  >
                    <span className="sheen" style={{ opacity: 0.4 }} />
                  </span>
                  <span style={{ display: 'block', textAlign: 'left', opacity: active ? 1 : 0.55, transition: 'opacity .3s ease' }}>
                    <span style={{ display: 'block', fontSize: 14, fontWeight: 700 }}>{ip.title}</span>
                    <span className="mono" style={{ display: 'block', fontSize: 11, color: 'var(--dim)', marginTop: 2 }}>{compactNumber(ip.fans)} FANS</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="rise" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 26, animationDelay: '.46s' }}>
          <Link className="btn btn-holo" href={hrefFor('ip', selectedIp.id)} style={{ height: 52, padding: '0 28px', fontSize: 16 }}>
            {selectedIp.title} 세계로 입장 →
          </Link>
          <a className="btn" href="#verbs" style={{ height: 52, padding: '0 26px', fontSize: 15, border: '1px solid var(--line-3)', background: 'rgba(8,6,15,.35)', backdropFilter: 'blur(8px)' }}>
            둘러보기
          </a>
        </div>
      </div>
    </header>
  );
}

function Ticker({ items }: { items: { c: string; t: string }[] }) {
  if (items.length === 0) return null;
  const loop = [...items, ...items];
  return (
    <div className="home-ticker">
      <div className="home-ticker-track">
        {loop.map((item, i) => (
          <span key={i} className="home-ticker-item" aria-hidden={i >= items.length}>
            <span style={{ width: 6, height: 6, borderRadius: 99, background: item.c, boxShadow: `0 0 8px ${item.c}` }} />
            {item.t}
          </span>
        ))}
      </div>
    </div>
  );
}

function TiltCard({ card, ip }: { card: Card; ip: Ip | null }) {
  const { cardRef, glareRef, onMouseMove, onMouseLeave } = useTilt();

  return (
    <div onMouseMove={onMouseMove} onMouseLeave={onMouseLeave} className="home-float" style={{ perspective: 1000 }}>
      <div
        ref={cardRef}
        style={{
          width: 'clamp(240px, 26vw, 310px)', aspectRatio: '5 / 7', borderRadius: 20, position: 'relative', overflow: 'hidden',
          background: card.bg,
          boxShadow: '0 40px 90px -30px rgba(0,0,0,.85), 0 0 0 1px rgba(255,255,255,.14), 0 0 60px -18px rgba(139,92,255,.55)',
          transformStyle: 'preserve-3d', transition: 'transform .35s ease, box-shadow .35s ease', willChange: 'transform',
        }}
      >
        <div ref={glareRef} aria-hidden style={{ position: 'absolute', inset: 0, mixBlendMode: 'color-dodge', opacity: 0.55, background: 'linear-gradient(115deg, transparent 20%, rgba(45,226,255,.5), rgba(139,92,255,.4), rgba(255,77,157,.5), transparent 80%)', backgroundSize: '240% 240%', backgroundPosition: '20% 20%', transition: 'background-position .3s ease' }} />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, transparent 55%, rgba(8,6,15,.9) 100%)' }} />
        <div className="mono" style={{ position: 'absolute', top: 14, left: 14, fontSize: 11, letterSpacing: '.08em', padding: '4px 10px', borderRadius: 6, color: '#0A0813', fontWeight: 700, background: 'var(--holo)', backgroundSize: '200% 200%', animation: 'holoShift 5s ease infinite' }}>
          {card.rarity}
        </div>
        <div style={{ position: 'absolute', left: 18, right: 18, bottom: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontWeight: 700, fontSize: 17 }}>{card.name}</span>
          <span className="mono" style={{ fontSize: 11, color: 'var(--dim)' }}>No. {card.no}{ip ? ` · ${ip.title}` : ''}</span>
        </div>
      </div>
    </div>
  );
}

export function Home({
  catalog,
  postPreviewByIpId,
}: {
  catalog: CatalogSnapshot;
  postPreviewByIpId: HomePostPreviewByIpId;
}) {
  const selectableIps = useMemo(() => getHomeSelectableIps(catalog), [catalog]);
  const [selectedIpId, setSelectedIpId] = useState<string | null>(null);
  const selectedIp = selectableIps.find((ip) => ip.id === selectedIpId) ?? selectableIps[0] ?? null;

  const ticker = useMemo(() => {
    const items: { c: string; t: string }[] = [];
    for (const e of catalog.events) {
      if (e.status === '예매중' || e.status === '진행중') items.push({ c: 'var(--mint)', t: `${e.title} — ${e.date} ${e.status}` });
    }
    for (const g of catalog.goods) {
      if (g.stock === 'low') items.push({ c: 'var(--amber)', t: `${g.name} — 한정 · 품절임박` });
    }
    for (const post of Object.values(postPreviewByIpId)) {
      if (post) items.push({ c: 'var(--pink)', t: `@${post.user} 님의 ${post.tag} — ♥ ${post.likes}` });
    }
    const fans = catalog.ips.reduce((sum, ip) => sum + ip.fans, 0);
    if (fans > 0) items.push({ c: 'var(--cyan)', t: `지금 ${compactNumber(fans)} 팬이 ICONS에서 덕질 중` });
    return items.slice(0, 8);
  }, [catalog, postPreviewByIpId]);

  const holoCard = useMemo(() => {
    const byRarity = (r: RarityKey) => catalog.cards.find((c) => c.rarity === r);
    return byRarity('HOLO') ?? byRarity('SSR') ?? catalog.cards[0] ?? null;
  }, [catalog.cards]);
  const holoCardIp = holoCard ? catalog.ips.find((ip) => ip.id === holoCard.ip) ?? null : null;

  if (!selectedIp) {
    return (
      <div className="screen">
        <div className="wrap" style={{ paddingTop: 48, paddingBottom: 80 }}>
          <Empty icon="ip" text="등록된 IP가 아직 없습니다" sub="곧 새로운 IP가 공개될 예정이에요." />
        </div>
      </div>
    );
  }

  const verbs = [
    { n: '01', word: '사요', eyebrow: 'OFFICIAL GOODS', color: 'var(--amber)', art: catalog.goods[0]?.img, href: hrefFor('shop'), anchor: false, desc: 'IP 파트너와 직접 계약한 공식 라이선스 정품 굿즈. 한정판은 여기서 제일 먼저 열려요.' },
    { n: '02', word: '모아요', eyebrow: 'GACHA CARDS', color: 'var(--violet-2)', art: catalog.cards[0]?.bg, href: '#gacha', anchor: true, desc: '가챠로 뽑는 수집 카드. SSR·HOLO 포일이 빛나고, 확률은 전부 공시합니다.' },
    { n: '03', word: '만나요', eyebrow: 'POP-UP & TICKETS', color: 'var(--mint)', art: catalog.events[0]?.img, href: hrefFor('events'), anchor: false, desc: '팝업스토어와 온라인 이벤트 예매. QR 티켓으로 줄 없이 입장해요.' },
    { n: '04', word: '떠들어요', eyebrow: 'FANDOM COMMUNITY', color: 'var(--pink)', art: catalog.events[3]?.img ?? catalog.events[1]?.img, href: hrefFor('community'), anchor: false, desc: '같은 최애를 가진 사람들의 채널. 인증하고, 자랑하고, 교환 상대를 찾아요.' },
  ];

  return (
    <div style={{ minHeight: '100vh' }}>
      <Hero ips={selectableIps} selectedIp={selectedIp} onSelect={setSelectedIpId} />

      <Ticker items={ticker} />

      {/* four verbs */}
      <section id="verbs" style={{ padding: 'clamp(64px, 9vw, 110px) 0 clamp(40px, 6vw, 70px)' }}>
        <div className="wrap">
          <div className="eyebrow">WHAT YOU DO HERE</div>
          <h2 style={{ margin: '18px 0 0', fontFamily: 'var(--ff-display)', fontWeight: 700, fontSize: 'clamp(30px, 4.6vw, 52px)', lineHeight: 1.05, letterSpacing: '-0.02em' }}>
            덕질은 네 가지<br />동사로 움직여요
          </h2>
          <div style={{ marginTop: 'clamp(36px, 5vw, 56px)', borderTop: '1px solid var(--line)' }}>
            {verbs.map((v) => {
              const inner = (
                <>
                  <span className="mono" style={{ fontSize: 13, color: 'var(--faint)', width: 34 }}>{v.n}</span>
                  <span style={{ width: 'min(240px, 34vw)' }}>
                    <span style={{ display: 'block', fontFamily: 'var(--ff-display)', fontWeight: 700, fontSize: 'clamp(34px, 4.8vw, 62px)', letterSpacing: '-0.03em', lineHeight: 1 }}>{v.word}</span>
                  </span>
                  <span style={{ flex: 1, minWidth: 220 }}>
                    <span className="mono" style={{ display: 'block', fontSize: 11, letterSpacing: '.18em', color: v.color }}>{v.eyebrow}</span>
                    <span style={{ display: 'block', fontSize: 15, color: 'var(--dim)', marginTop: 8, maxWidth: 420, textWrap: 'pretty' }}>{v.desc}</span>
                  </span>
                  <span className="verb-art" style={{ flex: '0 0 auto', width: 'clamp(120px, 14vw, 168px)', height: 'clamp(76px, 9vw, 104px)', borderRadius: 14, background: v.art ?? 'var(--surface-2)', position: 'relative', overflow: 'hidden', boxShadow: '0 18px 40px -18px rgba(0,0,0,.8)' }}>
                    <span className="sheen" style={{ opacity: 0.4 }} />
                  </span>
                  <span aria-hidden style={{ fontSize: 22, color: v.color }}>→</span>
                </>
              );
              return v.anchor ? (
                <a key={v.n} className="verb-row" href={v.href}>{inner}</a>
              ) : (
                <Link key={v.n} className="verb-row" href={v.href}>{inner}</Link>
              );
            })}
          </div>
        </div>
      </section>

      {/* gacha teaser */}
      <section id="gacha" style={{ background: 'linear-gradient(180deg, var(--bg), var(--bg-2) 20%, var(--bg-2) 80%, var(--bg))', padding: 'clamp(70px, 9vw, 110px) 0' }}>
        <div className="wrap" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 'clamp(40px, 6vw, 72px)', alignItems: 'center' }}>
          <div>
            <div className="eyebrow">모아요 · 수집 카드</div>
            <h2 style={{ margin: '18px 0 0', fontFamily: 'var(--ff-display)', fontWeight: 700, fontSize: 'clamp(30px, 4.6vw, 52px)', lineHeight: 1.08, letterSpacing: '-0.02em' }}>
              지금 뽑으면,<br />뭐가 나올까요?
            </h2>
            <p style={{ margin: '18px 0 0', fontSize: 16, color: 'var(--dim)', maxWidth: 440, textWrap: 'pretty' }}>
              충전금으로 돌리는 가챠. SSR·HOLO는 홀로그래픽 포일로 빛나고,
              일정 횟수 안에 최고 등급이 <strong style={{ color: 'var(--text)' }}>천장으로 보장</strong>됩니다.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 24 }}>
              {(Object.keys(RARITY_META) as RarityKey[]).map((k) => (
                <span key={k} className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, height: 34, padding: '0 14px', borderRadius: 999, border: '1px solid var(--line-2)', fontSize: 12, color: 'var(--dim)' }}>
                  <span style={{ width: 7, height: 7, borderRadius: 99, background: RARITY_META[k].color }} />
                  {k}
                </span>
              ))}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 30 }}>
              <a className="btn btn-holo" href="#join" style={{ height: 50, padding: '0 26px', fontSize: 15 }}>가입하고 뽑기 시작</a>
              <Link className="btn btn-ghost" href={hrefFor('iphub')} style={{ height: 50, fontSize: 15 }}>카드풀 구경하기</Link>
            </div>
            <p className="money-caption" style={{ margin: '22px 0 0', lineHeight: 1.6 }}>
              등급별 획득 확률과 천장 기준은 각 카드풀 페이지에 전문 공시됩니다.<br />
              충전금 미사용 잔액은 전액 환불 대상입니다.
            </p>
          </div>
          {holoCard && (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '20px 0' }}>
              <TiltCard card={holoCard} ip={holoCardIp} />
            </div>
          )}
        </div>
      </section>

      {/* join / trust */}
      <section id="join" style={{ padding: 'clamp(80px, 11vw, 140px) 0 clamp(60px, 8vw, 90px)', textAlign: 'center' }}>
        <div className="wrap">
          <h2 style={{ margin: 0, fontFamily: 'var(--ff-display)', fontWeight: 700, fontSize: 'clamp(40px, 7vw, 88px)', lineHeight: 1.05, letterSpacing: '-0.04em' }}>
            당신의 <span className="holo-text" style={{ backgroundSize: '200% 200%' }}>최애</span>가<br />기다리고 있어요
          </h2>
          <p style={{ margin: '20px auto 0', maxWidth: 460, fontSize: 16, color: 'var(--dim)', textWrap: 'pretty' }}>
            가입은 3초, 둘러보기는 로그인 없이. 결제는 굿즈를 담는 순간에만 필요해요.
          </p>
          <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: 12, marginTop: 34 }}>
            <Link className="btn btn-holo" href="/login?next=%2F" style={{ height: 54, padding: '0 32px', fontSize: 16 }}>3초 만에 시작하기</Link>
            <Link className="btn btn-ghost" href={hrefFor('iphub')} style={{ height: 54, padding: '0 28px', fontSize: 15 }}>IP 먼저 둘러보기</Link>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginTop: 'clamp(50px, 7vw, 80px)', textAlign: 'left' }}>
            {[
              { t: '공식 라이선스 정품', d: 'IP 파트너와 직접 계약한 정품만 입점해요.' },
              { t: '확률 공시 · 천장 보장', d: '가챠 확률은 카드풀마다 전문 공시, 최고 등급은 천장으로 보장돼요.' },
              { t: '안전한 결제 · 환불', d: '토스페이먼츠 결제, 미사용 충전금은 전액 환불 대상이에요.' },
            ].map((tr) => (
              <div key={tr.t} className="card" style={{ display: 'flex', gap: 14, padding: 22, borderRadius: 18 }}>
                <span style={{ flex: '0 0 auto', width: 26, height: 26, borderRadius: 99, display: 'grid', placeItems: 'center', background: 'rgba(56,240,192,.14)', color: 'var(--mint)', fontSize: 14, fontWeight: 700 }}>✓</span>
                <span>
                  <span style={{ display: 'block', fontWeight: 700, fontSize: 15 }}>{tr.t}</span>
                  <span style={{ display: 'block', fontSize: 13.5, color: 'var(--dim)', marginTop: 5, textWrap: 'pretty' }}>{tr.d}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
