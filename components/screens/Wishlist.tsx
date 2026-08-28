import Link from 'next/link';
import { AddToCartButton } from '@/components/shop/AddToCartButton';
import { WishlistHeart } from '@/components/shop/WishlistHeart';
import { EmptyState } from '@/components/wc/EmptyState';
import { PriceBlock } from '@/components/wc/PriceBlock';
import { SectionHeading } from '@/components/wc/SectionHeading';
import { WcButton } from '@/components/wc/WcButton';
import type { CatalogSnapshot } from '@/lib/catalog';
import type { Good, Ip } from '@/lib/data';
import type { WishlistEntry } from '@/lib/wishlist.server';

/*
 * 위시리스트 화면 (#326 S4).
 *
 * 그리드가 아니라 리스트 행이다. 찜한 굿즈는 "다시 보러 온 것"이라 이름·가격·담기를
 * 한 줄에서 비교하는 편이 빠르고, 하트를 카드 위에 겹치면 해제 버튼이 이미지 링크와
 * 같은 자리를 다툰다(R-02·04 실측).
 *
 * 카탈로그에서 사라진 굿즈(보관·삭제)도 행을 지운다: 찜 기록은 남아 있는데 목록에서
 * 조용히 빠지면 사용자는 자기가 해제한 줄 안다. 판매 종료로 표시하고 해제 수단을 남긴다.
 */

export interface WishlistProps {
  catalog: Pick<CatalogSnapshot, 'goods' | 'ips'>;
  entries: WishlistEntry[];
}

interface WishlistLine {
  goodId: string;
  good: Good | null;
  ip: Ip | null;
}

function shopCta() {
  return (
    <WcButton href="/shop" variant="primary">
      굿즈샵 둘러보기
    </WcButton>
  );
}

function WishlistRow({ line }: { line: WishlistLine }) {
  const { good, goodId, ip } = line;

  if (!good) {
    return (
      <li className="wc-wishlist__row">
        <span aria-hidden className="wc-wishlist__media" />
        <div className="wc-wishlist__info">
          <p className="wc-wishlist__name">판매 종료</p>
          <p className="wc-wishlist__state">더 이상 판매하지 않는 굿즈예요.</p>
        </div>
        <div className="wc-wishlist__actions">
          <WishlistHeart goodId={goodId} initialWished />
        </div>
      </li>
    );
  }

  const soldOut = good.stock === 'soldout' || good.stockQty <= 0;

  return (
    <li className="wc-wishlist__row">
      <Link aria-hidden className="wc-wishlist__media" href={`/shop/${good.id}`} tabIndex={-1}>
        <span className="wc-wishlist__image" style={{ background: good.img }} />
      </Link>
      <div className="wc-wishlist__info">
        {ip ? <p className="wc-wishlist__brand">{ip.title}</p> : null}
        <p className="wc-wishlist__name">
          <Link className="wc-wishlist__name-link" href={`/shop/${good.id}`}>{good.name}</Link>
          {soldOut ? <span className="wc-sr-only"> (품절)</span> : null}
        </p>
        <PriceBlock compareAtPrice={good.compareAtPrice} price={good.price} />
      </div>
      <div className="wc-wishlist__actions">
        <WishlistHeart goodId={good.id} initialWished />
        <AddToCartButton good={good} />
      </div>
    </li>
  );
}

export function Wishlist({ catalog, entries }: WishlistProps) {
  const goodsById = new Map(catalog.goods.map((good) => [good.id, good]));
  const ipsById = new Map(catalog.ips.map((ip) => [ip.id, ip]));

  const lines: WishlistLine[] = entries.map((entry) => {
    const good = goodsById.get(entry.goodId) ?? null;
    return { goodId: entry.goodId, good, ip: good ? ipsById.get(good.ip) ?? null : null };
  });

  return (
    <div className="wc-root">
      <div className="wc-container">
        <section aria-labelledby="wishlist-heading" className="wc-wishlist">
          <SectionHeading as="h1" id="wishlist-heading" title="위시리스트" />
          {lines.length ? (
            <ul className="wc-wishlist__list">
              {lines.map((line) => <WishlistRow key={line.goodId} line={line} />)}
            </ul>
          ) : (
            <EmptyState
              action={shopCta()}
              description="마음에 드는 굿즈를 하트로 담아 두면 여기에 모여요."
              title="아직 찜한 굿즈가 없어요"
            />
          )}
        </section>
      </div>
    </div>
  );
}
