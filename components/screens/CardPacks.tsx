'use client';

import { useMemo, useState, useTransition } from 'react';
import { openDrawTicketAction } from '@/app/packs/actions';
import type { CatalogSnapshot } from '@/lib/catalog';
import type { Card } from '@/lib/data';
import type { DrawTicketInventory, OpenedCard, PackPoolGroup } from '@/lib/draw-tickets';
import { ipAccentInk } from '@/lib/ip-display';
import { rarityTag, RARITY_ORDER } from '@/lib/rarity';
import { hrefFor } from '@/lib/routes';
import { Badge } from '@/components/wc/Badge';
import { EmptyState } from '@/components/wc/EmptyState';
import { SectionHeading } from '@/components/wc/SectionHeading';
import { WcButton } from '@/components/wc/WcButton';

/* 카드팩 개봉 화면(#71) — White Catalog campaign-landing 차용 재조판(#327 · DESIGN §8).
 * 구매로 발급된 뽑기권(UI "카드팩")을 풀별로 보여주고 개봉한다. 카드는 open_draw_ticket
 * RPC(서버)가 결정하고 reveal 연출은 코스메틱이다(ADR-0002 · ADR-0004). 화면 크롬은
 * 흰 지면·잉크·헤어라인, 카드 타일 내부만 foil·rarity 물성을 유지한다(DESIGN §1-4). */

/* 대표 카드 타일 — 카드 물성(어두운 배경·foil 시트·등급 링)은 유지하되
 * HM의 틸트·부유 연출은 정적 카탈로그 원칙에 따라 제거했다(DESIGN §5 motion). */
function MachineCard({ card }: { card: Card }) {
  const tag = rarityTag(card.rarity);
  return (
    <div
      style={{
        width: 'clamp(220px, 24vw, 300px)',
        aspectRatio: '5 / 7',
        borderRadius: 16,
        position: 'relative',
        overflow: 'hidden',
        background: card.bg,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        boxShadow: `0 0 0 1px ${tag.ring}`,
      }}
    >
      <div aria-hidden style={{ position: 'absolute', inset: 0, mixBlendMode: 'color-dodge', opacity: 0.35, background: 'var(--holo)', backgroundSize: '240% 240%', backgroundPosition: '20% 20%' }} />
      <div aria-hidden style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, transparent 58%, rgba(8,6,15,.9) 100%)' }} />
      <span style={{ position: 'absolute', top: 12, left: 12, fontSize: 11, letterSpacing: '.08em', padding: '4px 10px', borderRadius: 6, fontWeight: 700, color: tag.color, background: tag.bg }}>{card.rarity}</span>
      <span style={{ position: 'absolute', left: 14, right: 14, bottom: 14, fontWeight: 700, fontSize: 16, textAlign: 'left', color: '#FFFFFF' }}>{card.name}</span>
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
    <div className="wc-root wc-packs">
      <div className="wc-container">
        {/* hero — 좌 텍스트 + 우 대표 카드(wc-discovery.css의 2열 그리드) */}
        <section className="wc-packs__hero">
          <div className="wc-packs__hero-body">
            <SectionHeading
              as="h1"
              subcopy="굿즈를 구매하면 카드팩이 발급돼요. 개봉하면 그 컬렉션의 카드 1장이 나오고, 내 바인더에 바로 저장됩니다."
              title="카드팩"
            />
            {inventory.signedIn && (
              <span className="wc-packs__count">
                보유 카드팩 <strong>{packCount}</strong>개
              </span>
            )}
            <p className="wc-packs__hero-note" style={{ marginTop: 12 }}>
              카드팩은 구매 리워드로 무상 발급 · 유효기간 없이 원할 때 개봉
            </p>
            <div className="wc-packs__hero-actions" style={{ maxWidth: 220, marginTop: 20 }}>
              <WcButton href={hrefFor('binder')}>내 바인더</WcButton>
            </div>
          </div>
          <div className="wc-packs__hero-visual">
            {heroCard && <MachineCard card={heroCard} />}
            {heroCard && <p className="wc-packs__hero-caption" style={{ marginTop: 10 }}>컬렉션 대표 카드 · No. {heroCard.no}</p>}
          </div>
        </section>

        {/* reveal — 개봉 결과 패널(흰 지면 헤어라인 박스, 카드 타일만 rarity 물성) */}
        {phase.kind === 'reveal' && (
          <section aria-label="개봉 결과" className="wc-packs__reveal">
            <SectionHeading className="wc-packs__reveal-heading" title="개봉 결과" />
            <p className="wc-packs__reveal-pool" style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--wc-ink-tertiary)' }}>{phase.poolName}</p>
            <div className="wc-packs__reveal-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 10, marginTop: 20 }}>
              {phase.cards.map(({ opened, card }, i) => {
                const tag = rarityTag(opened.rarity);
                return (
                  <div key={`${opened.cardId}-${i}`} style={{ animation: `wc-pop-in .55s cubic-bezier(0, 0, .3, 1) ${i * 0.07}s both` }}>
                    <div style={{ aspectRatio: '5 / 7', borderRadius: 10, position: 'relative', overflow: 'hidden', background: card?.bg ?? 'rgba(8,6,15,.9)', backgroundSize: 'cover', backgroundPosition: 'center', boxShadow: `0 0 0 1px ${tag.ring}` }}>
                      <span style={{ position: 'absolute', top: 8, left: 8, fontSize: 9.5, letterSpacing: '.06em', padding: '3px 7px', borderRadius: 5, fontWeight: 700, color: tag.color, background: tag.bg, zIndex: 2 }}>{opened.rarity}</span>
                      {opened.isNew && (
                        <span style={{ position: 'absolute', top: 8, right: 8, fontSize: 9, letterSpacing: '.1em', padding: '3px 7px', borderRadius: 5, fontWeight: 700, color: 'var(--wc-ink)', background: 'var(--wc-surface)', zIndex: 2 }}>NEW</span>
                      )}
                      <span aria-hidden style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, transparent 62%, rgba(8,6,15,.88) 100%)' }} />
                      <span style={{ position: 'absolute', left: 9, right: 9, bottom: 8, fontWeight: 700, fontSize: 11.5, lineHeight: 1.3, color: '#FFFFFF' }}>{card?.name ?? '새 카드'}</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="wc-btn-group wc-packs__reveal-actions" style={{ maxWidth: 448, margin: '24px auto 0' }}>
              <WcButton href={hrefFor('binder')} variant="primary">내 바인더에서 보기</WcButton>
              <WcButton onClick={() => setPhase({ kind: 'list' })}>계속 개봉</WcButton>
            </div>
            <p className="wc-packs__reveal-note" style={{ margin: '16px 0 0', fontSize: 13, color: 'var(--wc-ink-tertiary)' }}>개봉된 카드는 바인더에 자동 저장됩니다</p>
          </section>
        )}

        {/* pack inventory */}
        <section className="wc-packs__inventory" style={{ marginTop: 56 }}>
          <SectionHeading title="보유 카드팩" />
          {error && (
            <p className="wc-packs__error" role="alert" style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--wc-danger)' }}>
              {error}
            </p>
          )}

          {!inventory.signedIn ? (
            <EmptyState
              action={(
                <WcButton href={`/login?next=${encodeURIComponent('/packs')}`} variant="primary">
                  로그인하고 확인하기
                </WcButton>
              )}
              className="wc-packs__gate"
              description="굿즈 구매로 받은 카드팩과 개봉 기록을 계정에 보관합니다."
              title="로그인하면 보유 카드팩이 보여요"
            />
          ) : inventory.groups.length === 0 ? (
            <EmptyState
              action={<WcButton href={hrefFor('shop')} variant="primary">굿즈샵 둘러보기</WcButton>}
              className="wc-packs__gate"
              description="굿즈를 구매하면 컬렉션 카드팩이 무상으로 발급됩니다."
              title="아직 보유한 카드팩이 없어요"
            />
          ) : (
            <div className="wc-packs__groups">
              {inventory.groups.map((group) => {
                const ip = ipsById.get(group.ipId);
                const opening = phase.kind === 'opening' && phase.poolId === group.poolId;
                const lineup = group.lineupCardIds
                  .map((id) => cardsById.get(id))
                  .filter((c): c is Card => Boolean(c));
                return (
                  <div key={group.poolId} className="wc-packs__group">
                    <div className="wc-packs__group-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                        {ip && (
                          <span aria-hidden className="wc-packs__group-thumb" style={{ display: 'block', width: 40, height: 40, flex: '0 0 auto', background: ip.bg, backgroundSize: 'cover', backgroundPosition: 'center' }} />
                        )}
                        <div style={{ minWidth: 0 }}>
                          <strong className="wc-packs__group-name" style={{ display: 'block', fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{group.poolName}</strong>
                          {ip && <span className="wc-packs__group-ip" style={{ display: 'block', fontSize: 12, color: ipAccentInk(ip) }}>{ip.title}</span>}
                        </div>
                      </div>
                      <Badge className="wc-packs__group-count">{group.ticketIds.length}개</Badge>
                    </div>

                    {lineup.length > 0 && (
                      <div className="wc-packs__group-lineup" style={{ display: 'flex', gap: 8, overflow: 'hidden', marginTop: 16 }}>
                        {lineup.slice(0, 5).map((c) => {
                          const tag = rarityTag(c.rarity);
                          return (
                            <div key={c.id} style={{ width: 64, flex: '0 0 auto', aspectRatio: '5 / 7', borderRadius: 8, position: 'relative', overflow: 'hidden', background: c.bg, backgroundSize: 'cover', backgroundPosition: 'center', boxShadow: `0 0 0 1px ${tag.ring}` }}>
                              <span style={{ position: 'absolute', top: 4, left: 4, fontSize: 7.5, letterSpacing: '.04em', padding: '2px 5px', borderRadius: 4, fontWeight: 700, color: tag.color, background: tag.bg }}>{c.rarity}</span>
                            </div>
                          );
                        })}
                        {lineup.length > 5 && (
                          <span className="wc-packs__group-more" style={{ alignSelf: 'center', fontSize: 12, color: 'var(--wc-ink-tertiary)' }}>+{lineup.length - 5}</span>
                        )}
                      </div>
                    )}

                    <div className="wc-packs__group-cta" style={{ marginTop: 20 }}>
                      <WcButton disabled={isPending} onClick={() => open(group)} variant="primary">
                        {opening ? '개봉 중…' : '카드팩 개봉'}
                      </WcButton>
                      <p className="wc-packs__group-note" style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--wc-ink-tertiary)' }}>개봉 1회 = 카드 1장</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
