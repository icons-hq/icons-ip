import { describe, expect, it } from 'vitest';
import {
  adminProductQuestionAuthorLabel,
  adminProductQuestionHref,
  adminProductQuestionResetHref,
  formatAdminProductQuestionDateTime,
  normalizeAdminProductQuestionFilters,
  productQuestionBodyPreview,
} from './product-questions';

describe('normalizeAdminProductQuestionFilters', () => {
  it('빈 쿼리는 전체·1페이지다', () => {
    expect(normalizeAdminProductQuestionFilters({})).toEqual({ status: 'all', page: 1 });
  });

  it('아는 상태만 통과시킨다', () => {
    expect(normalizeAdminProductQuestionFilters({ status: 'unanswered' }).status).toBe('unanswered');
    expect(normalizeAdminProductQuestionFilters({ status: 'answered' }).status).toBe('answered');
    expect(normalizeAdminProductQuestionFilters({ status: 'hidden' }).status).toBe('hidden');
  });

  /* URL 을 그대로 질의에 넘기면 어드민 화면이 임의 입력의 통로가 된다. */
  it('모르는 상태와 배열 파라미터는 전체로 접는다', () => {
    expect(normalizeAdminProductQuestionFilters({ status: 'deleted' }).status).toBe('all');
    expect(normalizeAdminProductQuestionFilters({ status: ['hidden'] }).status).toBe('all');
  });

  it('0·음수·소수·문자 페이지는 1페이지로 접는다', () => {
    expect(normalizeAdminProductQuestionFilters({ page: '0' }).page).toBe(1);
    expect(normalizeAdminProductQuestionFilters({ page: '-3' }).page).toBe(1);
    expect(normalizeAdminProductQuestionFilters({ page: '2.5' }).page).toBe(1);
    expect(normalizeAdminProductQuestionFilters({ page: 'two' }).page).toBe(1);
  });

  it('정상 페이지는 그대로 읽는다', () => {
    expect(normalizeAdminProductQuestionFilters({ page: '3' }).page).toBe(3);
  });
});

describe('adminProductQuestionHref', () => {
  it('기본 상태는 URL 에 남기지 않는다', () => {
    expect(adminProductQuestionHref({ status: 'all', page: 1 })).toBe('/admin/cs/qna?page=1');
  });

  it('상태와 페이지를 함께 싣는다', () => {
    expect(adminProductQuestionHref({ status: 'unanswered', page: 2 }))
      .toBe('/admin/cs/qna?status=unanswered&page=2');
  });

  /* 조건을 좁힌 뒤 5페이지에 남아 있으면 결과가 비어 보인다 — 호출자가 page: 1 을
     함께 넘길 수 있어야 한다. */
  it('덮어쓴 값이 이긴다', () => {
    expect(adminProductQuestionHref({ status: 'hidden', page: 5 }, { page: 1, status: 'all' }))
      .toBe('/admin/cs/qna?page=1');
  });

  it('초기화 링크는 조건을 전부 버린다', () => {
    expect(adminProductQuestionResetHref()).toBe('/admin/cs/qna?page=1');
  });
});

describe('표시 헬퍼', () => {
  it('닉네임이 비면 주문·문의 콘솔과 같은 fan_ 축약을 쓴다', () => {
    expect(adminProductQuestionAuthorLabel('  ', '77777777-7777-4777-8777-777777777777'))
      .toBe('fan_777777');
    expect(adminProductQuestionAuthorLabel('팬일호', 'u1')).toBe('팬일호');
  });

  it('본문 미리보기는 줄바꿈을 접고 길이를 자른다', () => {
    expect(productQuestionBodyPreview('사이즈가\n궁금해요')).toBe('사이즈가 궁금해요');
    expect(productQuestionBodyPreview('가나다라마', 3)).toBe('가나다…');
  });

  it('작성 시각은 KST 로 읽는다', () => {
    expect(formatAdminProductQuestionDateTime('2026-08-31T15:00:00.000Z')).toContain('2026');
    expect(formatAdminProductQuestionDateTime('not-a-date')).toBe('');
  });
});
