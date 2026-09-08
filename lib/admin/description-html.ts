/*
 * 상세 설명 HTML 화이트리스트 (현업 슬라이스 5 · §2-1).
 *
 * 요청은 「상세 설명에 표·이미지·강조를 쓰고 싶다」였다. 그러려면 HTML 을 받아야 하는데,
 * 받은 것을 그대로 그리면 그 칸이 스크립트 실행 지점이 된다.
 *
 * 그래서 **fail-closed 검사기 하나**로 쓰기와 그리기를 모두 통과시킨다.
 *
 * - 모르는 것은 전부 거절한다. 태그·속성·주소 형식 중 하나라도 목록 밖이면 저장이 실패하고,
 *   **무엇이 문제인지 말한다**. 조용히 지우면 운영자는 저장된 줄 알고 화면에는 없다.
 * - 그리는 쪽도 같은 검사기를 다시 돌린다. 옛 데이터·직접 수정된 행이 있을 수 있으니
 *   「저장 때 검사했으니 안전하다」에 기대지 않는다. 통과하지 못하면 **글자 그대로** 보여준다.
 * - 검사기가 파싱하지 못하는 모양은 안전한 쪽(거절)으로 떨어진다. 「아마 괜찮을 것」은 없다.
 */

/** 허용 태그. 설계안 §2-1 목록 그대로다. */
export const DESCRIPTION_ALLOWED_TAGS = [
  'p', 'br', 'strong', 'em', 'u', 'ul', 'ol', 'li', 'a', 'img',
  'table', 'thead', 'tbody', 'tr', 'td', 'th', 'h2', 'h3',
] as const;

/** 닫지 않는 태그. 이 둘만 `<br>` · `<img ...>` 처럼 혼자 선다. */
const VOID_TAGS = new Set(['br', 'img']);

/** 태그별 허용 속성. 여기 없는 태그는 속성을 하나도 받지 않는다. */
const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href']),
  img: new Set(['src', 'alt']),
};

const ALLOWED = new Set<string>(DESCRIPTION_ALLOWED_TAGS);
const MAX_DEPTH = 20;

/* 태그 하나. 속성값은 반드시 따옴표로 감싼다 — 따옴표 없는 값은 어디서 끝나는지가
   파서마다 달라, 브라우저와 우리가 다르게 읽는 순간이 곧 구멍이다. */
const TAG = /^<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)((?:\s+[a-zA-Z-]+\s*=\s*"[^"<>]*")*)\s*(\/?)\s*>/;
const ATTR = /([a-zA-Z-]+)\s*=\s*"([^"<>]*)"/g;

export type DescriptionHtmlCheck =
  | { ok: true; hasMarkup: boolean }
  | { ok: false; error: string };

function attrError(tag: string, name: string) {
  return `<${tag}> 에는 ${name} 속성을 쓸 수 없습니다. 허용: ${
    [...(ALLOWED_ATTRS[tag] ?? [])].join(', ') || '없음'
  }`;
}

/**
 * 링크 주소. 우리 사이트 안(`/...`)이거나 `https://` 만 허용한다.
 *
 * `javascript:` 는 물론이고 `data:` 도 막는다 — 이미지처럼 보이는 문서를 심을 수 있다.
 * `//example.com` 도 막는다: 프로토콜만 물려받는 주소라 사람 눈에 내부 경로로 보인다.
 */
function linkError(tag: string, name: string, value: string) {
  const url = value.trim();
  if (!url) return `<${tag}> 의 ${name} 가 비어 있습니다.`;
  if (url.startsWith('//')) return `<${tag}> 의 ${name} 는 https:// 로 시작하는 전체 주소를 써주세요.`;
  if (url.startsWith('/')) return null;
  if (url.startsWith('https://')) return null;
  return `<${tag}> 의 ${name} 는 사이트 내부 경로(/…)나 https:// 주소만 쓸 수 있습니다: ${url}`;
}

/**
 * 상세 설명 HTML 검사. 통과하면 그대로 그려도 되는 값이다.
 *
 * `hasMarkup` 이 false 면 태그가 하나도 없는 순수 문자다 — 부르는 쪽이 지금까지처럼
 * 줄바꿈만 살려 글자로 그린다.
 */
export function checkDescriptionHtml(input: string | null | undefined): DescriptionHtmlCheck {
  const text = input ?? '';
  if (!text.includes('<')) return { ok: true, hasMarkup: false };

  const stack: string[] = [];
  let cursor = 0;
  let sawTag = false;

  while (cursor < text.length) {
    const next = text.indexOf('<', cursor);
    if (next === -1) break;

    const match = TAG.exec(text.slice(next));
    if (!match) {
      return {
        ok: false,
        error: '태그로 읽을 수 없는 `<` 가 있습니다. 글자로 쓰려면 &lt; 로 적어주세요.',
      };
    }

    const [whole, closing, rawName, rawAttrs, selfClose] = match;
    const tag = rawName.toLowerCase();
    sawTag = true;

    if (!ALLOWED.has(tag)) {
      return { ok: false, error: `<${tag}> 태그는 쓸 수 없습니다. 허용: ${DESCRIPTION_ALLOWED_TAGS.join(', ')}` };
    }

    if (closing) {
      if (VOID_TAGS.has(tag)) return { ok: false, error: `</${tag}> 는 쓰지 않습니다.` };
      if (rawAttrs.trim()) return { ok: false, error: `</${tag}> 에는 속성을 쓸 수 없습니다.` };
      if (stack.pop() !== tag) return { ok: false, error: `</${tag}> 의 짝이 맞지 않습니다.` };
    } else {
      const allowedAttrs = ALLOWED_ATTRS[tag] ?? new Set<string>();
      ATTR.lastIndex = 0;
      let attr: RegExpExecArray | null;
      const seen = new Set<string>();
      while ((attr = ATTR.exec(rawAttrs)) !== null) {
        const name = attr[1].toLowerCase();
        if (!allowedAttrs.has(name)) return { ok: false, error: attrError(tag, name) };
        if (seen.has(name)) return { ok: false, error: `<${tag}> 에 ${name} 가 두 번 있습니다.` };
        seen.add(name);
        if (name === 'href' || name === 'src') {
          const problem = linkError(tag, name, attr[2]);
          if (problem) return { ok: false, error: problem };
        }
      }
      if (tag === 'img' && !seen.has('src')) return { ok: false, error: '<img> 에는 src 가 필요합니다.' };
      if (tag === 'a' && !seen.has('href')) return { ok: false, error: '<a> 에는 href 가 필요합니다.' };

      if (!VOID_TAGS.has(tag)) {
        if (selfClose) return { ok: false, error: `<${tag}/> 처럼 혼자 닫을 수 없습니다. </${tag}> 로 닫아주세요.` };
        stack.push(tag);
        if (stack.length > MAX_DEPTH) return { ok: false, error: '태그가 너무 깊게 겹쳐 있습니다.' };
      }
    }

    cursor = next + whole.length;
  }

  if (stack.length > 0) return { ok: false, error: `<${stack[stack.length - 1]}> 를 닫지 않았습니다.` };
  return { ok: true, hasMarkup: sawTag };
}

/**
 * 그릴 때 쓰는 판정. **검사를 통과한 마크업만** HTML 로 돌려준다.
 *
 * 통과하지 못하면 `null` 이다 — 부르는 쪽은 글자로 그린다. 옛 행이나 손으로 고친 행이
 * 화면에서 실행되지 않도록, 「저장 때 봤다」에 기대지 않는 두 번째 문이다.
 */
export function descriptionHtmlToRender(input: string | null | undefined): string | null {
  const check = checkDescriptionHtml(input);
  if (!check.ok || !check.hasMarkup) return null;
  return input ?? null;
}
