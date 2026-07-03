'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { CatalogSnapshot } from '@/lib/catalog';
import type { Card, Ip } from '@/lib/data';
import { ipAccent } from '@/lib/ip-display';
import { RARITY_META, type RarityKey } from '@/lib/rarity';
import { hrefFor } from '@/lib/routes';
import { Empty } from '@/components/ui/Empty';
import { Modal } from '@/components/ui/Modal';

/* mock 시세 — 실제 시세는 v2 교환/마켓 데이터가 진실원 (현행 바인더도 mock 표기) */
const MOCK_PRICE: Partial<Record<RarityKey, string>> = { HOLO: '₩48,000', SSR: '₩30,000', SR: '₩18,000', R: '₩12,000', N: '₩8,000' };

function rarityTag(rarity: RarityKey): { color: string; bg: string; ring: string } {
  if (rarity === 'HOLO') return { color: '#0A0813', bg: 'var(--holo)', ring: `${RARITY_META.HOLO.color}99` };
  if (rarity === 'N') return { color: 'var(--text)', bg: 'rgba(8,6,15,.75)', ring: 'rgba(255,255,255,.18)' };
  const c = RARITY_META[rarity].color;
  const ink = rarity === 'R';
  return { color: ink ? '#0A0813' : 'var(--text)', bg: `${c}${ink ? 'E6' : 'D9'}`, ring: `${c}73` };
}

function CardDetail({
  card,
  ip,
  hasOwnership,
  collection,
  onClose,
}: {
  card: Card;
  ip: Ip | undefined;
  hasOwnership: boolean;
  collection: string;
  onClose: () => void;
}) {
  const tag = rarityTag(card.rarity);
  const owned = hasOwnership && card.owned;
  const denom = /^\d+\/(\d+)$/.exec(card.no)?.[1] ?? '—';

  return (
    <Modal onClose={onClose}>
      <div className="binder-detail" style={{ display: 'grid', gap: 'clamp(20px, 3vw, 32px)', alignItems: 'center' }}>
        <div style={{ width: 'min(230px, 60vw)', justifySelf: 'center', aspectRatio: '5 / 7', borderRadius: 16, position: 'relative', overflow: 'hidden', background: card.bg, backgroundSize: 'cover', backgroundPosition: 'center', boxShadow: `0 30px 70px -24px rgba(0,0,0,.9), 0 0 0 1px ${tag.ring}`, filter: hasOwnership && !card.owned ? 'grayscale(.6) brightness(.85)' : 'none' }}>
          <span className="mono" style={{ position: 'absolute', top: 10, left: 10, fontSize: 10, letterSpacing: '.06em', padding: '4px 8px', borderRadius: 5, fontWeight: 700, color: tag.color, background: tag.bg }}>{card.rarity}</span>
        </div>
        <div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {ip && (
              <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', height: 26, padding: '0 11px', borderRadius: 999, fontSize: 11, color: ipAccent(ip), border: '1px solid rgba(255,255,255,.16)' }}>{ip.title}</span>
            )}
            {hasOwnership && (
              <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', height: 26, padding: '0 11px', borderRadius: 999, fontSize: 11, color: owned ? 'var(--mint)' : 'var(--dim)', border: '1px solid rgba(255,255,255,.16)' }}>
                {owned ? '보유 중' : '미보유'}
              </span>
            )}
          </div>
          <h2 style={{ margin: '14px 0 0', fontFamily: 'var(--ff-display)', fontWeight: 700, fontSize: 'clamp(22px, 3vw, 30px)', letterSpacing: '-0.02em' }}>{card.name}</h2>
          <div className="mono" style={{ fontSize: 12, color: 'var(--faint)', marginTop: 6 }}>No. {card.no}</div>
          <p style={{ margin: '14px 0 0', fontSize: 14, color: 'var(--dim)', textWrap: 'pretty' }}>
            {owned
              ? '보유 중인 카드입니다. 교환 마켓에 등록하거나 프로필에 전시할 수 있어요.'
              : '아직 보유하지 않은 카드입니다. 가챠 · 교환으로 획득할 수 있어요.'}
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginTop: 20 }}>
            {([
              ['시세', MOCK_PRICE[card.rarity] ?? '—'],
              ['발행량', denom],
              ['도감', collection],
            ] as const).map(([l, v]) => (
              <div key={l} style={{ padding: '12px 14px', borderRadius: 14, border: '1px solid rgba(255,255,255,.08)', background: 'rgba(255,255,255,.02)' }}>
                <div className="mono" style={{ fontSize: 10, color: 'var(--faint)' }}>{l}</div>
                <div style={{ fontFamily: 'var(--ff-display)', fontWeight: 700, fontSize: 16, marginTop: 4 }}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 22 }}>
            {owned ? (
              <>
                <Link className="btn btn-holo" href={hrefFor('exchange')} style={{ height: 46, fontSize: 14 }}>교환 등록 ⇄</Link>
                <Link className="btn btn-ghost" href={hrefFor('community')} style={{ height: 46, fontSize: 14 }}>전시하기</Link>
              </>
            ) : (
              <>
                <Link className="btn btn-holo" href={`${hrefFor('gacha')}?ip=${card.ip}`} style={{ height: 46, fontSize: 14 }}>뽑기로 획득 ✦</Link>
                <Link className="btn btn-ghost" href={hrefFor('exchange')} style={{ height: 46, fontSize: 14 }}>교환으로 획득</Link>
              </>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

export function Binder({ catalog }: { catalog: Pick<CatalogSnapshot, 'source' | 'ips' | 'cards'> }) {
  const hasOwnership = catalog.source === 'mock';
  const [own, setOwn] = useState<'all' | 'owned' | 'wish'>('all');
  const [rar, setRar] = useState<'all' | RarityKey>('all');
  const [detail, setDetail] = useState<Card | null>(null);

  const ipsById = new Map(catalog.ips.map((ip) => [ip.id, ip]));

  let list = catalog.cards;
  if (hasOwnership && own === 'owned') list = list.filter((c) => c.owned);
  if (hasOwnership && own === 'wish') list = list.filter((c) => !c.owned);
  if (rar !== 'all') list = list.filter((c) => c.rarity === rar);

  const ownedCards = hasOwnership ? catalog.cards.filter((c) => c.owned) : [];
  const total = catalog.cards.length;
  const pct = hasOwnership && total ? Math.round((ownedCards.length / total) * 100) : 0;

  const stats: [string, string][] = hasOwnership
    ? [
        [String(ownedCards.length), '보유 카드'],
        [String(total - ownedCards.length), '미보유'],
        [String(new Set(ownedCards.map((c) => c.ip)).size), '보유 IP'],
        [String(ownedCards.filter((c) => c.rarity === 'HOLO').length), 'HOLO'],
      ]
    : [
        [String(total), '카드 종수'],
        [String(new Set(catalog.cards.map((c) => c.ip)).size), 'IP'],
        [String(catalog.cards.filter((c) => c.rarity === 'HOLO').length), 'HOLO'],
        [String(catalog.cards.filter((c) => c.rarity === 'SSR').length), 'SSR'],
      ];

  const collectionOf = (card: Card) => {
    if (!hasOwnership) return '—';
    const sameIp = catalog.cards.filter((c) => c.ip === card.ip);
    const ownedSameIp = sameIp.filter((c) => c.owned);
    return `${ownedSameIp.length}/${sameIp.length}`;
  };

  return (
    <div style={{ minHeight: '100vh' }}>
      {/* header */}
      <header style={{ padding: 'clamp(108px, 12vw, 140px) 0 0' }}>
        <div className="wrap" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 24 }}>
          <div>
            <div className="eyebrow rise">모아요 · 내 컬렉션</div>
            <h1 className="rise" style={{ margin: '14px 0 0', fontFamily: 'var(--ff-display)', fontWeight: 700, fontSize: 'clamp(36px, 5vw, 64px)', lineHeight: 1.04, letterSpacing: '-0.04em', animationDelay: '.08s' }}>내 바인더</h1>
            <p className="rise" style={{ margin: '14px 0 0', fontSize: 15, color: '#C9C3E4', maxWidth: 480, textWrap: 'pretty', animationDelay: '.16s' }}>
              가챠로 모은 수집 카드를 등급·IP별로 정리하고, 도감을 채워가세요.
            </p>
            <div className="rise" style={{ display: 'flex', flexWrap: 'wrap', gap: 'clamp(20px, 4vw, 40px)', marginTop: 24, animationDelay: '.22s' }}>
              {stats.map(([n, l]) => (
                <div key={l} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span className="holo-text" style={{ fontFamily: 'var(--ff-display)', fontWeight: 700, fontSize: 30, letterSpacing: '-0.02em', backgroundSize: '200% 200%' }}>{n}</span>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--faint)' }}>{l}</span>
                </div>
              ))}
            </div>
          </div>
          {hasOwnership ? (
            <div className="rise" style={{ minWidth: 240, maxWidth: 300, flex: 1, animationDelay: '.28s' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                <span className="mono" style={{ fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--dim)' }}>도감 달성률</span>
                <span className="mono" style={{ fontSize: 17, fontWeight: 700, color: 'var(--violet-2)' }}>{pct}%</span>
              </div>
              <div style={{ height: 10, borderRadius: 99, background: 'rgba(255,255,255,.07)', marginTop: 10, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${pct}%`, borderRadius: 99, background: 'linear-gradient(90deg, #2DE2FF, #8B5CFF, #FF4D9D)', transition: 'width .5s ease' }} />
              </div>
              <div className="money-caption" style={{ marginTop: 8 }}>{ownedCards.length} / {total}장 보유</div>
            </div>
          ) : (
            <div className="rise money-caption" style={{ minWidth: 240, maxWidth: 300, flex: 1, animationDelay: '.28s' }}>
              보유 현황은 가챠 연동 후 표시됩니다 · 지금은 공개 도감으로 열람할 수 있어요
            </div>
          )}
        </div>
      </header>

      {/* filters */}
      <div className="wrap" style={{ paddingTop: 30, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        {hasOwnership ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }} role="group" aria-label="보유 필터">
            {([['all', '전체'], ['owned', '보유'], ['wish', '미보유']] as const).map(([k, l]) => (
              <button key={k} className={'chip' + (own === k ? ' on' : '')} aria-pressed={own === k} onClick={() => setOwn(k)}>{l}</button>
            ))}
          </div>
        ) : (
          <span />
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }} role="group" aria-label="등급 필터">
          <button className={'chip chip-sm' + (rar === 'all' ? ' on' : '')} aria-pressed={rar === 'all'} onClick={() => setRar('all')}>전체 등급</button>
          {(Object.keys(RARITY_META) as RarityKey[]).map((k) => {
            const active = rar === k;
            const c = RARITY_META[k].color;
            return (
              <button
                key={k}
                className={'chip chip-sm' + (active ? ' on accent' : '')}
                aria-pressed={active}
                onClick={() => setRar(k)}
                style={active ? { background: c, borderColor: c, color: '#0A0813' } : {}}
              >
                {k}
              </button>
            );
          })}
        </div>
      </div>

      {/* grid */}
      <section style={{ padding: '24px 0 clamp(40px, 6vw, 60px)' }}>
        <div className="wrap">
          {list.length > 0 ? (
            <div className="binder-grid">
              {list.map((c) => {
                const tag = rarityTag(c.rarity);
                const ip = ipsById.get(c.ip);
                const locked = hasOwnership && !c.owned;
                return (
                  <button key={c.id} type="button" className="binder-card" onClick={() => setDetail(c)} style={{ padding: 0, textAlign: 'left', borderRadius: 18, border: '1px solid var(--line)', background: 'linear-gradient(180deg, var(--surface), var(--bg-2))', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ margin: '12px 12px 0', aspectRatio: '5 / 7', borderRadius: 12, position: 'relative', overflow: 'hidden', background: c.bg, backgroundSize: 'cover', backgroundPosition: 'center', boxShadow: `0 0 0 1px ${tag.ring}`, filter: locked ? 'grayscale(.85) brightness(.75)' : 'none' }}>
                      <span className="mono" style={{ position: 'absolute', top: 8, left: 8, fontSize: 9.5, letterSpacing: '.06em', padding: '3px 7px', borderRadius: 5, fontWeight: 700, color: tag.color, background: tag.bg, zIndex: 2 }}>{c.rarity}</span>
                      {locked && (
                        <span style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'rgba(8,6,15,.45)' }}>
                          <span className="mono" style={{ fontSize: 10, letterSpacing: '.14em', padding: '5px 11px', borderRadius: 999, border: '1px dashed rgba(255,255,255,.4)', color: '#C9C3E4', background: 'rgba(8,6,15,.6)' }}>미보유</span>
                        </span>
                      )}
                    </div>
                    <div style={{ padding: '11px 14px 13px', display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <span style={{ fontWeight: 700, fontSize: 13.5, color: locked ? 'var(--dim)' : 'var(--text)' }}>{c.name}</span>
                      <span className="mono" style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 10.5, color: 'var(--faint)' }}>
                        <span style={{ color: ip ? ipAccent(ip) : undefined }}>{ip?.title ?? ''}</span>
                        <span>{c.no}</span>
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : catalog.cards.length > 0 ? (
            <div style={{ textAlign: 'center', padding: '70px 20px', border: '1px dashed var(--line-2)', borderRadius: 20 }}>
              <div style={{ fontSize: 17, fontWeight: 700 }}>조건에 맞는 카드가 없어요</div>
              <div className="mono" style={{ fontSize: 12, color: 'var(--faint)', marginTop: 8 }}>필터를 바꿔보세요</div>
            </div>
          ) : (
            <Empty icon="card" text="등록된 카드가 아직 없습니다" sub="Supabase 카탈로그 seed 또는 admin 등록 후 도감에 공개됩니다." />
          )}

          {/* CTA row */}
          <div className="binder-cta-row" style={{ marginTop: 34 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14, padding: '22px 26px', borderRadius: 20, border: '1px solid var(--line)', background: 'linear-gradient(150deg, rgba(139,92,255,.14), rgba(255,77,157,.08) 60%, transparent), var(--bg-2)' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 16 }}>빈 칸을 채우고 싶다면</div>
                <div style={{ fontSize: 13.5, color: 'var(--dim)', marginTop: 4 }}>카드풀에서 새 카드를 뽑아보세요. 천장 보장.</div>
              </div>
              <Link className="btn btn-holo" href={hrefFor('gacha')} style={{ height: 44, fontSize: 14 }}>뽑기로 →</Link>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14, padding: '22px 26px', borderRadius: 20, border: '1px solid var(--line)', background: 'linear-gradient(180deg, var(--surface), var(--bg-2))' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 16 }}>중복 카드가 있나요?</div>
                <div style={{ fontSize: 13.5, color: 'var(--dim)', marginTop: 4 }}>교환 마켓에서 직거래하거나 경매에 올려보세요.</div>
              </div>
              <Link className="btn btn-ghost" href={hrefFor('exchange')} style={{ height: 44, fontSize: 14 }}>교환 마켓으로 ⇄</Link>
            </div>
          </div>
        </div>
      </section>

      {detail && (
        <CardDetail
          card={detail}
          ip={ipsById.get(detail.ip)}
          hasOwnership={hasOwnership}
          collection={collectionOf(detail)}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}
