'use client';

import Link from 'next/link';
import { useMemo, useState, useTransition } from 'react';
import { openDrawTicketAction } from '@/app/packs/actions';
import type { CatalogSnapshot } from '@/lib/catalog';
import type { Card } from '@/lib/data';
import type { DrawTicketInventory, OpenedCard, PackPoolGroup } from '@/lib/draw-tickets';
import { ipAccentInk } from '@/lib/ip-display';
import { rarityTag, RARITY_ORDER } from '@/lib/rarity';
import { hrefFor } from '@/lib/routes';
import { Empty } from '@/components/ui/Empty';
import { useTilt } from '@/components/ui/motion';

/* 카드팩 개봉 화면(#71) — 구매로 발급된 뽑기권(UI "카드팩")을 풀별로 보여주고
 * 개봉한다. 카드는 open_draw_ticket RPC(서버)가 결정하고, reveal 연출은
 * 코스메틱이다(ADR-0004). 옛 유료 뽑기 화면(Gacha.tsx)의 포일·reveal
 * 연출을 무료 모델로 재목적화했다 — 가격·천장·확률 공시·클라 RNG는 제거. */

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


interface RevealCard {
  opened: OpenedCard;
  card: Card | null;
}

type Phase =
  | { kind: 'list' }
  | { kind: 'opening'; poolId: string }
  | { kind: 'reveal'; poolId: string; poolName: string; cards: RevealCard[] };

export function CardPacks({
  catalog,
  inventory,
}: {
  catalog: Pick<CatalogSnapshot, 'source' | 'ips' | 'cards'>;
  inventory: DrawTicketInventory;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: 'list' });
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const cardsById = useMemo(() => new Map(catalog.cards.map((c) => [c.id, c])), [catalog.cards]);
  const ipsById = useMemo(() => new Map(catalog.ips.map((ip) => [ip.id, ip])), [catalog.ips]);

  /* 히어로 비주얼 — 보유 팩 라인업의 최고 등급 카드, 없으면 카탈로그 대표 카드 */
  const heroCard = useMemo(() => {
    const lineup = inventory.groups
      .flatMap((g) => g.lineupCardIds)
      .map((id) => cardsById.get(id))
      .filter((c): c is Card => Boolean(c));
    const pool = lineup.length ? lineup : catalog.cards;
    for (const rarity of RARITY_ORDER) {
      const hit = pool.find((c) => c.rarity === rarity);
      if (hit) return hit;
    }
    return null;
  }, [inventory.groups, cardsById, catalog.cards]);

  const packCount = inventory.groups.reduce((sum, g) => sum + g.ticketIds.length, 0);

  const open = (group: PackPoolGroup) => {
    const ticketId = group.ticketIds[0];
    if (!ticketId || isPending) return;
    setError(null);
    setPhase({ kind: 'opening', poolId: group.poolId });
    startTransition(async () => {
      const result = await openDrawTicketAction(ticketId);
      if (result.status === 'error') {
        setError(result.message);
        setPhase({ kind: 'list' });
        return;
      }
      setPhase({
        kind: 'reveal',
        poolId: group.poolId,
        poolName: group.poolName,
        cards: result.cards.map((opened) => ({ opened, card: cardsById.get(opened.cardId) ?? null })),
      });
    });
  };

  return (
    <div style={{ minHeight: '100vh' }}>
      {/* hero */}
      <section style={{ padding: 'clamp(96px, 11vw, 128px) 0 0' }}>
        <div className="wrap packs-hero">
          <div>
            <div className="eyebrow rise">모아요 · 카드팩</div>
            <h1 className="rise" style={{ margin: '14px 0 0', fontFamily: 'var(--ff-display)', fontWeight: 700, fontSize: 'clamp(36px, 5vw, 64px)', lineHeight: 1.04, letterSpacing: '-0.04em', animationDelay: '.08s' }}>
              카드팩
            </h1>
            <p className="rise" style={{ margin: '14px 0 0', fontSize: 15, color: '#C9C3E4', maxWidth: 460, textWrap: 'pretty', animationDelay: '.16s' }}>
              굿즈를 구매하면 카드팩이 발급돼요. 개봉하면 그 컬렉션의 카드 1장이 나오고, 내 바인더에 바로 저장됩니다.
            </p>
            <div className="rise" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 26, animationDelay: '.24s' }}>
              {inventory.signedIn && (
                <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 40, padding: '0 18px', borderRadius: 999, fontSize: 12.5, border: '1px solid rgba(139,92,255,.5)', background: 'rgba(139,92,255,.1)', color: 'var(--text)' }}>
                  보유 카드팩 <strong style={{ color: 'var(--violet-2)', fontSize: 16 }}>{packCount}</strong>개
                </span>
              )}
              <Link className="btn btn-ghost" href={hrefFor('binder')} style={{ height: 40, fontSize: 13.5 }}>내 바인더 →</Link>
            </div>
            <div className="money-caption rise" style={{ lineHeight: 1.7, marginTop: 16, animationDelay: '.3s' }}>
              카드팩은 구매 리워드로 무상 발급 · 유효기간 없이 원할 때 개봉
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
            {heroCard && <MachineCard card={heroCard} />}
            {heroCard && <span className="mono" style={{ fontSize: 11.5, color: 'var(--dim)' }}>컬렉션 대표 카드 · No. {heroCard.no}</span>}
          </div>
        </div>
      </section>

      {/* reveal */}
      {phase.kind === 'reveal' && (
        <section style={{ padding: 'clamp(44px, 6vw, 70px) 0 0' }}>
          <div className="wrap">
            <div style={{ borderRadius: 26, border: '1px solid rgba(139,92,255,.35)', background: 'linear-gradient(180deg, var(--surface-2), var(--bg-2))', padding: 'clamp(22px, 3vw, 34px)', position: 'relative', overflow: 'hidden' }}>
              <div aria-hidden style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: 'radial-gradient(600px 300px at 50% 0%, rgba(139,92,255,.18), transparent 70%)' }} />
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, position: 'relative' }}>
                <span className="mono" style={{ fontSize: 11, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--violet-2)' }}>개봉 결과</span>
                <span className="mono" style={{ fontSize: 12, color: 'var(--dim)' }}>{phase.poolName}</span>
              </div>
              <div className="packs-results" style={{ marginTop: 20, position: 'relative' }}>
                {phase.cards.map(({ opened, card }, i) => {
                  const tag = rarityTag(opened.rarity);
                  return (
                    <div key={`${opened.cardId}-${i}`} style={{ animation: `popIn .55s cubic-bezier(.2,.6,.2,1) ${i * 0.07}s both` }}>
                      <div className="packs-result-card" style={{ aspectRatio: '5 / 7', borderRadius: 12, position: 'relative', overflow: 'hidden', background: card?.bg ?? 'linear-gradient(180deg, var(--surface-2), var(--bg-2))', backgroundSize: 'cover', backgroundPosition: 'center', boxShadow: `0 0 0 1px ${tag.ring}, 0 18px 40px -18px rgba(0,0,0,.85)` }}>
                        <span className="mono" style={{ position: 'absolute', top: 8, left: 8, fontSize: 9.5, letterSpacing: '.06em', padding: '3px 7px', borderRadius: 5, fontWeight: 700, color: tag.color, background: tag.bg, zIndex: 2 }}>{opened.rarity}</span>
                        {opened.isNew && (
                          <span className="mono" style={{ position: 'absolute', top: 8, right: 8, fontSize: 9, letterSpacing: '.1em', padding: '3px 7px', borderRadius: 5, fontWeight: 700, color: '#0A0813', background: 'var(--mint)', zIndex: 2 }}>NEW</span>
                        )}
                        <span style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, transparent 62%, rgba(8,6,15,.88) 100%)' }} />
                        <span style={{ position: 'absolute', left: 9, right: 9, bottom: 8, fontWeight: 700, fontSize: 11.5, lineHeight: 1.3 }}>{card?.name ?? '새 카드'}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginTop: 18, position: 'relative' }}>
                <Link className="btn btn-holo" href={hrefFor('binder')} style={{ height: 44, fontSize: 14 }}>내 바인더에서 보기 →</Link>
                <button type="button" className="btn btn-ghost" onClick={() => setPhase({ kind: 'list' })} style={{ height: 44, fontSize: 14 }}>
                  계속 개봉
                </button>
                <span className="money-caption">개봉된 카드는 바인더에 자동 저장됩니다</span>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* pack inventory */}
      <section style={{ padding: 'clamp(44px, 6vw, 70px) 0 clamp(70px, 9vw, 110px)' }}>
        <div className="wrap">
          <div className="eyebrow">보유 카드팩</div>
          {error && (
            <div role="alert" className="mono" style={{ marginTop: 16, padding: '12px 16px', borderRadius: 12, fontSize: 12.5, border: '1px solid rgba(255,77,157,.4)', background: 'rgba(255,77,157,.08)', color: 'var(--pink)' }}>
              {error}
            </div>
          )}

          {!inventory.signedIn ? (
            <div style={{ marginTop: 22, textAlign: 'center', padding: '56px 20px', border: '1px dashed var(--line-2)', borderRadius: 20 }}>
              <div style={{ fontSize: 17, fontWeight: 700 }}>로그인하면 보유 카드팩이 보여요</div>
              <div style={{ fontSize: 13.5, color: 'var(--dim)', marginTop: 8 }}>굿즈 구매로 받은 카드팩과 개봉 기록을 계정에 보관합니다.</div>
              <Link className="btn btn-holo" href={`/login?next=${encodeURIComponent('/packs')}`} style={{ display: 'inline-flex', height: 46, fontSize: 14, marginTop: 18 }}>
                로그인하고 확인하기
              </Link>
            </div>
          ) : inventory.groups.length === 0 ? (
            <div style={{ marginTop: 22 }}>
              <Empty icon="card" text="아직 보유한 카드팩이 없어요" sub="굿즈를 구매하면 컬렉션 카드팩이 무상으로 발급됩니다." />
              <div style={{ display: 'flex', justifyContent: 'center', marginTop: 6 }}>
                <Link className="btn btn-holo" href={hrefFor('shop')} style={{ height: 46, fontSize: 14 }}>굿즈샵 둘러보기 →</Link>
              </div>
            </div>
          ) : (
            <div className="packs-groups" style={{ marginTop: 22 }}>
              {inventory.groups.map((group) => {
                const ip = ipsById.get(group.ipId);
                const opening = phase.kind === 'opening' && phase.poolId === group.poolId;
                const lineup = group.lineupCardIds
                  .map((id) => cardsById.get(id))
                  .filter((c): c is Card => Boolean(c));
                return (
                  <div key={group.poolId} style={{ borderRadius: 22, border: '1px solid var(--line)', background: 'linear-gradient(180deg, var(--surface), var(--bg-2))', padding: 'clamp(18px, 2.4vw, 26px)', display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                        {ip && (
                          <span style={{ width: 34, height: 34, borderRadius: 99, flex: '0 0 auto', background: ip.bg, backgroundSize: 'cover', backgroundPosition: 'center', boxShadow: '0 0 0 1px rgba(255,255,255,.15)' }} />
                        )}
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: 16, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{group.poolName}</div>
                          {ip && <div className="mono" style={{ fontSize: 11, color: ipAccentInk(ip), marginTop: 2 }}>{ip.title}</div>}
                        </div>
                      </div>
                      <span className="mono" style={{ flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', height: 30, padding: '0 13px', borderRadius: 999, fontSize: 12, border: '1px solid rgba(139,92,255,.5)', background: 'rgba(139,92,255,.1)', color: 'var(--violet-2)', fontWeight: 700 }}>
                        {group.ticketIds.length}개
                      </span>
                    </div>

                    {lineup.length > 0 && (
                      <div style={{ display: 'flex', gap: 8, overflow: 'hidden' }}>
                        {lineup.slice(0, 5).map((c) => {
                          const tag = rarityTag(c.rarity);
                          return (
                            <div key={c.id} style={{ width: 64, flex: '0 0 auto', aspectRatio: '5 / 7', borderRadius: 8, position: 'relative', overflow: 'hidden', background: c.bg, backgroundSize: 'cover', backgroundPosition: 'center', boxShadow: `0 0 0 1px ${tag.ring}` }}>
                              <span className="mono" style={{ position: 'absolute', top: 4, left: 4, fontSize: 7.5, letterSpacing: '.04em', padding: '2px 5px', borderRadius: 4, fontWeight: 700, color: tag.color, background: tag.bg }}>{c.rarity}</span>
                            </div>
                          );
                        })}
                        {lineup.length > 5 && (
                          <div className="mono" style={{ alignSelf: 'center', fontSize: 11, color: 'var(--faint)' }}>+{lineup.length - 5}</div>
                        )}
                      </div>
                    )}

                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 'auto' }}>
                      <button
                        type="button"
                        className="btn btn-holo"
                        onClick={() => open(group)}
                        disabled={isPending}
                        style={{ height: 48, padding: '0 26px', fontSize: 14.5, opacity: isPending && !opening ? 0.55 : 1 }}
                      >
                        {opening ? '개봉 중…' : '카드팩 개봉 ✦'}
                      </button>
                      <span className="money-caption">개봉 1회 = 카드 1장</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
