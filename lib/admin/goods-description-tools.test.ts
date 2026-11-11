import { describe, expect, it } from 'vitest';
import { GOODS_HTML_MAX_LENGTH, safeGoodsDescriptionLink, sanitizeGoodsDescription } from '@/lib/goods-description';
import { createGoodsDescriptionToolScope, goodsDescriptionToolFragment, planGoodsDescriptionInsertion } from './goods-description-tools';

describe('상품 상세 HTML 도구', () => {
  it('인용의 특수문자는 글자로 보존하고 모든 줄바꿈을 유지한다', () => {
    const result = goodsDescriptionToolFragment({ kind: 'quote', text: '가 & "나" <img src=x>\r\n둘째\r셋째\n끝' });
    expect(result).toEqual({ ok: true, value: '<blockquote>가 &amp; &quot;나&quot; &lt;img src=x&gt;<br>둘째<br>셋째<br>끝</blockquote>\n' });
    if (result.ok) expect(sanitizeGoodsDescription(result.value).html).not.toContain('<img');
    expect(goodsDescriptionToolFragment({ kind: 'divider' })).toEqual({ ok: true, value: '<hr>\n' });
  });
  it('정렬과 글자 크기·강조를 허용된 문서 서식으로만 만들고 문자 입력을 이스케이프한다', () => {
    const result = goodsDescriptionToolFragment({ kind: 'text', text: '상품 <script> & 안내\n둘째 줄', alignment: 'center', size: '24', emphasis: ['strong', 'u'] });
    expect(result).toEqual({ ok: true, value: '<p data-icons-align="center" data-icons-size="24"><u><strong>상품 &lt;script&gt; &amp; 안내<br>둘째 줄</strong></u></p>\n' });
    if (result.ok) expect(sanitizeGoodsDescription(result.value).html).toContain('data-icons-align="center" data-icons-size="24"');
    expect(goodsDescriptionToolFragment({ kind: 'quote', text: '인용', style: 'frame' })).toEqual({ ok: true, value: '<blockquote data-icons-quote="frame">인용</blockquote>\n' });
    expect(goodsDescriptionToolFragment({ kind: 'divider', style: 'diamond' })).toEqual({ ok: true, value: '<hr data-icons-divider="diamond">\n' });
  });
  it('타입 경계를 우회한 서식도 문자열 보간 전에 거부한다', () => {
    for (const bad of [
      { kind: 'quote', text: '가', style: 'x" onclick="alert(1)' },
      { kind: 'divider', style: '__proto__' },
      { kind: 'text', text: '가', alignment: 'center', size: '99', emphasis: [] },
      { kind: 'text', text: '가', alignment: 'center', size: '24', emphasis: ['script'] },
    ]) expect(goodsDescriptionToolFragment(bad as Parameters<typeof goodsDescriptionToolFragment>[0]).ok).toBe(false);
  });
  it.each(['https://example.com/한글?a=1&b=2', 'http://example.com', '/shop/test?q=1#detail', 'mailto:help@example.com', 'tel:+82212345678'])('기존 정제기와 같은 허용 주소를 그대로 쓴다: %s', href => {
    const result = goodsDescriptionToolFragment({ kind: 'link', text: '가 <나> & "다"', href });
    expect(safeGoodsDescriptionLink(href)).toBe(href); expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toContain('rel="noopener noreferrer"');
    expect(result.value).toContain('가 &lt;나&gt; &amp; "다"');
    expect(sanitizeGoodsDescription(result.value).html).toBe(result.value);
  });
  it.each(['javascript:alert(1)', 'data:text/html,hi', '//evil.test', '/\\evil.test', 'https://name:secret@example.com', 'https://example.com/a b', 'https://example.com/\npath', ' https://example.com', '#detail', 'shop/test', ''])('지원하지 않는 주소를 넣지 않는다: %s', href => {
    expect(safeGoodsDescriptionLink(href)).toBeUndefined();
    expect(goodsDescriptionToolFragment({ kind: 'link', text: '링크', href }).ok).toBe(false);
  });
  it('빈 문구는 거부하고 주소의 따옴표는 속성 밖으로 나가지 않는다', () => {
    expect(goodsDescriptionToolFragment({ kind: 'quote', text: '\n ' }).ok).toBe(false);
    expect(goodsDescriptionToolFragment({ kind: 'link', text: '\t', href: '/shop' }).ok).toBe(false);
    const result = goodsDescriptionToolFragment({ kind: 'link', text: '" onclick="x', href: '/shop?x="&y=<value>' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toContain('href="/shop?x=&quot;&amp;y=&lt;value&gt;"');
      expect(result.value).not.toContain(' onclick="x"');
    }
  });
  it('선택 영역만 바꾸고 삽입 뒤 커서를 반환한다', () => {
    expect(planGoodsDescriptionInsertion('앞-교체-뒤', 2, 4, '<hr>')).toEqual({ ok: true, value: { value: '앞-<hr>-뒤', cursor: 6 } });
    expect(planGoodsDescriptionInsertion('앞뒤', 1, 1, '중간')).toEqual({ ok: true, value: { value: '앞중간뒤', cursor: 3 } });
  });
  it.each([
    ['<a href="https://example.com/path">링크</a>', 'example.com'],
    ['<p title="앞 > 뒤">본문</p>', '뒤'],
    ['<p>앞 &amp; 뒤</p>', 'amp'],
    ['<!-- 주석 > 아직 안 끝남 -->본문', '아직'],
  ])('태그·속성·문자 참조·주석 안의 선택을 거부한다: %s', (source, selected) => {
    const start = source.indexOf(selected);
    expect(planGoodsDescriptionInsertion(source, start, start + selected.length, '<p>바꿈</p>').ok).toBe(false);
  });
  it('문단 내부와 여러 문단에 걸친 일부 선택은 거부하고 완전한 문단 선택만 바꾼다', () => {
    const source = '<p>앞 <strong>본문</strong> 뒤</p><p>둘째</p>';
    expect(planGoodsDescriptionInsertion(source, 3, 4, '<p>바꿈</p>').ok).toBe(false);
    expect(planGoodsDescriptionInsertion(source, 3, source.indexOf('둘째') + 1, '<hr>').ok).toBe(false);
    const end = source.indexOf('</p>') + 4;
    const result = planGoodsDescriptionInsertion(source, 0, end, '<p data-icons-align="center">바꿈</p>');
    expect(result.ok && result.value.value).toBe('<p data-icons-align="center">바꿈</p><p>둘째</p>');
    expect(planGoodsDescriptionInsertion(source, source.length, source.length, '<hr>').ok).toBe(true);
    expect(planGoodsDescriptionInsertion(source, source.indexOf('본문'), source.indexOf('본문') + 2, '<a href="/shop">새 링크</a>').ok).toBe(true);
  });
  it('닫히지 않은 속성과 주석의 끝 또는 기존 링크 안에 넣지 않는다', () => {
    for (const source of ['<p title="열린 >', '<!-- 열린 >', '<p>앞 &amp'])
      expect(planGoodsDescriptionInsertion(source, source.length, source.length, '<p>추가</p>').ok).toBe(false);
    const source = '<a href="/shop">링크</a>';
    expect(planGoodsDescriptionInsertion(source, source.indexOf('링크'), source.indexOf('링크') + 2, '<a href="/">중첩</a>').ok).toBe(false);
  });
  it('복수 조각의 앞이 일반 글자여도 뒤에 있는 블록과 중첩 링크를 검사한다', () => {
    const paragraph = '<p>본문</p>', anchor = '<a href="/shop">링크</a>';
    for (const fragment of ['안내<p>새 문단</p>', '<span>안내</span><table><tr><td>값</td></tr></table>', '안내<li>목록</li>']) {
      expect(planGoodsDescriptionInsertion(paragraph, 3, 5, fragment).ok).toBe(false);
      expect(planGoodsDescriptionInsertion(paragraph, paragraph.length, paragraph.length, fragment).ok).toBe(true);
    }
    expect(planGoodsDescriptionInsertion(anchor, anchor.indexOf('링크'), anchor.indexOf('링크') + 2, '<strong>안내</strong><a href="/">이동</a>').ok).toBe(false);
    expect(planGoodsDescriptionInsertion(paragraph, 3, 5, '일반 글자 &lt;p&gt; <strong>강조</strong>').ok).toBe(true);
  });
  it.each([
    ['<div>앞 시작</div><div>끝 뒤</div>', '<p>교체</p>'],
    ['<p><strong>앞 시작</strong></p><p><strong>끝 뒤</strong></p>', '<a href="/shop">교체</a>'],
  ])('같은 태그의 서로 다른 형제 요소를 하나의 선택 문맥으로 취급하지 않는다', (source, fragment) => {
    expect(planGoodsDescriptionInsertion(source, source.indexOf('시작'), source.indexOf('끝') + 1, fragment).ok).toBe(false);
  });
  it.each([[-1, 1], [2, 1], [0, 4], [NaN, 0], [1.5, 2]])('잘못된 선택 범위를 거부한다: %s ~ %s', (start, end) => {
    expect(planGoodsDescriptionInsertion('가나다', start, end, '<hr>').ok).toBe(false);
  });
  it('원문 또는 정리 후 한도를 넘으면 내용이나 선택 범위를 잘라내지 않는다', () => {
    expect(GOODS_HTML_MAX_LENGTH).toBe(200000);
    expect(planGoodsDescriptionInsertion('가'.repeat(GOODS_HTML_MAX_LENGTH), GOODS_HTML_MAX_LENGTH, GOODS_HTML_MAX_LENGTH, '나'))
      .toEqual({ ok: false, error: '입력 원문이 200,000자를 넘어 넣을 수 없습니다. 기존 내용은 유지됩니다.' });
    const source = '가'.repeat(GOODS_HTML_MAX_LENGTH);
    expect(planGoodsDescriptionInsertion(source, source.length, source.length, '나').ok).toBe(false);
    expect(planGoodsDescriptionInsertion(source, 0, 1, '나').ok).toBe(true);
    // rel is appended by the existing sanitizer; short source can exceed the saved HTML limit.
    const expanding = '<a href="/">가</a>'.repeat(5000);
    expect(expanding.length).toBeLessThan(GOODS_HTML_MAX_LENGTH);
    expect(planGoodsDescriptionInsertion(expanding, expanding.length, expanding.length, '<hr>').ok).toBe(false);
    expect(source).toHaveLength(GOODS_HTML_MAX_LENGTH);
  });
});

describe('상품 상세 도구의 작업 수명', () => {
  function ready() { const scope = createGoodsDescriptionToolScope('actor'); scope.setEnabled(true); scope.activate(); scope.authenticate('actor', 'session-a'); return scope; }
  it('계정 확인 이전에는 시작하지 않고 같은 세션 토큰 갱신은 허용한다', () => {
    const scope = createGoodsDescriptionToolScope('actor'); scope.activate(); scope.setEnabled(true);
    expect(scope.capture()).toBeNull(); scope.authenticate('actor', 'session-a');
    const ticket = scope.capture()!; scope.authenticate('actor', 'session-a'); expect(scope.canApply(ticket)).toBe(true);
  });
  it.each([[null, null], ['other', 'session-a'], ['actor', 'session-b']])('로그인 변경 후 이전 계정으로 돌아와도 지난 창을 적용하지 않는다', (actor, session) => {
    const scope = ready(), ticket = scope.capture()!;
    scope.authenticate(actor, session); scope.authenticate('actor', 'session-a');
    expect(scope.canApply(ticket)).toBe(false); expect(scope.capture()).toBeNull();
  });
  it('저장 시작/끝과 형식 전환 뒤 이전 창은 되살아나지 않는다', () => {
    const scope = ready(), ticket = scope.capture()!;
    scope.setEnabled(false); expect(scope.capture()).toBeNull(); scope.setEnabled(true);
    expect(scope.canApply(ticket)).toBe(false); expect(scope.capture()).not.toBeNull();
  });
  it('폼 reset과 다른 폼, unmount/remount는 창을 무효화한다', () => {
    const scope = ready(), other = ready(), ticket = scope.capture()!;
    expect(other.canApply(ticket)).toBe(false); scope.invalidate(); expect(scope.canApply(ticket)).toBe(false);
    const next = scope.capture()!; scope.dispose(); expect(scope.canApply(next)).toBe(false);
    scope.activate(); scope.authenticate('actor', 'session-a'); expect(scope.canApply(next)).toBe(false);
  });
});
