import sanitizeHtml from 'sanitize-html';
import { publicMediaUrl } from './media';

export type GoodsDescriptionFormat = 'plain' | 'html';
export const GOODS_HTML_MAX_LENGTH = 30000;
/** 업로드한 저장소 이미지 상한. DB `goods_description_images` 제약과 같은 값이다. */
export const GOODS_HTML_IMAGE_MAX = 20;
/** 이미지 호스팅 URL 상한. 저장소 소유 검증 대상이 아니라 DB 목록에 넣지 않는다. */
export const GOODS_HTML_EXTERNAL_IMAGE_MAX = 100;
const IMAGE_PATH = /^public-media\/catalog\/good\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|png|webp)$/;
/* 호스팅 상세페이지 HTML의 레이아웃 래퍼. 속성 없이 남기거나(div·span) div로 바꿔(center)
   블록 구조만 보존한다 — 안내할 내용이 없어 제거 경고도 내지 않는다. */
const LAYOUT_TAGS = ['div', 'span'];
const DOCUMENT_TAGS = ['h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'hr', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li', 'blockquote', 'table', 'caption', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'a', 'img', 'figure', 'figcaption', ...LAYOUT_TAGS];
const DOCUMENT_ATTRIBUTES: Record<string, string[]> = { a: ['href', 'title', 'rel'], img: ['src', 'alt', 'loading', 'decoding', 'referrerpolicy'], ol: ['start'], table: ['tabindex'], th: ['colspan', 'rowspan', 'scope'], td: ['colspan', 'rowspan'] };
const UNSAFE_URL_CHARACTER = /[\u0000- \u007f\\]/;
const BLANK_URL_CHARACTER = /[\u0000- \u007f]/;
/* 스킴 뒤에 //가 바로 오는 절대 주소만 받는다. 원문 문자열을 그대로 저장하므로 `https:host`처럼
   파서마다 해석이 갈릴 수 있는 형태는 거른다. */
const HOSTED_IMAGE_URL = /^(https?):\/\/([^/?#]*)([\s\S]*)$/i;
/* 공개 상세의 이미지는 블록이라, 바로 뒤의 <br>은 다른 판매처(인라인 이미지)에는 없는 빈 줄을 만든다.
   sanitize-html 출력은 `<img … />`·`<br />`로 정규화되고 속성값의 `>`는 `&gt;`로 바뀌어 이 패턴이 정확하다. */
const IMAGE_TRAILING_BREAK = /(<img\b[^>]*>(?:\s*<\/a>)?)(\s*)<br \/>/g;

export const GOODS_HTML_WARNINGS = {
  unverifiedImage: '주소를 확인할 수 없는 이미지는 제거됩니다. https로 시작하는 호스팅 이미지 주소를 넣거나 HTML 이미지 업로드를 사용해주세요.',
  imageUrlWhitespace: '이미지 주소에 공백·줄바꿈 같은 보이지 않는 문자가 있어 표시되지 않습니다. 주소 앞뒤 공백을 지우고, 파일명의 공백은 %20으로 바꿔주세요.',
  insecureImage: 'http로 시작하는 이미지 주소는 https로 바꿔 저장합니다. 호스팅 이미지가 https 주소로 열리는지 확인해주세요.',
  externalImageLimit: `호스팅 이미지는 최대 ${GOODS_HTML_EXTERNAL_IMAGE_MAX}장까지 표시됩니다. 초과한 이미지는 제거됩니다.`,
} as const;

/** 편집기 저장 전 확인용. 서버는 정리된 코드에도 같은 상한을 건다(이미지마다 표시용 속성이 붙어 원문보다 길어질 수 있다). */
export function goodsHtmlCleanedLengthWarning(length: number) {
  return `정리된 코드가 ${length.toLocaleString('ko-KR')}자로 최대 ${GOODS_HTML_MAX_LENGTH.toLocaleString('ko-KR')}자를 넘어 저장할 수 없습니다. 이미지마다 표시용 속성이 붙어 원문보다 길어지니 내용을 줄여주세요.`;
}

function safeLink(href: string | undefined): string | undefined {
  if (!href || UNSAFE_URL_CHARACTER.test(href)) return undefined;
  if (href.startsWith('/') && !href.startsWith('//')) return href;
  try {
    const url = new URL(href);
    return ['https:', 'http:', 'mailto:', 'tel:'].includes(url.protocol) && !url.username && !url.password ? href : undefined;
  } catch { return undefined; }
}

/*
 * 이미지 호스팅에 올린 상세페이지 이미지 (2026-10-07 MD 요청). 여러 판매처가 같은 HTML
 * 소스를 쓰고 호스팅 이미지만 바꿔 한 번에 갱신하므로, 절대 https 주소는 그대로 둔다.
 * http는 브라우저의 mixed content 자동 승격과 같은 https 주소로 저장한다(기본 포트 80 표기는 뺀다).
 * 상대·프로토콜 상대 경로, 인증 정보가 든 주소, 제어문자·공백·역슬래시는 거른다.
 *
 * 검증은 URL 파서로 하되 저장값은 적은 문자열 그대로다. `url.href`로 다시 쓰면 한글 파일명이
 * 퍼센트 인코딩(1자 → 9자)돼 정리된 코드만 길이 상한을 넘거나, `%2e%2e` 같은 경로가 정규화돼
 * 다른 리소스를 가리킬 수 있다. 출력 이스케이프는 sanitize-html이 맡는다.
 */
type HostedImage = { ok: true; url: string; upgraded: boolean } | { ok: false; reason: 'blank' | 'invalid' };

function hostedImageUrl(src: string): HostedImage {
  if (BLANK_URL_CHARACTER.test(src) && /^[\u0000- ]*https?:/i.test(src)) return { ok: false, reason: 'blank' };
  const parts = UNSAFE_URL_CHARACTER.test(src) ? null : HOSTED_IMAGE_URL.exec(src);
  if (!parts) return { ok: false, reason: 'invalid' };
  let url: URL;
  try { url = new URL(src); } catch { return { ok: false, reason: 'invalid' }; }
  if (url.username || url.password || !url.hostname) return { ok: false, reason: 'invalid' };
  if (url.protocol === 'https:') return { ok: true, url: src, upgraded: false };
  // http 기본 포트(80)는 파서가 비워 둔다. https로 바꾸면 기본 포트가 443이므로 그 표기만 뺀다.
  const [, , authority, rest] = parts;
  return { ok: true, url: `https://${url.port ? authority : authority.replace(/:\d*$/, '')}${rest}`, upgraded: true };
}

/** A single parser/allowlist for saving, preview and the public HTML sink.
 * Uploaded images stay as portable Storage paths at rest. Only paths authorized
 * by the database are expanded to public URLs at the render boundary. Hosted
 * https images are kept as written and never enter the ownership list.
 * The render boundary (`renderImages`) also drops a `<br>` directly after an image;
 * the stored source keeps it because the same HTML is reused by other sales channels. */
export function sanitizeGoodsDescription(input: string, options: {
  imagePaths?: readonly string[];
  renderImages?: boolean;
} = {}): { html: string; imagePaths: string[]; warnings: string[] } {
  const images = new Set<string>();
  const warnings = new Set<string>();
  const allowedImages = options.imagePaths ? new Set(options.imagePaths) : null;
  let externalImages = 0;
  const html = sanitizeHtml(input, {
    allowedTags: DOCUMENT_TAGS,
    allowedAttributes: DOCUMENT_ATTRIBUTES,
    allowedSchemes: ['https', 'http', 'mailto', 'tel'],
    allowProtocolRelative: false,
    parseStyleAttributes: false,
    nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript', 'iframe', 'object', 'embed', 'svg', 'math', 'template'],
    onOpenTag: (tag, attrs) => {
      if (tag !== 'h1' && tag !== 'center' && !DOCUMENT_TAGS.includes(tag)) warnings.add('지원하지 않는 태그는 제거됩니다. 제목·문단·목록·표와 강조 요소로 내용을 옮겨주세요.');
      if (Object.keys(attrs).some((attr) => !(DOCUMENT_ATTRIBUTES[tag] ?? []).includes(attr))) warnings.add('CSS·이벤트 등 지원하지 않는 속성은 제거됩니다. 문서 기본 서식이 적용됩니다.');
      if (tag === 'a' && attrs.href && !safeLink(attrs.href)) warnings.add('안전하지 않은 링크 주소는 제거됩니다. https 주소 또는 사이트 안의 /경로를 입력해주세요.');
    },
    transformTags: {
      h1: 'h2',
      center: () => ({ tagName: 'div', attribs: {} }),
      div: () => ({ tagName: 'div', attribs: {} }),
      span: () => ({ tagName: 'span', attribs: {} }),
      a: (_tag, attrs) => {
        const href = safeLink(attrs.href);
        return { tagName: 'a', attribs: { ...(href ? { href } : {}), ...(attrs.title ? { title: attrs.title } : {}), rel: 'noopener noreferrer' } };
      },
      table: () => ({ tagName: 'table', attribs: { tabindex: '0' } }),
      img: (_tag, attrs): sanitizeHtml.Tag => {
        const path = attrs.src ?? '';
        if (IMAGE_PATH.test(path) && (!allowedImages || allowedImages.has(path))) {
          images.add(path);
          const src = options.renderImages ? publicMediaUrl(path) : path;
          return { tagName: 'img', attribs: src ? { src, alt: attrs.alt ?? '', loading: 'lazy', decoding: 'async' } : {} };
        }
        const hosted: HostedImage = IMAGE_PATH.test(path) ? { ok: false, reason: 'invalid' } : hostedImageUrl(path);
        if (!hosted.ok) {
          warnings.add(hosted.reason === 'blank' ? GOODS_HTML_WARNINGS.imageUrlWhitespace : GOODS_HTML_WARNINGS.unverifiedImage);
          return { tagName: 'img', attribs: {} };
        }
        if (externalImages >= GOODS_HTML_EXTERNAL_IMAGE_MAX) {
          warnings.add(GOODS_HTML_WARNINGS.externalImageLimit);
          return { tagName: 'img', attribs: {} };
        }
        externalImages += 1;
        if (hosted.upgraded) warnings.add(GOODS_HTML_WARNINGS.insecureImage);
        return { tagName: 'img', attribs: { src: hosted.url, alt: attrs.alt ?? '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' } };
      },
      '*': (tagName, attrs) => {
        const attribs = { ...attrs };
        for (const name of ['colspan', 'rowspan']) {
          if (attribs[name] && !/^(?:[1-9]|[1-9][0-9]|100)$/.test(attribs[name])) delete attribs[name];
        }
        if (attribs.scope && !['row', 'col', 'rowgroup', 'colgroup'].includes(attribs.scope)) delete attribs.scope;
        if (attribs.start && !/^-?\d{1,5}$/.test(attribs.start)) delete attribs.start;
        return { tagName, attribs };
      },
    },
    exclusiveFilter: (frame) => frame.tag === 'img' && !frame.attribs.src,
    nestingLimit: 30,
  });
  return { html: options.renderImages ? html.replace(IMAGE_TRAILING_BREAK, '$1$2') : html, imagePaths: [...images], warnings: [...warnings] };
}
