import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { GoodsNoticePresetsScreen } from './GoodsNoticePresetsScreen';

vi.mock('@/app/admin/goods-notice-preset-actions', () => ({ saveGoodsNoticePresetAction: vi.fn(), deleteGoodsNoticePresetAction: vi.fn() }));

describe('상품정보제공고시 프리셋 관리 화면', () => {
  it('이름과 고시정보 7칸을 읽고 수정하며 삭제를 명시적으로 확인할 수 있다', () => {
    const html = renderToStaticMarkup(<GoodsNoticePresetsScreen data={{
      total: 1, filters: { query: '', page: 1 }, presets: [{
        id: 'preset-1', name: '아크릴 기본', updatedAt: '2026-09-08T01:00:00Z',
        notice: { maker: '아이콘스', origin: '대한민국', material: '아크릴', size: '80mm', madeOn: '2026-09', asManager: '아이콘스 고객센터', asContact: '02-000-0000' },
      }],
    }} />);
    for (const name of ['name', 'noticeMaker', 'noticeOrigin', 'noticeMaterial', 'noticeSize', 'noticeMadeOn', 'noticeAsManager', 'noticeAsContact']) {
      expect(html).toContain(`name="${name}"`);
    }
    expect(html).toContain('value="아크릴 기본"');
    expect(html).toContain('value="아이콘스"');
    expect(html).toContain('value="02-000-0000"');
    expect(html).toContain('이 프리셋을 삭제하겠습니다.');
    expect(html).toContain('프리셋 수정 저장');
    expect(html).toContain('기존 상품에 입력된 값은 바뀌지 않습니다.');
    expect(html).toContain('action="/admin/catalog/notice-presets"');
  });
  it('결과가 없는 검색에서도 등록과 검색 초기화를 제공한다', () => {
    const html = renderToStaticMarkup(<GoodsNoticePresetsScreen data={{ total: 0, filters: { query: '없는 이름', page: 1 }, presets: [] }} />);
    expect(html).toContain('새 프리셋 등록');
    expect(html).toContain('조건에 맞는 프리셋이 없습니다.');
    expect(html).toContain('전체 프리셋 보기');
  });
});
