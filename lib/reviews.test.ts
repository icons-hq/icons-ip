import { describe, expect, it } from 'vitest';
import {
  buildReviewUploadPath,
  formatReviewAverage,
  goodReviewsHref,
  MAX_REVIEW_IMAGES,
  newReviewHref,
  normalizeGoodReviewOptions,
  normalizeReviewCreateForm,
  normalizeReviewUpdateForm,
  reviewBodyPreview,
  reviewDaysRemaining,
  reviewDistributionPercent,
  reviewWriteDeadline,
  REVIEW_WINDOW_DAYS,
} from './reviews';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ORDER_ID = '22222222-2222-4222-8222-222222222222';
const REVIEW_ID = '33333333-3333-4333-8333-333333333333';

function imageFile(name: string, type = 'image/jpeg', size = 1024) {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

describe('리뷰 목록 조건', () => {
  it('모르는 정렬값은 최신순으로 접는다', () => {
    expect(normalizeGoodReviewOptions({ reviewSort: 'stars' })).toEqual({
      page: 1,
      photoOnly: false,
      sort: 'recent',
    });
  });

  it('사진 필터와 페이지를 URL에서 읽는다', () => {
    expect(normalizeGoodReviewOptions({
      reviewPage: '4',
      reviewPhoto: '1',
      reviewSort: 'rating_asc',
    })).toEqual({ page: 4, photoOnly: true, sort: 'rating_asc' });
  });

  /* 음수·0·소수 페이지는 오프셋 계산을 깨뜨린다. 조용히 1로 되돌린다. */
  it('쓸 수 없는 페이지 번호는 1로 되돌린다', () => {
    expect(normalizeGoodReviewOptions({ reviewPage: '0' }).page).toBe(1);
    expect(normalizeGoodReviewOptions({ reviewPage: '-2' }).page).toBe(1);
    expect(normalizeGoodReviewOptions({ reviewPage: '1.5' }).page).toBe(1);
  });

  /* 기본 정렬·필터는 URL에서 빼되 reviewPage는 항상 싣는다 — 리뷰 파라미터가 하나도
     없으면 굿즈 상세가 상세정보 탭으로 열려 #reviews 앵커가 숨은 패널을 가리킨다. */
  it('기본 조건에서도 reviewPage를 실어 리뷰 탭에서 열리게 한다', () => {
    expect(goodReviewsHref('g13', { page: 1, photoOnly: false, sort: 'recent' }))
      .toBe('/shop/g13?reviewPage=1#reviews');
    expect(goodReviewsHref('g13')).toBe('/shop/g13?reviewPage=1#reviews');
  });

  it('기본이 아닌 정렬·필터는 쿼리에 함께 싣는다', () => {
    expect(goodReviewsHref('g13', { page: 1, photoOnly: false, sort: 'recent' }, {
      page: 2,
      photoOnly: true,
    })).toBe('/shop/g13?reviewPhoto=1&reviewPage=2#reviews');
  });

  it('0 이하 페이지는 1페이지 링크로 접는다', () => {
    expect(goodReviewsHref('g13', { page: 0, photoOnly: false, sort: 'recent' }))
      .toBe('/shop/g13?reviewPage=1#reviews');
  });

  it('작성 화면 링크는 주문과 굿즈를 함께 싣는다', () => {
    expect(newReviewHref(ORDER_ID, 'g13')).toBe(`/my/reviews/new?orderId=${ORDER_ID}&goodId=g13`);
  });
});

describe('평점 표시', () => {
  /* 4.0을 "4"로 접지 않는다 — 4.0과 4.04는 다른 신호다. */
  it('평균은 소수 한 자리를 유지한다', () => {
    expect(formatReviewAverage(4)).toBe('4.0');
    expect(formatReviewAverage(3.25)).toBe('3.3');
  });

  it('리뷰가 없으면 0.0이다', () => {
    expect(formatReviewAverage(0)).toBe('0.0');
    expect(formatReviewAverage(Number.NaN)).toBe('0.0');
  });

  /* 0으로 나눈 NaN이 style에 흘러들면 막대가 사라지거나 100%로 늘어난다. */
  it('전체가 0건이면 분포 비율은 0이다', () => {
    expect(reviewDistributionPercent(0, 0)).toBe(0);
    expect(reviewDistributionPercent(3, 0)).toBe(0);
  });

  it('분포 비율은 소수 한 자리까지 낸다', () => {
    expect(reviewDistributionPercent(1, 3)).toBe(33.3);
    expect(reviewDistributionPercent(2, 4)).toBe(50);
  });

  it('본문 미리보기는 줄바꿈을 접고 길이를 자른다', () => {
    expect(reviewBodyPreview('첫 줄\n\n둘째 줄')).toBe('첫 줄 둘째 줄');
    expect(reviewBodyPreview('가'.repeat(80), 10)).toBe(`${'가'.repeat(10)}…`);
  });
});

describe('작성 기한', () => {
  it('배송완료 시각 + 90일이 기한이다', () => {
    const deadline = reviewWriteDeadline('2026-01-01T00:00:00.000Z');
    expect(deadline?.toISOString()).toBe('2026-04-01T00:00:00.000Z');
  });

  /* 기산점이 없으면 기한도 없다. 지어내면 90일이 아니라 무기한이 된다. */
  it('배송완료 시각이 없으면 기한도 없다', () => {
    expect(reviewWriteDeadline(null)).toBeNull();
    expect(reviewDaysRemaining(null)).toBeNull();
  });

  /* 3시간 남았을 때 "0일 남음"은 이미 끝났다는 말로 읽힌다. */
  it('남은 시간은 올려서 센다', () => {
    const now = new Date('2026-03-31T21:00:00.000Z');
    expect(reviewDaysRemaining('2026-01-01T00:00:00.000Z', now)).toBe(1);
  });

  it('기한이 지나면 0이다', () => {
    const now = new Date('2026-05-01T00:00:00.000Z');
    expect(reviewDaysRemaining('2026-01-01T00:00:00.000Z', now)).toBe(0);
  });

  it('기한 상수는 90일이다', () => {
    expect(REVIEW_WINDOW_DAYS).toBe(90);
  });
});

describe('첨부 경로', () => {
  /* 커뮤니티 경로를 재사용하면 커뮤니티 글쓰기 스위치가 리뷰 사진까지 잠근다. */
  it('리뷰 전용 접두를 쓴다', () => {
    expect(buildReviewUploadPath({ userId: USER_ID, mimeType: 'image/png', nonce: 'n1' }))
      .toBe(`${USER_ID}/review/n1.png`);
  });

  it('모르는 MIME은 확장자를 지어내지 않는다', () => {
    expect(buildReviewUploadPath({ userId: USER_ID, mimeType: 'image/tiff', nonce: 'n1' }))
      .toBe(`${USER_ID}/review/n1.bin`);
  });
});

describe('작성 폼 정규화', () => {
  function createForm(overrides: Record<string, string> = {}) {
    const formData = new FormData();
    formData.set('orderId', ORDER_ID);
    formData.set('goodId', 'g13');
    formData.set('rating', '5');
    formData.set('body', '마감이 깔끔하고 배송도 빨랐습니다');
    for (const [key, value] of Object.entries(overrides)) formData.set(key, value);
    return formData;
  }

  it('정상 입력을 그대로 통과시킨다', () => {
    const result = normalizeReviewCreateForm(createForm());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.rating).toBe(5);
      expect(result.value.goodId).toBe('g13');
      expect(result.value.images).toEqual([]);
    }
  });

  it('별점이 범위 밖이면 거절한다', () => {
    const result = normalizeReviewCreateForm(createForm({ rating: '6' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.rating).toBeTruthy();
  });

  it('너무 짧은 본문은 거절한다', () => {
    const result = normalizeReviewCreateForm(createForm({ body: '굿' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.body).toBeTruthy();
  });

  /* 주문·굿즈가 없는 제출은 자격 판정 자체가 불가능하다. RPC에 보내기 전에 막는다. */
  it('주문 id 형식이 아니면 거절한다', () => {
    const result = normalizeReviewCreateForm(createForm({ orderId: 'not-a-uuid' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.form).toBeTruthy();
  });

  it('허용 장수를 넘으면 거절한다', () => {
    const formData = createForm();
    for (let index = 0; index <= MAX_REVIEW_IMAGES; index += 1) {
      formData.append('images', imageFile(`p${index}.jpg`));
    }
    const result = normalizeReviewCreateForm(formData);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.images).toBeTruthy();
  });

  it('허용하지 않는 형식은 거절한다', () => {
    const formData = createForm();
    formData.append('images', imageFile('doc.pdf', 'application/pdf'));
    const result = normalizeReviewCreateForm(formData);
    expect(result.ok).toBe(false);
  });
});

describe('수정 폼 정규화', () => {
  function updateForm(overrides: Record<string, string> = {}) {
    const formData = new FormData();
    formData.set('reviewId', REVIEW_ID);
    formData.set('rating', '4');
    formData.set('body', '다시 보니 색감이 사진과 조금 다릅니다');
    for (const [key, value] of Object.entries(overrides)) formData.set(key, value);
    return formData;
  }

  it('유지할 기존 사진 경로를 그대로 돌려준다', () => {
    const formData = updateForm();
    formData.append('keepImagePaths', `${USER_ID}/review/${REVIEW_ID}.jpg`);
    const result = normalizeReviewUpdateForm(formData);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.keptImagePaths).toHaveLength(1);
  });

  /* 클라이언트가 보낸 문자열을 그대로 DB에 넘기면 남의 폴더 경로가 섞일 수 있다.
     소유 검증은 DB가 한 번 더 하지만, 형식이 아닌 값은 여기서 버린다. */
  it('형식이 아닌 사진 경로는 조용히 버린다', () => {
    const formData = updateForm();
    formData.append('keepImagePaths', '../../etc/passwd');
    formData.append('keepImagePaths', `${USER_ID}/community/${REVIEW_ID}.jpg`);
    const result = normalizeReviewUpdateForm(formData);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.keptImagePaths).toEqual([]);
  });

  /* 유지한 사진과 새 사진의 합이 상한이다 — 새 사진만 세면 상한을 우회할 수 있다. */
  it('유지한 사진과 새 사진의 합으로 장수를 센다', () => {
    const formData = updateForm();
    for (let index = 0; index < MAX_REVIEW_IMAGES; index += 1) {
      formData.append('keepImagePaths', `${USER_ID}/review/3333333${index}-3333-4333-8333-333333333333.jpg`);
    }
    formData.append('images', imageFile('new.jpg'));

    const result = normalizeReviewUpdateForm(formData);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.images).toBeTruthy();
  });
});
