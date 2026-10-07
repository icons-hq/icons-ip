import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { CategoryAssignmentField, createPrimaryChangeAnnouncer } from './CategoryAssignmentField';
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
