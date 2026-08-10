'use client';

import { useState } from 'react';
import type { CatalogSnapshot } from '@/lib/catalog';
import { goodDetailHref } from '@/lib/goods-display';
import { ipAccent } from '@/lib/ip-display';
import { ALL_IPS, GOODS_SORTS, selectShopGoods, type GoodsSort } from '@/lib/shop-catalog';
import { useCart } from '@/components/shell/CartProvider';
import { AddToCartButton } from '@/components/shop/AddToCartButton';
import { GoodsCard } from '@/components/shop/GoodsCard';
import { Empty } from '@/components/ui/Empty';

export function Shop({
  catalog,
  initialIpId,
}: {
  catalog: Pick<CatalogSnapshot, 'ips' | 'goods'>;
  initialIpId?: string;
}) {
  const [ipF, setIpF] = useState(initialIpId ?? ALL_IPS);
  const [sort, setSort] = useState<GoodsSort>('인기순');
  const { error } = useCart();

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
          {error && (
            <div className="card" role="alert" style={{ marginBottom: 18, padding: 12, borderRadius: 12, color: 'var(--pink)', fontSize: 13.5, fontWeight: 700 }}>
              {error}
            </div>
          )}
          {visible.length === 0 ? (
            <Empty
              icon="bag"
              text={catalog.goods.length ? '조건에 맞는 굿즈가 없어요' : '등록된 굿즈가 아직 없습니다'}
              sub={catalog.goods.length ? '필터를 바꿔보세요' : 'Supabase 카탈로그 seed 또는 admin 등록 후 굿즈샵에 공개됩니다.'}
            />
          ) : (
            <div className="shop-grid">
              {visible.map((g) => (
                <GoodsCard
                  action={<AddToCartButton good={g} />}
                  good={g}
                  href={goodDetailHref(g.id)}
                  ip={ipsById.get(g.ip)}
                  key={g.id}
                />
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
