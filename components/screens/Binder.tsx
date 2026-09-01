'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { OverlayPortal } from '@/components/shell/OverlayPortal';
import { useOverlayA11y } from '@/components/shell/useOverlayA11y';
import type { CatalogSnapshot } from '@/lib/catalog';
import { COMMUNITY_ENABLED } from '@/lib/community-visibility';
import type { Card, Ip } from '@/lib/data';
import { ipAccentInk } from '@/lib/ip-display';
import { rarityTag, RARITY_META, type RarityKey } from '@/lib/rarity';
import { hrefFor } from '@/lib/routes';
import { EmptyState } from '@/components/wc/EmptyState';
import { SectionHeading } from '@/components/wc/SectionHeading';
import { WcButton } from '@/components/wc/WcButton';

/* 바인더(도감) 화면(#71) — White Catalog 카탈로그 문법 재조판(#327 · DESIGN §8).
 * 화면 크롬은 흰 지면·잉크·헤어라인이고 카드 타일 내부만 rarity 물성을 유지한다.
 * 시세는 실데이터 원칙(DESIGN §0)에 따라 표기하지 않는다 — 스탯은 발행량·도감뿐. */

/* 카드 상세 다이얼로그 — 포커스 트랩·Escape·복귀 포커스·배경 스크롤 잠금·배경 inert는
 * useOverlayA11y 공유 훅 몫이다(원래 자체 구현이었으나, 훅의 #root inert가 #root 안 오버레이를
 * 얼리던 결함이 OverlayPortal 도입으로 해소되며 통합했다). HM Modal 대신 흰 지면 다이얼로그로
 * 재구성했다. 테스트에서 renderToStaticMarkup으로 직접 렌더할 수 있게 export 한다 —
 * 그래서 포털은 이 컴포넌트가 아니라 Binder 호출부에 있다. */
export function CardDetail({
  card,
  cardRewardsEnabled,
  ip,
  hasOwnership,
  collection,
  onClose,
}: {
  card: Card;
  cardRewardsEnabled: boolean;
  ip: Ip | undefined;
  hasOwnership: boolean;
  collection: string;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  /* 조건부 마운트라 열림 = 마운트다 — open은 상수 true로 두고 마운트/언마운트가 수명을 정한다. */
  useOverlayA11y({ open: true, onClose, panelRef });

  const tag = rarityTag(card.rarity);
  const owned = hasOwnership && card.owned;
  const denom = /^\d+\/(\d+)$/.exec(card.no)?.[1] ?? '—';

  return (
    /* 래퍼 자체가 딤이다(wc-discovery.css) — 바깥 클릭은 닫기, 패널 클릭은 전파를 끊는다. */
    <div className="wc-binder__detail" onClick={onClose}>
      <div
        ref={panelRef}
        aria-label={`${card.name} 카드 상세`}
        aria-modal="true"
        className="wc-binder__detail-panel"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            className="wc-binder__detail-close"
            onClick={onClose}
            style={{ padding: '4px 8px', font: 'inherit', fontSize: 13, fontWeight: 700, border: 'none', background: 'none', color: 'var(--wc-ink-tertiary)', cursor: 'pointer' }}
            type="button"
          >
            닫기
          </button>
        </div>
        <div className="wc-binder__detail-body" style={{ display: 'grid', gap: 20 }}>
          <div
            className="wc-binder__detail-tile"
            style={{
              width: 'min(230px, 60vw)',
              justifySelf: 'center',
              aspectRatio: '5 / 7',
              borderRadius: 12,
              position: 'relative',
              overflow: 'hidden',
              background: card.bg,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              boxShadow: `0 0 0 1px ${tag.ring}`,
              filter: hasOwnership && !card.owned ? 'grayscale(.6) brightness(.85)' : 'none',
            }}
          >
            <span style={{ position: 'absolute', top: 10, left: 10, fontSize: 10, letterSpacing: '.06em', padding: '4px 8px', borderRadius: 5, fontWeight: 700, color: tag.color, background: tag.bg }}>{card.rarity}</span>
          </div>
          <div className="wc-binder__detail-info">
            <div className="wc-binder__detail-chips" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {ip && (
                <span className="wc-binder__detail-chip" style={{ padding: '3px 10px', fontSize: 12, border: '1px solid var(--wc-line-control)', color: ipAccentInk(ip) }}>{ip.title}</span>
              )}
              {hasOwnership && (
                <span className={`wc-binder__detail-chip${owned ? ' is-owned' : ''}`} style={{ padding: '3px 10px', fontSize: 12, border: '1px solid var(--wc-line-control)', color: owned ? 'var(--wc-success)' : 'var(--wc-ink-tertiary)' }}>
                  {owned ? '보유 중' : '미보유'}
                </span>
              )}
            </div>
            <h2 className="wc-binder__detail-name" style={{ margin: '14px 0 0', fontFamily: 'inherit', fontSize: 22, fontWeight: 700, lineHeight: 1.3, color: 'var(--wc-ink)' }}>{card.name}</h2>
            <p className="wc-binder__detail-no" style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--wc-ink-tertiary)' }}>No. {card.no}</p>
            <p className="wc-binder__detail-desc" style={{ margin: '14px 0 0', fontSize: 14, color: 'var(--wc-ink-sub)' }}>
              {owned
                ? '보유 중인 카드입니다. 트레이드에 등록하거나 프로필에 전시할 수 있어요.'
                : '아직 보유하지 않은 카드입니다. 카드팩 · 트레이드로 획득할 수 있어요.'}
            </p>
            <div className="wc-binder__detail-stats" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginTop: 20 }}>
              {([
                ['발행량', denom],
                ['도감', collection],
              ] as const).map(([l, v]) => (
                <div key={l} className="wc-binder__detail-stat" style={{ padding: '10px 14px', border: '1px solid var(--wc-hairline)' }}>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--wc-ink-tertiary)' }}>{l}</span>
                  <strong style={{ display: 'block', marginTop: 2, fontSize: 16, fontWeight: 700, color: 'var(--wc-ink)' }}>{v}</strong>
                </div>
              ))}
            </div>
            <div className="wc-btn-group wc-binder__detail-actions" style={{ marginTop: 22 }}>
              {owned ? (
                <>
                  <WcButton href={hrefFor('exchange')} variant="primary">트레이드 등록</WcButton>
                  {COMMUNITY_ENABLED && <WcButton href={hrefFor('community')}>전시하기</WcButton>}
                </>
              ) : (
                <>
                  {cardRewardsEnabled && (
                    <WcButton href={hrefFor('packs')} variant="primary">카드팩으로 획득</WcButton>
                  )}
                  <WcButton href={hrefFor('exchange')}>트레이드로 획득</WcButton>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Binder({
  cardRewardsEnabled,
  catalog,
  ownedCardIds = null,
}: {
  cardRewardsEnabled: boolean;
  catalog: Pick<CatalogSnapshot, 'source' | 'ips' | 'cards'>;
  /** supabase 모드 본인 보유(user_cards) — null = 미로그인/미설정(공개 도감) */
  ownedCardIds?: string[] | null;
}) {
  const hasOwnership = catalog.source === 'mock' || ownedCardIds !== null;
  const [own, setOwn] = useState<'all' | 'owned' | 'wish'>('all');
  const [rar, setRar] = useState<'all' | RarityKey>('all');
  const [detail, setDetail] = useState<Card | null>(null);

  const ipsById = new Map(catalog.ips.map((ip) => [ip.id, ip]));

  /* supabase 모드는 카탈로그의 owned(항상 false)를 본인 보유로 덮어쓴다(#71 바인더 연결) */
  const ownedSet = ownedCardIds !== null ? new Set(ownedCardIds) : null;
  const cards =
    catalog.source === 'supabase' && ownedSet
      ? catalog.cards.map((c) => ({ ...c, owned: ownedSet.has(c.id) }))
      : catalog.cards;

  let list = cards;
  if (hasOwnership && own === 'owned') list = list.filter((c) => c.owned);
  if (hasOwnership && own === 'wish') list = list.filter((c) => !c.owned);
  if (rar !== 'all') list = list.filter((c) => c.rarity === rar);

  const ownedCards = hasOwnership ? cards.filter((c) => c.owned) : [];
  const total = cards.length;
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
        [String(new Set(cards.map((c) => c.ip)).size), 'IP'],
        [String(cards.filter((c) => c.rarity === 'HOLO').length), 'HOLO'],
        [String(cards.filter((c) => c.rarity === 'SSR').length), 'SSR'],
      ];

  const collectionOf = (card: Card) => {
    if (!hasOwnership) return '—';
    const sameIp = cards.filter((c) => c.ip === card.ip);
    const ownedSameIp = sameIp.filter((c) => c.owned);
    return `${ownedSameIp.length}/${sameIp.length}`;
  };

  return (
    <div className="wc-root wc-binder">
      <div className="wc-container">
        {/* header — h1 + 스탯 행 + 진행률 */}
        <header className="wc-binder__header">
          <SectionHeading
            as="h1"
            subcopy="카드팩으로 모은 수집 카드를 등급·IP별로 정리하고, 도감을 채워가세요."
            title="내 바인더"
          />
          <div className="wc-binder__stats">
            {stats.map(([n, l]) => (
              <div key={l} className="wc-binder__stat">
                <strong>{n}</strong>
                {l}
              </div>
            ))}
          </div>
          {hasOwnership ? (
            <div className="wc-binder__progress">
              <span className="wc-binder__progress-label">도감 달성률</span>
              <span aria-hidden className="wc-binder__progress-track">
                <span className="wc-binder__progress-fill" style={{ width: `${pct}%` }} />
              </span>
              <strong className="wc-binder__progress-pct">{pct}%</strong>
              <span className="wc-binder__progress-note">{ownedCards.length} / {total}장 보유</span>
            </div>
          ) : (
            <p className="wc-binder__signin-note" style={{ margin: '16px 0 0', fontSize: 13, color: 'var(--wc-ink-tertiary)' }}>
              로그인하면 보유 현황이 표시됩니다 · 지금은 공개 도감으로 열람할 수 있어요
            </p>
          )}
        </header>

        {/* filters — 칩 행. role=group 래퍼는 보유/등급 두 축의 접근성 그룹 라벨을 유지한다. */}
        <div className="wc-binder__filters">
          {hasOwnership && (
            <div aria-label="보유 필터" className="wc-binder__filter-group" role="group" style={{ display: 'contents' }}>
              {([['all', '전체'], ['owned', '보유'], ['wish', '미보유']] as const).map(([k, l]) => (
                <button
                  key={k}
                  aria-pressed={own === k}
                  className={`wc-binder__chip${own === k ? ' is-active' : ''}`}
                  onClick={() => setOwn(k)}
                  type="button"
                >
                  {l}
                </button>
              ))}
            </div>
          )}
          <div aria-label="등급 필터" className="wc-binder__filter-group" role="group" style={{ display: 'contents' }}>
            <button
              aria-pressed={rar === 'all'}
              className={`wc-binder__chip${rar === 'all' ? ' is-active' : ''}`}
              onClick={() => setRar('all')}
              type="button"
            >
              전체 등급
            </button>
            {(Object.keys(RARITY_META) as RarityKey[]).map((k) => {
              const active = rar === k;
              const c = RARITY_META[k].color;
              return (
                <button
                  key={k}
                  aria-pressed={active}
                  className={`wc-binder__chip${active ? ' is-active' : ''}`}
                  onClick={() => setRar(k)}
                  /* 활성 등급 칩의 등급색 채움은 카드 물성 예외(계약 §2) — 어두운 잉크는 기존 값 승계 */
                  style={active ? { background: c, borderColor: c, color: '#0A0813' } : undefined}
                  type="button"
                >
                  {k}
                </button>
              );
            })}
          </div>
        </div>

        {/* grid */}
        <section className="wc-binder__list">
          {list.length > 0 ? (
            <div className="wc-binder__grid">
              {list.map((c) => {
                const tag = rarityTag(c.rarity);
                const ip = ipsById.get(c.ip);
                const locked = hasOwnership && !c.owned;
                return (
                  <button
                    key={c.id}
                    className={`wc-binder__card${locked ? ' is-locked' : ''}`}
                    onClick={() => setDetail(c)}
                    type="button"
                  >
                    <span
                      className="wc-binder__card-tile"
                      style={{
                        display: 'block',
                        aspectRatio: '5 / 7',
                        borderRadius: 10,
                        position: 'relative',
                        overflow: 'hidden',
                        background: c.bg,
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                        boxShadow: `0 0 0 1px ${tag.ring}`,
                        filter: locked ? 'grayscale(.85) brightness(.75)' : 'none',
                      }}
                    >
                      <span style={{ position: 'absolute', top: 8, left: 8, fontSize: 9.5, letterSpacing: '.06em', padding: '3px 7px', borderRadius: 5, fontWeight: 700, color: tag.color, background: tag.bg, zIndex: 2 }}>{c.rarity}</span>
                      {locked && (
                        <span style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'rgba(8,6,15,.45)' }}>
                          <span style={{ fontSize: 10, letterSpacing: '.14em', padding: '5px 11px', borderRadius: 999, border: '1px dashed rgba(255,255,255,.4)', color: '#FFFFFF', background: 'rgba(8,6,15,.6)' }}>미보유</span>
                        </span>
                      )}
                    </span>
                    <span className="wc-binder__card-name" style={{ display: 'block', marginTop: 10, fontSize: 13, fontWeight: 700, color: locked ? 'var(--wc-ink-tertiary)' : 'var(--wc-ink)' }}>{c.name}</span>
                    <span className="wc-binder__card-meta" style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 2, fontSize: 11, color: 'var(--wc-ink-tertiary)' }}>
                      <span style={{ color: ip ? ipAccentInk(ip) : undefined }}>{ip?.title ?? ''}</span>
                      <span>{c.no}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : cards.length > 0 ? (
            <EmptyState description="필터를 바꿔보세요" title="조건에 맞는 카드가 없어요" />
          ) : (
            <EmptyState
              description="Supabase 카탈로그 seed 또는 admin 등록 후 도감에 공개됩니다."
              title="등록된 카드가 아직 없습니다"
            />
          )}

          {/* CTA row — 헤어라인 박스 링크 밴드(박스 전체가 링크) */}
          <div className="wc-binder__cta-row">
            {cardRewardsEnabled && (
              <Link className="wc-binder__cta" href={hrefFor('packs')}>
                <span className="wc-binder__cta-copy" style={{ minWidth: 0 }}>
                  <strong style={{ display: 'block' }}>빈 칸을 채우고 싶다면</strong>
                  <span style={{ display: 'block', marginTop: 2, fontSize: 13, fontWeight: 400, color: 'var(--wc-ink-tertiary)' }}>보유한 카드팩을 개봉하고 새 카드를 만나보세요.</span>
                </span>
                <span className="wc-binder__cta-action">카드팩 열기</span>
              </Link>
            )}
            <Link className="wc-binder__cta" href={hrefFor('exchange')}>
              <span className="wc-binder__cta-copy" style={{ minWidth: 0 }}>
                <strong style={{ display: 'block' }}>중복 카드가 있나요?</strong>
                <span style={{ display: 'block', marginTop: 2, fontSize: 13, fontWeight: 400, color: 'var(--wc-ink-tertiary)' }}>트레이드에서 직거래하거나 경매에 올려보세요.</span>
              </span>
              <span className="wc-binder__cta-action">트레이드로</span>
            </Link>
          </div>
        </section>
      </div>

      {/* #root 밖으로 포털한다 — 훅의 #root inert가 다이얼로그를 얼리지 않게,
          그리고 #root 스태킹 컨텍스트(z2)가 딤을 셸 헤더·탭바(z3) 아래로 깔지 않게. */}
      {detail && (
        <OverlayPortal>
          <CardDetail
            card={detail}
            cardRewardsEnabled={cardRewardsEnabled}
            ip={ipsById.get(detail.ip)}
            hasOwnership={hasOwnership}
            collection={collectionOf(detail)}
            onClose={() => setDetail(null)}
          />
        </OverlayPortal>
      )}
    </div>
  );
}
