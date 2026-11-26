import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { CategoryTemplatesScreen, categoryTemplateSavedMessage } from './CategoryTemplatesScreen';

it('관리 화면의 검색은 폼 제출이고, 등록은 머리의 버튼에서 연다', () => {
  const management = renderToStaticMarkup(<CategoryTemplatesScreen />);
  expect(management).toContain('<form');
  // 관리 화면의 검색은 폼 제출이다(kit 버튼의 기본 type은 button).
  expect(management).toMatch(/<button(?=[^>]*type="submit")[^>]*>검색<\/button>/);
  expect(management).toContain('자주 쓰는 카테고리 등록');
  // 등록 창은 누를 때만 연다. 처음에는 선택창이 그려지지 않는다.
  expect(management).not.toContain('data-admin-picker');
});

/* 운영 책임자 피드백(2026-11-10): '카테고리 템플릿'이 무엇인지 화면만 보고는 알 수 없었다. */
it('읽는 말은 자주 쓰는 카테고리이고, 무엇을 하는 메뉴인지 머리 설명에 드러난다', () => {
  const management = renderToStaticMarkup(<CategoryTemplatesScreen />);
  expect(management).toContain('자주 쓰는 마지막 단계 카테고리를 등록해 두면 상품 등록에서 검색 없이 목록에서 바로 고를 수 있습니다');
  expect(management).not.toContain('말단');
  expect(management).toContain('자주 쓰는 카테고리 관리');
  expect(management).not.toContain('카테고리 템플릿');
});

/* 낱말 표: 보관을 되돌리는 말은 복원이다. 복구·같은 요청 결과 확인은 쓰지 않는다. */
it('화면에 복구·같은 요청 결과 확인·조회 후에 관리 같은 옛 말이 없다', () => {
  const management = renderToStaticMarkup(<CategoryTemplatesScreen />);
  for (const word of ['복구', '같은 요청 결과 확인', '조회 후에 관리']) expect(management).not.toContain(word);
});

/* 사람 눈 시험(2026-11-10): 복구한 적 없는데 등록할 때마다 '등록·복구했습니다'로 나왔다. */
it('저장 완료 문구는 등록·복원·보관을 실제 동작대로 말한다', () => {
  expect(categoryTemplateSavedMessage([{ categoryId: 'a', revision: 0 }], false, 1)).toBe('자주 쓰는 카테고리 1개를 등록했습니다.');
  expect(categoryTemplateSavedMessage([{ categoryId: 'a', revision: 0 }, { categoryId: 'b', revision: 0 }], false, 2)).toBe('자주 쓰는 카테고리 2개를 등록했습니다.');
  expect(categoryTemplateSavedMessage([{ categoryId: 'a', revision: 3 }, { categoryId: 'b', revision: 2 }], false, 2)).toBe('자주 쓰는 카테고리 2개를 복원했습니다.');
  expect(categoryTemplateSavedMessage([{ categoryId: 'a', revision: 1 }], true, 1)).toBe('자주 쓰는 카테고리 1개를 보관했습니다.');
});
