import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { GoodsNoticePreset } from '@/lib/admin/goods-notice-presets';
import { GoodsNoticePresetsScreen } from './GoodsNoticePresetsScreen';
import { GoodsNoticePresetForm, noticePresetReadback } from './GoodsNoticePresetForm';

vi.mock('@/app/admin/goods-notice-preset-actions', () => ({ saveGoodsNoticePresetAction: vi.fn(), deleteGoodsNoticePresetAction: vi.fn() }));
/* 목록 요약은 상품등록 선택창의 요약 함수를 쓴다. 그 파일이 부르는 서버 액션은 이 화면에서 쓰지 않는다. */
vi.mock('@/app/admin/good-notice-actions', () => ({ findGoodNoticePresets: vi.fn(), loadGoodNoticeOf: vi.fn() }));

const preset = (overrides: Partial<GoodsNoticePreset> = {}): GoodsNoticePreset => ({
  id: 'preset-1', name: '아크릴 기본', updatedAt: '2026-09-08T01:00:00Z',
  kcTemplate: { family: 'living', scheme: 'not_applicable', publicNote: '합성 안내' },
  notice: { maker: '아이콘스', origin: '대한민국', material: '아크릴', size: '80mm', madeOn: '2026-09', asManager: '엑스스퀘어 고객센터', asContact: '02-000-0000' },
  ...overrides,
});
const screen = (presets: GoodsNoticePreset[], query = '') => renderToStaticMarkup(<GoodsNoticePresetsScreen data={{ total: presets.length, filters: { query, page: 1 }, presets }} />);
const NOTICE_NAMES = ['noticeMaker', 'noticeOrigin', 'noticeMaterial', 'noticeSize', 'noticeMadeOn', 'noticeAsManager', 'noticeAsContact'];
const inputTag = (html: string, name: string) => html.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))?.[0] ?? '';

describe('상품정보제공고시 템플릿 관리 화면', () => {
  it('이름과 고시 7칸을 읽고 고칠 수 있다', () => {
    const html = screen([preset()]);
    for (const name of ['name', ...NOTICE_NAMES]) expect(html).toContain(`name="${name}"`);
    expect(html).toContain('value="아크릴 기본"');
    expect(html).toContain('value="아이콘스"');
    expect(html).toContain('value="02-000-0000"');
    expect(html).toContain('템플릿 수정 저장');
    expect(html).toContain('action="/admin/catalog/notice-presets"');
    // 서버 액션 폼의 제출 버튼은 submit이다(kit 버튼의 기본 type은 button).
    for (const label of ['템플릿 수정 저장', '검색']) expect(html).toMatch(new RegExp(`<button(?=[^>]*type="submit")[^>]*>${label}</button>`));
    /* 등록은 화면 머리 오른쪽 버튼이 여는 팝업이다(템플릿 화면군 공통 위치). 팝업의 등록 폼도 제출 버튼을 쓴다. */
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>(?:<svg[\s\S]*?<\/svg>)?새 템플릿 등록<\/button>/);
    const create = renderToStaticMarkup(<GoodsNoticePresetForm inset={false} />);
    expect(create).toMatch(/<button(?=[^>]*type="submit")[^>]*>템플릿 등록<\/button>/);
    expect(create).toContain('name="noticeAsContact"');
    /* 화면 말은 '템플릿' 하나다. */
    expect(html).not.toContain('프리셋');
  });

  it('KC 유형 틀의 이름은 상품등록의 KC 정보와 같다', () => {
    const html = screen([preset()]);
    expect(html).toContain('KC 유형 틀 · 선택');
    expect(html).toContain('KC 유형 틀 포함');
    expect(html).toContain('>적용 제도</label>');
    expect(html).not.toContain('KC 모델 틀');
    expect(html).toContain('합성 안내');
    expect(html).toContain('해당 없음 고객 안내 (선택)');
    expect(html).toContain('name="kcTemplate"');
    expect(html).toContain('검토 완료 상태는 복사하지 않습니다');
  });

  it('고시 칸은 비워 둘 수 있고, 이름만 꼭 적는다. 상품마다 다른 칸은 비워 두는 것을 권한다', () => {
    const create = renderToStaticMarkup(<GoodsNoticePresetForm inset={false} />);
    expect(inputTag(create, 'name')).toContain('required');
    for (const name of NOTICE_NAMES) expect(inputTag(create, name)).not.toContain('required');
    for (const name of ['noticeSize', 'noticeMadeOn']) expect(inputTag(create, name)).toContain('placeholder="비워 두면 상품에 적은 값 그대로"');
    expect(inputTag(create, 'noticeMaker')).toContain('placeholder="주식회사 아이콘스"');
    expect(create).toContain('적은 칸만 상품에 가져옵니다. 비운 칸은 상품에 적어 둔 값 그대로입니다.');
  });

  it('적은 칸과 비운 칸이 상품에서 어떻게 되는지 한 줄로 되읽는다', () => {
    expect(noticePresetReadback([])).toBe('적은 칸만 상품에 가져옵니다. 비운 칸은 상품에 적어 둔 값 그대로입니다.');
    expect(noticePresetReadback(['maker', 'origin', 'material', 'asManager', 'asContact']))
      .toBe('상품에 가져오면 5개 칸이 이 내용으로 바뀝니다. 비운 칸(크기 · 중량, 제조연월)은 상품에 적어 둔 값 그대로입니다.');
    expect(noticePresetReadback(['maker', 'origin', 'material', 'size', 'madeOn', 'asManager', 'asContact'])).toBe('상품에 가져오면 7개 칸이 모두 이 내용으로 바뀝니다.');
    /* 저장된 템플릿은 저장된 값으로 되읽는다. */
    const html = screen([preset({ notice: { ...preset().notice, size: '', madeOn: '' } })]);
    expect(html).toContain('상품에 가져오면 5개 칸이 이 내용으로 바뀝니다. 비운 칸(크기 · 중량, 제조연월)은 상품에 적어 둔 값 그대로입니다.');
    expect(inputTag(html, 'noticeSize')).toContain('value=""');
  });

  it('목록 한 줄은 상품등록의 템플릿 선택창과 같은 요약(제조사 · 소재 · KC 유형 틀)을 보인다', () => {
    const html = screen([preset()]);
    expect(html).toContain('제조사 아이콘스 · 소재 아크릴 · KC 유형 틀 포함');
    expect(html).not.toContain('아이콘스 · 대한민국');
    /* 제조사·소재를 비운 템플릿은 적어 둔 첫 칸을 대신 보여 요약이 비지 않는다(2026-11-26 브라우저 확인). 일곱 칸이 다 비면 이름만 보인다. */
    const bare = screen([preset({ kcTemplate: null, notice: { ...preset().notice, maker: '', material: '' } })]);
    expect(bare).toContain('<strong class="font-medium">아크릴 기본</strong><span class="text-sm text-muted-foreground">원산지 대한민국</span></span>');
    const empty = screen([preset({ kcTemplate: null, notice: { maker: '', origin: '', material: '', size: '', madeOn: '', asManager: '', asContact: '' } })]);
    expect(empty).toContain('<strong class="font-medium">아크릴 기본</strong></span>');
  });

  it('삭제는 버튼 하나다(확인은 확인창이 한다). 접힌 링크·체크·삭제 확정은 없다', () => {
    const html = screen([preset()]);
    expect(html).toMatch(/<button(?=[^>]*type="button")[^>]*>삭제<\/button>/);
    for (const gone of ['삭제 확정', '이 템플릿을 삭제하겠습니다', 'name="confirmed"', '템플릿 삭제']) expect(html).not.toContain(gone);
    /* 등록 폼에는 삭제가 없다. */
    expect(renderToStaticMarkup(<GoodsNoticePresetForm inset={false} />)).not.toMatch(/>삭제<\/button>/);
  });

  it('머리 설명은 한 문장이고, 상품 값이 그대로라는 말은 삭제 확인창에만 둔다', () => {
    const html = screen([preset()]);
    expect(html).toContain('자주 쓰는 고시 내용을 저장해 두고 상품등록에서 가져옵니다.');
    for (const gone of ['기존 상품에 입력된 값은 바뀌지 않습니다', '이름을 열어 7개 항목을 수정할 수 있습니다']) expect(html).not.toContain(gone);
  });

  it('이름 칸 아래에 상품등록이 이 템플릿을 권하는 규칙을 적고, 원산지 칸에는 상품등록과 같은 고르기 버튼이 있다', () => {
    const create = renderToStaticMarkup(<GoodsNoticePresetForm inset={false} />);
    expect(create).toContain('이름에 카테고리 이름(예: 키링)을 넣으면 그 카테고리 상품을 등록할 때 먼저 권합니다.');
    expect(create).toMatch(/<button(?=[^>]*type="button")(?=[^>]*aria-label="원산지 고르기")[^>]*>/);
    /* 원산지 칸은 한 화면에 폼마다 있다. 칸 번호가 겹치지 않아야 이름을 눌렀을 때 제 칸으로 간다. */
    const html = screen([preset(), preset({ id: 'preset-2', name: '키링 공통' })]);
    const ids = [...html.matchAll(/<input(?=[^>]*name="noticeOrigin")[^>]*?\sid="([^"]+)"/g)].map((match) => match[1]);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it('결과가 없는 검색에서도 등록과 검색 초기화를 제공한다', () => {
    const html = screen([], '없는 이름');
    expect(html).toContain('새 템플릿 등록');
    expect(html).toContain('조건에 맞는 템플릿이 없습니다.');
    expect(html).toContain('전체 템플릿 보기');
    expect(screen([])).toContain('아직 등록된 템플릿이 없습니다. [새 템플릿 등록]으로 만들어 주세요.');
  });
});
