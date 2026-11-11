import { describe, expect, it } from 'vitest';
import { isIpHallBannerImagePath, parseIpHallBanner } from './ip-hall-banner';

const PC = 'public-media/catalog/ip/97510000-0000-4000-8000-000000000001.webp';
const MO = 'public-media/catalog/ip/97510000-0000-4000-8000-000000000002.png';
const url = (path: string) => `https://cdn.test/${path}`;

describe('IP관 PC/MO 배너 (11 IP-06)', () => {
  it('Storage 의 IP 아트워크 키만 배너 경로로 받는다', () => {
    expect(isIpHallBannerImagePath(PC)).toBe(true);
    expect(isIpHallBannerImagePath(MO)).toBe(true);
    for (const path of ['/generated/ip/banner.webp', 'public-media/catalog/curation/97510000-0000-4000-8000-000000000001.webp', `${PC}?v=1`, '', null]) {
      expect(isIpHallBannerImagePath(path)).toBe(false);
    }
  });

  it('두 칸 모두 비면 배너가 없다(키아트 그대로)', () => {
    expect(parseIpHallBanner(null, url)).toBeNull();
    expect(parseIpHallBanner({ hall_banner_image_path: null, hall_banner_mobile_image_path: null }, url)).toBeNull();
    expect(parseIpHallBanner({ hall_banner_image_path: '/generated/x.webp', hall_banner_mobile_image_path: null }, url)).toBeNull();
  });

  it('있는 칸만 공개 URL 로 바꾸고 형식이 어긋난 칸은 없는 것으로 본다', () => {
    expect(parseIpHallBanner({ hall_banner_image_path: PC, hall_banner_mobile_image_path: MO }, url))
      .toEqual({ imageUrl: `https://cdn.test/${PC}`, mobileImageUrl: `https://cdn.test/${MO}` });
    expect(parseIpHallBanner({ hall_banner_image_path: '/generated/x.webp', hall_banner_mobile_image_path: MO }, url))
      .toEqual({ imageUrl: null, mobileImageUrl: `https://cdn.test/${MO}` });
  });
});
