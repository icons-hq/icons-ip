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
  it('exposes tree, activation gates, ERP evidence and legacy type coexistence', () => {
    const html = renderToStaticMarkup(<CategoryScreen data={{ categories, mappings: [], migrations: [], activation: { customerEnabled: false, erpEnabled: false, customerEvidence: null, erpEvidence: null, updatedAt: null } }} legacyTypes={['문구', '키링']} />);
    expect(html).toContain('고객 카테고리');
    expect(html).toContain('최대 4단계');
    expect(html).toContain('실제 ERP 코드·품명');
    expect(html).toContain('>미분류</option>');
    expect(html).toContain('비워도 기존 유형과 전체 상품 판매는 유지됩니다.');
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
  for (const text of ['ERP 매핑 저장', '활성화 상태 저장', '이관 메모 저장', '기존 유형 이관 메모', '분류·ERP CSV']) expect(html).not.toContain(text);
});

it('카테고리 관리에서 `대>중>소` 경로를 붙여넣어 일괄 등록할 수 있다', () => {
  const html = renderToStaticMarkup(<CategoryScreen data={{ categories, mappings: [], migrations: [], activation: { customerEnabled: false, erpEnabled: false, customerEvidence: null, erpEvidence: null, updatedAt: null } }} canManagePlatform={false} />);
  expect(html).toContain('카테고리 일괄 등록');
  expect(html).toContain('aria-label="카테고리 경로"');
  expect(html).toContain('같은 부모 아래 같은 이름은 새로 만들지 않고 건너뜁니다.');
});
