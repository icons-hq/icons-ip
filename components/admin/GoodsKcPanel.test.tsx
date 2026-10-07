import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { emptyGoodsKcModel, goodsKcProductNotApplicableModel, planGoodsKcProductNotApplicable, type AdminGoodsKc } from '@/lib/admin/goods-kc';
import { GOODS_KC_NOT_APPLICABLE_ATTESTATION, GoodsKcEditor } from './GoodsKcPanel';

vi.mock('@/app/admin/goods-kc-actions', () => ({ readGoodsKcAction: vi.fn(), saveGoodsKcAction: vi.fn() }));
const variant = { id: '00000000-0000-4000-8000-000000000001', code: 'OPTION-1', name: '기본 옵션', active: true };
const draft: AdminGoodsKc = { revision: null, status: 'unreviewed', models: [], contextFingerprint: 'a'.repeat(64),
  publishedAt: null, archivedAt: null, reviewedAt: null, reviewerName: null, variants: [variant], history: [] };
describe('KC 모델 검토 화면', () => {
  it('프리셋은 검토된 상품에도 새 미검토 모델만 추가하고 이전 검토 표기를 숨긴다', () => {
    const html = renderToStaticMarkup(<GoodsKcEditor goodId="g1" configuration={{ ...draft, status: 'reviewed', reviewedAt: '2026-09-01T00:00:00Z', reviewerName: '이전 검토자' }} onSaved={() => {}}
      templateRequest={{ id: 'preset-request', template: { family: 'living', scheme: 'not_applicable', publicNote: '합성 해당 없음 안내' } }} />);
    expect(html).toContain('KC 미검토 초안 · 미저장');
    expect(html).toContain('합성 해당 없음 안내');
    expect(html).toContain('모델 1 모델명');
    expect(html).not.toContain('모델 2 모델명');
    expect(html).not.toContain('이전 검토자');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>KC 검토 완료/);
  });
  it('공개 상품에는 프리셋 모델을 추가하지 않는다', () => {
    const html = renderToStaticMarkup(<GoodsKcEditor goodId="g1" configuration={{ ...draft, publishedAt: '2026-09-01T00:00:00Z' }} onSaved={() => {}}
      templateRequest={{ id: 'preset-request', template: { family: 'living', scheme: 'not_applicable', publicNote: '복사 불가 문구' } }} />);
    expect(html).not.toContain('모델 1 모델명');
    expect(html).not.toContain('복사 불가 문구');
    expect(html).toContain('비공개 상품의 미검토 모델');
  });
  it('유형 틀만 제공하고 실제 증빙 없는 최초 검토 완료는 비활성화한다', () => {
    const html = renderToStaticMarkup(<GoodsKcEditor goodId="g1" configuration={draft} onSaved={() => {}} />);
    expect(html).toContain('유형 틀로 모델 추가');
    expect(html).toContain('미검토로 저장');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>KC 검토 완료/);
    expect(html).toContain('원본 근거와 실제 모델');
    expect(html).not.toContain('TEST-ONLY');
  });
  it('기존 공개 미기록을 자동 승인하지 않고 비공개 후 검토할 수 있게 안내한다', () => {
    const html = renderToStaticMarkup(<GoodsKcEditor goodId="g1" configuration={{ ...draft, publishedAt: '2026-09-10T00:00:00Z' }} onSaved={() => {}} />);
    expect(html).toContain('기존 공개 · KC 미기록');
    expect(html).toContain('먼저 상품을 비공개');
    expect(html).not.toContain('>KC 검토 완료</button>');
    expect(html).not.toContain('>미검토로 저장</button>');
  });
  it('상단의 상품 전체 KC 해당 없음은 확인 체크 하나로 검토를 끝내는 경로를 안내한다', () => {
    const html = renderToStaticMarkup(<GoodsKcEditor goodId="g1" configuration={{ ...draft, variants: [variant,
      { id: '00000000-0000-4000-8000-000000000003', code: 'OPTION-3', name: '중지 옵션', active: false }] }} onSaved={() => {}} />);
    expect(html.indexOf('상품 전체 KC 해당 없음')).toBeLessThan(html.indexOf('유형 틀로 모델 추가'));
    expect(GOODS_KC_NOT_APPLICABLE_ATTESTATION).toBe('이 상품은 KC 안전인증·안전확인·공급자적합성확인·안전기준준수 대상이 아님을 확인했습니다.');
    expect(html).toContain(GOODS_KC_NOT_APPLICABLE_ATTESTATION);
    expect(html).toContain('사용 중인 옵션 1개가 모두 연결');
    expect(html).toContain('고객 안내 추가 (선택)');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>해당 없음으로 검토 완료/);
    expect(html).toContain('KC 대상 상품은 아래에서 모델별로');
  });
  it('공개·보관 상품과 옵션이 없는 상품에서는 해당 없음 완료를 막고 기존 안내를 유지한다', () => {
    const published = renderToStaticMarkup(<GoodsKcEditor goodId="g1" configuration={{ ...draft, publishedAt: '2026-09-10T00:00:00Z' }} onSaved={() => {}} />);
    expect(published).toMatch(/<fieldset[^>]*disabled=""[^>]*><legend>상품 전체 KC 해당 없음/);
    expect(published).toContain('먼저 상품을 비공개');
    const archived = renderToStaticMarkup(<GoodsKcEditor goodId="g1" configuration={{ ...draft, archivedAt: '2026-09-10T00:00:00Z' }} onSaved={() => {}} />);
    expect(archived).toMatch(/<fieldset[^>]*disabled=""[^>]*><legend>상품 전체 KC 해당 없음/);
    expect(archived).toContain('복원한 뒤 검토');
    const empty = renderToStaticMarkup(<GoodsKcEditor goodId="g1" configuration={{ ...draft, variants: [{ ...variant, active: false }] }} onSaved={() => {}} />);
    expect(empty).toContain('사용 중인 옵션이 없습니다');
    expect(empty).toMatch(/<button[^>]*disabled=""[^>]*>해당 없음으로 검토 완료/);
  });
  it('이미 해당 없음으로 검토한 상품은 고객 안내를 이어받고 빈 선택 칸 없이 미리보기를 보여준다', () => {
    const reviewed = { ...goodsKcProductNotApplicableModel([variant]), publicNote: '합성 고객 안내' };
    const html = renderToStaticMarkup(<GoodsKcEditor goodId="g1" configuration={{ ...draft, revision: 2, status: 'reviewed',
      reviewedAt: '2026-10-07T00:00:00Z', reviewerName: '합성 검토자', models: [reviewed] }} onSaved={() => {}} />);
    expect(html).toContain('KC 검토 완료 · 합성 검토자');
    expect(html).toMatch(/aria-label="해당 없음 고객 안내"[^>]*>합성 고객 안내<\/textarea>/);
    expect(html).toContain('KC 인증 대상이 아닌 상품입니다.');
    expect(html).toContain('모델 1 고객 안내');
    expect(html).toContain('고객 안내 (선택)');
    expect(html).toContain('모델명 (선택)');
    expect(html).not.toContain('<td style="white-space:pre-wrap"></td>');
    expect(html).not.toContain('<caption class="wc-pdp-notice__caption"></caption>');
  });
  it('기존 모델 입력을 지울 때만 확인을 요구하고 사용 중인 옵션 전부를 연결한다', () => {
    const stopped = { id: '00000000-0000-4000-8000-000000000003', code: 'OPTION-3', name: '중지 옵션', active: false };
    expect(planGoodsKcProductNotApplicable([], [variant, stopped], ' 안내 ')).toEqual({ discarded: 0, models: [{
      ...emptyGoodsKcModel(), family: 'other', scheme: 'not_applicable', publicNote: '안내', variantIds: [variant.id] }] });
    const same = planGoodsKcProductNotApplicable([goodsKcProductNotApplicableModel([variant])], [variant]);
    expect(same.discarded).toBe(0);
    const detailed = [{ ...emptyGoodsKcModel(), family: 'children' as const, scheme: 'safety_confirmation' as const, modelName: '입력한 모델' },
      { ...emptyGoodsKcModel(), family: 'living' as const }];
    expect(planGoodsKcProductNotApplicable(detailed, [variant]).discarded).toBe(2);
  });
  it('해당 없음 모델 1개를 아래에서 고친 고객 안내가 위쪽 이전 입력으로 덮이지 않는다', () => {
    // 'A'로 검토한 뒤 아래 '모델 1 고객 안내'를 'B '로 고쳤고, 위쪽 칸에는 열 때의 'A'가 남아 있는 상황.
    const edited = { ...goodsKcProductNotApplicableModel([variant]), publicNote: 'B ' };
    const plan = planGoodsKcProductNotApplicable([edited], [variant], 'A');
    expect(plan.models).toEqual([{ ...goodsKcProductNotApplicableModel([variant]), publicNote: 'B' }]);
    expect(plan.discarded).toBe(0);
    // 저장값의 옵션 순서·대소문자가 달라도 같은 해당 없음 모델이면 지울 입력이 없다.
    const second = { id: '00000000-0000-4000-8000-00000000000B', code: 'OPTION-B', name: '파랑', active: true };
    const loaded = { ...goodsKcProductNotApplicableModel([variant, second]), variantIds: [second.id, variant.id] };
    expect(planGoodsKcProductNotApplicable([loaded], [variant, second]).discarded).toBe(0);
    // 아래 모델이 해당 없음 1개가 아니면 위쪽에 따로 입력한 안내를 쓴다.
    expect(planGoodsKcProductNotApplicable([], [variant], 'A').models[0].publicNote).toBe('A');
  });
  it('위쪽 고객 안내 칸은 해당 없음 모델 1개의 고객 안내를 그대로 보여준다', () => {
    const html = renderToStaticMarkup(<GoodsKcEditor goodId="g1" configuration={{ ...draft, revision: 1,
      models: [{ ...goodsKcProductNotApplicableModel([variant]), publicNote: '아래 모델 안내' }] }} onSaved={() => {}} />);
    expect(html).toMatch(/aria-label="해당 없음 고객 안내"[^>]*>아래 모델 안내<\/textarea>/);
    expect(html).toMatch(/aria-label="모델 1 고객 안내 \(선택\)"[^>]*>아래 모델 안내<\/textarea>/);
  });
  it('해당 없음의 선택 칸은 접근 가능한 이름에도 (선택)을 붙이고 KC 대상 제도에는 붙이지 않는다', () => {
    const notApplicable = renderToStaticMarkup(<GoodsKcEditor goodId="g1" configuration={{ ...draft, revision: 1,
      models: [goodsKcProductNotApplicableModel([variant])] }} onSaved={() => {}} />);
    for (const name of ['모델 1 품목 분류 (선택)', '모델 1 모델명 (선택)', '모델 1 사업자 구분 (선택)', '모델 1 사업자명 (선택)',
      '모델 1 고객 안내 (선택)']) expect(notApplicable).toContain(`aria-label="${name}"`);
    const subject = renderToStaticMarkup(<GoodsKcEditor goodId="g1" configuration={{ ...draft, revision: 1,
      models: [{ ...emptyGoodsKcModel(), family: 'children', scheme: 'safety_confirmation', variantIds: [variant.id] }] }} onSaved={() => {}} />);
    for (const name of ['모델 1 품목 분류', '모델 1 모델명', '모델 1 사업자 구분', '모델 1 사업자명', '모델 1 고객 안내', '모델 1 인증·신고번호']) {
      expect(subject).toContain(`aria-label="${name}"`);
    }
    expect(subject).not.toContain('(선택)"');
  });
  it('모델·옵션·사내근거를 따로 입력하고 잘못된 기존 옵션 연결도 해제할 수 있다', () => {
    const html = renderToStaticMarkup(<GoodsKcEditor goodId="g1" configuration={{ ...draft, revision: 1,
      models: [{ ...emptyGoodsKcModel(), family: 'children', scheme: 'safety_confirmation',
        variantIds: ['00000000-0000-4000-8000-000000000002'] }] }} onSaved={() => {}} />);
    for (const text of ['모델 1 모델명', '모델 1 인증·신고번호', '모델 1 적용 옵션 기본 옵션', '모델 1 적용 판단 사유',
      '모델 1 인증·신고문서 참조', '모델 1 삭제된 옵션 연결 해제']) expect(html).toContain(text);
    expect(html).toContain('고객에게 공개되지 않습니다');
    expect(html).not.toContain('모델명 (선택)');
    expect(html).not.toContain('고객 고시 미리보기');
  });
});
