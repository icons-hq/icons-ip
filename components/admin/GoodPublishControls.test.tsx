import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GOODS_READINESS_REASONS, type AdminGoodsReadiness } from '@/lib/admin/goods-readiness';
import { GoodPublishControls } from './GoodPublishControls';
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
});
