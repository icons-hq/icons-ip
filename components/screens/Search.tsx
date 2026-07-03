'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SearchResult, SearchResultGroup, SearchResultKind, SearchSnapshot } from '@/lib/search';
import { useGo } from '@/components/shell/useGo';

const POPULAR = ['리락쿠마', '메이플스토리', '담곰이', '카카오프렌즈', '리바이', '한정굿즈'];

const GROUP_META: Record<SearchResultKind, { color: string; moreLabel: string | null; moreRoute: string | null }> = {
  ip: { color: 'var(--violet-2)', moreLabel: 'IP 허브 전체 →', moreRoute: 'iphub' },
  good: { color: 'var(--amber)', moreLabel: '굿즈샵 전체 →', moreRoute: 'shop' },
  card: { color: 'var(--pink)', moreLabel: '바인더에서 보기 →', moreRoute: 'binder' },
  post: { color: 'var(--cyan)', moreLabel: '커뮤니티 전체 →', moreRoute: 'community' },
  tag: { color: 'var(--mint)', moreLabel: null, moreRoute: null },
};

function resultBg(result: SearchResult) {
  if (result.bg) return result.bg;
  if (result.kind === 'tag') return 'linear-gradient(150deg, var(--violet), var(--pink))';
  if (result.kind === 'post') return 'linear-gradient(150deg, rgba(45,226,255,.24), rgba(139,92,255,.26))';
  return 'var(--surface-2)';
}

export function Search({ snapshot }: { snapshot: SearchSnapshot }) {
  const go = useGo();
  const router = useRouter();
  const [q, setQ] = useState(snapshot.query);
  const [scope, setScope] = useState<'all' | SearchResultKind>('all');

  const openResult = (result: SearchResult) => {
    if (result.kind === 'ip') return go('ip', result.ipId ?? result.id);
    if (result.kind === 'good') return go('shop');
    if (result.kind === 'card') return go('binder');
    return go('community');
  };

  const searchFor = (query: string) => {
    setQ(query);
    router.push(`/search?q=${encodeURIComponent(query)}`);
  };

  const groups = snapshot.groups.filter((g) => scope === 'all' || g.kind === scope);

  const groupSection = (group: SearchResultGroup) => {
    const meta = GROUP_META[group.kind];
    const header = (
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
        <div className="mono" style={{ fontSize: 11, letterSpacing: '.2em', textTransform: 'uppercase', color: meta.color }}>
          {group.label} · {group.results.length}
        </div>
        {meta.moreLabel && meta.moreRoute && (
          <button type="button" className="mono" onClick={() => go(meta.moreRoute!)} style={{ fontSize: 11.5, color: 'var(--dim)' }}>
            {meta.moreLabel}
          </button>
        )}
      </div>
    );

    if (group.kind === 'ip') {
      return (
        <div key={group.kind}>
          {header}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 14 }}>
            {group.results.map((r) => (
              <button key={r.id} type="button" className="search-pill" onClick={() => openResult(r)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 18px 10px 10px', borderRadius: 999, border: '1px solid rgba(255,255,255,.09)', background: 'linear-gradient(180deg, var(--surface), var(--bg-2))', textAlign: 'left' }}>
                <span style={{ width: 44, height: 44, borderRadius: 99, background: resultBg(r), backgroundSize: 'cover', backgroundPosition: 'center', boxShadow: '0 0 0 1px rgba(255,255,255,.15)', flex: '0 0 auto' }} />
                <span>
                  <span style={{ display: 'block', fontWeight: 700, fontSize: 14.5 }}>{r.label}</span>
                  {r.subtitle && <span className="mono" style={{ display: 'block', fontSize: 10.5, color: 'var(--faint)', marginTop: 1 }}>{r.subtitle}</span>}
                </span>
              </button>
            ))}
          </div>
        </div>
      );
    }

    if (group.kind === 'good') {
      return (
        <div key={group.kind}>
          {header}
          <div className="search-goods-grid" style={{ marginTop: 14 }}>
            {group.results.map((r) => (
              <button key={r.id} type="button" className="search-card" onClick={() => openResult(r)} style={{ borderRadius: 16, border: '1px solid var(--line)', background: 'linear-gradient(180deg, var(--surface), var(--bg-2))', overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: 0, textAlign: 'left' }}>
                <span style={{ display: 'block', aspectRatio: '1 / 1', background: resultBg(r), backgroundSize: 'cover', backgroundPosition: 'center' }} />
                <span style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '12px 14px 14px' }}>
                  {r.ipTitle && <span className="mono" style={{ fontSize: 10, color: r.accent ?? 'var(--faint)' }}>{r.ipTitle}</span>}
                  <span style={{ fontWeight: 700, fontSize: 13.5 }}>{r.label}</span>
                  {r.subtitle && <span className="mono" style={{ fontSize: 11, color: 'var(--dim)', marginTop: 2 }}>{r.subtitle}</span>}
                </span>
              </button>
            ))}
          </div>
        </div>
      );
    }

    if (group.kind === 'card') {
      return (
        <div key={group.kind}>
          {header}
          <div className="search-cards-grid" style={{ marginTop: 14 }}>
            {group.results.map((r) => (
              <button key={r.id} type="button" className="search-tile" onClick={() => openResult(r)} style={{ borderRadius: 14, overflow: 'hidden', position: 'relative', aspectRatio: '5 / 7', background: resultBg(r), backgroundSize: 'cover', backgroundPosition: 'center', boxShadow: '0 0 0 1px rgba(255,255,255,.14)', padding: 0, textAlign: 'left' }}>
                <span style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, transparent 60%, rgba(8,6,15,.88) 100%)' }} />
                <span style={{ position: 'absolute', left: 9, right: 9, bottom: 8, fontWeight: 700, fontSize: 11.5, lineHeight: 1.3 }}>{r.label}</span>
              </button>
            ))}
          </div>
        </div>
      );
    }

    return (
      <div key={group.kind}>
        {header}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
          {group.results.map((r) => (
            <button key={r.id} type="button" className="search-row" onClick={() => openResult(r)} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 16px 12px 12px', borderRadius: 16, border: '1px solid var(--line)', background: 'linear-gradient(180deg, var(--surface), var(--bg-2))', textAlign: 'left' }}>
              <span style={{ flex: '0 0 auto', width: 52, height: 52, borderRadius: 10, background: resultBg(r), backgroundSize: 'cover', backgroundPosition: 'center', display: 'grid', placeItems: 'center', fontWeight: 800, color: r.kind === 'tag' ? '#0A0813' : 'var(--text)' }}>
                {r.kind === 'tag' ? '#' : null}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontWeight: 700, fontSize: 14.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span>
                {r.subtitle && <span className="mono" style={{ display: 'block', fontSize: 11, color: 'var(--faint)', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.subtitle}</span>}
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div style={{ minHeight: '100vh' }}>
      {/* search hero */}
      <header style={{ padding: 'clamp(108px, 12vw, 140px) 0 0' }}>
        <div style={{ maxWidth: 860, margin: '0 auto', padding: '0 24px' }}>
          <div className="eyebrow rise">통합 검색</div>
          <h1 className="rise" style={{ margin: '14px 0 0', fontFamily: 'var(--ff-display)', fontWeight: 700, fontSize: 'clamp(32px, 4.4vw, 52px)', lineHeight: 1.06, letterSpacing: '-0.04em', animationDelay: '.08s' }}>
            무엇을 찾고 있나요?
          </h1>
          <form action="/search" method="get" className="rise" style={{ position: 'relative', marginTop: 24, animationDelay: '.16s' }}>
            <span aria-hidden style={{ position: 'absolute', left: 22, top: '50%', transform: 'translateY(-50%)', fontSize: 18, color: 'var(--faint)' }}>⌕</span>
            <input
              autoFocus
              name="q"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="IP · 굿즈 · 카드 · 포스트 통합 검색"
              style={{
                width: '100%', boxSizing: 'border-box', height: 60, padding: '0 52px', borderRadius: 999,
                border: '1px solid rgba(139,92,255,.4)', background: 'rgba(21,17,42,.8)', color: 'var(--text)',
                fontSize: 16, fontFamily: 'inherit', outline: 'none',
                boxShadow: '0 0 0 4px rgba(139,92,255,.08), 0 20px 50px -24px rgba(139,92,255,.4)',
              }}
            />
            {q && (
              <button
                type="button"
                aria-label="검색어 지우기"
                onClick={() => { setQ(''); router.push('/search'); }}
                style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', width: 32, height: 32, borderRadius: 99, display: 'grid', placeItems: 'center', color: 'var(--dim)', border: '1px solid var(--line-2)' }}
              >
                ✕
              </button>
            )}
          </form>
          <div className="rise" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 16, animationDelay: '.22s' }}>
            <span className="mono" style={{ fontSize: 10.5, letterSpacing: '.14em', color: 'var(--faint)' }}>인기 검색어</span>
            {POPULAR.map((t) => (
              <button key={t} type="button" className="chip chip-sm" style={{ fontFamily: 'var(--ff-body)', fontSize: 12.5 }} onClick={() => searchFor(t)}>
                {t}
              </button>
            ))}
          </div>
          {snapshot.query && snapshot.groups.length > 1 && (
            <div className="rise" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 22, animationDelay: '.28s' }}>
              <button type="button" className={'chip' + (scope === 'all' ? ' on' : '')} aria-pressed={scope === 'all'} onClick={() => setScope('all')}>
                전체 <span className="mono" style={{ fontSize: 10.5, opacity: 0.7 }}>{snapshot.displayedTotal}</span>
              </button>
              {snapshot.groups.map((g) => (
                <button key={g.kind} type="button" className={'chip' + (scope === g.kind ? ' on' : '')} aria-pressed={scope === g.kind} onClick={() => setScope(g.kind)}>
                  {g.label} <span className="mono" style={{ fontSize: 10.5, opacity: 0.7 }}>{g.results.length}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      {/* results */}
      <section style={{ padding: 'clamp(30px, 4vw, 44px) 0 clamp(48px, 7vw, 80px)' }}>
        <div className="wrap" style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(34px, 5vw, 48px)' }}>
          {snapshot.query ? (
            snapshot.displayedTotal > 0 ? (
              groups.map(groupSection)
            ) : (
              <div style={{ textAlign: 'center', padding: '70px 20px', border: '1px dashed var(--line-2)', borderRadius: 20 }}>
                <div style={{ fontSize: 17, fontWeight: 700 }}>&lsquo;{snapshot.query}&rsquo;에 대한 결과가 없어요</div>
                <div className="mono" style={{ fontSize: 12, color: 'var(--faint)', marginTop: 8 }}>다른 검색어를 입력하거나 인기 검색어를 눌러보세요</div>
              </div>
            )
          ) : (
            <div className="money-caption" style={{ textAlign: 'center', padding: '30px 0' }}>
              검색어를 입력하면 IP · 굿즈 · 카드 · 포스트 · 태그를 한 번에 찾아드려요
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
