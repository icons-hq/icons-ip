import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  CAMPAIGN_BANNER_AUTOPLAY_MS,
  CampaignBannerSlider,
  hasCampaignBannerAutoplayControl,
  isCampaignBannerPlaying,
  nextCampaignBannerIndex,
  type CampaignBannerPlayback,
} from './CampaignBannerSlider';

const playable: CampaignBannerPlayback = {
  current: 0,
  focusWithin: false,
  hidden: false,
  hovered: false,
  paused: false,
  reducedMotion: false,
  slideCount: 3,
};

describe('이벤트 허브 배너 자동 넘김 규칙 (11 §6 B21)', () => {
  it('5초마다 넘긴다', () => {
    expect(CAMPAIGN_BANNER_AUTOPLAY_MS).toBe(5000);
  });

  /* 레퍼런스 배너는 loop 하지 않는다 — 마지막 장 다음은 없다. */
  it('마지막 장에서 멈추고 처음으로 되감지 않는다', () => {
    expect(nextCampaignBannerIndex(0, 3)).toBe(1);
    expect(nextCampaignBannerIndex(1, 3)).toBe(2);
    expect(nextCampaignBannerIndex(2, 3)).toBeNull();
    expect(nextCampaignBannerIndex(0, 1)).toBeNull();
    expect(nextCampaignBannerIndex(0, 0)).toBeNull();
  });

  it('막을 이유가 없고 다음 장이 있을 때만 돈다', () => {
    expect(isCampaignBannerPlaying(playable)).toBe(true);
    expect(isCampaignBannerPlaying({ ...playable, current: 2 })).toBe(false);
    expect(isCampaignBannerPlaying({ ...playable, slideCount: 1 })).toBe(false);
  });

  /* DESIGN §5·§10 — hover·포커스·조작(정지 상태)·문서 비활성·모션 축소는 각각 독립적으로 멈춘다. */
  it.each([
    ['hovered'],
    ['focusWithin'],
    ['paused'],
    ['hidden'],
    ['reducedMotion'],
  ] as const)('%s 이면 자동 넘김을 멈춘다', (reason) => {
    expect(isCampaignBannerPlaying({ ...playable, [reason]: true })).toBe(false);
  });

  /* 누를 일이 없는 정지 버튼을 남기지 않는다 — 모션 축소면 처음부터 돌지 않고, 끝에 닿으면 더 갈 곳이 없다. */
  it('자동 넘김이 남아 있을 때만 정지 버튼을 둔다', () => {
    expect(hasCampaignBannerAutoplayControl({ current: 0, reducedMotion: false, slideCount: 3 })).toBe(true);
    expect(hasCampaignBannerAutoplayControl({ current: 2, reducedMotion: false, slideCount: 3 })).toBe(false);
    expect(hasCampaignBannerAutoplayControl({ current: 0, reducedMotion: true, slideCount: 3 })).toBe(false);
    expect(hasCampaignBannerAutoplayControl({ current: 0, reducedMotion: false, slideCount: 1 })).toBe(false);
  });
});

describe('CampaignBannerSlider 마크업', () => {
  it('라벨이 붙은 캐러셀이고 슬라이드마다 위치를 읽어 준다', () => {
    const html = renderToStaticMarkup(
      <CampaignBannerSlider label="추천 캠페인">
        <span className="slide">A</span>
        <span className="slide">B</span>
      </CampaignBannerSlider>,
    );

    expect(html).toContain('aria-roledescription="carousel"');
    expect(html).toContain('aria-label="추천 캠페인"');
    expect(html.match(/aria-roledescription="slide"/g)).toHaveLength(2);
    expect(html).toContain('aria-label="1 / 2"');
    expect(html).toContain('aria-label="2 / 2"');
    expect(html).toContain('class="wc-slider__track wc-campaign-banners__track"');
  });

  /* 첫 장에서 시작한다 — 이전은 비활성, 다음은 활성(loop 없음). 정지 버튼은 재생 중 상태다. */
  it('첫 장 기준의 화살표·위치·정지 버튼을 낸다', () => {
    const html = renderToStaticMarkup(
      <CampaignBannerSlider label="추천 캠페인">
        <span className="slide">A</span>
        <span className="slide">B</span>
        <span className="slide">C</span>
      </CampaignBannerSlider>,
    );

    expect(html).toMatch(/<button[^>]*aria-label="이전 배너"[^>]*disabled=""/);
    expect(html).toMatch(/<button[^>]*aria-label="다음 배너"(?![^>]*disabled)[^>]*>/);
    expect(html).toContain('1 / 3</span>');
    expect(html).toContain('aria-label="자동 넘김 일시정지"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('aria-live="off"');
  });

  it('한 장뿐이면 넘길 것이 없어 컨트롤을 두지 않는다', () => {
    const html = renderToStaticMarkup(
      <CampaignBannerSlider label="추천 캠페인">
        <span className="slide">A</span>
      </CampaignBannerSlider>,
    );

    expect(html).not.toContain('wc-campaign-banners__arrow');
    expect(html).not.toContain('wc-campaign-banners__pause');
    expect(html).not.toContain('wc-campaign-banners__status');
  });
});
