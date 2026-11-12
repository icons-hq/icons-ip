import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { CategoryScreen } from './CategoryScreen';

const categories = [{
  id: '00000000-0000-4000-8000-000000047401', code: 'life', name: '생활', parentId: null, depth: 1, sortOrder: 1,
  archivedAt: null, updatedAt: '2026-09-10T00:00:00Z', childCount: 1, assignedGoodCount: 0,
}, {
  id: '00000000-0000-4000-8000-000000047402', code: 'paper', name: '문구', parentId: '00000000-0000-4000-8000-000000047401', depth: 2, sortOrder: 1,
  archivedAt: null, updatedAt: '2026-09-10T00:00:00Z', childCount: 0, assignedGoodCount: 2,
}];

describe('CategoryScreen', () => {
  /* SHEET-003(ADR-0037): 카테고리 추가·수정에 상품 유형 연결 칸이 있고, 지금 적용 유형(상위 연결 포함)과 이름 기준 추천을 보인다. */
  it('카테고리 추가·수정 화면에 상품 유형 연결 칸과 지금 적용되는 유형을 보인다', () => {
    const typed = [{ ...categories[0], goodType: '피규어' }, { ...categories[1], name: '키링 모음', goodType: null }];
    const html = renderToStaticMarkup(<CategoryScreen data={{ categories: typed, mappings: [], migrations: [], activation: { customerEnabled: false, erpEnabled: false, customerEvidence: null, erpEvidence: null, updatedAt: null } }} />);
    expect(html.match(/<select[^>]*name="goodType"/g)?.length).toBe(2);
    expect(html).toContain('<option value="">연결 안 함 · 상위 카테고리를 따름</option>');
    expect(html).toContain('<option value="피규어" selected="">피규어</option>');
    expect(html).toContain('지금 이 카테고리 상품의 유형은 <strong class="font-medium text-foreground">피규어</strong>입니다');
    expect(html).toContain('data-category-good-type="">· 피규어</span>');
    expect(html).toContain('초안 상품의 유형이 바로 바뀌고 KC를 다시 검토해야 공개할 수 있습니다');
  });

  it('exposes tree, activation gates, ERP evidence and legacy type coexistence', () => {
    const html = renderToStaticMarkup(<CategoryScreen data={{ categories, mappings: [], migrations: [], activation: { customerEnabled: false, erpEnabled: false, customerEvidence: null, erpEvidence: null, updatedAt: null } }} legacyTypes={['문구', '키링']} />);
    expect(html).toContain('고객 카테고리');
    expect(html).toContain('최대 4단계');
    expect(html).toContain('실제 ERP 코드·품명');
    expect(html).toContain('>미분류</option>');
    expect(html).toContain('비우거나 연결 없는 카테고리면 새로 공개할 수 없고 공개 중인 상품은 유형이 같은 카테고리로만 옮깁니다.');
    expect(html).toContain('기존 유형 이관 메모');
    expect(html).toContain('키링');
  });

  it('links every category to its goods including descendants while public categories are disabled', () => {
    const html = renderToStaticMarkup(<CategoryScreen data={{ categories, mappings: [], migrations: [], activation: { customerEnabled: false, erpEnabled: false, customerEvidence: null, erpEvidence: null, updatedAt: null } }} />);
    expect(html).toContain('href="/admin/catalog/goods?status=active&amp;stock=all&amp;page=1&amp;categoryId=00000000-0000-4000-8000-000000047401"');
    expect(html).toContain('href="/admin/catalog/goods?status=active&amp;stock=all&amp;page=1&amp;categoryId=00000000-0000-4000-8000-000000047402"');
    expect(html).toContain('생활 상품 목록');
    expect(html).toContain('문구 상품 목록');
  });
});

it('basic category managers keep CRUD and assignment without platform configuration', () => {
  const html = renderToStaticMarkup(<CategoryScreen data={{ categories, mappings: [], migrations: [], activation: { customerEnabled: false, erpEnabled: false, customerEvidence: null, erpEvidence: null, updatedAt: null } }} canManagePlatform={false} />);
  expect(html).toContain('카테고리 추가'); expect(html).toContain('대표 분류 저장'); expect(html).toContain('분류 CSV');
  // kit 버튼은 type을 주지 않으면 button이 된다 — 서버 액션 폼의 제출 버튼은 submit이어야 한다.
  for (const label of ['카테고리 추가', '대표 분류 저장', '보관']) expect(html).toMatch(new RegExp(`<button(?=[^>]*type="submit")[^>]*>${label}</button>`));
  for (const text of ['ERP 매핑 저장', '활성화 상태 저장', '이관 메모 저장', '기존 유형 이관 메모', '분류·ERP CSV']) expect(html).not.toContain(text);
});

it('기본 카테고리 적용 칸의 자주 쓰는 카테고리는 등록된 게 있을 때만 보인다', () => {
  const render = (hasCategoryTemplates?: boolean) => renderToStaticMarkup(<CategoryScreen data={{ categories, mappings: [], migrations: [], activation: { customerEnabled: false, erpEnabled: false, customerEvidence: null, erpEvidence: null, updatedAt: null } }} canManagePlatform={false} hasCategoryTemplates={hasCategoryTemplates} />);
  expect(render()).not.toContain('자주 쓰는 카테고리');
  expect(render(true)).toMatch(/<button[^>]*>자주 쓰는 카테고리<\/button>/);
});

it('트리에서 고치는 항목 하나만 오른쪽에 열고 트리에 주 색으로 표시한다', () => {
  const html = renderToStaticMarkup(<CategoryScreen data={{ categories, mappings: [], migrations: [], activation: { customerEnabled: false, erpEnabled: false, customerEvidence: null, erpEvidence: null, updatedAt: null } }} canManagePlatform={false} />);
  expect(html.match(/<button aria-current="true"/g)).toHaveLength(1);
  expect(html).toContain('생활 수정');
  expect(html).not.toContain('문구 수정');
  // 저장·추가는 각자 묶음의 주 행동이다.
  for (const label of ['저장', '카테고리 추가']) expect(html).toMatch(new RegExp(`<button(?=[^>]*bg-primary)[^>]*>${label}</button>`));
});

it('카테고리 관리에서 `대>중>소` 경로를 붙여넣어 일괄 등록할 수 있다', () => {
  const html = renderToStaticMarkup(<CategoryScreen data={{ categories, mappings: [], migrations: [], activation: { customerEnabled: false, erpEnabled: false, customerEvidence: null, erpEvidence: null, updatedAt: null } }} canManagePlatform={false} />);
  expect(html).toContain('카테고리 일괄 등록');
  expect(html).toContain('aria-label="카테고리 경로"');
  expect(html).toContain('같은 부모 아래 같은 이름은 새로 만들지 않고 건너뜁니다.');
});

/* 리뷰 재현(T3B-RV-6): 0건 안내가 카테고리 관리 화면의 '굿즈 기본 카테고리 적용' 카드에도 나와 같은 화면을 새 탭으로 열었다. */
it('카테고리가 없을 때 이 화면의 기본 카테고리 적용 카드는 같은 화면 링크 대신 위 등록 카드를 가리킨다', () => {
  const html = renderToStaticMarkup(<CategoryScreen data={{ categories: [], mappings: [], migrations: [], activation: { customerEnabled: false, erpEnabled: false, customerEvidence: null, erpEvidence: null, updatedAt: null } }} />);
  expect(html).not.toContain('카테고리 관리에서 먼저 등록하세요');
  expect(html).not.toMatch(/href="\/admin\/catalog\/categories"[^>]*target="_blank"/);
  expect(html).toContain('등록된 카테고리가 없습니다. 위 카테고리 일괄 등록이나 새 카테고리에서 먼저 등록하세요.');
});

it('한 화면의 저장은 고르는 항목 하나다 — 새 등록·ERP 매핑·이관 메모는 접혀 있고, 트리 한 줄에는 단계 분수 대신 상품 수만 있다', () => {
  const html = renderToStaticMarkup(<CategoryScreen data={{ categories, mappings: [], migrations: [], activation: { customerEnabled: false, erpEnabled: false, customerEvidence: null, erpEvidence: null, updatedAt: null } }} />);
  for (const title of ['새 카테고리 등록', 'ERP 분류 매핑', '기존 유형 이관 메모', '활성화 상태']) expect(html).toMatch(new RegExp(`<details[^>]*data-fold-card=""(?![^>]*open)[^>]*><summary[^>]*>(?:(?!</summary>)[\\s\\S])*${title}`));
  expect(html).toContain('>상품 2개</a>');
  expect(html).not.toMatch(/\d\/4/);
  // 영어 내부어 대신 운영팀 말로 쓴다.
  for (const word of ['고객 category', 'ERP mapping', '유효 tree', '기존 type', '제안 category']) expect(html).not.toContain(word);
  // 고객 화면 미적용은 무엇을 해야 하는지 함께 말한다.
  expect(html).toContain('트리를 다 만든 뒤 펼쳐서 켜주세요.');
});

it('고객 화면 미적용이면 접힌 줄에 켜는 곳을 버튼 모양으로 알리고, 적용 중이면 알리지 않는다', () => {
  const render = (customerEnabled: boolean) => renderToStaticMarkup(<CategoryScreen data={{ categories, mappings: [], migrations: [], activation: { customerEnabled, erpEnabled: false, customerEvidence: null, erpEvidence: null, updatedAt: null } }} />);
  expect(render(false)).toMatch(/<summary[^>]*>(?:(?!<\/summary>)[\s\S])*활성화 상태(?:(?!<\/summary>)[\s\S])*펼쳐서 켜기/);
  expect(render(true)).not.toContain('펼쳐서 켜기');
});

/* 2026-11-10 측정: 말단 300개면 ERP 분류 매핑 입력 묶음만 DOM 4,500개였다. 접혀 있는 동안은 그리지 않는다. */
it('ERP 분류 매핑 입력 묶음은 펼치기 전에는 그리지 않고 안내만 둔다', () => {
  const leaf = (index: number) => ({ ...categories[1], id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, code: `leaf-${index}`, name: `말단 ${index}` });
  const many = [categories[0], ...Array.from({ length: 300 }, (_, index) => leaf(index))];
  const html = renderToStaticMarkup(<CategoryScreen data={{ categories: many, mappings: [], migrations: [], activation: { customerEnabled: false, erpEnabled: false, customerEvidence: null, erpEvidence: null, updatedAt: null } }} />);
  expect(html).toContain('맨 아래 단계 300개');
  expect(html).toContain('실제 ERP 코드·품명');
  expect(html).not.toContain('ERP 매핑 저장');
  expect(html).not.toContain('name="erpCode"');
  expect(html.match(/<[a-z][^>]*>/g)!.length).toBeLessThan(4_000);
});

/* 2026-11-10 사람 눈 시험: 말단마다 카드 한 장이라 펼치면 페이지가 10만 px까지 길어지고 검색이 없었다. */
it('ERP 분류 매핑은 검색되는 표 한 벌이고, 여기서 하는 일과 ERP 품목 화면에서 하는 일을 구분해 알려 준다', () => {
  const html = renderToStaticMarkup(<CategoryScreen data={{ categories, mappings: [], migrations: [], activation: { customerEnabled: false, erpEnabled: false, customerEvidence: null, erpEvidence: null, updatedAt: null } }} legacyTypes={[]} />);
  expect(html).toContain('id="category-erp-mapping"');
  expect(html).toContain('맨 아래 단계 1개 · 미설정 1개');
  expect(html).not.toContain('ERP 매핑 저장');
  expect(html).toContain('분류·ERP CSV와 ERP 활성화에 쓰이고, 상품은 바뀌지 않습니다.');
  expect(html).toContain('href="/admin/catalog/erp-items#erp-category-mapping"');
  expect(html).toContain('ERP 품목 화면의 연결 표');
});

it('카테고리가 없으면 새 등록 카드를 펼쳐 둔다', () => {
  const html = renderToStaticMarkup(<CategoryScreen data={{ categories: [], mappings: [], migrations: [], activation: { customerEnabled: false, erpEnabled: false, customerEvidence: null, erpEvidence: null, updatedAt: null } }} canManagePlatform={false} />);
  expect(html).toMatch(/<details[^>]*data-fold-card=""[^>]*open=""[^>]*><summary[^>]*>(?:(?!<\/summary>)[\s\S])*새 카테고리 등록/);
});
