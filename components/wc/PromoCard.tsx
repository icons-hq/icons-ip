import Link from 'next/link';
import { preload } from 'react-dom';
import { imageUrlFromBg } from '@/lib/media';

export interface PromoCardProps {
  href: string;
  /** CSS background 값 — `lib/media`의 `imageBg(url)` 결과(또는 그라데이션). null 이면 회색 면이다. */
  imageBg: string | null;
  title: string;
  /** 제목 아래 한 줄(POP-UP 의 방식·장소·기간). 없으면 그리지 않는다. */
  meta?: string;
  /** 왼쪽 위 배지("오픈 예정"). 없으면 그리지 않는다. */
  badge?: string;
  /** 첫 화면에 보이는 카드 — 배경 이미지를 우선 내려받게 미리 불러 둔다(CSS 배경이라 `loading` 속성이 없다). */
  priority?: boolean;
  /** 루트 링크에 더하는 클래스(묶음 안에서 모서리 조정 등). */
  className?: string;
}

/*
 * 프로모션 카드 (Figma 408×260 · radius 8 · 아래 150px 그라데이션 위에 흰 제목 20 Bold 최대 2줄).
 * POP-UP·EVENT 목록과 홈 ICONS PICK 이 같은 모양을 쓴다(공용 부품 계약 §9) — 스타일은 `wc-popups.css`의 `.wc-promo-card`.
 *
 * 카드 전체가 링크 하나다. 제목은 h3 이다: 이 카드가 놓이는 곳(EVENT·POP-UP 의 h1, 홈의 섹션 h2) 바로 아래 단계이고,
 * 링크 이름이 제목으로 채워진다. 배경 이미지는 장식이라 접근성 트리에서 뺀다.
 */
export function PromoCard({ badge, className, href, imageBg, meta, priority = false, title }: PromoCardProps) {
  if (priority) {
    const url = imageUrlFromBg(imageBg);
    if (url) preload(url, { as: 'image', fetchPriority: 'high' });
  }

  return (
    <Link className={`wc-promo-card${className ? ` ${className}` : ''}`} href={href}>
      <div aria-hidden className="wc-promo-card__art" style={imageBg ? { background: imageBg } : undefined} />
      {badge ? <span className="wc-promo-card__badge">{badge}</span> : null}
      <div className="wc-promo-card__body">
        <h3 className="wc-promo-card__title">{title}</h3>
        {meta ? <p className="wc-promo-card__meta">{meta}</p> : null}
      </div>
    </Link>
  );
}
