'use client';

import { useState } from 'react';
import type { CatalogSnapshot } from '@/lib/catalog';
import type { Good, Ip, Stock } from '@/lib/data';
import { ipAccent } from '@/lib/ip-display';
import { ALL_IPS, GOODS_SORTS, selectShopGoods, type GoodsSort } from '@/lib/shop-catalog';
import { useCart } from '@/components/shell/CartProvider';
import { Empty } from '@/components/ui/Empty';

const STOCK_LABEL: Record<Stock, string | null> = { low: '품절임박', soldout: '품절', ok: null };
const krw = (n: number) => '₩' + n.toLocaleString('ko-KR');

function ShopGoodsCard({ g, ip }: { g: Good; ip?: Ip }) {
  const { add, remove } = useCart();
  const [inCart, setInCart] = useState(false);
  const sold = g.stock === 'soldout';
  const stockLabel = STOCK_LABEL[g.stock];
  const accent = ip ? ipAccent(ip) : 'var(--violet-2)';

  const toggleCart = () => {
    if (sold) return;
    if (inCart) remove(); else add();
    setInCart(!inCart);
  };

  return (
    <div
      className="shop-card"
      style={{ ['--cell-accent' as string]: `${accent}55`, borderRadius: 22, border: '1px solid var(--line)', background: 'linear-gradient(180deg, var(--surface), var(--bg-2))', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
    >
      <div style={{ aspectRatio: '1 / 1', background: g.img, backgroundSize: 'cover', backgroundPosition: 'center', position: 'relative' }}>
        <span aria-hidden className="sheen" style={{ opacity: 0.3 }} />
        {(g.badge ?? stockLabel) && (
          <span className="mono" style={{ position: 'absolute', top: 12, left: 12, fontSize: 10.5, letterSpacing: '.06em', padding: '4px 10px', borderRadius: 6, background: 'rgba(8,6,15,.7)', border: '1px solid rgba(255,255,255,.2)', backdropFilter: 'blur(6px)' }}>
            {g.badge ?? stockLabel}
          </span>
        )}
      </div>
      <div style={{ padding: '16px 16px 18px', display: 'flex', flexDirection: 'column', gap: 5, flex: 1 }}>
        <span className="mono" style={{ fontSize: 10.5, letterSpacing: '.14em', textTransform: 'uppercase', color: accent }}>{ip?.title ?? ''}</span>
        <span style={{ fontWeight: 700, fontSize: 15, lineHeight: 1.35, textWrap: 'pretty' }}>{g.name}</span>
        <span style={{ fontSize: 12.5, color: 'var(--dim)' }}>{g.type}{stockLabel && g.badge ? ` · ${stockLabel}` : ''}</span>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 'auto', paddingTop: 12 }}>
          <span className="mono" style={{ fontSize: 16, fontWeight: 700 }}>{krw(g.price)}</span>
          <button
            type="button"
            onClick={toggleCart}
            disabled={sold}
            aria-label={sold ? '품절' : inCart ? '장바구니에서 빼기' : '장바구니 담기'}
            style={{
              height: 36, padding: '0 16px', borderRadius: 999, fontWeight: 700, fontSize: 12.5,
              background: inCart ? 'rgba(255,255,255,.05)' : 'var(--text)',
              color: sold ? 'var(--faint)' : inCart ? 'var(--text)' : '#110D22',
              border: inCart ? '1px solid rgba(255,255,255,.25)' : 'none',
              opacity: sold ? 0.5 : 1,
              transition: 'transform .18s ease, background .25s ease',
            }}
          >
            {sold ? '품절' : inCart ? '담김 ✓' : '담기'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Shop({
  catalog,
  initialIpId,
}: {
  catalog: Pick<CatalogSnapshot, 'ips' | 'goods'>;
  initialIpId?: string;
}) {
  const [ipF, setIpF] = useState(initialIpId ?? ALL_IPS);
  const [sort, setSort] = useState<GoodsSort>('인기순');

  const ipsById = new Map(catalog.ips.map((ip) => [ip.id, ip]));
  const visible = selectShopGoods(catalog.goods, { ipId: ipF, sort });

  return (
    <div style={{ minHeight: '100vh' }}>
      {/* header */}
      <header style={{ padding: '128px 0 0' }}>
        <div className="wrap">
          <div className="eyebrow rise" style={{ color: 'var(--amber)' }}>사요 · 공식 굿즈샵</div>
          <div className="rise" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, marginTop: 14, animationDelay: '.08s' }}>
            <h1 style={{ margin: 0, fontFamily: 'var(--ff-display)', fontWeight: 700, fontSize: 'clamp(38px, 5.6vw, 72px)', lineHeight: 1.02, letterSpacing: '-0.04em' }}>최애의 물건들</h1>
            <span className="mono" style={{ fontSize: 12, letterSpacing: '.1em', color: 'var(--faint)' }}>{String(visible.length).padStart(2, '0')} ITEMS · 공식 라이선스 정품</span>
          </div>
          <p className="rise" style={{ margin: '14px 0 0', fontSize: 15, color: '#C9C3E4', maxWidth: 560, textWrap: 'pretty', animationDelay: '.16s' }}>
            모든 굿즈는 IP사와의 정식 계약으로 제작됩니다. 한정판은 재입고 없이 소진 시 종료돼요.
          </p>
        </div>
      </header>

      {/* sticky filter bar */}
      <div className="shop-toolbar" style={{ marginTop: 30 }}>
        <div className="wrap ipworld-switcher" role="group" aria-label="IP·정렬 필터">
          <span className="mono" style={{ fontSize: 11, letterSpacing: '.18em', color: 'var(--faint)', flex: '0 0 auto' }}>WORLDS</span>
          <button
            type="button"
            aria-pressed={ipF === ALL_IPS}
            onClick={() => setIpF(ALL_IPS)}
            style={{
              flex: '0 0 auto', height: 36, padding: '0 16px', borderRadius: 999, fontSize: 13,
              fontWeight: ipF === ALL_IPS ? 700 : 500,
              color: ipF === ALL_IPS ? 'var(--text)' : 'var(--dim)',
              border: `1px solid ${ipF === ALL_IPS ? 'var(--violet)' : 'var(--line-2)'}`,
              background: ipF === ALL_IPS ? 'rgba(255,255,255,.05)' : 'rgba(255,255,255,.02)',
              transition: 'all .25s ease',
            }}
          >
            전체
          </button>
          {catalog.ips.map((ip) => {
            const active = ipF === ip.id;
            return (
              <button
                key={ip.id}
                type="button"
                aria-pressed={active}
                onClick={() => setIpF(ip.id)}
                style={{
                  flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', gap: 8, height: 36, padding: '0 15px 0 6px',
                  borderRadius: 999, fontSize: 13, fontWeight: active ? 700 : 500,
                  color: active ? 'var(--text)' : 'var(--dim)',
                  border: `1px solid ${active ? ipAccent(ip) : 'var(--line-2)'}`,
                  background: active ? 'rgba(255,255,255,.05)' : 'rgba(255,255,255,.02)',
                  transition: 'all .25s ease',
                }}
              >
                <span style={{ width: 24, height: 24, borderRadius: 99, background: ip.bg, backgroundSize: 'cover', backgroundPosition: 'center', boxShadow: '0 0 0 1px rgba(255,255,255,.15)' }} />
                {ip.title}
              </button>
            );
          })}
          <span aria-hidden style={{ flex: '0 0 auto', width: 1, height: 22, background: 'rgba(255,255,255,.1)', margin: '0 4px' }} />
          {GOODS_SORTS.map((s) => {
            const active = sort === s;
            return (
              <button
                key={s}
                type="button"
                className="mono"
                aria-pressed={active}
                onClick={() => setSort(s)}
                style={{
                  flex: '0 0 auto', height: 36, padding: '0 14px', borderRadius: 999, fontSize: 11.5, letterSpacing: '.04em',
                  fontWeight: active ? 700 : 400,
                  color: active ? 'var(--text)' : 'var(--faint)',
                  border: `1px solid ${active ? 'rgba(139,92,255,.6)' : 'rgba(255,255,255,.1)'}`,
                  background: active ? 'rgba(139,92,255,.12)' : 'transparent',
                  transition: 'all .25s ease',
                }}
              >
                {s}
              </button>
            );
          })}
        </div>
      </div>

      {/* grid */}
      <section style={{ padding: '34px 0 clamp(70px, 9vw, 110px)' }}>
        <div className="wrap">
          {visible.length === 0 ? (
            <Empty
              icon="bag"
              text={catalog.goods.length ? '조건에 맞는 굿즈가 없어요' : '등록된 굿즈가 아직 없습니다'}
              sub={catalog.goods.length ? '필터를 바꿔보세요' : 'Supabase 카탈로그 seed 또는 admin 등록 후 굿즈샵에 공개됩니다.'}
            />
          ) : (
            <div className="shop-grid">
              {visible.map((g) => (
                <ShopGoodsCard key={g.id} g={g} ip={ipsById.get(g.ip)} />
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
