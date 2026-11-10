import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { GoodsNoticePresetsScreen } from './GoodsNoticePresetsScreen';
import { GoodsNoticePresetForm } from './GoodsNoticePresetForm';

vi.mock('@/app/admin/goods-notice-preset-actions', () => ({ saveGoodsNoticePresetAction: vi.fn(), deleteGoodsNoticePresetAction: vi.fn() }));

describe('상품정보제공고시 프리셋 관리 화면', () => {
  it('이름과 고시정보 7칸을 읽고 수정하며 삭제를 명시적으로 확인할 수 있다', () => {
    const html = renderToStaticMarkup(<GoodsNoticePresetsScreen data={{
      total: 1, filters: { query: '', page: 1 }, presets: [{
        id: 'preset-1', name: '아크릴 기본', updatedAt: '2026-09-08T01:00:00Z',
        kcTemplate:{family:'living',scheme:'not_applicable',publicNote:'합성 안내'},
        notice: { maker: '아이콘스', origin: '대한민국', material: '아크릴', size: '80mm', madeOn: '2026-09', asManager: '아이콘스 고객센터', asContact: '02-000-0000' },
      }],
    }} />);
    for (const name of ['name', 'noticeMaker', 'noticeOrigin', 'noticeMaterial', 'noticeSize', 'noticeMadeOn', 'noticeAsManager', 'noticeAsContact']) {
      expect(html).toContain(`name="${name}"`);
    }
    expect(html).toContain('value="아크릴 기본"');
    expect(html).toContain('KC 모델 틀 포함');
    expect(html).toContain('합성 안내');
    expect(html).toContain('해당 없음 고객 안내 (선택)');
    expect(html).toContain('name="kcTemplate"');
    expect(html).toContain('검토 완료 상태는 복사하지 않습니다');
    expect(html).toContain('value="아이콘스"');
    expect(html).toContain('value="02-000-0000"');
    expect(html).toContain('이 템플릿을 삭제하겠습니다.');
    expect(html).toContain('템플릿 수정 저장');
    expect(html).toContain('기존 상품에 입력된 값은 바뀌지 않습니다.');
    expect(html).toContain('action="/admin/catalog/notice-presets"');
    // 서버 액션 폼의 제출 버튼은 submit이다(kit 버튼의 기본 type은 button).
    for (const label of ['템플릿 수정 저장', '삭제 확정', '검색']) expect(html).toMatch(new RegExp(`<button(?=[^>]*type="submit")[^>]*>${label}</button>`));
    /* 등록은 화면 머리 오른쪽 버튼이 여는 팝업이다(템플릿 화면군 공통 위치). 팝업의 등록 폼도 제출 버튼을 쓴다. */
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>(?:<svg[\s\S]*?<\/svg>)?새 템플릿 등록<\/button>/);
    const create = renderToStaticMarkup(<GoodsNoticePresetForm inset={false} />);
    expect(create).toMatch(/<button(?=[^>]*type="submit")[^>]*>템플릿 등록<\/button>/);
    expect(create).toContain('name="noticeAsContact"');
  });
  it('결과가 없는 검색에서도 등록과 검색 초기화를 제공한다', () => {
    const html = renderToStaticMarkup(<GoodsNoticePresetsScreen data={{ total: 0, filters: { query: '없는 이름', page: 1 }, presets: [] }} />);
    expect(html).toContain('새 템플릿 등록');
    expect(html).toContain('조건에 맞는 템플릿이 없습니다.');
    expect(html).toContain('전체 템플릿 보기');
  });
});
