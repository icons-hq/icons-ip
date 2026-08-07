import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Good, Ip } from '@/lib/data';
import { krw } from '@/lib/format';
import { STOCK_LABEL } from '@/lib/goods-display';
import { ipAccent, ipAccentInk } from '@/lib/ip-display';

/*
 * 굿즈샵 목록 카드 (#173).
 *
 * 상세 링크는 이미지와 이름만 감싼다. 카드 전체를 <Link> 로 덮으면 담기 버튼
 * 클릭이 상세 이동까지 같이 일으키고, 링크 안의 버튼은 마크업으로도 잘못됐다.
 *
 * action 을 slot 으로 받는 이유는 어드민 미리보기(#184) 때문이다. 미리보기는
 * 장바구니에 손대면 안 되므로 같은 카드에 동작하지 않는 버튼을 꽂는다.
 */
export function GoodsCard({
  action,
  good,
  href,
  ip,
}: {
  action: ReactNode;
  good: Good;
  href?: string;
  ip?: Ip | null;
}) {
  const stockLabel = STOCK_LABEL[good.stock];
  const accent = ip ? ipAccent(ip) : 'var(--violet-2)';
  const accentInk = ip ? ipAccentInk(ip) : 'var(--editorial-ink-muted)';

  const media = (
    <div style={{ aspectRatio: '1 / 1', background: good.img, backgroundSize: 'cover', backgroundPosition: 'center', position: 'relative' }}>
      <span aria-hidden className="sheen" style={{ opacity: 0.3 }} />
      {(good.badge ?? stockLabel) && (
        <span className="mono" style={{ position: 'absolute', top: 12, left: 12, fontSize: 10.5, letterSpacing: '.06em', padding: '4px 10px', borderRadius: 6, color: '#fff', background: 'rgba(8,6,15,.7)', border: '1px solid rgba(255,255,255,.2)', backdropFilter: 'blur(6px)' }}>
          {good.badge ?? stockLabel}
        </span>
      )}
    </div>
  );

  const meta = (
    <>
      <span className="mono" style={{ fontSize: 10.5, letterSpacing: '.14em', textTransform: 'uppercase', color: accentInk }}>{ip?.title ?? ''}</span>
      <span style={{ fontWeight: 700, fontSize: 15, lineHeight: 1.35, textWrap: 'pretty' }}>{good.name}</span>
      <span style={{ fontSize: 12.5, color: 'var(--dim)' }}>{good.type}{stockLabel && good.badge ? ` · ${stockLabel}` : ''}</span>
    </>
  );

  return (
    <div
      className="shop-card"
      style={{ ['--cell-accent' as string]: `${accent}55`, borderRadius: 22, border: '1px solid var(--line)', background: 'linear-gradient(180deg, var(--surface), var(--bg-2))', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
    >
      {href ? <Link href={href} style={{ color: 'inherit', display: 'block', textDecoration: 'none' }}>{media}</Link> : media}
      <div style={{ padding: '16px 16px 18px', display: 'flex', flexDirection: 'column', gap: 5, flex: 1 }}>
        {href ? (
          <Link href={href} style={{ color: 'inherit', display: 'flex', flexDirection: 'column', gap: 5, textDecoration: 'none' }}>
            {meta}
          </Link>
        ) : meta}
        <div className="shop-card-purchase">
          <span className="shop-card-price mono">{krw(good.price)}</span>
          {action}
        </div>
      </div>
    </div>
  );
}
