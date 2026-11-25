import { describe, expect, it } from 'vitest';
import type { AdminCategoryNode } from './category';
import {
  goodsAttributeCategoryLoader, goodsAttributeChangeSummary, goodsAttributeChanges, goodsAttributeFieldIssues, goodsAttributeIssueHint,
  goodsAttributeIssueSentence, goodsAttributeIssuesMessage, goodsAttributeKindLoss, goodsAttributeNamedOptionCount, goodsAttributeSubmissionReady,
  hasGoodsAttributeChanges, isBlankGoodsAttributeField, normalizeGoodsAttributeFields,
} from './goods-attributes';
import type { GoodsAttributeField } from '@/lib/goods-attributes';

it('blocks saving while a category change still carries the previous schema snapshot', () => {
  const previous = '94900000-0000-4000-8000-000000000122', next = '94900000-0000-4000-8000-000000000101';
  const submission = (categoryId: string | null) => JSON.stringify({ categoryId, schemaRevision: 0, expectedRevision: 0, values: {}, removeIds: [] });
  expect(goodsAttributeSubmissionReady('', next)).toBe(false);
  expect(goodsAttributeSubmissionReady(submission(previous), next)).toBe(false);
  expect(goodsAttributeSubmissionReady(submission(next), next)).toBe(true);
  expect(goodsAttributeSubmissionReady(submission(null), '')).toBe(true);
  expect(goodsAttributeSubmissionReady('{}', next)).toBe(false);
});

/* 시험용 항목. 번호 형식은 이 시험이 보는 것이 아니라 글자만 서로 다르면 된다. */
const option = (id: string, label: string) => ({ id: `option-${id}`, label });
const field = (id: string, patch: Partial<GoodsAttributeField> = {}): GoodsAttributeField => ({ id: `field-${id}`, name: `항목${id}`, kind: 'text', required: false, unit: '', options: [], ...patch });
const choice = (id: string, labels: string[], patch: Partial<GoodsAttributeField> = {}) => field(id, { kind: 'single', options: labels.map((label, n) => option(`${id}-${n}`, label)), ...patch });

describe('저장하기 전에 걸리는 곳', () => {
  it('이름이 비었거나 같은 이름이 앞에 있으면 그 항목을 가리킨다', () => {
    const issues = goodsAttributeFieldIssues([field('1', { name: '  ' }), field('2', { name: '색상' }), field('3', { name: ' 색상 ' })]);
    expect(issues).toEqual([{ code: 'name-empty', index: 0 }, { code: 'name-duplicate', index: 2, of: 1 }]);
  });

  it('선택 유형은 선택값이 하나 이상 있어야 하고, 이름이 비었거나 같은 선택값은 그 줄을 가리킨다', () => {
    expect(goodsAttributeFieldIssues([field('1', { name: '색상', kind: 'multi' })])).toEqual([{ code: 'options-empty', index: 0 }]);
    const labels = goodsAttributeFieldIssues([choice('1', ['빨강', ' ', '빨강', '파랑'], { name: '색상' })]);
    expect(labels).toEqual([{ code: 'option-empty', index: 0, option: 1 }, { code: 'option-duplicate', index: 0, option: 2, of: 0 }]);
  });

  it('텍스트·숫자 유형은 선택값을 보지 않고, 문제가 없으면 아무것도 걸리지 않는다', () => {
    expect(goodsAttributeFieldIssues([field('1', { name: '길이', kind: 'number', unit: 'cm' }), field('2', { name: '메모' })])).toEqual([]);
    expect(goodsAttributeFieldIssues([choice('1', ['빨강', '파랑'], { name: '색상' })])).toEqual([]);
  });

  it('서버가 받은 값이 이상해도 던지지 않는다', () => {
    expect(goodsAttributeFieldIssues('x')).toEqual([]);
    expect(goodsAttributeFieldIssues(null)).toEqual([]);
    expect(goodsAttributeFieldIssues([1, null, { kind: 'single' }])).toEqual([{ code: 'name-empty', index: 2 }, { code: 'options-empty', index: 2 }]);
    expect(goodsAttributeFieldIssues([{ name: '색상', kind: 'single', options: ['a', { label: 3 }] }])).toEqual([{ code: 'option-empty', index: 0, option: 0 }, { code: 'option-empty', index: 0, option: 1 }]);
  });

  it('칸 아래 글은 짧고, 칸 밖 글은 몇 번째 항목인지 말한다', () => {
    const cases = [
      { code: 'name-empty', index: 1 }, { code: 'name-duplicate', index: 2, of: 0 }, { code: 'options-empty', index: 3 },
      { code: 'option-empty', index: 3, option: 1 }, { code: 'option-duplicate', index: 3, option: 2, of: 0 },
    ] as const;
    expect(cases.map(goodsAttributeIssueHint)).toEqual([
      '이름을 입력해주세요.', '이미 항목 1에 같은 이름이 있습니다. 다르게 적어주세요.', '선택값을 하나 이상 추가해주세요.',
      '선택값 이름을 입력해주세요.', '이미 선택값 1에 같은 이름이 있습니다. 다르게 적어주세요.',
    ]);
    expect(cases.map(goodsAttributeIssueSentence)).toEqual([
      '항목 2의 이름을 입력해주세요.', '항목 1·3의 이름이 같습니다. 서로 다르게 적어주세요.', '항목 4에 선택값을 하나 이상 추가해주세요.',
      '항목 4의 선택값 2 이름을 입력해주세요.', '항목 4의 선택값 1·3의 이름이 같습니다. 서로 다르게 적어주세요.',
    ]);
  });

  it('첫 문제를 말하고 나머지는 몇 곳인지만 덧붙인다', () => {
    expect(goodsAttributeIssuesMessage([])).toBeNull();
    expect(goodsAttributeIssuesMessage([{ code: 'name-empty', index: 1 }])).toBe('항목 2의 이름을 입력해주세요.');
    expect(goodsAttributeIssuesMessage([{ code: 'name-empty', index: 1 }, { code: 'options-empty', index: 4 }, { code: 'name-empty', index: 5 }])).toBe('항목 2의 이름을 입력해주세요. 이 밖에 2곳이 더 있습니다.');
  });

  it('보내기 전에 이름·단위·선택값의 앞뒤 공백을 걷어 낸다', () => {
    const [clean] = normalizeGoodsAttributeFields([field('1', { name: ' 길이 ', kind: 'number', unit: ' cm ' }), choice('2', [' 빨강 '])]);
    expect(clean).toMatchObject({ name: '길이', unit: 'cm' });
    expect(normalizeGoodsAttributeFields([choice('2', [' 빨강 '])])[0].options[0].label).toBe('빨강');
  });
});

describe('저장하지 않은 변경', () => {
  const saved = [choice('1', ['빨강', '파랑'], { name: '색상' }), field('2', { name: '재질' }), field('3', { name: '길이', kind: 'number', unit: 'cm' })];

  it('같으면 변경 없음이다(키 순서가 달라도 같은 내용이면 같다)', () => {
    const reordered = saved.map(item => ({ options: item.options, unit: item.unit, required: item.required, kind: item.kind, name: item.name, id: item.id }));
    expect(goodsAttributeChanges(saved, reordered)).toEqual({ added: 0, removed: 0, changed: 0, moved: false });
    expect(hasGoodsAttributeChanges(goodsAttributeChanges(saved, reordered))).toBe(false);
    expect(goodsAttributeChangeSummary(goodsAttributeChanges(saved, saved))).toBe('');
  });

  it('추가·수정·삭제·순서 바꿈을 따로 센다', () => {
    const draft = [saved[1], { ...saved[0], options: [saved[0].options[0]] }, field('9', { name: '새 항목' })];
    const changes = goodsAttributeChanges(saved, draft);
    expect(changes).toEqual({ added: 1, removed: 1, changed: 1, moved: true });
    expect(hasGoodsAttributeChanges(changes)).toBe(true);
    expect(goodsAttributeChangeSummary(changes)).toBe('추가 1개 · 수정 1개 · 삭제 1개 · 순서 바꿈');
  });

  it('이름·유형·필수·단위·선택값 이름 중 하나만 달라도 수정이다', () => {
    const edits: Partial<GoodsAttributeField>[] = [{ name: '색깔' }, { kind: 'multi' }, { required: true }, { options: [saved[0].options[0], option('9', '초록')] }];
    for (const patch of edits) expect(goodsAttributeChanges(saved, [{ ...saved[0], ...patch }, saved[1], saved[2]]).changed, JSON.stringify(patch)).toBe(1);
    expect(goodsAttributeChanges(saved, [saved[0], saved[1], { ...saved[2], unit: 'mm' }]).changed).toBe(1);
    expect(goodsAttributeChanges(saved, [{ ...saved[0], options: [{ ...saved[0].options[0], label: '진한 빨강' }, saved[0].options[1]] }, saved[1], saved[2]]).changed).toBe(1);
  });

  it('순서만 바꿔도 변경이다', () => {
    expect(goodsAttributeChangeSummary(goodsAttributeChanges(saved, [saved[1], saved[0], saved[2]]))).toBe('순서 바꿈');
  });
});

describe('지우기 전에 묻는 기준', () => {
  it('이름·단위·선택값이 모두 비어 있으면 빈 항목이다', () => {
    expect(isBlankGoodsAttributeField(field('1', { name: '' }))).toBe(true);
    expect(isBlankGoodsAttributeField(choice('2', ['', '  '], { name: ' ' }))).toBe(true);
    expect(isBlankGoodsAttributeField(field('3', { name: '', kind: 'number', unit: 'cm' }))).toBe(false);
    expect(isBlankGoodsAttributeField(choice('4', ['빨강'], { name: '' }))).toBe(false);
    expect(isBlankGoodsAttributeField(field('5', { name: '색상' }))).toBe(false);
  });

  it('선택값은 이름을 적은 것만 센다', () => {
    expect(goodsAttributeNamedOptionCount(choice('1', ['빨강', '', ' ', '파랑']))).toBe(2);
  });

  it('유형을 바꿀 때 지워지는 것: 선택값은 단일·복수가 아닌 유형으로, 단위는 숫자가 아닌 유형으로 바꿀 때', () => {
    const colors = choice('1', ['빨강', '파랑', ''], { name: '색상' });
    expect(goodsAttributeKindLoss(colors, 'text')).toEqual({ options: 2, unit: '' });
    expect(goodsAttributeKindLoss(colors, 'number')).toEqual({ options: 2, unit: '' });
    expect(goodsAttributeKindLoss(colors, 'multi')).toEqual({ options: 0, unit: '' });
    const length = field('2', { name: '길이', kind: 'number', unit: ' cm ' });
    expect(goodsAttributeKindLoss(length, 'text')).toEqual({ options: 0, unit: 'cm' });
    expect(goodsAttributeKindLoss(length, 'single')).toEqual({ options: 0, unit: 'cm' });
    expect(goodsAttributeKindLoss(length, 'number')).toEqual({ options: 0, unit: '' });
    expect(goodsAttributeKindLoss(field('3'), 'number')).toEqual({ options: 0, unit: '' });
  });
});

describe('카테고리 고르기 목록', () => {
  const node = (id: string, name: string, patch: Partial<AdminCategoryNode> = {}): AdminCategoryNode => ({ id, code: `code-${id}`, name, parentId: null, depth: 1, sortOrder: 0, archivedAt: null, updatedAt: '', childCount: 0, assignedGoodCount: 0, ...patch });
  const goods = node('goods', '굿즈', { sortOrder: 2, childCount: 2 });
  const stationery = node('stationery', '문구', { sortOrder: 1, childCount: 1 });
  const categories = [
    goods,
    node('keyring', '키링', { parentId: 'goods', depth: 2, sortOrder: 2 }),
    node('doll', '인형', { parentId: 'goods', depth: 2, sortOrder: 1 }),
    stationery,
    node('sticker', '스티커', { parentId: 'stationery', depth: 2 }),
    node('old', '단종', { parentId: 'goods', depth: 2, sortOrder: 3, archivedAt: '2026-11-01' }),
    node('lonely', '단독', { sortOrder: 3 }),
    node('under-archived', '보관된 상위 아래', { parentId: 'old', depth: 3 }),
  ];
  const request = (query = '', page = 1) => ({ query, field: '', filter: '', page });
  const rows = async (load = goodsAttributeCategoryLoader(categories), query = '') => {
    const result = await load(request(query));
    if ('error' in result) throw new Error(result.error);
    return result;
  };

  it('보관하지 않은 맨 아래 단계 카테고리만, 카테고리 관리와 같은 순서(상위 아래에 하위)로 낸다', async () => {
    const page = await rows();
    expect(page.rows.map(row => row.id)).toEqual(['sticker', 'doll', 'keyring', 'lonely']);
    expect(page.total).toBe(4);
    expect(page.rows[0]).toEqual({ id: 'sticker', code: 'code-sticker', path: '문구 > 스티커' });
  });

  it('하위가 있는 카테고리·보관한 카테고리·보관한 상위 아래 카테고리는 목록에 없다', async () => {
    const ids = (await rows()).rows.map(row => row.id);
    for (const hidden of ['goods', 'stationery', 'old', 'under-archived']) expect(ids).not.toContain(hidden);
  });

  it('경로 낱말이나 코드로 찾는다(낱말은 모두 들어 있으면 된다)', async () => {
    expect((await rows(undefined, '굿즈 인형')).rows.map(row => row.id)).toEqual(['doll']);
    expect((await rows(undefined, 'CODE-KEYRING')).rows.map(row => row.id)).toEqual(['keyring']);
    expect((await rows(undefined, '없는 말')).total).toBe(0);
  });

  it('지금 보고 있는 카테고리를 빼고 낼 수 있다', async () => {
    expect((await rows(goodsAttributeCategoryLoader(categories, 'doll'))).rows.map(row => row.id)).toEqual(['sticker', 'keyring', 'lonely']);
  });

  it('20개씩 자른다', async () => {
    const many = Array.from({ length: 45 }, (_, n) => node(`c${String(n).padStart(2, '0')}`, `카테고리 ${n}`, { sortOrder: n }));
    const load = goodsAttributeCategoryLoader(many);
    const second = await load(request('', 2));
    if ('error' in second) throw new Error(second.error);
    expect(second).toMatchObject({ total: 45, page: 2, pageSize: 20 });
    expect(second.rows).toHaveLength(20);
    expect(second.rows[0].id).toBe('c20');
  });
});
