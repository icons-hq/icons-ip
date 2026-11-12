import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GOODS_READINESS_REASONS, type AdminGoodsReadiness } from '@/lib/admin/goods-readiness';
import { GOOD_DRAFT_SWITCH_NOTICE, GoodDraftSwitch, GoodPublishControls } from './GoodPublishControls';
const kcRequired: AdminGoodsReadiness = { state: 'blocked', checkedAt: '2026-11-09T06:20:51.000Z', publication: 'draft', operation: 'active', availableQty: 40, publicReview: 'required', saleSettings: 'blocked', reviewRequired: true,
  reasons: [{ code: 'draft', ...GOODS_READINESS_REASONS.draft, kind: 'blocking' }, { code: 'kc_required', ...GOODS_READINESS_REASONS.kc_required, kind: 'review' }] };
const ready: AdminGoodsReadiness = { ...kcRequired, publicReview: 'current', reasons: [kcRequired.reasons[0]] };
const publishButton = (html: string) => html.match(/<button[^>]*>공개로 전환<\/button>/)?.[0] ?? '';
describe('상품 게시 상태 화면', () => {
  it('공개 상품을 내릴 때 기존 주문 유지와 확인 단계를 보여준다', () => {
    const html = renderToStaticMarkup(<GoodPublishControls id="g1" publishedAt="2026-09-08" archivedAt={null}/>);
    expect(html).toContain('초안으로 되돌리기'); expect(html).toContain('기존 주문');
    expect(html).toContain('name="confirmUnpublish"'); expect(html).toContain('required=""');
  });
  it('보관 상품은 복원 안내를 표시하고 게시 버튼을 제공하지 않는다', () => {
    const html = renderToStaticMarkup(<GoodPublishControls id="g1" publishedAt={null} archivedAt="2026-09-08"/>);
    expect(html).toContain('복원하면 초안'); expect(html).not.toContain('<button');
  });
  it('공개 중인 상품을 내리는 작업은 접혀 있고, 링크로 올 수 있게 접힌 줄이 도착지다', () => {
    const html = renderToStaticMarkup(<GoodPublishControls id="g1" publishedAt="2026-09-08" archivedAt={null}/>);
    expect(html).toMatch(/<details[^>]*id="good-operation-publish"/);
    expect(html.match(/<details[^>]*id="good-operation-publish"[^>]*>/)?.[0]).not.toContain('open=""');
    expect(html).toContain('value="false"');
  });
  /* 사람 눈 테스트 3라운드 — 판매를 내리는 일인데 옆 안내와 같은 펼침 글자라 낮아 보였다. 모양만 outline+빨간 글자로 올리고 펼쳐서 확인하는 동작은 그대로다. */
  it('초안으로 되돌리기는 평소에는 조용한 outline 펼침 버튼이고 실제 전환은 펼친 뒤 확인을 거친다', () => {
    const html = renderToStaticMarkup(<GoodPublishControls id="g1" publishedAt="2026-09-08" archivedAt={null}/>);
    const summary = html.match(/<summary[^>]*>(?:(?!<\/summary>)[^])*초안으로 되돌리기<\/summary>/)?.[0] ?? '';
    expect(summary).toContain('border-border-strong'); expect(summary).toContain('text-destructive'); expect(summary).toContain('hover:text-destructive');
    expect(summary).not.toContain('hover:text-foreground'); expect(summary).not.toContain('bg-danger-soft');
    expect(html.indexOf('</summary>')).toBeLessThan(html.indexOf('name="confirmUnpublish"'));
  });
  it('공개를 막는 항목이 남으면 공개 버튼을 그리지 않고, 저장할 입력이 생기면 다음 할 일은 주 색을 저장에 넘긴다', () => {
    const clean = renderToStaticMarkup(<GoodPublishControls id="g1" publishedAt={null} archivedAt={null} readiness={kcRequired}/>);
    expect(publishButton(clean)).toBe(''); expect(clean).toContain('KC 검토하기');
    expect(clean.match(/<a[^>]*>KC 검토하기/)?.[0]).toContain('bg-primary');
    const unsaved = renderToStaticMarkup(<GoodPublishControls id="g1" publishedAt={null} archivedAt={null} readiness={kcRequired} unsaved/>);
    expect(unsaved.match(/<a[^>]*>KC 검토하기/)?.[0]).toContain('bg-primary-soft');
    expect(unsaved).toContain('저장하면 다시 확인합니다.');
  });
  it('저장하지 않은 입력이 있으면 저장본만 공개하는 버튼을 내리고 저장 막대로 안내한다', () => {
    const clean = renderToStaticMarkup(<GoodPublishControls id="g1" publishedAt={null} archivedAt={null} readiness={ready}/>);
    expect(publishButton(clean)).toContain('bg-primary');
    expect(clean).toContain('value="true"');
    const onSave = renderToStaticMarkup(<GoodPublishControls id="g1" publishedAt={null} archivedAt={null} readiness={ready} unsaved publishOnSave/>);
    expect(publishButton(onSave)).toBe(''); expect(onSave).toContain('저장 막대의 저장 후 공개');
    const blocked = renderToStaticMarkup(<GoodPublishControls id="g1" publishedAt={null} archivedAt={null} readiness={ready} unsaved/>);
    expect(publishButton(blocked)).toBe(''); expect(blocked).toContain('저장한 뒤 공개할 수 있습니다.');
  });
  it('판매 준비를 읽지 못하면 판정을 추정하지 않고 공개를 보조 버튼으로 남긴다', () => {
    const html = renderToStaticMarkup(<GoodPublishControls id="g1" publishedAt={null} archivedAt={null} readiness={null}/>);
    expect(publishButton(html)).not.toBe(''); expect(publishButton(html)).not.toContain('bg-primary');
    expect(html).toContain('id="good-operation-publish"');
  });
  /* ADM-004(복잡도 표 303행): 게시 전환은 저장된 내용의 게시 상태만 바꾼다는 뜻을 접힌 안내에 남긴다. */
  it('판매 준비 안내는 게시 전환이 저장된 내용의 게시 상태만 바꾼다고 말한다', () => {
    const html = renderToStaticMarkup(<GoodPublishControls id="g1" publishedAt={null} archivedAt={null} readiness={ready}/>);
    expect(html).toContain('공개·초안 전환은 저장된 내용의 게시 상태만 바꿉니다. 저장하지 않은 입력은 함께 저장되지 않고 화면에 그대로 남습니다.');
  });
});

/* TKT-009(11/11 결정): 잠금 안내 버튼 → 확인창 1회 → 바로 초안 전환. 확인창은 누를 때만 열리고 폼을 제출하지 않는 버튼이다. */
describe('초안으로 전환 후 수정', () => {
  it('버튼 하나이고 닫힌 확인창은 그리지 않으며, 확인창 안내는 판매 중단 영향과 KC 재검토를 말한다', () => {
    const html = renderToStaticMarkup(<GoodDraftSwitch id="g1" />);
    expect(html).toMatch(/<button[^>]*type="button"[^>]*data-good-draft-switch=""[^>]*>초안으로 전환 후 수정<\/button>/);
    expect(html).not.toContain('초안으로 전환할까요?');
    expect(html).not.toContain('<form');
    expect(renderToStaticMarkup(<GoodDraftSwitch id="g1" disabled />)).toMatch(/<button[^>]*disabled=""[^>]*>초안으로 전환 후 수정<\/button>/);
    for (const text of ['고객 화면에서 내려갑니다', '새 주문을 받지 않습니다', '기존 주문과 결제·취소 처리는 유지됩니다', 'KC를 다시 검토해야']) expect(GOOD_DRAFT_SWITCH_NOTICE).toContain(text);
  });
});
