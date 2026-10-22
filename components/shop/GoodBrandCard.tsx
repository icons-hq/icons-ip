import Link from 'next/link';
import type { Ip } from '@/lib/data';
import { publicIpHref } from '@/lib/ip-identity';

/**
 * IP 키아트가 이미지면 그 CSS 배경값, gradient·단색뿐이면 null.
 * 카탈로그의 IP `bg`는 이미지가 있으면 `url("…") center / cover` 축약값이다(lib/catalog backgroundFor).
 * 이미지가 없을 때 대체 gradient 를 칩에 깔면 IP 정체성 없는 색 띠가 되므로 글자만 둔다.
 */
export function ipArtBackground(ip: Pick<Ip, 'bg'>): string | null {
  return /(?:^|[\s,(])url\(/i.test(ip.bg) ? ip.bg : null;
}

/*
 * 브랜드(IP) 칩 카드 (PD-09 · R-04 §3.9).
 *
 * 446×82 카드 — 왼쪽 IP 키아트 150×80(없으면 글자만) + IP 이름 + '브랜드 보러가기 ›'.
 * 카드 전체가 하나의 링크라 접근 이름은 "IP 이름 브랜드 보러가기"다. 정보 칼럼 맨 아래와
 * 상세 설명 패널 끝(PD-19)이 같은 카드를 쓴다.
 */
export function GoodBrandCard({ className, ip }: { className?: string; ip: Ip }) {
  const art = ipArtBackground(ip);

  return (
    <Link className={`wc-pdp-brand${art ? '' : ' is-text'}${className ? ` ${className}` : ''}`} href={publicIpHref(ip)}>
      {art ? <span aria-hidden="true" className="wc-pdp-brand__art" style={{ background: art }} /> : null}
      <span className="wc-pdp-brand__text">
        <strong className="wc-pdp-brand__name">{ip.title}</strong>
        <span className="wc-pdp-brand__link">
          브랜드 보러가기 <span aria-hidden="true">›</span>
        </span>
      </span>
    </Link>
  );
}

/*
 * 상세 설명 패널의 IP 소개 (PD-19 · R-04 §5.3 ③).
 *
 * 상세 이미지 다음에 IP 키아트·이름·한 줄 소개·시놉시스를 둔다. 데이터는 IP 에 이미 있는
 * 값만 쓴다 — 소개 문장도 키아트도 없으면 이름만 덩그러니 남은 빈 블록이 되므로 그리지 않는다.
 * 키아트 비율은 온라인 팝업 IP관 배너(1440×540)와 같은 8:3 이라 같은 크롭으로 보인다.
 */
export function GoodIpStory({ ip }: { ip: Ip }) {
  const art = ipArtBackground(ip);
  const tagline = ip.tagline.trim();
  const synopsis = ip.synopsis.trim();
  if (!art && !tagline && !synopsis) return null;

  return (
    <section aria-labelledby="pdp-ip-story-heading" className="wc-pdp-ip-story">
      <h2 className="wc-pdp-panel__title" id="pdp-ip-story-heading">IP 소개</h2>
      {art ? <div aria-hidden="true" className="wc-pdp-ip-story__art" style={{ background: art }} /> : null}
      <h3 className="wc-pdp-ip-story__name">{ip.title}</h3>
      {ip.sub.trim() ? <p className="wc-pdp-ip-story__sub">{ip.sub}</p> : null}
      {tagline ? <p className="wc-pdp-ip-story__tagline">{tagline}</p> : null}
      {synopsis ? <p className="wc-pdp-ip-story__synopsis">{synopsis}</p> : null}
    </section>
  );
}
