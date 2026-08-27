import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Slider } from './Slider';

describe('Slider', () => {
  /* 스크롤 스냅 캐러셀은 역할이 없는 div 묶음이라, 이 두 속성이 없으면 스크린리더에서
     그냥 문단 더미로 읽힌다. */
  it('announces itself as a labelled carousel', () => {
    const html = renderToStaticMarkup(
      <Slider label="추천 굿즈">
        <div>a</div>
        <div>b</div>
        <div>c</div>
      </Slider>,
    );

    expect(html).toContain('aria-roledescription="carousel"');
    expect(html).toContain('aria-label="추천 굿즈"');
    expect(html).toContain('class="wc-slider__track"');
  });

  /* 마운트 전에는 DOM 을 잴 수 없다. SSR 초기 fraction 은 자식 수로 채워야
     하이드레이션 직전까지 `1 / 0` 같은 빈 값이 보이지 않는다. */
  it('renders the fraction from the child count before hydration', () => {
    const html = renderToStaticMarkup(
      <Slider label="추천 굿즈">
        <div>a</div>
        <div>b</div>
        <div>c</div>
      </Slider>,
    );

    expect(html).toContain('1 / 3');
    expect(html).toContain('aria-label="이전"');
    expect(html).toContain('aria-label="다음"');
  });

  it('drops the controls when there is nothing to scroll to', () => {
    const html = renderToStaticMarkup(
      <Slider label="추천 굿즈"><div>a</div></Slider>,
    );

    expect(html).not.toContain('wc-slider__controls');
    expect(html).not.toContain('aria-label="다음"');
  });

  it('drops the controls when they are turned off', () => {
    const html = renderToStaticMarkup(
      <Slider label="추천 굿즈" showControls={false}>
        <div>a</div>
        <div>b</div>
      </Slider>,
    );

    expect(html).not.toContain('wc-slider__controls');
  });

  /* 첫 슬라이드에서는 이전 화살표가 갈 곳이 없다. */
  it('disables the previous arrow at the first slide', () => {
    const html = renderToStaticMarkup(
      <Slider label="추천 굿즈">
        <div>a</div>
        <div>b</div>
      </Slider>,
    );

    const prev = html.match(/<button\b[^>]*aria-label="이전"[^>]*>/)?.[0] ?? '';
    const next = html.match(/<button\b[^>]*aria-label="다음"[^>]*>/)?.[0] ?? '';
    expect(prev).toContain('disabled');
    expect(next).not.toContain('disabled');
  });
});
