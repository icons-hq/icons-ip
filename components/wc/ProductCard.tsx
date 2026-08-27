import Link from 'next/link';
import type { ReactNode } from 'react';
import { Badge } from '@/components/wc/Badge';
import { PriceBlock } from '@/components/wc/PriceBlock';

export interface ProductCardProps {
  href: string;
  name: string;
  brand?: string | null;
  price: number;
  compareAtPrice?: number | null;
  badges?: string[];
  soldOut?: boolean;
  imageBackground?: string;
  image?: ReactNode;
  action?: ReactNode;
  className?: string;
}

/*
 * 카드 전체를 링크로 덮지 않는다. 위시 하트 같은 action 이 링크 안에 들어가면 클릭이
 * 상세 이동까지 같이 일으키고, 링크 안의 버튼은 마크업으로도 잘못됐다.
 *
 * 이미지 링크는 접근성 트리에서 숨긴다. 안에 읽을 텍스트가 없어 접근 가능한 이름이
 * 빈 문자열이 되고(link-name, WCAG 2.4.4), 이름을 붙여도 바로 아래 이름 링크와 목적지가
 * 같아 스크린리더 링크 목록과 탭 순서에 상품마다 중복 항목이 하나씩 더 생긴다.
 * aria-hidden 안에 초점 가능한 요소를 두면 안 되므로 tabIndex 도 같이 뺀다.
 *
 * 품절 밴드는 그 숨긴 링크 안에 있어 스크린리더에 닿지 않는다. 이름 옆의 sr-only
 * '(품절)'이 그 상태를 대신 읽어주는 유일한 지점이다(WCAG 1.3.1).
 */
export function ProductCard({
  action,
  badges,
  brand,
  className,
  compareAtPrice,
  href,
  image,
  imageBackground,
  name,
  price,
  soldOut,
}: ProductCardProps) {
  return (
    <article className={`wc-product-card${className ? ` ${className}` : ''}`}>
      <div className="wc-product-card__media">
        <Link aria-hidden className="wc-product-card__media-link" href={href} tabIndex={-1}>
          {image ?? <div className="wc-product-card__image" style={{ background: imageBackground }} />}
          {soldOut ? (
            <div className="wc-product-card__soldout"><span>SOLD OUT</span></div>
          ) : null}
        </Link>
        {action ? <div className="wc-product-card__action">{action}</div> : null}
      </div>
      <div className="wc-product-card__info">
        {badges?.length ? (
          <div className="wc-product-card__badges">
            {badges.map((badge) => <Badge key={badge}>{badge}</Badge>)}
          </div>
        ) : null}
        {brand ? <p className="wc-product-card__brand">{brand}</p> : null}
        <h3 className="wc-product-card__name">
          <Link className="wc-product-card__name-link" href={href}>{name}</Link>
          {soldOut ? <span className="wc-sr-only"> (품절)</span> : null}
        </h3>
        <PriceBlock compareAtPrice={compareAtPrice} price={price} />
      </div>
    </article>
  );
}
