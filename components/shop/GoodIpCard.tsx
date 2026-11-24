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
 * IP 카드 (PD-09 · R-04 §3.9 — 레퍼런스의 브랜드 칩 자리).
 *
 * 446×82 카드 — 왼쪽 IP 키아트 150×80(없으면 글자만) + IP 이름 + '굿즈 전체보기 ›'(IP는 '브랜드'라 부르지 않는다 — CONTEXT.md).
 * 링크는 IP관(그 IP의 굿즈 전체)으로 가므로 문구도 목적지에 맞춘다(MD-0052, 2026-11-23 — 옛 문구 '온라인 팝업 보러가기').
 * 요청 원문은 '상품 전체보기'지만 공개 화면 어휘(CONTEXT.md 굿즈, lib/vocabulary-contract.test.ts)에 맞춰 '굿즈'로 쓴다(MD-0037 '총 굿즈 금액' 선례).
 * 카드 전체가 하나의 링크라 접근 이름은 "IP 이름 굿즈 전체보기"다. 정보 칼럼 맨 아래에 둔다
 * (상세 설명 패널 끝의 같은 카드는 MD-0054로 지웠다).
 */
export function GoodIpCard({ className, ip }: { className?: string; ip: Ip }) {
  const art = ipArtBackground(ip);

  return (
    <Link className={`wc-pdp-ipcard${art ? '' : ' is-text'}${className ? ` ${className}` : ''}`} href={publicIpHref(ip)}>
      {art ? <span aria-hidden="true" className="wc-pdp-ipcard__art" style={{ background: art }} /> : null}
      <span className="wc-pdp-ipcard__text">
        <strong className="wc-pdp-ipcard__name">{ip.title}</strong>
        <span className="wc-pdp-ipcard__link">
          굿즈 전체보기 <span aria-hidden="true">›</span>
        </span>
      </span>
    </Link>
  );
}
