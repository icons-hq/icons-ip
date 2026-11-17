import Link from 'next/link';
import type { CSSProperties } from 'react';

export interface StripBannerImageSize {
  width: number;
  height: number;
}

export interface StripBannerProps {
  imageUrl: string;
  mobileImageUrl?: string | null;
  alt: string;
  href?: string | null;
  /** home = 1272×170, page = 1272×340(데스크톱 비율). */
  size: 'home' | 'page';
  imageSize?: StripBannerImageSize | null;
  mobileImageSize?: StripBannerImageSize | null;
}

function validSize(size: StripBannerImageSize | null | undefined): size is StripBannerImageSize {
  return !!size && Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0 && size.height > 0;
}

/*
 * 스트립 배너 한 장 (X SQUARE 공용 부품 계약 §8).
 *
 * 데스크톱은 고정 비율(home 1272:170, page 1272:340)에 cover 로 채운다. 모바일(750 미만)에 별도 이미지가 있으면 그 이미지의
 * 고유 비율을 따르고(`<source>`의 width·height 와 `--wc-strip-mobile-ratio`로 로딩 전에도 자리를 잡는다), 없으면 데스크톱
 * 이미지를 같은 비율로 줄인다. 넓은 컨테이너 안에 놓는 것은 소비 화면 몫이다.
 * 여러 장을 넘기는 슬라이더는 이 부품이 아니라 캠페인 배너 부품의 일이다.
 */
export function StripBanner({ alt, href, imageSize, imageUrl, mobileImageSize, mobileImageUrl, size }: StripBannerProps) {
  const mobile = mobileImageUrl || null;
  const mobileSize = mobile && validSize(mobileImageSize) ? mobileImageSize : null;
  const desktopSize = validSize(imageSize) ? imageSize : null;
  const picture = (
    <picture>
      {mobile ? <source height={mobileSize?.height} media="(max-width: 749px)" srcSet={mobile} width={mobileSize?.width} /> : null}
      <img alt={alt} className="wc-strip-banner__img" height={desktopSize?.height} src={imageUrl} width={desktopSize?.width} />
    </picture>
  );
  const style = mobileSize ? ({ '--wc-strip-mobile-ratio': `${mobileSize.width} / ${mobileSize.height}` } as CSSProperties) : undefined;
  return (
    <div className="wc-strip-banner" data-mobile={mobile ? 'true' : undefined} data-size={size} style={style}>
      {href ? <Link className="wc-strip-banner__link" href={href}>{picture}</Link> : picture}
    </div>
  );
}
