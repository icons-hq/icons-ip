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
import { SABANGNET_GALLERY_LIMIT, suggestSabangnetTargets } from '@/lib/admin/sabangnet-goods-format';
const group = {
  index: 0,
  code: 'G0001',
  name: '검증한 상품',
  rows: [5, 6],
  kind: 'update' as const,
  errors: [],
  warnings: ['공개 상품의 가격·재고가 변경됩니다.'],
  result: null,
  skippedImages: 0,
  retryable: true,
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
  it('카테고리 코드·원산지 고르기를 파일 업로드·적용과 별도 버튼으로 제공한다(선택창 여는 버튼은 [○○ 고르기])', () => {
    const html = renderToStaticMarkup(<GoodsImportScreen />);
    expect(html).toContain('카테고리 코드 고르기');
    expect(html).toContain('원산지 고르기');
    for (const stale of ['카테고리 찾기', '제조국 찾기']) expect(html).not.toContain(stale);
    expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.commit).not.toHaveBeenCalled();
  });
  it('판매가가 바뀌는 행은 이전 → 새 금액을 보이고 0원·자릿수 오타는 확인 표시를 붙인다(CAT-108)', () => {
    const same = (price: number) => ({ regularPrice: price, salePrice: price });
    const html = renderToStaticMarkup(
      <GoodsImportScreen
        initialView={{
          ...view,
          groups: [
            { ...group, index: 0, name: '인상', priceChange: { saved: same(29000), next: same(30000), publishing: false } },
            { ...group, index: 1, name: '오타', priceChange: { saved: same(29000), next: same(2900), publishing: false } },
          ],
        }}
      />,
    );
    expect(html).toContain('판매가 29,000원 → 30,000원');
    expect(html).toContain('판매가 29,000원 → 2,900원 (이전 금액의 절반 이하');
    expect(html.match(/data-price-check="true"/g)).toHaveLength(1);
  });
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
    expect(html).toContain('role="region" aria-label="상품 엑셀 결과 가로 스크롤" tabindex="0"');
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
    expect(html).toContain('실패한 줄 내려받기');
    expect(html).toContain('고친 뒤 다시 올려주세요. 이미지 파일명을 썼다면 처음 올린 이미지 ZIP도 함께 올려주세요.');
    expect(html).toContain('상품 XLSX');
    expect(html).not.toContain('실패 행');
  });
});

describe('상품 일괄등록 순서와 주의', () => {
  it('덮어쓰기 주의는 주의 상자로, 몇 단계 중 어디인지는 순서 표시로 보이고 양식 내려받기는 첫 단계 안에 있다', () => {
    const html = renderToStaticMarkup(<GoodsImportScreen />);
    expect(html).toMatch(/data-admin-notice="warning"[\s\S]*?상품번호나 상품 자동코드가 같으면 기존 상품을 수정합니다/);
    expect(html).toMatch(/<ol aria-label="진행 순서"[\s\S]*?<li aria-current="step"[\s\S]*?파일 올리기[\s\S]*?검증 결과 확인·적용[\s\S]*?<\/ol>/);
    expect(html.indexOf('mode=template')).toBeGreaterThan(html.indexOf('1. 파일 올리기'));
    const done = renderToStaticMarkup(<GoodsImportScreen initialView={view} />);
    expect(done).toMatch(/<li aria-current="step"(?:(?!<\/li>)[\s\S])*검증 결과 확인·적용/);
  });

  it('올리기 한도는 파일 칸 아래 한 줄이고, 주의 상자는 덮어쓰기 경고 한 줄뿐이다(M-06)', () => {
    const html = renderToStaticMarkup(<GoodsImportScreen />);
    expect(html.match(/data-admin-notice=/g)).toHaveLength(1);
    expect(html).toMatch(/<p[^>]*id="goods-workbook-hint"[^>]*>2MB·500줄까지입니다\. 예전에 내려받은 양식도 올릴 수 있습니다\.<\/p>/);
    expect(html).toMatch(/<p[^>]*id="goods-images-hint"[^>]*>[^<]*50MB까지입니다\.<\/p>/);
    expect(html).toContain('aria-describedby="goods-workbook-hint"');
    for (const removed of ['옵션을 모두 포함해주세요', '별도 시트', '안내 시트나 상품 행을 빼면', '상품·옵션 최대 500행']) expect(html, removed).not.toContain(removed);
  });

  it('화면에 개발 값(v3~v7·ID·버전)과 행 대신 줄을 쓴다(M-02·M-07)', () => {
    const icons = renderToStaticMarkup(<GoodsImportScreen />);
    const done = renderToStaticMarkup(<GoodsImportScreen initialView={view} />);
    for (const html of [icons, done]) for (const stale of ['v3', 'v7', 'ID·버전', '번호 칸', '행']) expect(html.replace(/<[^>]+>/g, ' '), stale).not.toContain(stale);
    expect(done).toContain('goods.xlsx · 1개 상품 · 엑셀 2줄');
    expect(done).toMatch(/<th[^>]*>엑셀 줄<\/th>/);
    expect(done).toContain('상품 엑셀 줄별 검증 결과');
  });

  it('버튼은 누르면 일어나는 일을 말한다(M-05)', () => {
    const icons = renderToStaticMarkup(<GoodsImportScreen />);
    expect(icons).toContain('파일 올리고 확인하기');
    expect(icons).not.toContain('파일 검증');
    const errorsOnly = renderToStaticMarkup(<GoodsImportScreen initialView={{ ...view, groups: [{ ...group, kind: 'error', errors: ['상품명을 입력해주세요.'], warnings: [] }] }} />);
    expect(errorsOnly).toContain('오류만 기록하고 끝내기');
    expect(errorsOnly).not.toContain('검증 오류 결과 확정');
  });

  it('결과 아래 설명 문단은 없고, 24시간 안내는 끝나지 않은 작업에만 보인다', () => {
    const open = renderToStaticMarkup(<GoodsImportScreen initialView={view} />);
    expect(open).toContain('이 작업은 24시간 동안 이어서 열 수 있습니다.');
    for (const removed of ['함께 성공하거나 실패합니다', '변경 없는 상품은', '해당 상품만 실패합니다', '모든 상품을 초안으로 만들고']) expect(open, removed).not.toContain(removed);
    const finished = renderToStaticMarkup(<GoodsImportScreen initialView={{ ...view, state: 'complete', groups: [{ ...group, result: { status: 'success', id: 'good' } }] }} />);
    expect(finished).not.toContain('24시간');
    expect(finished).not.toContain('고친 뒤');
  });
});

describe('사방넷 상품 양식 화면', () => {
  it('양식 선택은 엑스스퀘어 자체 양식이 기본이고 사방넷 상품 양식을 고를 수 있다', () => {
    const html = renderToStaticMarkup(<GoodsImportScreen />);
    expect(html).toContain('엑스스퀘어 자체 양식');
    expect(html).toContain('사방넷 상품 양식');
    expect(html).toContain('상품 XLSX');
    expect(html).not.toContain('열 확인');
  });

  it('사방넷 미리보기는 초안 만들기와 엑스스퀘어 양식 실패 행 안내를 보여 준다', () => {
    const html = renderToStaticMarkup(
      <GoodsImportScreen initialView={{ ...view, format: 'sabangnet', groups: [{ ...group, kind: 'new', warnings: [] }] }} />,
    );
    expect(html).toContain('3. 검증 결과 확인·초안 만들기');
    expect(html).toContain('검증한 1개 상품 초안 만들기');
    expect(html).toContain('사방넷 상품 파일');
    expect(html).toContain('열 읽어 오기');
    expect(html).not.toContain('상품 XLSX');
    /* 실패한 줄이 없으면 실패 파일 안내도 없다. 있을 때만 그 파일로 무엇을 하는지 말한다. */
    expect(html).not.toContain('엑스스퀘어 양식으로 내려받습니다');
    const failedHtml = renderToStaticMarkup(
      <GoodsImportScreen initialView={{ ...view, format: 'sabangnet', groups: [{ ...group, kind: 'error', warnings: [], errors: ['상품명을 입력해주세요.'] }] }} />,
    );
    expect(failedHtml).toContain('실패한 줄 내려받기');
    expect(failedHtml).toContain('엑스스퀘어 양식으로 내려받습니다. 고친 뒤 양식을 “엑스스퀘어 자체 양식”으로 바꿔 올려주세요.');
  });

  it('사방넷 파일의 올리기 한도는 파일 칸 아래 한 줄이고, 흩어져 있던 안내 문단은 없다(M-06)', () => {
    const html = renderToStaticMarkup(<GoodsImportScreen initialView={{ ...view, format: 'sabangnet', groups: [{ ...group, kind: 'new', warnings: [] }] }} />);
    expect(html).toMatch(/<p[^>]*id="sabangnet-workbook-hint"[^>]*>\.xlsx 또는 \.csv · 2MB까지 · 옵션을 한 줄씩 펼쳐 500줄까지 · 이미지는 한 번에 200장까지<\/p>/);
    expect(html).toContain('aria-describedby="sabangnet-workbook-hint"');
    for (const removed of ['옵션 조합을 펼쳐', '안내 행', '이미 등록된 상품 자동코드는 수정하지 않고', '.xls 파일은 엑셀에서']) expect(html, removed).not.toContain(removed);
  });

  it('다시 연 사방넷 작업도 저장된 결과로 뺀 이미지 수를 보여 준다', () => {
    const html = renderToStaticMarkup(
      <GoodsImportScreen
        initialView={{
          ...view, format: 'sabangnet', state: 'complete',
          groups: [{ ...group, kind: 'new', warnings: [], skippedImages: 2, result: { status: 'success', id: 'good' } }],
        }}
      />,
    );
    expect(html).toContain('초안 저장 완료');
    expect(html).toContain('이미지 2장은 확인하지 못해 빼고 저장했습니다');
  });

  it('이미 등록된 상품코드 오류만 있으면 실패 행 내려받기를 보이지 않는다', () => {
    const existing = { ...group, kind: 'error' as const, warnings: [], errors: ['이미 등록된 상품코드입니다.'], retryable: false };
    const only = renderToStaticMarkup(
      <GoodsImportScreen initialView={{ ...view, format: 'sabangnet', groups: [existing] }} />,
    );
    expect(only).toContain('이미 등록된 상품코드입니다.');
    expect(only).not.toContain('실패한 줄 내려받기');
    const mixed = renderToStaticMarkup(
      <GoodsImportScreen
        initialView={{ ...view, format: 'sabangnet', groups: [existing, { ...group, index: 1, kind: 'error' as const, errors: ['상품명을 입력해주세요.'] }] }}
      />,
    );
    expect(mixed).toContain('실패한 줄 내려받기');
  });

  it('열 연결 단계는 인식 상태·엑스스퀘어 항목 선택·필수 IP·브랜드별 IP 제안을 보여 준다', () => {
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
    expect(html).toContain('sabangnet.xlsx · 엑셀 3번째 줄을 열 이름으로 읽었습니다 · 상품 2줄 · 확인이 필요한 열 2개');
    expect(html).toContain('연결 IP (필수)');
    expect(html).toContain('required');
    expect(html).toContain('자동 인식');
    expect(html).toContain('추정 · 확인 필요');
    expect(html).toContain('인식 못 함 · 직접 선택');
    expect(html).toContain('사방넷 메모 열을 연결할 엑스스퀘어 항목');
    expect(html).toContain('고시정보 · 제조사 / 수입사');
    expect(html).toContain('메이플스토리 브랜드 상품을 연결할 IP');
    expect(html).toContain('미리보기 만들기');
    expect(html).not.toContain('슬롯');
    /* 2026-10-07 QA: JSX 줄바꿈 뒤 숫자가 붙어 "추가 이미지9장으로"로 보였다. */
    expect(html).toContain(`대표 이미지와 추가 이미지 ${SABANGNET_GALLERY_LIMIT}장까지 가져오고, 옵션 재고수량은 0으로 만듭니다.`);
  });

  it('연결할 항목 이름은 상품 수정 화면의 말이다: 사방넷 판매가는 할인가, TAG가는 판매가이고 옵션은 옵션명·옵션값이다(M-03·M-04)', () => {
    const headers = ['상품명', '판매가', 'TAG가', '옵션제목(1)', '옵션상세명칭(1)'];
    const { targets, status } = suggestSabangnetTargets(headers);
    const html = renderToStaticMarkup(
      <SabangnetMappingStep
        inspection={{ id: 'batch', fileName: 'sabangnet.xlsx', headerRow: 1, rowCount: 1, columns: headers.map((header) => ({ header, sample: '' })), ips: [{ id: 'maple', title: '메이플스토리' }] }}
        targets={targets} columnStates={status} ipId="" brandIps={{}} busy={false}
        onTarget={() => {}} onIp={() => {}} onBrandIp={() => {}} onPreview={() => {}}
      />,
    );
    const options = [...html.matchAll(/<option[^>]*>([^<]*)<\/option>/g)].map((match) => match[1]);
    for (const label of ['할인가(고객이 내는 금액)', '판매가(할인 전 금액)', '옵션명 1', '옵션값 1', '옵션명 2', '옵션값 2']) expect(options, label).toContain(label);
    for (const stale of ['옵션 축', '판매가(고객 결제 금액)', 'TAG가(할인 전 판매가)']) expect(html, stale).not.toContain(stale);
    /* 자동 인식은 그대로다: 판매가 열 → 할인가(고객이 내는 금액), TAG가 열 → 판매가(할인 전 금액). */
    expect(targets).toEqual(['name', 'price', 'compareAtPrice', 'optionTitle1', 'optionValues1']);
  });
});
