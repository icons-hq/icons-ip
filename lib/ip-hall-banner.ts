/*
 * IP관 PC/MO 배너(11 IP-06 · LFS 패리티 2차 L8b).
 *
 * `ips.hall_banner_image_path`(PC)·`hall_banner_mobile_image_path`(모바일)는 둘 다 선택이고 정본은 Storage 키다
 * (`public-media/catalog/ip/<uuid>.(jpg|png|webp)` — DB ips_hall_banner_*_check 와 같은 형식, `/generated` 정적 경로 금지).
 * 폭마다 고른다: 모바일(<750px)은 모바일 배너 → PC 배너 → 키아트(ip.bg), 데스크톱은 PC 배너 → 키아트.
 * 둘 다 없으면 null 이고 화면은 지금처럼 키아트 배경이다.
 */

export const IP_HALL_BANNER_IMAGE_PATTERN =
  /^public-media\/catalog\/ip\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$/;

export interface IpHallBanner {
  /** 데스크톱(≥750px) 배너. 없으면 데스크톱은 키아트다. */
  imageUrl: string | null;
  /** 모바일(<750px) 배너. 없으면 모바일은 PC 배너, 그것도 없으면 키아트다. */
  mobileImageUrl: string | null;
}

export interface IpHallBannerRow {
  hall_banner_image_path: string | null;
  hall_banner_mobile_image_path: string | null;
}

export function isIpHallBannerImagePath(value: unknown): value is string {
  return typeof value === 'string' && IP_HALL_BANNER_IMAGE_PATTERN.test(value);
}

/** 행 → 배너. 형식이 어긋난 칸은 없는 것으로 본다(그 폭은 키아트로 돌아간다). */
export function parseIpHallBanner(row: IpHallBannerRow | null | undefined, publicUrlFor: (path: string) => string): IpHallBanner | null {
  if (!row) return null;
  const imageUrl = isIpHallBannerImagePath(row.hall_banner_image_path) ? publicUrlFor(row.hall_banner_image_path) : null;
  const mobileImageUrl = isIpHallBannerImagePath(row.hall_banner_mobile_image_path) ? publicUrlFor(row.hall_banner_mobile_image_path) : null;
  return imageUrl || mobileImageUrl ? { imageUrl, mobileImageUrl } : null;
}

/** 데스크톱에 키아트를 남길 때 모바일 전용 그림이 데스크톱에서 내려받히지 않게 넣는 1×1 투명 GIF(네트워크 요청 없음). */
export const IP_HALL_BANNER_EMPTY_SOURCE = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
