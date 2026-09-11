import sanitizeHtml from 'sanitize-html';
import { publicMediaUrl } from './media';

export type GoodsDescriptionFormat = 'plain' | 'html';
export const GOODS_HTML_MAX_LENGTH = 30000;
export const GOODS_HTML_IMAGE_MAX = 20;
const IMAGE_PATH = /^public-media\/catalog\/good\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|png|webp)$/;
const DOCUMENT_TAGS = ['h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'hr', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li', 'blockquote', 'table', 'caption', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'a', 'img', 'figure', 'figcaption'];
const DOCUMENT_ATTRIBUTES: Record<string, string[]> = { a: ['href', 'title', 'rel'], img: ['src', 'alt', 'loading', 'decoding'], ol: ['start'], table: ['tabindex'], th: ['colspan', 'rowspan', 'scope'], td: ['colspan', 'rowspan'] };

function safeLink(href: string | undefined): string | undefined {
  if (!href || /[\u0000-\u0020\u007f\\]/.test(href)) return undefined;
  if (href.startsWith('/') && !href.startsWith('//')) return href;
  try {
    const url = new URL(href);
    return ['https:', 'http:', 'mailto:', 'tel:'].includes(url.protocol) && !url.username && !url.password ? href : undefined;
  } catch { return undefined; }
}

/** A single parser/allowlist for saving, preview and the public HTML sink.
 * Images stay as portable Storage paths at rest. Only paths authorized by the
 * database are expanded to public URLs at the render boundary. */
export function sanitizeGoodsDescription(input: string, options: {
  imagePaths?: readonly string[];
  renderImages?: boolean;
} = {}): { html: string; imagePaths: string[]; warnings: string[] } {
  const images = new Set<string>();
  const warnings = new Set<string>();
  const allowedImages = options.imagePaths ? new Set(options.imagePaths) : null;
  const html = sanitizeHtml(input, {
    allowedTags: DOCUMENT_TAGS,
    allowedAttributes: DOCUMENT_ATTRIBUTES,
    allowedSchemes: ['https', 'http', 'mailto', 'tel'],
    allowProtocolRelative: false,
    parseStyleAttributes: false,
    nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript', 'iframe', 'object', 'embed', 'svg', 'math', 'template'],
    onOpenTag: (tag, attrs) => {
      if (tag !== 'h1' && !DOCUMENT_TAGS.includes(tag)) warnings.add('지원하지 않는 태그는 제거됩니다. 제목·문단·목록·표와 강조 요소로 내용을 옮겨주세요.');
      if (Object.keys(attrs).some((attr) => !(DOCUMENT_ATTRIBUTES[tag] ?? []).includes(attr))) warnings.add('CSS·이벤트 등 지원하지 않는 속성은 제거됩니다. 문서 기본 서식이 적용됩니다.');
      if (tag === 'a' && attrs.href && !safeLink(attrs.href)) warnings.add('안전하지 않은 링크 주소는 제거됩니다. https 주소 또는 사이트 안의 /경로를 입력해주세요.');
    },
    transformTags: {
      h1: 'h2',
      a: (_tag, attrs) => {
        const href = safeLink(attrs.href);
        return { tagName: 'a', attribs: { ...(href ? { href } : {}), ...(attrs.title ? { title: attrs.title } : {}), rel: 'noopener noreferrer' } };
      },
      table: () => ({ tagName: 'table', attribs: { tabindex: '0' } }),
      img: (_tag, attrs): sanitizeHtml.Tag => {
        const path = attrs.src ?? '';
        if (!IMAGE_PATH.test(path) || (allowedImages && !allowedImages.has(path))) {
          warnings.add('외부 URL·검증되지 않은 이미지는 표시되지 않습니다. HTML 이미지 업로드 후 설명에 넣기를 사용해주세요.');
          return { tagName: 'img', attribs: {} };
        }
        images.add(path);
        const src = options.renderImages ? publicMediaUrl(path) : path;
        return { tagName: 'img', attribs: src ? { src, alt: attrs.alt ?? '', loading: 'lazy', decoding: 'async' } : {} };
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
