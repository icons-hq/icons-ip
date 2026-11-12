import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { CategoryAssignmentField, categoryErpMatch, createPrimaryChangeAnnouncer, searchAssignableCategories } from './CategoryAssignmentField';
import { CategoryTemplatesAvailableProvider } from './CategoryTemplatesAvailability';
const categories = [
  { id: 'primary', name: '문구', code: 'paper', parentId: null, depth: 1, childCount: 0, sortOrder: 0, archivedAt: null, updatedAt: '', assignedGoodCount: 1 },
  { id: 'extra', name: '신학기', code: 'school', parentId: null, depth: 1, childCount: 0, sortOrder: 0, archivedAt: '2026-09-01', updatedAt: '', assignedGoodCount: 1 },
];
it('대표와 추가 분류를 구분하고 보관된 기존 연결은 해제 가능한 값으로 보존한다', () => {
  const html = renderToStaticMarkup(<CategoryAssignmentField categories={categories} value="primary" additionalValue='["extra"]' />);
  expect(html).toContain('대표 카테고리');
  expect(html).toContain('추가 카테고리');
  expect(html).toContain('name="additionalCategoryIds"');
  expect(html).toContain('신학기 추가 분류 해제');
  expect(html).toContain('보관됨');
  expect(html).toContain('ERP');
});
it('상위에서 대표 카테고리를 제어하면 그 값을 선택하고 같은 분류를 추가 분류에서 뺀다', () => {
  const active = [categories[0], { ...categories[1], id: 'gift', name: '선물', archivedAt: null }];
  const html = renderToStaticMarkup(<CategoryAssignmentField categories={active} value="" primary="gift" onPrimaryChange={() => {}} additionalValue='["gift","primary"]' />);
  expect(html).toMatch(/<option value="gift" selected="">/);
  expect(html).toContain('value="[&quot;primary&quot;]"');
  expect(html).not.toContain('선물 추가 분류 해제');
  const uncontrolled = renderToStaticMarkup(<CategoryAssignmentField categories={active} value="primary" primary="gift" />);
  expect(uncontrolled).toMatch(/<option value="primary" selected="">/);
});

it('카테고리 검색은 이름·상위 경로·코드를 함께 찾고 말단과 활성 계층만 선택한다', () => {
  const source = [
    { ...categories[0], id: 'root', name: '문구', code: 'stationery', childCount: 2 },
    { ...categories[0], id: 'note', name: '노트', code: 'note-a', parentId: 'root', depth: 2 },
    { ...categories[0], id: 'pen', name: '펜', code: 'pen-b', parentId: 'root', depth: 2 },
    { ...categories[0], id: 'old-root', name: '이전 문구', code: 'old-root', childCount: 1, archivedAt: '2026-10-20' },
    { ...categories[0], id: 'old-note', name: '노트', code: 'old-note', parentId: 'old-root', depth: 2 },
  ];
  expect(searchAssignableCategories(source, '문구 노트').map(row => row.id)).toEqual(['note']);
  expect(searchAssignableCategories(source, 'ＮＯＴＥ－Ａ').map(row => row.id)).toEqual(['note']);
  expect(searchAssignableCategories(source, '문구').map(row => row.id)).toEqual(['note', 'pen']);
  expect(searchAssignableCategories(source, '   ')).toEqual([]);
});

/* SHEET-042(사용자 결정 2026-11-11 묶음 13): ERP 품목 메뉴에서 분류를 연결해 두면 카테고리 찾기에 ERP 분류명을 쳐도 그 카테고리가 나온다. */
it('카테고리 검색은 연결된 ERP 분류명으로도 찾고, 그 근거를 결과에 함께 보인다', () => {
  const source = [
    { ...categories[0], id: 'root', name: '문구', code: 'stationery', childCount: 2 },
    { ...categories[0], id: 'keyring', name: '키링', code: 'kr-1', parentId: 'root', depth: 2, erpNames: ['굿즈 > 아크릴 키링', 'ERP-KR'] },
    { ...categories[0], id: 'pen', name: '펜', code: 'pen-b', parentId: 'root', depth: 2 },
  ];
  expect(searchAssignableCategories(source, '아크릴').map(row => row.id)).toEqual(['keyring']);
  expect(searchAssignableCategories(source, '굿즈>아크릴').map(row => row.id)).toEqual(['keyring']);
  expect(searchAssignableCategories(source, 'erp-kr').map(row => row.id)).toEqual(['keyring']);
  expect(searchAssignableCategories(source, '문구').map(row => row.id)).toEqual(['keyring', 'pen']);
  /* ERP 분류처럼 '>'로 붙여 쓴 경로도 카테고리 경로(문구 > 키링)와 같은 낱말로 나눠 찾는다. */
  expect(searchAssignableCategories(source, '문구>키링').map(row => row.id)).toEqual(['keyring']);
  expect(searchAssignableCategories(source, '문구 > 키링').map(row => row.id)).toEqual(['keyring']);
  expect(searchAssignableCategories(source, '문구 키링').map(row => row.id)).toEqual(['keyring']);
  expect(searchAssignableCategories(source, '>')).toEqual([]);
  expect(categoryErpMatch(source, source[1], '아크릴')).toBe('굿즈 > 아크릴 키링');
  /* 카테고리 경로로 찾은 결과에는 ERP 근거를 덧붙이지 않는다. */
  expect(categoryErpMatch(source, source[1], '키링')).toBeNull();
  expect(categoryErpMatch(source, source[2], '아크릴')).toBeNull();
});

it('ERP 분류 이름을 실은 카테고리가 있을 때만 검색 칸이 ERP 분류명을 말한다', () => {
  expect(renderToStaticMarkup(<CategoryAssignmentField categories={categories} value="" />)).toContain('placeholder="카테고리명 또는 코드 입력"');
  const withErp = [{ ...categories[0], erpNames: ['문구 > 노트'] }, categories[1]];
  const html = renderToStaticMarkup(<CategoryAssignmentField categories={withErp} value="" />);
  expect(html).toContain('placeholder="카테고리명·코드 또는 ERP 분류명 입력"');
  expect(html).toContain('카테고리명·코드나 연결된 ERP 분류명을 입력하거나 카테고리명 선택을 이용해주세요.');
});

it('검색·선택 진입을 제공하면서 폼의 대표 카테고리 값은 보존한다', () => {
  const html = renderToStaticMarkup(<CategoryAssignmentField categories={categories} value="primary" />);
  expect(html).toContain('카테고리명 검색');
  expect(html).toContain('카테고리명 선택');
  expect(html).toContain('name="categoryId"');
  expect(html).toMatch(/<option value="primary" selected="">/);
  expect(html).toContain('선택 해제');
});

/* 운영 책임자 피드백(2026-11-10): '카테고리 템플릿' 버튼이 무엇인지 몰랐고, 등록 0건이라 누르면 빈 창이었다. */
it('자주 쓰는 카테고리는 등록된 게 있을 때만 버튼과 관리 링크를 보인다', () => {
  const field = <CategoryAssignmentField categories={categories} value="primary" />;
  const none = renderToStaticMarkup(field);
  expect(none).not.toContain('자주 쓰는 카테고리');
  expect(none).not.toContain('카테고리 템플릿');
  const some = renderToStaticMarkup(<CategoryTemplatesAvailableProvider available>{field}</CategoryTemplatesAvailableProvider>);
  expect(some).toMatch(/<button[^>]*>자주 쓰는 카테고리<\/button>/);
  expect(some).toContain('자주 쓰는 카테고리 관리 ↗');
  expect(some).toContain('href="/admin/catalog/category-templates"');
  expect(some).not.toContain('카테고리 템플릿');
});

/* 2026-10-07 리뷰: 'ERP 카테고리로 바꾸기'는 select의 change 이벤트 없이 값만 바꿔 브라우저 복구 기록·미리보기 관찰에 잡히지 않았다. */
it('상위에서 바꾼 대표 카테고리만 select의 change 이벤트로 폼 관찰자에게 알린다', () => {
  const select = new EventTarget();
  const seen: Event[] = [];
  select.addEventListener('change', (event) => seen.push(event));
  const announcer = createPrimaryChangeAnnouncer('primary');

  expect(announcer.committed('primary', select)).toBe(false);
  expect(seen).toHaveLength(0);

  /* 상위(ERP 제안)가 바꾼 값: 폼 관찰자가 듣도록 bubbling change를 한 번 보낸다. */
  expect(announcer.committed('gift', select)).toBe(true);
  expect(seen).toHaveLength(1);
  expect(seen[0].bubbles).toBe(true);
  expect(announcer.committed('gift', select)).toBe(false);

  /* 사용자가 select에서 직접 고른 값은 이미 change가 났으므로 다시 보내지 않는다. */
  announcer.chosen('primary');
  expect(announcer.committed('primary', select)).toBe(false);
  expect(seen).toHaveLength(1);
});

/* R9: 카테고리가 하나도 없으면 검색칸이 빈 채로 막히지 않게 카테고리 관리로 안내한다. */
it('사용할 수 있는 카테고리가 없으면 카테고리 관리 링크와 먼저 등록하라는 안내를 보인다', () => {
  const html = renderToStaticMarkup(<CategoryAssignmentField categories={[]} value="" />);
  expect(html).toContain('등록된 카테고리가 없습니다. 카테고리 관리에서 먼저 등록하세요.');
  expect(html).toMatch(/<a [^>]*href="\/admin\/catalog\/categories"[^>]*>카테고리 관리<\/a>/);
  expect(renderToStaticMarkup(<CategoryAssignmentField categories={categories} value="" />)).not.toContain('등록된 카테고리가 없습니다');
});
