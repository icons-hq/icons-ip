import Link from 'next/link';
import { Badge } from '@/components/wc/Badge';

export interface ContentCardProps {
  href: string;
  title: string;
  badge?: string | null;
  description?: string | null;
  imageBg?: string;
  className?: string;
}

/*
 * 상품 카드와 다른 anatomy 다(R-스펙 02 §2 ②). 1:1 썸네일 → 배지 → 타이틀 → 설명 순서로,
 * 배지가 이미지 위 오버레이가 아니라 텍스트 영역 첫 줄에 온다.
 *
 * 카드 전체가 링크 하나다. ProductCard 와 달리 안에 위시 하트 같은 별도 액션이 없어
 * 링크를 두 개로 쪼갤 이유가 없고, 링크 안에 타이틀 텍스트가 있어 접근 가능한 이름도 채워진다.
 * 썸네일은 읽을 것이 없는 장식이라 접근성 트리에서 뺀다.
 */
export function ContentCard({ badge, className, description, href, imageBg, title }: ContentCardProps) {
  return (
    <article className={`wc-content-card${className ? ` ${className}` : ''}`}>
      <Link className="wc-content-card__link" href={href}>
        <div aria-hidden className="wc-content-card__media" style={{ background: imageBg }} />
        <div className="wc-content-card__info">
          {badge ? <Badge>{badge}</Badge> : null}
          <h3 className="wc-content-card__title">{title}</h3>
          {description ? <p className="wc-content-card__desc">{description}</p> : null}
        </div>
      </Link>
    </article>
  );
}
