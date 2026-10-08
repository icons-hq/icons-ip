/*
 * 굿즈 대표·추가 이미지는 1:1 프레임 안에 원본 비율 그대로, 잘리지 않게 그린다
 * (2026-10-07 MD 요청 — 웹팀 썸네일 1000×1000 원본 유지). 1000×1000 원본은 프레임을
 * 꽉 채우고, 정사각이 아닌 기존 이미지는 가운데에 놓여 프레임의 중립 배경이 남는다.
 *
 * 카탈로그의 굿즈 `img`·갤러리 값은 `imageBg`가 만든 `url("…") center / cover no-repeat`
 * 축약값이다. 기존 카탈로그 굿즈는 그 뒤에 이미지가 없을 때를 위한 gradient 레이어가 붙는다.
 * 인라인 축약값의 크기는 CSS로 덮을 수 없어 굿즈를 그리는 지점에서 첫 이미지 레이어만 남기고
 * url() 밖의 `/ cover`를 `/ contain`으로 바꾼다. 대체 gradient를 남기면 contain 여백을 원색
 * 띠가 덮어 업로드 이미지(중립 여백)와 여백 색이 갈린다. 데이터는 그대로라 IP 배너·카드 아트·
 * 이벤트 포스터처럼 같은 축약값을 쓰는 다른 이미지에는 영향이 없다.
 */
const URL_OR_COVER = /url\(\s*(?:"[^"]*"|'[^']*'|[^)]*)\)|\/\s*cover\b/g;
const IMAGE_LAYER = /(?:^|[\s,(])url\(/i;
/* 인라인 축약값은 요소의 배경색도 지운다. 이미지가 남긴 여백이 놓인 자리(장바구니·썸네일)마다
   흰 지면이 드러나지 않게 마지막 레이어로 프레임의 중립 배경을 깐다. `.wc-root` 밖에서도
   선언 전체가 무효가 되지 않도록 대체값을 둔다. */
const NEUTRAL_LAYER = 'var(--wc-surface-grey-2, transparent)';

/* background 축약값을 최상위 쉼표로 레이어마다 나눈다. 괄호(url·gradient·rgba)와 따옴표 안 쉼표는 경계가 아니다. */
function backgroundLayers(value: string): string[] {
  const layers: string[] = [];
  let depth = 0;
  let quote: '"' | "'" | null = null;
  let start = 0;
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (quote) {
      if (char === '\\') index++;
      else if (char === quote) quote = null;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '(') depth++;
    else if (char === ')') depth = Math.max(0, depth - 1);
    else if (char === ',' && depth === 0) {
      layers.push(value.slice(start, index));
      start = index + 1;
    }
  }
  layers.push(value.slice(start));
  return layers.map((layer) => layer.trim()).filter(Boolean);
}

export function goodsImageBackground(background: string | null | undefined): string | undefined {
  if (!background) return undefined;
  const imageLayer = backgroundLayers(background).find((layer) => IMAGE_LAYER.test(layer));
  /* 이미지가 없는 gradient 값은 대체 아트 그대로다. */
  if (!imageLayer) return background;
  const contained = imageLayer.replace(URL_OR_COVER, (token) => (token.startsWith('url(') ? token : '/ contain'));
  return `${contained}, ${NEUTRAL_LAYER}`;
}
