import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
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
    expect(html).toContain('미분류 · 기존 유형/전체 목록 유지');
    expect(html).toContain('기존 8종 이관 메모');
    expect(html).toContain('키링');
  });
});
