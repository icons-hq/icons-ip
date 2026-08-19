import { describe, expect, it } from 'vitest';
import {
  buildInquiryUploadPath,
  INQUIRY_CATEGORY_IDS,
  inquiryCategoryLabel,
  inquiryElapsedLabel,
  inquiryFirstReplyDueAt,
  inquiryReferenceLabel,
  inquirySlaState,
  isInquiryCategory,
  MAX_INQUIRY_IMAGES,
  newInquiryHref,
  normalizeInquiryForm,
  normalizeInquiryReplyForm,
} from './inquiries';

const INQUIRY_ID = '11111111-1111-4111-8111-111111111111';
const ORDER_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';

function imageFile(name = 'shot.png', type = 'image/png', size = 1024) {
  const file = new File([new Uint8Array(size)], name, { type });
  return file;
}

function form(entries: Record<string, string>, images: File[] = []) {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  for (const image of images) data.append('images', image);
  return data;
}

describe('문의 카테고리', () => {
  it('DB CHECK와 같은 5종을 노출한다', () => {
    expect(INQUIRY_CATEGORY_IDS).toEqual(['order', 'claim', 'good', 'account', 'etc']);
  });

  it('모르는 값은 기타로 접어 목록에서 행이 사라지지 않게 한다', () => {
    expect(isInquiryCategory('refund')).toBe(false);
    expect(inquiryCategoryLabel('refund')).toBe('기타');
    expect(inquiryCategoryLabel('claim')).toBe('취소/반품/교환');
  });
});

describe('접수 폼 정규화', () => {
  it('유형·제목·본문이 갖춰지면 값을 돌려준다', () => {
    const result = normalizeInquiryForm(form({
      body: '  배송이 언제 시작되나요  ',
      category: 'order',
      orderId: ORDER_ID.toUpperCase(),
      title: '  배송 문의  ',
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.title).toBe('배송 문의');
    expect(result.value.body).toBe('배송이 언제 시작되나요');
    expect(result.value.orderId).toBe(ORDER_ID);
  });

  it('빈 제목·본문과 모르는 유형을 각각 알린다', () => {
    const result = normalizeInquiryForm(form({ body: ' ', category: 'refund', title: '' }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.category).toBeTruthy();
    expect(result.errors.title).toBeTruthy();
    expect(result.errors.body).toBeTruthy();
  });

  /* 형식이 아닌 주문 id를 그대로 실어 보내면 RPC가 거절해 폼 전체가 실패한다. */
  it('형식을 벗어난 주문 id는 연결하지 않고 버린다', () => {
    const result = normalizeInquiryForm(form({
      body: '내용',
      category: 'order',
      orderId: 'not-a-uuid',
      title: '제목',
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.orderId).toBeNull();
  });

  it(`첨부는 ${MAX_INQUIRY_IMAGES}장과 허용 형식까지만 받는다`, () => {
    const tooMany = normalizeInquiryForm(
      form({ body: '내용', category: 'etc', title: '제목' }),
      );
    expect(tooMany.ok).toBe(true);

    const badType = normalizeInquiryForm(
      form({ body: '내용', category: 'etc', title: '제목' }, [imageFile('a.pdf', 'application/pdf')]),
    );
    expect(badType.ok).toBe(false);
    if (badType.ok) return;
    expect(badType.errors.images).toBeTruthy();

    const overCount = normalizeInquiryForm(
      form({ body: '내용', category: 'etc', title: '제목' }, [
        imageFile('a.png'), imageFile('b.png'), imageFile('c.png'), imageFile('d.png'),
      ]),
    );
    expect(overCount.ok).toBe(false);
  });
});

describe('추가 문의 폼', () => {
  it('문의 id가 없으면 저장하지 않는다', () => {
    const result = normalizeInquiryReplyForm(form({ body: '추가 질문', inquiryId: '' }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.form).toBeTruthy();
  });

  it('본문이 있으면 통과한다', () => {
    const result = normalizeInquiryReplyForm(form({ body: '추가 질문', inquiryId: INQUIRY_ID }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.inquiryId).toBe(INQUIRY_ID);
  });
});

describe('첨부 업로드 경로', () => {
  /* 커뮤니티 경로를 재사용하면 커뮤니티 글쓰기 스위치가 문의 첨부까지 잠근다. */
  it('커뮤니티가 아니라 inquiry 접두를 쓴다', () => {
    const path = buildInquiryUploadPath({
      mimeType: 'image/webp',
      nonce: '44444444-4444-4444-8444-444444444444',
      userId: USER_ID,
    });

    expect(path).toBe(`${USER_ID}/inquiry/44444444-4444-4444-8444-444444444444.webp`);
    expect(path).not.toContain('/community/');
  });
});

describe('1차 답변 기한 — 영업일 24시간', () => {
  /* KST 기준 계산이다. 2026-08-18은 화요일. */
  it('평일 접수는 다음 영업일 같은 시각이 기한이다', () => {
    const due = inquiryFirstReplyDueAt('2026-08-18T01:00:00.000Z');

    expect(due?.toISOString()).toBe('2026-08-19T01:00:00.000Z');
  });

  /* 2026-08-21은 금요일. 금요일 접수는 주말을 건너뛰어 월요일이 된다 —
     주말을 세면 운영자가 출근하기도 전에 SLA가 깨진다. */
  it('금요일 접수는 주말을 건너뛴다', () => {
    const due = inquiryFirstReplyDueAt('2026-08-21T05:00:00.000Z');

    expect(due?.toISOString()).toBe('2026-08-24T05:00:00.000Z');
  });

  it('형식이 아닌 시각은 기한을 지어내지 않는다', () => {
    expect(inquiryFirstReplyDueAt('nope')).toBeNull();
  });
});

describe('SLA 상태', () => {
  const createdAt = '2026-08-18T01:00:00.000Z';

  it('기한 안이면 남은 시간을 말한다', () => {
    const state = inquirySlaState(
      { answeredAt: null, createdAt, status: 'open' },
      new Date('2026-08-18T05:00:00.000Z'),
    );

    expect(state.tone).toBe('ok');
    expect(state.label).toContain('남음');
  });

  /* 남은 시간을 0으로 접으면 3시간 늦은 건과 3일 늦은 건이 같아 보인다. */
  it('기한을 넘기면 얼마나 넘겼는지 말한다', () => {
    const state = inquirySlaState(
      { answeredAt: null, createdAt, status: 'open' },
      new Date('2026-08-22T01:00:00.000Z'),
    );

    expect(state.tone).toBe('danger');
    expect(state.label).toContain('기한 초과');
  });

  it('기한 안에 답변한 건은 더 이상 다투지 않는다', () => {
    const state = inquirySlaState(
      { answeredAt: '2026-08-18T02:00:00.000Z', createdAt, status: 'answered' },
      new Date('2026-08-30T00:00:00.000Z'),
    );

    expect(state.tone).toBe('settled');
    expect(state.label).toBe('기한 내 답변');
  });

  it('늦게 답변한 건은 지난 뒤에도 초과로 남는다', () => {
    const state = inquirySlaState(
      { answeredAt: '2026-08-25T01:00:00.000Z', createdAt, status: 'answered' },
      new Date('2026-08-30T00:00:00.000Z'),
    );

    expect(state.tone).toBe('danger');
    expect(state.label).toContain('기한 초과 답변');
  });
});

describe('표기 헬퍼', () => {
  it('문의번호는 주문번호와 섞이지 않게 # 접두를 쓴다', () => {
    expect(inquiryReferenceLabel(42)).toBe('#42');
  });

  it('경과시간은 하루가 넘으면 일 단위로 계속 커진다', () => {
    const now = new Date('2026-08-18T06:00:00.000Z');

    expect(inquiryElapsedLabel('2026-08-18T05:59:30.000Z', now)).toBe('방금');
    expect(inquiryElapsedLabel('2026-08-18T03:00:00.000Z', now)).toBe('3시간');
    expect(inquiryElapsedLabel('2026-08-15T06:00:00.000Z', now)).toBe('3일');
  });

  it('진입점이 유형과 연결 대상을 실어 보낸다', () => {
    expect(newInquiryHref()).toBe('/my/inquiries/new');
    expect(newInquiryHref({ category: 'good', goodId: 'g13' }))
      .toBe('/my/inquiries/new?category=good&goodId=g13');
    expect(newInquiryHref({ category: 'order', orderId: ORDER_ID }))
      .toBe(`/my/inquiries/new?category=order&orderId=${ORDER_ID}`);
  });
});
