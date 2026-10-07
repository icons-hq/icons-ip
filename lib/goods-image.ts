/*
 * 굿즈 대표·추가 이미지는 1:1 프레임 안에 원본 비율 그대로, 잘리지 않게 그린다
 * (2026-10-07 MD 요청 — 웹팀 썸네일 1000×1000 원본 유지). 1000×1000 원본은 프레임을
 * 꽉 채우고, 정사각이 아닌 기존 이미지는 가운데에 놓여 프레임의 중립 배경이 남는다.
 *
 * 카탈로그의 굿즈 `img`·갤러리 값은 `imageBg`가 만든 `url("…") center / cover no-repeat`
 * 축약값이다(뒤에 gradient 레이어가 붙기도 한다). 인라인 축약값의 크기는 CSS로 덮을 수 없어
 * 굿즈를 그리는 지점에서 url() 밖의 `/ cover`만 `/ contain`으로 바꾼다. 데이터는 그대로라
 * IP 배너·카드 아트·이벤트 포스터처럼 같은 축약값을 쓰는 다른 이미지에는 영향이 없다.
 */
const URL_OR_COVER = /url\(\s*(?:"[^"]*"|'[^']*'|[^)]*)\)|\/\s*cover\b/g;
/* 인라인 축약값은 요소의 배경색도 지운다. 이미지가 남긴 여백이 놓인 자리(장바구니·썸네일)마다
   흰 지면이 드러나지 않게 마지막 레이어로 프레임의 중립 배경을 깐다. `.wc-root` 밖에서도
   선언 전체가 무효가 되지 않도록 대체값을 둔다. */
const NEUTRAL_LAYER = 'var(--wc-surface-grey-2, transparent)';

export function goodsImageBackground(background: string | null | undefined): string | undefined {
  if (!background) return undefined;
  let hasImage = false;
  const contained = background.replace(URL_OR_COVER, (token) => {
    if (!token.startsWith('url(')) return '/ contain';
    hasImage = true;
    return token;
  });
  return hasImage ? `${contained}, ${NEUTRAL_LAYER}` : contained;
}
