import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { emptyGoodsKcModel, goodsKcProductNotApplicableModel, planGoodsKcProductNotApplicable, type AdminGoodsKc } from '@/lib/admin/goods-kc';
import {
  GOODS_KC_NOT_APPLICABLE_ATTESTATION, GOODS_KC_SUBJECT_ATTESTATION, GoodsKcEditor, GoodsOtherCertificationsFields, ProductNotApplicable,
} from './GoodsKcPanel';

vi.mock('@/app/admin/goods-kc-actions', () => ({ readGoodsKcAction: vi.fn(), saveGoodsKcAction: vi.fn(),
  readGoodsOtherCertificationsAction: vi.fn(), saveGoodsOtherCertificationsAction: vi.fn() }));
/* 'KC 인증 대상 여부' 라디오에서 체크된 값(없으면 null). */
function chosen(html: string): string | null {
  return html.match(/<input class="mt-0\.5" type="radio"[^>]*checked=""[^>]*value="([a-z_]+)"/)?.[1] ?? null;
}
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
  /* 1007-034(ADR-0036 자가 신고): 대상 여부를 먼저 고르고, 대상 모델은 게시 항목·번호가 있어야 검토를 완료한다. 근거 참조는 묻지 않는다. */
  it('KC 대상 여부를 고르기 전에는 입력칸을 열지 않고, 대상 모델은 게시 항목과 번호가 없으면 검토 완료를 막는다', () => {
    const empty = renderToStaticMarkup(<GoodsKcEditor goodId="g1" configuration={draft} onSaved={() => {}} />);
    expect(empty).toContain('<legend>KC 인증 대상 여부</legend>');
    expect(empty.indexOf('대상 아님 · 상품 전체 KC 해당 없음')).toBeLessThan(empty.indexOf('대상 · 인증 종류와 번호 입력'));
    expect(chosen(empty)).toBeNull();
    expect(empty).toContain('KC 대상 여부를 고르면 입력칸이 열립니다.');
    expect(empty).not.toContain('유형 틀로 모델 추가');
    expect(empty).not.toContain('>해당 없음으로 검토 완료</button>');
    /* 라디오는 상품 저장 폼에서 떼어 둔다(이름이 있어도 상품 저장에 실리지 않는다). */
    expect(empty).toMatch(/type="radio" form="good-detached-controls" name="[^"]+"/);
    const subject = { ...emptyGoodsKcModel(), family: 'living' as const, scheme: 'safety_confirmation' as const, variantIds: [variant.id] };
    const html = renderToStaticMarkup(<GoodsKcEditor goodId="g1" configuration={{ ...draft, revision: 1, models: [subject] }} onSaved={() => {}} />);
    expect(chosen(html)).toBe('subject');
    expect(html).toContain('유형 틀로 모델 추가');
    expect(html).toContain('미검토로 저장');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>KC 검토 완료/);
    expect(html).toContain('모델 1: 품목 분류·모델명·사업자 구분·사업자명을 입력해주세요.');
    expect(html).toContain('모델 1: 인증·신고번호를 입력해주세요.');
    expect(html).not.toContain('근거 참조를 입력해주세요');
    expect(html).not.toContain('문서 근거를 입력해주세요');
    expect(GOODS_KC_SUBJECT_ATTESTATION).toBe('실제 제품의 KC 표시(인증 종류·인증·신고번호)와 모델·사업자·적용 옵션이 일치함을 확인했습니다.');
    expect(html).toContain(GOODS_KC_SUBJECT_ATTESTATION);
    expect(html).not.toContain('TEST-ONLY');
  });
  it('KC 대상은 근거 참조 없이 게시 항목과 인증번호만으로 검토 완료할 수 있다', () => {
    const complete = { ...emptyGoodsKcModel(), family: 'living' as const, scheme: 'safety_confirmation' as const, productCategory: '합성 분류',
      modelName: '합성 모델', businessRole: 'importer' as const, businessName: '합성 수입자', identifier: 'TEST-ONLY-SD-1', variantIds: [variant.id] };
    const html = renderToStaticMarkup(<GoodsKcEditor goodId="g1" configuration={{ ...draft, revision: 1, models: [complete] }} onSaved={() => {}} />);
    expect(html).not.toContain('검토 완료 전 확인');
    expect(html).toContain('고객 고시 미리보기');
    expect(html).toContain('TEST-ONLY-SD-1');
    /* 확인 체크 칸은 열려 있고(근거가 비어도), 체크 전에는 검토 완료 버튼이 막혀 있다. */
    expect(html).toMatch(/<input class="mt-0\.5" type="checkbox"\/><span>실제 제품의 KC 표시/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>KC 검토 완료/);
    expect(html).toMatch(/내부 검토 근거 \(선택\) · 고객에게 공개되지 않습니다 · 0\/5칸 입력/);
  });
  it('기존 공개 미기록을 자동 승인하지 않고 비공개 후 검토할 수 있게 안내한다', () => {
    const html = renderToStaticMarkup(<GoodsKcEditor goodId="g1" configuration={{ ...draft, publishedAt: '2026-09-10T00:00:00Z' }} onSaved={() => {}} />);
    expect(html).toContain('기존 공개 · KC 미기록');
    expect(html).toContain('먼저 상품을 비공개');
    expect(html).not.toContain('>KC 검토 완료</button>');
    expect(html).not.toContain('>미검토로 저장</button>');
  });
  it('대상 아님(상품 전체 KC 해당 없음)은 확인 체크와 완료 버튼으로 검토를 끝내고, 고른 직후에는 체크된 채로 연다', () => {
    const variants = [variant, { id: '00000000-0000-4000-8000-000000000003', code: 'OPTION-3', name: '중지 옵션', active: false }];
    const fresh = renderToStaticMarkup(<ProductNotApplicable variants={variants} models={[]} disabled={false} onNoteChange={() => {}} onComplete={() => {}} />);
    expect(GOODS_KC_NOT_APPLICABLE_ATTESTATION).toBe('이 상품은 KC 안전인증·안전확인·공급자적합성확인·안전기준준수 대상이 아님을 확인했습니다.');
    expect(fresh).toContain(GOODS_KC_NOT_APPLICABLE_ATTESTATION);
    expect(fresh).toContain('사용 중인 옵션 1개가 모두 연결');
    expect(fresh).toContain('고객 안내 추가 (선택)');
    expect(fresh).toMatch(/<button[^>]*disabled=""[^>]*>해당 없음으로 검토 완료/);
    /* 운영자가 '대상 아님'을 방금 골랐으면 확인 체크가 켜진 채로 열려 완료 버튼 한 번이면 된다. */
    const picked = renderToStaticMarkup(<ProductNotApplicable variants={variants} models={[]} disabled={false} initialConfirmed onNoteChange={() => {}} onComplete={() => {}} />);
    expect(picked).toMatch(/<input class="mt-0\.5" type="checkbox" checked=""\/><span>이 상품은 KC/);
    expect(picked).not.toMatch(/<button[^>]*disabled=""[^>]*>해당 없음으로 검토 완료/);
    /* 저장된 미검토 해당 없음 모델은 '대상 아님'으로 열리지만 확인 체크는 운영자가 직접 한다. */
    const loaded = renderToStaticMarkup(<GoodsKcEditor goodId="g1" configuration={{ ...draft, revision: 1, models: [goodsKcProductNotApplicableModel([variant])] }} onSaved={() => {}} />);
    expect(chosen(loaded)).toBe('not_applicable');
    expect(loaded).toMatch(/<input class="mt-0\.5" type="checkbox"\/><span>이 상품은 KC/);
    expect(loaded.indexOf('<legend>상품 전체 KC 해당 없음')).toBeLessThan(loaded.indexOf('유형 틀로 모델 추가'));
  });
  it('공개·보관 상품은 대상 여부를 바꿀 수 없고, 옵션이 없는 상품은 해당 없음 완료를 막는다', () => {
    const published = renderToStaticMarkup(<GoodsKcEditor goodId="g1" configuration={{ ...draft, publishedAt: '2026-09-10T00:00:00Z' }} onSaved={() => {}} />);
    expect(published).toMatch(/<fieldset[^>]*disabled=""[^>]*data-kc-subject-choice=""><legend>KC 인증 대상 여부/);
    expect(published).toContain('먼저 상품을 비공개');
    const archived = renderToStaticMarkup(<GoodsKcEditor goodId="g1" configuration={{ ...draft, archivedAt: '2026-09-10T00:00:00Z' }} onSaved={() => {}} />);
    expect(archived).toMatch(/<fieldset[^>]*disabled=""[^>]*data-kc-subject-choice=""><legend>KC 인증 대상 여부/);
    expect(archived).toContain('복원한 뒤 검토');
    const publishedNotApplicable = renderToStaticMarkup(<GoodsKcEditor goodId="g1" configuration={{ ...draft, revision: 1, publishedAt: '2026-09-10T00:00:00Z',
      models: [goodsKcProductNotApplicableModel([variant])] }} onSaved={() => {}} />);
    expect(publishedNotApplicable).toMatch(/<fieldset[^>]*disabled=""[^>]*><legend>상품 전체 KC 해당 없음/);
    const empty = renderToStaticMarkup(<ProductNotApplicable variants={[{ ...variant, active: false }]} models={[]} disabled={false} initialConfirmed
      onNoteChange={() => {}} onComplete={() => {}} />);
    expect(empty).toContain('사용 중인 옵션이 없습니다');
    expect(empty).toMatch(/<button[^>]*disabled=""[^>]*>해당 없음으로 검토 완료/);
  });
  it('해당 없음 원클릭 검토를 마친 상품은 결과·검토자·시각을 위에 보이고 모델 상세는 접어 둔다', () => {
    const reviewed = { ...goodsKcProductNotApplicableModel([variant]), publicNote: '합성 고객 안내' };
    const html = renderToStaticMarkup(<GoodsKcEditor goodId="g1" configuration={{ ...draft, revision: 2, status: 'reviewed',
      reviewedAt: '2026-10-07T00:00:00Z', reviewerName: '합성 검토자', models: [reviewed] }} onSaved={() => {}} />);
    expect(html).toContain('<p role="status">상품 전체 KC 해당 없음으로 검토 완료 · 합성 검토자 · 2026. 10. 7.');
    expect(html).toContain('사용 중인 옵션 1개가 모두 해당 없음으로 연결되어 있습니다.');
    expect(html).toContain('고객 안내: 합성 고객 안내');
    // 확인 체크가 풀린 원클릭 칸을 다시 보여주지 않는다 — 다시 눌러야 하는 것처럼 보이지 않게.
    expect(html).not.toContain(GOODS_KC_NOT_APPLICABLE_ATTESTATION);
    expect(html).not.toContain('>해당 없음으로 검토 완료</button>');
    expect(html).not.toContain('aria-label="해당 없음 고객 안내"');
    // 모델 상세·내부 근거·검토 버튼은 닫힌 '모델 상세 보기·고치기' 안에 있다.
    const details = html.match(/<details([^>]*)><summary[^>]*>모델 상세 보기·고치기<\/summary>/);
    expect(details?.[1]).toContain('data-kc-model-details=""');
    expect(details?.[1]).not.toContain('open=""');
    const folded = html.slice(html.indexOf('모델 상세 보기·고치기'));
    for (const text of ['모델 1 고객 안내 (선택)', '내부 검토 근거', 'KC 인증 대상이 아닌 상품입니다.', '>미검토로 저장</button>']) {
      expect(html.indexOf(text), text).toBeGreaterThan(html.indexOf('모델 상세 보기·고치기'));
      expect(folded).toContain(text);
    }
    expect(html).toMatch(/aria-label="모델 1 고객 안내 \(선택\)"[^>]*>합성 고객 안내<\/textarea>/);
    expect(html).not.toContain('<td style="white-space:pre-wrap"></td>');
    expect(html).not.toContain('<caption class="wc-pdp-notice__caption"></caption>');
  });
  it('해당 없음 검토 완료 상품에 새 모델 틀을 넣으면 접힌 모델 상세를 펼쳐 미저장 입력을 보여준다', () => {
    const html = renderToStaticMarkup(<GoodsKcEditor goodId="g1" configuration={{ ...draft, revision: 2, status: 'reviewed',
      reviewedAt: '2026-10-07T00:00:00Z', reviewerName: '합성 검토자', models: [goodsKcProductNotApplicableModel([variant])] }} onSaved={() => {}}
      templateRequest={{ id: 'preset-request', template: { family: 'living', scheme: 'safety_confirmation', publicNote: '' } }} />);
    expect(html).toContain('<p role="status">KC 미검토 초안 · 미저장');
    const details = html.match(/<details([^>]*)><summary[^>]*>모델 상세 보기·고치기<\/summary>/);
    expect(details?.[1]).toContain('data-kc-model-details=""');
    expect(details?.[1]).toContain('open=""');
    expect(html).toContain('모델 2 모델명');
  });
  it('해당 없음 단독이 아닌 검토 완료와 미검토 해당 없음은 기존처럼 모델을 펼쳐 둔다', () => {
    const subject = { ...emptyGoodsKcModel(), family: 'children' as const, scheme: 'safety_confirmation' as const, productCategory: '합성 분류',
      modelName: '합성 모델', businessRole: 'importer' as const, businessName: '합성 수입자', identifier: 'TEST-ONLY-1', variantIds: [variant.id],
      basis: '합성 사유', evidence: { applicability: 'TEST:a', certificate: 'TEST:c', testReport: '', declaration: '' } };
    const reviewed = renderToStaticMarkup(<GoodsKcEditor goodId="g1" configuration={{ ...draft, revision: 2, status: 'reviewed',
      reviewedAt: '2026-10-07T00:00:00Z', reviewerName: '합성 검토자', models: [subject] }} onSaved={() => {}} />);
    expect(reviewed).toContain('<p role="status">KC 검토 완료 · 합성 검토자');
    expect(reviewed).not.toContain('모델 상세 보기·고치기');
    expect(chosen(reviewed)).toBe('subject');
    expect(reviewed).toContain(GOODS_KC_SUBJECT_ATTESTATION);
    expect(reviewed).not.toContain(GOODS_KC_NOT_APPLICABLE_ATTESTATION);
    const unreviewed = renderToStaticMarkup(<GoodsKcEditor goodId="g1" configuration={{ ...draft, revision: 1,
      models: [goodsKcProductNotApplicableModel([variant])] }} onSaved={() => {}} />);
    expect(unreviewed).not.toContain('모델 상세 보기·고치기');
    expect(chosen(unreviewed)).toBe('not_applicable');
    expect(unreviewed).toContain(GOODS_KC_NOT_APPLICABLE_ATTESTATION);
    expect(unreviewed).toContain('모델 1 모델명 (선택)');
  });
  it('기본 상품 저장(성공·실패 회차)마다 KC 패널이 서버 KC 상태를 다시 읽는다', () => {
    // 상품명·유형·IP·고시정보·옵션 저장은 DB에서 KC 검토를 미검토로 되돌릴 수 있다. 패널은 회차가 바뀌면
    // 화면을 비우지 않고 다시 읽어 '검토 완료'가 남지 않게 한다. effect는 정적 렌더로 실행되지 않아 배선을 대조한다.
    const section = readFileSync('components/admin/sections/GoodSection.tsx', 'utf8');
    expect(section).toMatch(/<GoodsKcPanel goodId=\{selected\.id\} refreshKey=\{state\.attempt \?\? 0\}/);
    const panel = readFileSync('components/admin/GoodsKcPanel.tsx', 'utf8');
    expect(panel).toContain('}, [goodId, refresh, refreshKey]);');
    expect(panel).toMatch(/if \(seenRefreshKey !== refreshKey\) \{ setSeenRefreshKey\(refreshKey\); setNotice\(null\); \}/);
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
  /* ADM-004(복잡도 표 335행): 고객에게 보이지 않는 내부 근거는 기본으로 접고 채운 칸 수를 요약에 보인다. 입력칸은 그대로 DOM에 있다. */
  it('내부 검토 근거는 접힌 채로 채운 칸 수를 보이고 입력칸은 그대로다', () => {
    const model = { ...emptyGoodsKcModel(), family: 'children' as const, scheme: 'safety_confirmation' as const, basis: '합성 판단 사유', variantIds: [variant.id] };
    const html = renderToStaticMarkup(<GoodsKcEditor goodId="g1" configuration={{ ...draft, revision: 1, models: [model] }} onSaved={() => {}} />);
    const evidence = html.match(/<details([^>]*)><summary[^>]*>내부 검토 근거[^<]*<\/summary>/);
    expect(evidence?.[1]).toContain('data-kc-evidence=""');
    expect(evidence?.[1]).not.toContain('open=""');
    expect(evidence?.[0]).toMatch(/· 1\/\d+칸 입력<\/summary>/);
    expect(html).toContain('aria-label="모델 1 적용 판단 사유"');
  });
});

describe('기타 인증 입력(SHEET-014)', () => {
  it('종류·인증기관·인증번호·고객 표시를 여러 건 받고, 고객 표시를 고른 것만 미리보기에 보인다', () => {
    const html = renderToStaticMarkup(<GoodsOtherCertificationsFields disabled={false} onChange={() => {}} entries={[
      { kind: '방송통신기자재 적합성평가', agency: '국립전파연구원', number: 'R-R-TEST-0001', visible: true },
      { kind: '내부 보관 인증', agency: '', number: 'INTERNAL-1', visible: false },
    ]} />);
    for (const label of ['기타 인증 1 인증 종류', '기타 인증 1 인증기관 (선택)', '기타 인증 1 인증번호', '기타 인증 2 고객 상세에 표시']) {
      expect(html).toContain(`aria-label="${label}"`);
    }
    expect(html).toContain('<datalist');
    expect(html).toContain('기타 인증 추가');
    const preview = html.slice(html.indexOf('고객 상세 미리보기'));
    expect(preview).toContain('인증번호 R-R-TEST-0001 · 인증기관 국립전파연구원');
    expect(preview).not.toContain('INTERNAL-1');
    /* 입력칸은 이름이 없어 상품 저장 폼에 실리지 않는다. */
    expect(html).not.toMatch(/<input[^>]*name="/);
  });
  it('종류나 인증번호가 비거나 같은 인증이 두 번이면 저장 전에 알린다', () => {
    const html = renderToStaticMarkup(<GoodsOtherCertificationsFields disabled={false} onChange={() => {}} entries={[
      { kind: 'KS 인증', agency: '', number: '', visible: true },
      { kind: '전파', agency: '', number: 'A-1', visible: true },
      { kind: '전파', agency: '다른 기관', number: 'a-1', visible: false },
    ]} />);
    expect(html).toContain('저장 전 확인');
    expect(html).toContain('기타 인증 1: 인증 종류와 인증번호를 입력해주세요.');
    expect(html).toContain('기타 인증 3: 같은 인증 종류·인증번호가 이미 있습니다.');
    const empty = renderToStaticMarkup(<GoodsOtherCertificationsFields disabled={false} onChange={() => {}} entries={[]} />);
    expect(empty).toContain('입력한 기타 인증이 없습니다.');
    expect(empty).not.toContain('저장 전 확인');
  });
});
