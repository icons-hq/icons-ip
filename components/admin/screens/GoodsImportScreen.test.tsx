import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  commit: vi.fn(),
  preview: vi.fn(),
  prepare: vi.fn(),
  replace: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));
vi.mock('@/app/admin/goods-import-actions', () => ({
  commitNextGoodsImport: mocks.commit,
  previewGoodsImport: mocks.preview,
  prepareGoodsImport: mocks.prepare,
  inspectSabangnetGoodsImport: vi.fn(),
  previewSabangnetGoodsImport: vi.fn(),
}));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ storage: { from: () => ({ upload: vi.fn() }) } }),
}));
import { GoodsImportScreen, SabangnetMappingStep } from './GoodsImportScreen';
import { suggestSabangnetTargets } from '@/lib/admin/sabangnet-goods-format';
const group = {
  index: 0,
  code: 'G0001',
  name: '검증한 상품',
  rows: [5, 6],
  kind: 'update' as const,
  errors: [],
  warnings: ['공개 상품의 가격·재고가 변경됩니다.'],
  result: null,
};
const view = {
  id: 'batch',
  fileName: 'goods.xlsx',
  state: 'ready' as const,
  format: 'icons' as const,
  groups: [group],
};
describe('goods workbook confirmation screen', () => {
  beforeEach(() => vi.clearAllMocks());
  it('finishes unchanged groups without suggesting product changes', () => {
    const html = renderToStaticMarkup(
      <GoodsImportScreen
        initialView={{
          ...view,
          groups: [{ ...group, kind: 'unchanged', warnings: [] }],
        }}
      />,
    );
    expect(html).toContain('변경 없이 완료');
    expect(html).not.toContain('검증한 1개 상품 적용');
  });
  it('shows row numbers and published-change warning without applying on load', () => {
    const html = renderToStaticMarkup(<GoodsImportScreen initialView={view} />);
    expect(html).toContain('5, 6');
    expect(html).toContain('공개 상품의 가격·재고가 변경됩니다.');
    expect(mocks.commit).not.toHaveBeenCalled();
    expect(html).toContain('검증한 1개 상품 적용');
  });
  it('reports completed results without exposing a second save button', () => {
    const html = renderToStaticMarkup(
      <GoodsImportScreen
        initialView={{
          ...view,
          state: 'complete',
          groups: [{ ...group, result: { status: 'success', id: 'good' } }],
        }}
      />,
    );
    expect(html).toContain('저장 완료');
    expect(html).not.toContain('검증한 1개 상품 적용');
  });
  it('offers a reusable failure workbook and keeps upload available', () => {
    const html = renderToStaticMarkup(
      <GoodsImportScreen
        initialView={{
          ...view,
          state: 'complete',
          groups: [
            {
              ...group,
              result: { status: 'failed', error: '재고가 바뀌었습니다.' },
            },
          ],
        }}
      />,
    );
    expect(html).toContain('mode=failures');
    expect(html).toContain('실패 행 내려받기');
    expect(html).toContain('상품 XLSX');
  });
});

describe('사방넷 상품 양식 화면', () => {
  it('양식 선택은 ICONS 자체 양식이 기본이고 사방넷 상품 양식을 고를 수 있다', () => {
    const html = renderToStaticMarkup(<GoodsImportScreen />);
    expect(html).toContain('ICONS 자체 양식');
    expect(html).toContain('사방넷 상품 양식');
    expect(html).toContain('상품 XLSX');
    expect(html).not.toContain('열 확인');
  });

  it('사방넷 미리보기는 초안 만들기와 ICONS 양식 실패 행 안내를 보여 준다', () => {
    const html = renderToStaticMarkup(
      <GoodsImportScreen initialView={{ ...view, format: 'sabangnet', groups: [{ ...group, kind: 'new', warnings: [] }] }} />,
    );
    expect(html).toContain('3. 검증 결과 확인·초안 만들기');
    expect(html).toContain('검증한 1개 상품 초안 만들기');
    expect(html).toContain('사방넷 상품 파일');
    expect(html).toContain('열 확인');
    expect(html).toContain('ICONS 양식으로 내려받습니다');
    expect(html).not.toContain('상품 XLSX');
  });

  it('열 연결 단계는 인식 상태·ICONS 항목 선택·필수 IP·브랜드별 IP 제안을 보여 준다', () => {
    const headers = ['상품명', '브랜드명', '소비자가', '사방넷 메모'];
    const { targets, status } = suggestSabangnetTargets(headers);
    const html = renderToStaticMarkup(
      <SabangnetMappingStep
        inspection={{
          id: 'batch', fileName: 'sabangnet.xlsx', headerRow: 3, rowCount: 2,
          columns: [
            { header: '상품명', sample: '머그', values: ['머그', '키링'] },
            { header: '브랜드명', sample: '메이플스토리', values: ['메이플스토리', '기타'] },
            { header: '소비자가', sample: '18000', values: ['18000'] },
            { header: '사방넷 메모', sample: '메모' },
          ],
          ips: [{ id: 'maple', title: '메이플스토리' }],
        }}
        targets={targets}
        columnStates={status}
        ipId=""
        brandIps={{ 메이플스토리: 'maple' }}
        busy={false}
        onTarget={() => {}}
        onIp={() => {}}
        onBrandIp={() => {}}
        onPreview={() => {}}
      />,
    );
    expect(html).toContain('3행을 열 이름으로 읽었습니다');
    expect(html).toContain('확인이 필요한 열 2개');
    expect(html).toContain('연결 IP (필수)');
    expect(html).toContain('required');
    expect(html).toContain('자동 인식');
    expect(html).toContain('추정 · 확인 필요');
    expect(html).toContain('인식 못 함 · 직접 선택');
    expect(html).toContain('사방넷 메모 열을 연결할 ICONS 항목');
    expect(html).toContain('고시정보 · 제조사 / 수입사');
    expect(html).toContain('메이플스토리 브랜드 상품을 연결할 IP');
    expect(html).toContain('미리보기 만들기');
    expect(html).not.toContain('슬롯');
  });
});
