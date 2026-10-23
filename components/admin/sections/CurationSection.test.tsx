import { renderToStaticMarkup } from 'react-dom/server';
vi.mock('@/app/admin/curation-archive-actions', () => ({ readArchivedHeroBannersAction: vi.fn(), setHeroBannerArchivedAction: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminCurationActionState } from '@/lib/admin/curations';
import type { AdminCurationRecord } from '@/lib/admin/curations.server';
import { CurationSection, getCurationFormKey } from './CurationSection';

const mocks = vi.hoisted(() => ({
  action: vi.fn(),
  onSelect: vi.fn(),
  reducer: null as null | ((state: AdminCurationActionState, data: FormData) => Promise<AdminCurationActionState>),
  state: {} as AdminCurationActionState,
}));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useActionState: (reducer: typeof mocks.reducer) => {
    mocks.reducer = reducer;
    return [mocks.state, vi.fn(), false];
  },
}));
vi.mock('@/app/admin/curation-actions', () => ({ upsertAdminCurationAction: mocks.action }));
vi.mock('@/components/ui/Icon', () => ({ Icon: () => null }));
vi.mock('../../../lib/admin/artwork-upload.client', () => ({ uploadAdminArtwork: vi.fn() }));

const record: AdminCurationRecord = {
  id: '11111111-1111-4111-8111-111111111111', kind: 'hero', ipId: null, title: '여름 신작',
  imagePath: 'public-media/catalog/curation/77777777-7777-4777-8777-777777777777.webp',
  imageUrl: 'https://cdn.example/desktop.webp', mobileImageUrl: 'https://cdn.example/mobile.webp',
  linkPath: '/shop/g13', displayOrder: 2, activeFrom: '2026-07-15T00:00:00.000Z', activeTo: null,
  enabled: true, slot: null, payload: { subtitle: '여름 한정', mobile_image_path: 'public-media/catalog/curation/99999999-9999-4999-8999-999999999999.webp' },
  createdAt: '2026-07-14T00:00:00.000Z', updatedAt: '2026-07-15T01:00:00.000Z', status: 'active',
};
const goodOptions = [
  { id: 'g13', title: '홍실 아크릴 블록', archivedAt: null },
  { id: 'archived-good', title: '보관 상품', archivedAt: '2026-07-01' },
];
/* 체크박스 하나의 태그 — 속성 순서와 무관하게 값으로 찾는다. */
function checkboxTag(html: string, value: string) {
  return html.match(new RegExp(`<input[^>]*name="pageTypes"[^>]*value="${value}"[^>]*/>`))?.[0] ?? '';
}
function renderSection(selected: AdminCurationRecord | null = record) {
  return renderToStaticMarkup(<CurationSection
    draftActiveFrom="2026-07-15T03:04:05.000Z" draftId="22222222-2222-4222-8222-222222222222"
    eventOptions={[]} goodOptions={goodOptions} ipOptions={[{ id: 'ip-1', title: '홍실', archivedAt: null }]}
    onSelect={mocks.onSelect} operationId="33333333-3333-4333-8333-333333333333" records={selected ? [selected] : []} selected={selected}
  />);
}

describe('CurationSection', () => {
  it('keeps missing legacy banner style selected and exposes archive only on saved heroes', () => {
    const html = renderSection(record);
    expect(html).toContain('name="imageDim"'); expect(html).toContain('name="textColor"');
    expect(html).toContain('<option value="" selected="">기존 표시 유지</option>');
    expect(html).toContain('배너 삭제'); expect(html).toContain('삭제한 배너');
    const styled = renderSection({ ...record, payload: { image_dim: 'white', text_color: 'black' } });
    expect(styled).toContain('value="white" selected=""'); expect(styled).toContain('value="black" selected=""');
  });
  beforeEach(() => { mocks.action.mockReset(); mocks.onSelect.mockReset(); mocks.reducer = null; mocks.state = {}; });
  it('edits free-product design, shape, candidates and count without an artwork or destination input', () => {
    const html = renderSection({ ...record, kind: 'product_collection', imagePath: null, imageUrl: null, linkPath: null,
      payload: { layout: 'full_image', image_shape: 'landscape', item_count: 8, good_ids: ['g13', 'gone'] } });
    for (const name of ['productLayout', 'productImageShape', 'productItemCount', 'goodIds']) expect(html).toContain(`name="${name}"`);
    expect(html).toContain('value="full_image" selected=""');
    expect(html).toContain('value="landscape" selected=""');
    expect(html).toContain('type="hidden" name="linkPath" value=""');
    expect(html).toContain('type="hidden" name="goodIds" value="g13, gone"');
    expect(html).toContain('자유상품 1 / 5개 · 모자이크·비노출·종료 포함');
    expect(html).not.toContain('data-artwork-kind="curation"');
    expect(html).not.toContain('눌렀을 때 이동할 화면');
  });

  it('배너 문구와 대체텍스트를 분리하고 null 링크와 저장본 시각을 유지한다', () => {
    const html = renderSection({ ...record, title: '', linkPath: null, payload: { alt_enabled: true, alt_title: '이미지 제목', alt_content: '이미지 설명' } });
    expect(html).toContain('제목 없는 배너');
    expect(html).toContain('대체텍스트 제목');
    expect(html).toContain('대체텍스트 내용');
    expect(html).toContain('value="이미지 제목"');
    expect(html).toContain('>이미지 설명</textarea>');
    expect(html).toContain('<option value="" selected="">링크 없음</option>');
    expect(html).toContain(`type="hidden" name="expectedUpdatedAt" value="${record.updatedAt}"`);
    expect(html).toContain('프로모션 배너 1 / 10개 · 비노출 포함');
  });

  it('응답 불명확 때 같은 원본 요청만 재확인하고 필드 편집을 잠근다', async () => {
    renderSection();
    const first = new FormData(); first.set('id', record.id); first.set('title', '보낸 원본');
    const changed = new FormData(); changed.set('id', record.id); changed.set('title', '바꾼 값');
    mocks.action.mockResolvedValueOnce({ errors: { form: '결과 확인 필요' }, uncertain: true });
    await mocks.reducer!({}, first);
    mocks.action.mockResolvedValueOnce({ message: '저장했습니다.' });
    await mocks.reducer!({ uncertain: true }, changed);
    expect(mocks.action.mock.calls[1][1].get('title')).toBe('보낸 원본');
    mocks.state = { errors: { form: '결과 확인 필요' }, uncertain: true };
    expect(renderSection()).toContain('<fieldset disabled="">');
    expect(renderSection()).toContain('같은 요청 결과 확인');
  });

  it('keeps a lost save request fixed when a later retry is denied or conflicts', async () => {
    renderSection();
    const first = new FormData(); first.set('id', record.id); first.set('title', '첫 요청');
    mocks.action.mockResolvedValueOnce({ errors: { form: '응답 유실' }, uncertain: true });
    await mocks.reducer!({}, first);
    for (const denied of [{ errors: { form: '권한 없음' } }, { errors: { form: '충돌' }, conflict: true }]) {
      mocks.action.mockResolvedValueOnce(denied);
      expect(await mocks.reducer!({ uncertain: true }, new FormData())).toMatchObject({ uncertain: true, conflict: false });
      expect(mocks.action.mock.lastCall?.[1]).toBe(first);
    }
  });

  it('저장본 충돌은 입력을 유지하고 명시적인 다시 불러오기를 제공한다', () => {
    mocks.state = { errors: { form: '저장본 충돌' }, conflict: true };
    const html = renderSection();
    expect(html).toContain('value="여름 신작"');
    expect(html).toContain('<fieldset disabled="">');
    expect(html).toContain('입력을 취소하고 최신 저장본 불러오기');
  });

  it('구성 목록·입력·실제 화면 미리보기와 기기 전환을 함께 제공한다', () => {
    const html = renderSection();
    expect(html).toContain('aria-label="홈 구성 목록"');
    expect(html).toContain('aria-label="홈 구성 편집"');
    expect(html).toContain('aria-label="스토어 미리보기"');
    expect(html).toContain('aria-current="true"');
    expect(html).toContain('여름 신작');
    expect(html).toContain('노출 중');
    expect(html).toContain('순서 2');
    expect(html).toContain('2026-07-15 09:00 KST');
    expect(html).toContain('모바일');
    expect(html).toContain('PC');
    expect(html).toContain('전체보기');
    expect(html).toContain('미리보기 준비 중…');
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('allow-scripts');
    expect(html).toContain('현재 공개 홈');
  });

  it('PC·모바일 이미지, 순서·KST 일정과 기존 RPC 필드 계약을 유지한다', () => {
    const html = renderSection();
    for (const field of ['id', 'operationId', 'kind', 'title', 'subtitle', 'linkPath', 'imagePath', 'mobileImagePath', 'displayOrder', 'activeFrom', 'activeTo', 'enabled']) {
      expect(html).toContain(`name="${field}"`);
    }
    expect(html).toContain('>여름 한정</textarea>');
    expect(html).toContain('PC 이미지');
    expect(html).toContain('모바일 이미지');
    expect(html.match(/data-artwork-kind="curation"/g)).toHaveLength(2);
    expect(html).toContain('value="2026-07-15T09:00"');
    expect(html).toContain('이 구성 적용하기');
  });

  it('이동 대상에 실재 상품을 표시하고 보관 상품을 새 선택지에서 제외한다', () => {
    const select = renderSection().match(/<select[^>]*name="linkPath"[\s\S]*?<\/select>/)?.[0];
    expect(select).toContain('value="/shop/g13"');
    expect(select).not.toContain('/shop/archived-good');
  });

  it('상품을 이름과 순서로 편집하고 기존 상품 ID 제출 형식을 유지한다', () => {
    const html = renderSection({ ...record, kind: 'best_tab', slot: 'popular', payload: { good_ids: ['g13', 'gone'] } });
    expect(html).toContain('전시할 상품');
    expect(html).toContain('상품 추가');
    expect(html).toContain('홍실 아크릴 블록 위로');
    expect(html).toContain('홍실 아크릴 블록 아래로');
    expect(html).toContain('현재 선택 상품');
    expect(html).toContain('type="hidden" name="goodIds" value="g13, gone"');
    expect(html).toContain('value="popular" selected=""');
    expect(html).not.toContain('data-artwork-kind="curation"');
  });

  it('검증 실패를 표시하면서 편집 값과 업로드된 경로를 유지한다', () => {
    mocks.state = { errors: { title: '제목을 확인해주세요.', imagePath: '이미지를 확인해주세요.' } };
    const html = renderSection();
    expect(html).toContain('제목을 확인해주세요.');
    expect(html).toContain('value="여름 신작"');
    expect(html).toContain(record.imagePath);
    expect(html).toContain('aria-invalid="true"');
  });

  it('실패한 저장은 선택을 이동하지 않고 성공한 저장만 실제 id를 선택한다', async () => {
    renderSection();
    const data = new FormData(); data.set('id', record.id);
    mocks.action.mockResolvedValueOnce({ errors: { form: '저장 실패' } });
    await mocks.reducer!({}, data);
    expect(mocks.onSelect).not.toHaveBeenCalled();
    mocks.action.mockResolvedValueOnce({ message: '저장했습니다.' });
    await mocks.reducer!({}, data);
    expect(mocks.onSelect).toHaveBeenCalledWith({ id: record.id });
    expect(mocks.action).toHaveBeenCalledWith({}, data);
  });

  it('현재 공개 홈에 없는 기존 타입은 가짜 미리보기를 만들지 않는다', () => {
    const html = renderSection({ ...record, kind: 'featured_ip', ipId: 'ip-1' });
    expect(html).toContain('현재 홈 본문에는 특집 IP 영역이 없습니다.');
    expect(html).toContain('name="ipId"');
    expect(html).not.toContain('<iframe');
  });

  it('텍스트 공지 바는 문구·선택 버튼·노출 화면을 편집하고 이미지 업로드를 두지 않는다', () => {
    const notice: AdminCurationRecord = { ...record, kind: 'notice_bar', title: '이용약관 개정 안내', imagePath: null, imageUrl: null, mobileImageUrl: null,
      linkPath: '/shop/g13', payload: { page_types: ['home', 'product'], cta_label: '자세히 보기' } };
    const html = renderSection(notice);
    expect(html).toContain('텍스트 공지 바 관리');
    expect(html).toContain('공지 문구');
    expect(html).toContain('10 / 60자');
    expect(html).toContain('name="ctaLabel"');
    expect(html).toContain('value="자세히 보기"');
    expect(html).toContain('버튼을 눌렀을 때 이동할 화면');
    expect(html).toContain('<option value="">링크 없음</option>');
    expect(html).toContain('type="hidden" name="pageTypesField" value="1"');
    expect(checkboxTag(html, 'home')).toContain('checked=""');
    expect(checkboxTag(html, 'collection')).toContain('type="checkbox"');
    expect(checkboxTag(html, 'collection')).not.toContain('checked');
    expect(checkboxTag(html, 'product')).toContain('checked=""');
    expect(html).toContain('상품 목록(굿즈샵·NEW·BEST·IP관)');
    expect(html).not.toContain('data-artwork-kind="curation"');
    expect(html).toContain('type="hidden" name="imagePath" value=""');
    /* 띠배너를 공지 바로 바꿔도 이전 이미지 경로를 싣지 않는다 — 이미지 칸이 없어 오류를 보여 줄 자리도 없다. */
    expect(renderSection({ ...notice, imagePath: record.imagePath })).toContain('type="hidden" name="imagePath" value=""');
    /* 링크를 비우면 버튼 문구 칸이 사라진다 — 저장 계약에서도 버튼 문구를 싣지 않는다. */
    expect(renderSection({ ...notice, linkPath: null })).not.toContain('name="ctaLabel"');
  });

  it('띠배너도 노출 화면을 고르고, 대상 없이 저장된 기존 띠배너는 모든 화면이 켜진 채로 보인다', () => {
    const strip: AdminCurationRecord = { ...record, kind: 'notice_strip', payload: null };
    const html = renderSection(strip);
    for (const type of ['home', 'collection', 'product', 'content', 'other']) {
      expect(checkboxTag(html, type), type).toContain('checked=""');
    }
    expect(html).toContain('스토어를 새로 열 때마다 하나를 무작위로 보여줍니다');
    expect(renderSection({ ...strip, payload: { page_types: ['product'] } })).toContain('홈이 노출 화면에 없어 공개 홈에서는 보이지 않습니다.');
  });

  it('저장본 변경은 폼을 초기화하지만 서버 요청 ID 교체는 폼의 식별자가 아니다', () => {
    expect(getCurationFormKey(record, 'draft')).not.toBe(getCurationFormKey({ ...record, updatedAt: 'later' }, 'draft'));
    expect(getCurationFormKey(record, 'draft')).toBe(getCurationFormKey(record, 'other-server-draft'));
    expect(getCurationFormKey(null, 'draft')).not.toBe(getCurationFormKey(null, 'new-explicit-draft'));
  });
});
