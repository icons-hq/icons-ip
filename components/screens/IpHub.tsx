'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useFormStatus } from 'react-dom';
import { toggleIpFollowAction } from '@/app/ip/actions';
import type { CatalogIpDetail } from '@/lib/catalog';
import type { Card, Ip, Stock } from '@/lib/data';
import { ipAccent } from '@/lib/ip-display';
import type { IpFollowState } from '@/lib/ip-follow';
import type { RarityKey } from '@/lib/rarity';
import { hrefFor } from '@/lib/routes';
import { useCart } from '@/components/shell/CartProvider';
import { useHeroParallax, useTilt } from '@/components/ui/motion';

const STOCK_LABEL: Record<Stock, string | null> = { low: '품절임박', soldout: '품절', ok: null };
const RARITY_ORDER: RarityKey[] = ['HOLO', 'SSR', 'SR', 'R', 'N'];

const compactNumber = (n: number) =>
  new Intl.NumberFormat('ko-KR', { notation: 'compact', maximumFractionDigits: 1 }).format(n);

const eyebrowStyle = (color: string): React.CSSProperties => ({
  fontFamily: 'var(--ff-mono)', fontSize: 11, letterSpacing: '.18em', textTransform: 'uppercase', color,
});

function FollowButton({ isFollowed, mini }: { isFollowed: boolean; mini?: boolean }) {
  const { pending } = useFormStatus();
  const label = pending ? '저장 중' : mini
    ? (isFollowed ? '가입됨 ✓' : '팬덤 가입하기')
    : (isFollowed ? '팬덤 가입됨 ✓' : '팬덤 가입 — 무료');

  if (mini) {
    return (
      <button className="btn btn-ghost" disabled={pending} style={{ height: 40, padding: '0 18px', fontSize: 13, fontWeight: 700 }}>
        {label}
      </button>
    );
  }
  return (
    <button className={isFollowed ? 'btn btn-ghost' : 'btn btn-holo'} disabled={pending} style={{ height: 50, padding: '0 26px', fontSize: 15 }}>
      {label}
    </button>
  );
}

function FollowForm({ followState, ipId, mini }: { followState: IpFollowState; ipId: string; mini?: boolean }) {
  return (
    <form action={toggleIpFollowAction} style={mini ? { marginTop: 'auto', paddingTop: 16 } : undefined}>
      <input type="hidden" name="ipId" value={ipId} />
      <input type="hidden" name="intent" value={followState.isFollowed ? 'unfollow' : 'follow'} />
      <input type="hidden" name="next" value={`/ip/${ipId}`} />
      <FollowButton isFollowed={followState.isFollowed} mini={mini} />
    </form>
  );
}

function GachaTiltCard({ card }: { card: Card }) {
  const { cardRef, glareRef, onMouseMove, onMouseLeave } = useTilt();
  return (
    <div onMouseMove={onMouseMove} onMouseLeave={onMouseLeave} className="home-float" style={{ perspective: 900, margin: '22px 0 6px', position: 'relative' }}>
      <div
        ref={cardRef}
        style={{
          width: 'clamp(180px, 17vw, 220px)', aspectRatio: '5 / 7', borderRadius: 16, position: 'relative', overflow: 'hidden',
          background: card.bg,
          boxShadow: '0 34px 70px -26px rgba(0,0,0,.85), 0 0 0 1px rgba(255,255,255,.14), 0 0 50px -14px rgba(139,92,255,.6)',
          transformStyle: 'preserve-3d', transition: 'transform .35s ease', willChange: 'transform',
        }}
      >
        <div ref={glareRef} aria-hidden style={{ position: 'absolute', inset: 0, mixBlendMode: 'color-dodge', opacity: 0.55, background: 'linear-gradient(115deg, transparent 20%, rgba(45,226,255,.5), rgba(139,92,255,.4), rgba(255,77,157,.5), transparent 80%)', backgroundSize: '240% 240%', backgroundPosition: '20% 20%', transition: 'background-position .3s ease' }} />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, transparent 58%, rgba(8,6,15,.9) 100%)' }} />
        <span className="mono" style={{ position: 'absolute', top: 10, left: 10, fontSize: 10, letterSpacing: '.08em', padding: '3px 8px', borderRadius: 5, color: '#0A0813', fontWeight: 700, background: 'var(--holo)', backgroundSize: '200% 200%', animation: 'holoShift 5s ease infinite' }}>{card.rarity}</span>
        <span style={{ position: 'absolute', left: 12, right: 12, bottom: 10, fontWeight: 700, fontSize: 13.5, textAlign: 'left' }}>{card.name}</span>
      </div>
    </div>
  );
}

export function IpHub({
  ips,
  detail,
  followState,
  followError,
}: {
  ips: Ip[];
  detail: CatalogIpDetail;
  followState: IpFollowState;
  followError: boolean;
}) {
  const { ip, goods, cards, events, posts } = detail;
  const { artRef, onMouseMove, onMouseLeave } = useHeroParallax({ x: -18, y: -12 });
  const { add } = useCart();
  const [carted, setCarted] = useState(false);

  const accent = ipAccent(ip);
  const good = goods[0] ?? null;
  const goodStockLabel = good ? STOCK_LABEL[good.stock] : null;
  const goodsLineup = goods.length > 1 ? goods.slice(1, 3) : goods.slice(0, 2);
  const topCard = RARITY_ORDER.map((r) => cards.find((c) => c.rarity === r)).find(Boolean) ?? null;
  const event = events[0] ?? null;
  const post = posts[0] ?? null;

  const onAddCart = () => {
    if (!good || good.stock === 'soldout') return;
    add();
    setCarted(true);
    window.setTimeout(() => setCarted(false), 1400);
  };

  return (
    <div style={{ minHeight: '100vh' }}>
      {/* cinematic hero */}
      <header
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
        style={{ position: 'relative', minHeight: 'min(78vh, 720px)', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', overflow: 'hidden', isolation: 'isolate' }}
      >
        <div ref={artRef} aria-hidden style={{ position: 'absolute', inset: -48, zIndex: 0, transform: 'scale(1.04)', transition: 'transform .9s cubic-bezier(.2,.6,.2,1)' }}>
          <div style={{ position: 'absolute', inset: 0, background: ip.bg, backgroundSize: 'cover', backgroundPosition: 'center' }} />
        </div>
        <div aria-hidden style={{ position: 'absolute', inset: 0, zIndex: 1, background: 'linear-gradient(90deg, rgba(8,6,15,.9) 0%, rgba(8,6,15,.5) 45%, rgba(8,6,15,.1) 80%)' }} />
        <div aria-hidden style={{ position: 'absolute', inset: 0, zIndex: 1, background: 'linear-gradient(180deg, rgba(8,6,15,.5) 0%, transparent 30%, transparent 52%, rgba(8,6,15,.96) 100%)' }} />

        <div className="wrap" style={{ position: 'relative', zIndex: 2, padding: '120px 24px 40px' }}>
          <Link className="rise" href="/" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 34, padding: '0 14px', borderRadius: 999, fontSize: 12.5, fontWeight: 600, color: 'var(--dim)', border: '1px solid rgba(255,255,255,.18)', background: 'rgba(8,6,15,.4)', backdropFilter: 'blur(8px)' }}>
            ← 모든 IP
          </Link>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 24, marginTop: 22 }}>
            <div style={{ maxWidth: 640 }}>
              <span className="mono rise" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', padding: '5px 12px', borderRadius: 6, border: `1px solid ${accent}`, color: '#fff', background: 'rgba(0,0,0,.35)', animationDelay: '.05s' }}>{ip.sub}</span>
              <h1 className="rise" style={{ margin: '16px 0 0', fontFamily: 'var(--ff-display)', fontWeight: 700, fontSize: 'clamp(42px, 6.4vw, 84px)', lineHeight: 1.0, letterSpacing: '-0.04em', animationDelay: '.12s' }}>{ip.title}</h1>
              <p className="rise" style={{ margin: '14px 0 0', fontSize: 'clamp(16px, 1.8vw, 19px)', fontWeight: 700, animationDelay: '.18s' }}>{ip.tagline}</p>
              <p className="rise" style={{ margin: '10px 0 0', fontSize: 15, color: '#C9C3E4', maxWidth: 560, textWrap: 'pretty', animationDelay: '.24s' }}>{ip.synopsis}</p>
              <div className="mono rise" style={{ fontSize: 12, letterSpacing: '.1em', color: 'var(--dim)', marginTop: 22, display: 'flex', flexWrap: 'wrap', gap: '8px 22px', animationDelay: '.3s' }}>
                <span><strong style={{ color: accent, fontSize: 15 }}>{compactNumber(ip.fans)}</strong> FANS</span>
                <span>GOODS {goods.length}</span>
                <span>CARDS {cards.length}</span>
                <span>POP-UP {events.length}</span>
              </div>
            </div>
            <div className="rise" style={{ display: 'flex', gap: 10, animationDelay: '.3s' }}>
              <FollowForm followState={followState} ipId={ip.id} />
              <button className="btn" style={{ height: 50, padding: '0 22px', fontSize: 14, border: '1px solid var(--line-3)', background: 'rgba(8,6,15,.35)', backdropFilter: 'blur(8px)' }}>알림 받기</button>
            </div>
          </div>
          {followError && (
            <div className="card" role="alert" style={{ marginTop: 18, padding: 12, borderRadius: 12, color: 'var(--pink)', fontSize: 13.5, fontWeight: 700 }}>
              팔로우 상태를 저장하지 못했습니다. 잠시 후 다시 시도해주세요.
            </div>
          )}
        </div>
      </header>

      {/* IP switcher */}
      <div style={{ borderBottom: '1px solid var(--line)' }}>
        <div className="wrap ipworld-switcher">
          <span className="mono" style={{ fontSize: 11, letterSpacing: '.18em', color: 'var(--faint)', flex: '0 0 auto' }}>WORLDS</span>
          {ips.map((s) => {
            const active = s.id === ip.id;
            return (
              <Link
                key={s.id}
                href={hrefFor('ip', s.id)}
                style={{
                  flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', gap: 8, height: 38, padding: '0 16px 0 6px',
                  borderRadius: 999, fontSize: 13.5, fontWeight: active ? 700 : 500,
                  color: active ? 'var(--text)' : 'var(--dim)',
                  border: `1px solid ${active ? ipAccent(s) : 'var(--line-2)'}`,
                  background: active ? 'rgba(255,255,255,.05)' : 'rgba(255,255,255,.02)',
                  transition: 'all .25s ease',
                }}
              >
                <span style={{ width: 28, height: 28, borderRadius: 99, background: s.bg, backgroundSize: 'cover', backgroundPosition: 'center', boxShadow: '0 0 0 1px rgba(255,255,255,.15)' }} />
                {s.title}
              </Link>
            );
          })}
        </div>
      </div>

      {/* bento */}
      <section style={{ padding: 'clamp(48px, 6vw, 76px) 0 clamp(70px, 9vw, 110px)' }}>
        <div className="wrap">
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
            <div>
              <div className="eyebrow">이 세계에서 할 수 있는 것</div>
              <h2 style={{ margin: '14px 0 0', fontFamily: 'var(--ff-display)', fontWeight: 700, fontSize: 'clamp(28px, 4vw, 44px)', letterSpacing: '-0.02em', lineHeight: 1.08 }}>오늘, {ip.title}에서</h2>
            </div>
            <span className="mono" style={{ fontSize: 11, letterSpacing: '.1em', color: 'var(--faint)' }}>사요 · 모아요 · 만나요 · 떠들어요</span>
          </div>

          <div className="ipworld-bento">
            {/* A · 대표 굿즈 (사요) */}
            <div className="ipworld-cell ipw-goods" style={{ ['--cell-accent' as string]: 'rgba(255,178,61,.45)', display: 'flex', flexWrap: 'wrap', overflow: 'hidden', minHeight: 280 }}>
              {good ? (
                <>
                  <div style={{ flex: '1 1 240px', minWidth: 220, minHeight: 220, background: good.img, backgroundSize: 'cover', backgroundPosition: 'center', position: 'relative' }}>
                    <span className="sheen" style={{ opacity: 0.35 }} />
                    {(good.badge ?? goodStockLabel) && (
                      <span className="mono" style={{ position: 'absolute', top: 14, left: 14, fontSize: 11, letterSpacing: '.06em', padding: '4px 10px', borderRadius: 6, background: 'rgba(8,6,15,.7)', border: '1px solid rgba(255,255,255,.2)', backdropFilter: 'blur(6px)' }}>
                        {good.badge ?? goodStockLabel}
                      </span>
                    )}
                  </div>
                  <div style={{ flex: '1 1 260px', padding: 26, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <span style={eyebrowStyle('var(--amber)')}>사요 · 공식 굿즈</span>
                    <span style={{ fontWeight: 800, fontSize: 'clamp(19px, 2vw, 24px)', lineHeight: 1.25, marginTop: 4 }}>{good.name}</span>
                    <span style={{ fontSize: 13.5, color: 'var(--dim)' }}>{good.type}{goodStockLabel ? ` · ${goodStockLabel}` : ''}</span>
                    <span className="mono" style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>₩{good.price.toLocaleString('ko-KR')}</span>
                    <div style={{ marginTop: 'auto', paddingTop: 16, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      <button
                        className="btn btn-primary"
                        onClick={onAddCart}
                        disabled={good.stock === 'soldout'}
                        style={{ height: 46, fontWeight: 700, opacity: good.stock === 'soldout' ? 0.5 : 1 }}
                      >
                        {good.stock === 'soldout' ? '품절' : carted ? '장바구니 담김 ✓' : '장바구니 담기'}
                      </button>
                      <Link className="btn btn-ghost" href={`${hrefFor('shop')}?ip=${ip.id}`} style={{ height: 46, fontSize: 14 }}>
                        전체 굿즈 {goods.length}종
                      </Link>
                    </div>
                  </div>
                </>
              ) : (
                <div style={{ padding: 26, display: 'flex', flexDirection: 'column', gap: 10, justifyContent: 'center' }}>
                  <span style={eyebrowStyle('var(--amber)')}>사요 · 공식 굿즈</span>
                  <span style={{ fontWeight: 700, fontSize: 17 }}>등록된 굿즈가 아직 없습니다</span>
                  <span style={{ fontSize: 13.5, color: 'var(--dim)' }}>새 굿즈가 입점하면 이 자리에 소개돼요.</span>
                </div>
              )}
            </div>

            {/* B · 가챠 (모아요) */}
            <div className="ipworld-cell ipw-gacha" style={{ ['--cell-accent' as string]: 'rgba(139,92,255,.5)', background: 'linear-gradient(180deg, var(--surface-2), var(--bg-2))', overflow: 'hidden', position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '28px 24px 26px', minHeight: 480 }}>
              <div aria-hidden style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: 'radial-gradient(420px 300px at 50% 30%, rgba(139,92,255,.22), transparent 70%)' }} />
              <span style={{ ...eyebrowStyle('var(--violet-2)'), position: 'relative' }}>모아요 · 가챠</span>
              {topCard ? (
                <>
                  <span style={{ fontWeight: 800, fontSize: 21, marginTop: 8, position: 'relative' }}>이번 카드풀 최고 등급</span>
                  <GachaTiltCard card={topCard} />
                  <span className="mono" style={{ fontSize: 11.5, color: 'var(--dim)', position: 'relative' }}>No. {topCard.no}</span>
                </>
              ) : (
                <span style={{ fontWeight: 800, fontSize: 21, marginTop: 8, position: 'relative' }}>카드풀 준비 중</span>
              )}
              <div style={{ marginTop: 'auto', paddingTop: 18, width: '100%', position: 'relative', display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
                <Link className="btn btn-holo" href={`${hrefFor('gacha')}?ip=${ip.id}`} style={{ width: 'min(100%, 280px)', fontSize: 15 }}>
                  지금 뽑기 ✦
                </Link>
                <span className="money-caption" style={{ lineHeight: 1.6 }}>등급별 확률·천장 기준은 카드풀 상세에 전문 공시 · 미사용 충전금 전액 환불</span>
              </div>
            </div>

            {/* C · 팝업 (만나요) */}
            <div className="ipworld-cell ipw-event" style={{ ['--cell-accent' as string]: 'rgba(56,240,192,.5)', overflow: 'hidden', position: 'relative', minHeight: 250, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', isolation: 'isolate' }}>
              {event ? (
                <>
                  <div aria-hidden style={{ position: 'absolute', inset: 0, zIndex: 0, background: event.img, backgroundSize: 'cover', backgroundPosition: 'center' }} />
                  <div aria-hidden style={{ position: 'absolute', inset: 0, zIndex: 1, background: 'linear-gradient(180deg, rgba(8,6,15,.25), rgba(8,6,15,.9) 78%)' }} />
                  <div style={{ position: 'relative', zIndex: 2, padding: 22 }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <span className="mono" style={{ fontSize: 10.5, letterSpacing: '.06em', padding: '3px 9px', borderRadius: 5, fontWeight: 700, color: '#0A0813', background: event.accent }}>{event.mode}</span>
                      <span className="mono" style={{ fontSize: 10.5, letterSpacing: '.06em', padding: '3px 9px', borderRadius: 5, border: '1px solid rgba(255,255,255,.25)', color: 'var(--text)', background: 'rgba(8,6,15,.5)' }}>{event.status}</span>
                    </div>
                    <div className="mono" style={{ fontSize: 'clamp(22px, 2.4vw, 28px)', fontWeight: 700, marginTop: 12 }}>{event.date || '일정 공개 예정'}</div>
                    <div style={{ fontWeight: 700, fontSize: 16, marginTop: 6, textWrap: 'pretty' }}>{event.title}</div>
                    <div style={{ fontSize: 13, color: '#C9C3E4', marginTop: 4 }}>{event.loc || '장소 공개 예정'}</div>
                    <Link className="btn btn-primary" href={`${hrefFor('events')}?ip=${ip.id}`} style={{ height: 40, padding: '0 20px', fontSize: 13.5, fontWeight: 700, marginTop: 16 }}>
                      예매하기 →
                    </Link>
                  </div>
                </>
              ) : (
                <div style={{ position: 'relative', zIndex: 2, padding: 22, display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'center', flex: 1 }}>
                  <span style={{ fontWeight: 700, fontSize: 16, marginTop: 24 }}>예정된 팝업이 없어요</span>
                  <span style={{ fontSize: 13, color: 'var(--dim)' }}>새 팝업이 공개되면 여기서 알려드릴게요.</span>
                  <Link href={hrefFor('events')} style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--dim)', marginTop: 6 }}>전체 팝업 보기 →</Link>
                </div>
              )}
              <span style={{ ...eyebrowStyle('var(--mint)'), position: 'absolute', top: 18, left: 22, zIndex: 2 }}>만나요 · 팝업</span>
            </div>

            {/* D · 커뮤니티 (떠들어요) */}
            <div className="ipworld-cell ipw-comm" style={{ ['--cell-accent' as string]: 'rgba(255,77,157,.45)', padding: 22, display: 'flex', flexDirection: 'column', minHeight: 250 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <span style={eyebrowStyle('var(--pink)')}>떠들어요 · 팬덤</span>
                <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10.5, color: 'var(--mint)' }}>
                  <span style={{ width: 6, height: 6, borderRadius: 99, background: 'var(--mint)', boxShadow: '0 0 8px var(--mint)' }} />LIVE
                </span>
              </div>
              {post ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 16, fontSize: 13, color: 'var(--dim)' }}>
                    <span style={{ width: 26, height: 26, borderRadius: 99, background: post.avatar }} />
                    <span style={{ fontWeight: 700, color: 'var(--text)' }}>@{post.user}</span>
                    <span className="mono" style={{ fontSize: 11, color: 'var(--faint)' }}>{post.time}</span>
                  </div>
                  <p style={{ margin: '12px 0 0', fontSize: 14.5, lineHeight: 1.55, color: '#E6E1FA', textWrap: 'pretty' }}>{post.text}</p>
                  <div className="mono" style={{ fontSize: 12, color: accent, marginTop: 12 }}>♥ {post.likes} · 댓글 {post.comments}</div>
                </>
              ) : (
                <p style={{ margin: '16px 0 0', fontSize: 14, color: 'var(--dim)' }}>아직 포스트가 없어요. 첫 이야기를 시작해 보세요.</p>
              )}
              <Link href={`${hrefFor('community')}?ip=${ip.id}`} style={{ marginTop: 'auto', paddingTop: 16, fontWeight: 700, fontSize: 14, color: 'var(--text)', display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                팬덤 채널 들어가기 →
              </Link>
            </div>

            {/* E · 카드 도감 */}
            <div className="ipworld-cell ipw-cards" style={{ ['--cell-accent' as string]: 'rgba(169,129,255,.4)', padding: 22, display: 'flex', flexDirection: 'column', gap: 14, minHeight: 200 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={eyebrowStyle('var(--violet-2)')}>카드 도감</span>
                <span className="mono" style={{ fontSize: 12, color: 'var(--faint)' }}>{cards.length} TYPES</span>
              </div>
              {cards.length > 0 ? (
                <div style={{ display: 'flex', gap: 10 }}>
                  {cards.slice(0, 3).map((c) => (
                    <span key={c.id} style={{ flex: 1, aspectRatio: '5 / 7', borderRadius: 10, background: c.bg, backgroundSize: 'cover', backgroundPosition: 'center', position: 'relative', overflow: 'hidden', boxShadow: '0 0 0 1px rgba(255,255,255,.12), 0 14px 30px -16px rgba(0,0,0,.8)' }}>
                      <span className="mono" style={{ position: 'absolute', top: 6, left: 6, fontSize: 9, padding: '2px 6px', borderRadius: 4, background: 'rgba(8,6,15,.75)', border: '1px solid rgba(255,255,255,.2)' }}>{c.rarity}</span>
                    </span>
                  ))}
                </div>
              ) : (
                <p style={{ margin: 0, fontSize: 13.5, color: 'var(--dim)' }}>등록된 카드가 아직 없습니다.</p>
              )}
              <Link href={hrefFor('binder')} style={{ fontWeight: 700, fontSize: 13.5, display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--dim)' }}>
                바인더에서 도감 완성하기 →
              </Link>
            </div>

            {/* F · 팬덤 스탯 */}
            <div className="ipworld-cell ipw-fans" style={{ ['--cell-accent' as string]: `${accent}66`, padding: 22, display: 'flex', flexDirection: 'column', minHeight: 200 }}>
              <span style={eyebrowStyle(accent)}>팬덤</span>
              <span className="mono" style={{ fontSize: 'clamp(30px, 3vw, 40px)', fontWeight: 700, marginTop: 12 }}>{compactNumber(ip.fans)}</span>
              <span style={{ fontSize: 13, color: 'var(--dim)', marginTop: 2 }}>명의 팬이 함께해요</span>
              <FollowForm followState={followState} ipId={ip.id} mini />
            </div>

            {/* G · 굿즈 라인업 */}
            <div className="ipworld-cell ipw-more" style={{ ['--cell-accent' as string]: 'rgba(255,178,61,.35)', padding: 22, display: 'flex', flexDirection: 'column', gap: 14, minHeight: 200 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={eyebrowStyle('var(--amber)')}>굿즈 라인업</span>
                <Link className="mono" href={`${hrefFor('shop')}?ip=${ip.id}`} style={{ fontSize: 12, color: 'var(--dim)' }}>굿즈샵 →</Link>
              </div>
              {goodsLineup.length > 0 ? (
                <div style={{ display: 'flex', gap: 10, flex: 1 }}>
                  {goodsLineup.map((g) => (
                    <Link key={g.id} href={`${hrefFor('shop')}?ip=${ip.id}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
                      <span style={{ display: 'block', aspectRatio: '4 / 3', borderRadius: 12, background: g.img, backgroundSize: 'cover', backgroundPosition: 'center', boxShadow: '0 0 0 1px rgba(255,255,255,.1)' }} />
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: '#C9C3E4', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.name}</span>
                      <span className="mono" style={{ fontSize: 12 }}>₩{g.price.toLocaleString('ko-KR')}</span>
                    </Link>
                  ))}
                </div>
              ) : (
                <p style={{ margin: 0, fontSize: 13.5, color: 'var(--dim)' }}>라인업이 준비되는 대로 소개할게요.</p>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
