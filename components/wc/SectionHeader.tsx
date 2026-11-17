import Link from 'next/link';

export interface SectionHeaderProps {
  /** 제목 요소의 id. 섹션이 `aria-labelledby`로 가리킨다. */
  id: string;
  title: string;
  as?: 'h1' | 'h2' | 'h3';
  /** 없거나 null이면 알약 링크를 그리지 않는다. */
  moreHref?: string | null;
  moreLabel?: string;
  className?: string;
}

/*
 * 섹션 제목 + 전체보기 알약 (X SQUARE 공용 부품 계약 §5).
 *
 * 알약의 접근 이름은 '<제목> 전체보기'다 — 한 화면에 알약이 여러 개라 이름이 모두 '전체보기'면 링크 목록에서 구분되지
 * 않고, 보이는 글('전체보기')을 이름 안에 포함하므로 음성 제어도 맞는다(WCAG 2.5.3).
 */
export function SectionHeader({ as: Heading = 'h2', className, id, moreHref, moreLabel = '전체보기', title }: SectionHeaderProps) {
  return (
    <header className={`wc-x-sechead${className ? ` ${className}` : ''}`}>
      <Heading className="wc-x-sechead__title" id={id}>{title}</Heading>
      {moreHref ? <Link aria-label={`${title} ${moreLabel}`} className="wc-x-pill" href={moreHref}>{moreLabel}</Link> : null}
    </header>
  );
}
