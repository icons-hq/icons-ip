import Link from 'next/link';
import type { ReactNode } from 'react';
import { pdpPriceView } from '@/components/shop/PdpPrice';
import { PromoCard } from '@/components/wc/PromoCard';
import { SectionHeader } from '@/components/wc/SectionHeader';
import { krw } from '@/lib/format';
import { goodsImageBackground } from '@/lib/goods-image';
import { homeCardUnavailableLabel, type HomeGoodsBand, type HomeGoodsCard } from '@/lib/home-catalog';
import { imageBg } from '@/lib/media';

/** ICONS PICK 카드 하나에 붙는 상품 행 수(Figma: 카드마다 2행). */
export const ICONS_PICK_GOODS = 2;

export interface IconsPickProps {
  /** 순서상 연달아 놓인 기획전 배너. 한 줄(데스크톱 3열)로 묶여 한 섹션이 된다. */
  bands: readonly HomeGoodsBand[];
  /** 상품 행 오른쪽 위시 하트. 위시 상태를 받지 않은 자리(어드민 미리보기·목업)에서는 null 을 돌려준다. */
  heartFor: (good: Pick<HomeGoodsCard, 'id' | 'name'>, className?: string) => ReactNode;
}

/*
 * ICONS PICK (X SQUARE Figma Main Page). 운영 데이터는 기획전 배너(`band_banner`) 행이고, 배너 한 장이 카드 한 장이다.
 * 카드 = 프로모션 카드(배너 이미지 + 제목, `PromoCard`) 아래에 고른 상품 앞 2개를 행으로 붙인 묶음이다. 부제는 그리지 않는다.
 *
 * 카드 전체를 링크로 덮지 않는다 — 상품 행의 링크·하트가 카드 링크 안에 들어가면 마크업으로도 잘못되고 클릭이 겹친다.
 * 그래서 배너 링크(PromoCard)와 행마다의 링크·하트가 서로 형제다(상품 카드·구 기획전 행과 같은 규칙).
 * 행의 '품절'·'판매 예정' 라벨은 구 기획전 행과 같이 가격 옆 글로 전한다(썸네일에 밴드를 겹칠 자리가 없다).
 * 할인율은 상품 카드(PriceBlock inline)와 같은 판정이다 — pdpPriceView 가 PriceBlock 과 같은 규칙으로 계산한다(가격 범위·정가 이하는 없음).
 */
export function IconsPick({ bands, heartFor }: IconsPickProps) {
  if (bands.length === 0) return null;
  /* 섹션 하나는 그룹 안 첫 기획전 id 로 이름 붙인다 — 연달아가 아니라 떨어져 놓인 그룹이 둘이면 제목 id 가 겹치면 안 된다. */
  const headingId = `home-icons-pick-${bands[0].id}-heading`;
  return (
    <section aria-labelledby={headingId} className="wc-home__band wc-home__icons-pick">
      <div className="wc-container wc-container--wide">
        <SectionHeader id={headingId} title="ICONS PICK" />
        <ul className="wc-x-pick-grid">
          {bands.map((band) => (
            <li key={band.id}>
              <article className="wc-x-pick">
                <PromoCard className="wc-x-pick__promo" href={band.href} imageBg={imageBg(band.imageUrl)} title={band.title} />
                {band.goods.length > 0 ? (
                  <ul className="wc-x-pick__goods">
                    {band.goods.slice(0, ICONS_PICK_GOODS).map((good) => {
                      const unavailable = homeCardUnavailableLabel(good) ?? (good.soldOut ? '품절' : null);
                      const { rate } = pdpPriceView(good);
                      return (
                        <li className="wc-x-pick__row" key={good.id}>
                          <Link className="wc-x-pick__link" href={good.href}>
                            <span aria-hidden className="wc-x-pick__thumb" style={{ background: goodsImageBackground(good.imageBg) }} />
                            <span className="wc-x-pick__text">
                              {good.brand ? <><span className="wc-x-pick__brand">{good.brand}</span>{' '}</> : null}
                              <span className="wc-x-pick__name">{good.name}</span>{' '}
                              <span className="wc-x-pick__price">
                                {rate ? <span className="wc-x-pick__rate">{rate}</span> : null}
                                {krw(good.price)}
                                {unavailable ? <span className="wc-x-pick__unavailable">{unavailable}</span> : null}
                              </span>
                            </span>
                          </Link>
                          {heartFor(good, 'wc-x-pick__heart')}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </article>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
