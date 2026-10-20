import { describe, expect, it } from 'vitest';
import { CONTENT_DIVIDER_STYLES, CONTENT_QUOTE_STYLES } from '@/lib/content-format';
import { GOODS_HTML_MAX_LENGTH } from '@/lib/goods-description';
import { bodyTemplateLength, createBodyTemplateRequestLane, normalizeBodyTemplateBody, normalizeBodyTemplateSave, parseBodyTemplate, parseBodyTemplateList, parseBodyTemplateReceipt, validBodyTemplateArchive } from './body-templates';
const id = '94000000-0000-4000-8000-000000000001', other = '94000000-0000-4000-8000-000000000002';
const summary = { id, name: '배송 안내', revision: 1, archivedAt: null, createdAt: '2026-10-14T00:00:00Z', updatedAt: '2026-10-14T00:00:00Z', characterCount: 12 };
const request = { surface: 'goods' as const, expectedActorId: id, id, expectedRevision: 0, operationId: other, name: ' 배송 안내 ', bodyHtml: '<p>배송 안내</p>' };
describe('개인 본문 템플릿 계약', () => {
  it.each(['goods', 'story'] as const)('%s는 모든 이미지와 실행 요소를 제거하고 본문만 보존한다', surface => {
    const body = normalizeBodyTemplateBody(surface, '<p onclick="x()">배송 안내</p><img src="https://example.com/a.png"><script>secret()</script><iframe>hidden</iframe>');
    expect(body.ok).toBe(true); if (!body.ok) return;
    expect(body.value.html).not.toMatch(/img|onclick|script|iframe|secret|hidden/); expect(body.value.text).toBe('배송 안내');
  });
  it('상품 외부 링크는 저장할 수 있고 스토리에서 읽거나 적용할 때만 제거된다', () => {
    const goods = normalizeBodyTemplateBody('goods', '<p><a href="https://example.com/help">안내</a></p>');
    expect(goods.ok).toBe(true); if (!goods.ok) return;
    expect(goods.value.html).toContain('href="https://example.com/help"');
    const story = parseBodyTemplate({ ...summary, bodyHtml: goods.value.html }, 'story');
    expect(story?.bodyHtml).not.toContain('href='); expect(story?.bodyHtml).toContain('안내'); expect(story?.warnings.join()).toContain('외부 링크');
  });
  it('허용한 공통 정렬·크기·인용·구분선은 양쪽 편집기에서 동일하게 보존한다', () => {
    const html = '<p data-icons-align="center" data-icons-size="24"><u><s>본문</s></u></p>' + CONTENT_QUOTE_STYLES.map(style => `<blockquote data-icons-quote="${style}">인용</blockquote>`).join('') + CONTENT_DIVIDER_STYLES.map(style => `<hr data-icons-divider="${style}">`).join('');
    for (const surface of ['goods', 'story'] as const) {
      const result = normalizeBodyTemplateBody(surface, html); expect(result.ok).toBe(true); if (!result.ok) continue;
      expect(result.value.html).toContain('data-icons-align="center"'); expect(result.value.html).toContain('data-icons-size="24"');
      for (const style of CONTENT_QUOTE_STYLES) expect(result.value.html).toContain(`data-icons-quote="${style}"`);
      for (const style of CONTENT_DIVIDER_STYLES) expect(result.value.html).toContain(`data-icons-divider="${style}"`);
    }
  });
  it.each(['', '<p> </p>', '<hr>', '<img src="https://example.com/a.png">'])('글 없는 본문 %s는 저장하지 않는다', html => expect(normalizeBodyTemplateBody('goods', html).ok).toBe(false));
  it('원문·정리 후 30000자 제한과 기존 상품 UTF16 적용 제한을 구별한다', () => {
    expect(normalizeBodyTemplateBody('story', '가'.repeat(30000)).ok).toBe(true);
    expect(normalizeBodyTemplateBody('story', '가'.repeat(30001)).ok).toBe(false);
    expect(normalizeBodyTemplateBody('story', '&'.repeat(10000)).ok).toBe(false);
    const emoji = '😀'.repeat(16000); expect(bodyTemplateLength(emoji)).toBe(16000); expect(emoji.length).toBeGreaterThan(GOODS_HTML_MAX_LENGTH);
    expect(normalizeBodyTemplateBody('goods', emoji).ok).toBe(true);
  });
  it('저장 입력은 이름·actor·CAS·operation과 정확한 필드만 받는다', () => {
    expect(normalizeBodyTemplateSave(request)).toMatchObject({ ok: true, value: { name: '배송 안내', expectedActorId: id } });
    for (const patch of [{ name: '가'.repeat(51) }, { name: '\n이름' }, { expectedActorId: other + 'x' }, { expectedRevision: -1 }, { operationId: '' }, { ownerId: other }]) expect(normalizeBodyTemplateSave({ ...request, ...patch }).ok).toBe(false);
    expect(validBodyTemplateArchive({ surface: 'story', expectedActorId: id, id, operationId: other, expectedRevision: 1, archived: true })).toBe(true);
    expect(validBodyTemplateArchive({ surface: 'story', expectedActorId: id, id, operationId: other, expectedRevision: 0, archived: true })).toBe(false);
  });
  it('목록은 본문·타인 필드를 전달하지 않고 개수·중복·보관 상태를 대조한다', () => {
    const list = { limit: 50, total: 1, archivedCount: 0, rows: [{ ...summary, bodyHtml: '<p>private</p>', ownerId: other }] };
    expect(parseBodyTemplateList(list, false)?.rows).toEqual([summary]);
    expect(parseBodyTemplateList(list, true)).toBeNull(); expect(parseBodyTemplateList({ ...list, total: 2 }, false)).toBeNull();
    expect(parseBodyTemplateList({ ...list, total: 2, rows: [summary, summary] }, false)).toBeNull();
    expect(parseBodyTemplateReceipt({ ...summary, id: other }, id)).toBeNull();
  });
  it('단일 요청은 늦은 완료가 다음 요청을 풀지 못하고 새 owner와 분리된다', () => {
    const lane = createBodyTemplateRequestLane({}), first = lane.begin()!; expect(lane.begin()).toBeNull(); lane.finish(first);
    const second = lane.begin()!; lane.finish(first); expect(lane.busy()).toBe(true); expect(lane.current(first)).toBe(false); expect(lane.current(second)).toBe(true);
    const another = createBodyTemplateRequestLane({}); expect(another.begin()).toBe(1); expect(another.owner).not.toBe(lane.owner);
    lane.finish(second); expect(lane.busy()).toBe(false);
  });
});
