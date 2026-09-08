/*
 * 이미지 권장 규격 (현업 슬라이스 5 · 「아트워크 권장 이미지 가이드」).
 *
 * **막지 않고 경고한다.** 규격은 보기 좋게 만들기 위한 것이지 옳고 그름이 아니다 —
 * 막으면 급할 때 올릴 방법이 없어지고, 그러면 사람들은 어드민 밖에서 처리한다.
 *
 * 판정은 순수 함수로 둔다. 화면에서 즉석 계산하면 문구가 자리마다 달라지고, 무엇을
 * 경고하는지 아무도 한 곳에서 확인할 수 없다.
 */

export interface ArtworkSizeGuide {
  width: number;
  /** 비우면 「높이는 자유」 — 상세 이미지처럼 길이가 정해지지 않은 자리다. */
  height?: number;
}

export interface ArtworkSize {
  width: number;
  height: number;
}

/** 비율 어긋남을 이 이상 봐준다. 1000×1000 에 1000×1004 를 경고하면 경고가 소음이 된다. */
const RATIO_TOLERANCE = 0.02;

function px(value: number) {
  return value.toLocaleString('ko-KR');
}

export function artworkGuideLabel(guide: ArtworkSizeGuide): string {
  return guide.height
    ? `권장 ${px(guide.width)}×${px(guide.height)}px`
    : `권장 가로 ${px(guide.width)}px (세로 자유)`;
}

/**
 * 올린 이미지가 권장과 다를 때 알려 줄 한 줄. 문제가 없으면 `null`.
 *
 * 비율과 크기를 **함께** 본다 — 비율만 보면 200×200 짜리가 통과하고, 크기만 보면
 * 3000×500 이 통과한다.
 */
export function artworkSizeWarning(
  guide: ArtworkSizeGuide,
  actual: ArtworkSize,
): string | null {
  if (!Number.isFinite(actual.width) || !Number.isFinite(actual.height)) return null;
  if (actual.width <= 0 || actual.height <= 0) return null;

  const notes: string[] = [];

  if (guide.height) {
    const wanted = guide.width / guide.height;
    const got = actual.width / actual.height;
    if (Math.abs(got - wanted) / wanted > RATIO_TOLERANCE) {
      notes.push(`권장 비율(${px(guide.width)}:${px(guide.height)})과 다릅니다`);
    }
  }

  const tooSmall = actual.width < guide.width
    || (guide.height !== undefined && actual.height < guide.height);
  if (tooSmall) {
    notes.push(`권장 크기보다 작습니다(${px(actual.width)}×${px(actual.height)}px)`);
  }

  if (notes.length === 0) return null;
  return `${notes.join(' · ')} — 그대로 올릴 수 있지만 화면에서 흐리거나 잘려 보일 수 있습니다.`;
}
