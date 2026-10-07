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

export const GOODS_HTML_WARNINGS = {
  unverifiedImage: '주소를 확인할 수 없는 이미지는 제거됩니다. https로 시작하는 호스팅 이미지 주소를 넣거나 HTML 이미지 업로드를 사용해주세요.',
  insecureImage: 'http로 시작하는 이미지 주소는 https로 바꿔 저장합니다. 호스팅 이미지가 https 주소로 열리는지 확인해주세요.',
  externalImageLimit: `호스팅 이미지는 최대 ${GOODS_HTML_EXTERNAL_IMAGE_MAX}장까지 표시됩니다. 초과한 이미지는 제거됩니다.`,
} as const;

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
 * http는 브라우저의 mixed content 자동 승격과 같은 https 주소로 저장한다.
 * 상대·프로토콜 상대 경로, 인증 정보가 든 주소, 제어문자·공백·역슬래시는 거른다.
 */
function hostedImageUrl(src: string): { url: string; upgraded: boolean } | null {
  if (!src || UNSAFE_URL_CHARACTER.test(src)) return null;
  let url: URL;
  try { url = new URL(src); } catch { return null; }
  if (url.username || url.password || !url.hostname) return null;
  if (url.protocol === 'https:') return { url: url.href, upgraded: false };
  if (url.protocol !== 'http:') return null;
  url.protocol = 'https:';
  return { url: url.href, upgraded: true };
}

/** A single parser/allowlist for saving, preview and the public HTML sink.
 * Uploaded images stay as portable Storage paths at rest. Only paths authorized
 * by the database are expanded to public URLs at the render boundary. Hosted
 * https images are kept as written and never enter the ownership list. */
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
        const hosted = IMAGE_PATH.test(path) ? null : hostedImageUrl(path);
        if (!hosted) {
          warnings.add(GOODS_HTML_WARNINGS.unverifiedImage);
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
  return { html, imagePaths: [...images], warnings: [...warnings] };
}
