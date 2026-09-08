import { describe, expect, it } from 'vitest';
import { checkDescriptionHtml, descriptionHtmlToRender } from './description-html';

function error(input: string) {
  const result = checkDescriptionHtml(input);
  return result.ok ? null : result.error;
}

describe('checkDescriptionHtml — 통과', () => {
  it('태그가 없으면 마크업이 아니다', () => {
    expect(checkDescriptionHtml('그냥 설명입니다.\n두 줄.')).toEqual({ ok: true, hasMarkup: false });
    expect(checkDescriptionHtml(null)).toEqual({ ok: true, hasMarkup: false });
  });

  it('허용 태그로 만든 문서는 통과한다', () => {
    const html = '<h2>구성</h2><p><strong>본품</strong> 1개<br>스티커 2매</p>'
      + '<ul><li>PVC</li><li>국내 제작</li></ul>'
      + '<table><thead><tr><th>항목</th></tr></thead><tbody><tr><td>크기</td></tr></tbody></table>'
      + '<p><a href="/shop/g1">함께 보기</a> <a href="https://icons.example/guide">가이드</a></p>'
      + '<p><img src="/storage/v1/object/public/artwork/g1.jpg" alt="구성품"></p>';

    expect(checkDescriptionHtml(html)).toEqual({ ok: true, hasMarkup: true });
    expect(descriptionHtmlToRender(html)).toBe(html);
  });
});

describe('checkDescriptionHtml — 거절', () => {
  /* 조용히 지우면 운영자는 저장된 줄 알고 화면에는 없다. 무엇이 문제인지 말한다. */
  it('목록 밖 태그는 이름을 짚어 거절한다', () => {
    expect(error('<p>안녕</p><script>alert(1)</script>')).toContain('<script> 태그는 쓸 수 없습니다');
    expect(error('<iframe src="https://x.test"></iframe>')).toContain('<iframe>');
  });

  it('허용 태그라도 목록 밖 속성은 거절한다', () => {
    expect(error('<p onclick="alert(1)">x</p>')).toContain('onclick');
    expect(error('<img src="/a.png" onerror="alert(1)">')).toContain('onerror');
    expect(error('<a href="/x" style="x">t</a>')).toContain('style');
  });

  it('주소는 내부 경로나 https 만 받는다', () => {
    expect(error('<a href="javascript:alert(1)">t</a>')).toContain('내부 경로');
    expect(error('<img src="data:text/html;base64,PHN2Zz4=">')).toContain('내부 경로');
    expect(error('<a href="//evil.test/x">t</a>')).toContain('https://');
    expect(error('<a href="http://plain.test">t</a>')).toContain('내부 경로');
  });

  it('짝이 맞지 않거나 닫지 않은 태그를 거절한다', () => {
    expect(error('<p>열기')).toContain('닫지 않았습니다');
    expect(error('<ul><li>하나</ul></li>')).toContain('짝이 맞지 않습니다');
    expect(error('<p/>')).toContain('혼자 닫을 수 없습니다');
  });

  /* 파서가 못 읽는 모양은 안전한 쪽으로 떨어진다 — 「아마 괜찮을 것」은 없다. */
  it('태그로 읽히지 않는 `<` 는 거절한다', () => {
    expect(error('가격 < 10000 원')).toContain('&lt;');
    expect(error("<a href=/x>t</a>")).toContain('&lt;');
  });

  it('필수 속성이 빠지면 거절한다', () => {
    expect(error('<img alt="설명">')).toContain('src 가 필요합니다');
    expect(error('<a>링크</a>')).toContain('href 가 필요합니다');
  });
});

describe('descriptionHtmlToRender', () => {
  it('통과하지 못한 값은 그리지 않는다 — 저장 때 봤다는 것에 기대지 않는다', () => {
    expect(descriptionHtmlToRender('<script>alert(1)</script>')).toBeNull();
    expect(descriptionHtmlToRender('<p onclick="x">t</p>')).toBeNull();
  });

  it('태그가 없으면 글자로 그리게 둔다', () => {
    expect(descriptionHtmlToRender('그냥 설명')).toBeNull();
  });
});
