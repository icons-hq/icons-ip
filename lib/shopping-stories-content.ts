import sanitizeHtml from 'sanitize-html';
import { isSafeInternalLink } from './home-catalog';
import { publicMediaUrl } from './media';
import { cleanContentFormat, invalidContentFormat, sanitizedContentFormat, withContentFormatAllowlist } from './content-format';
import { SHOPPING_STORY_DESCRIPTION_MAX, SHOPPING_STORY_IMAGE_MAX, SHOPPING_STORY_IMAGE_PATTERN } from './shopping-stories';

const TAGS = ['h2', 'h3', 'h4', 'p', 'span', 'br', 'hr', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li', 'blockquote',
  'table', 'caption', 'thead', 'tbody', 'tr', 'th', 'td', 'a', 'img', 'figure', 'figcaption'];
const ATTRIBUTES = withContentFormatAllowlist({ a: ['href', 'rel'], img: ['src', 'alt', 'loading', 'decoding'],
  th: ['colspan', 'rowspan', 'scope'], td: ['colspan', 'rowspan'] });
export function safeShoppingStoryLink(value: string) {
  if (!isSafeInternalLink(value)) return false;
  try {
    const parsed = new URL(decodeURIComponent(value), 'https://store.invalid');
    return parsed.origin === 'https://store.invalid' && !/^\/(?:admin|api)(?:\/|$)/i.test(parsed.pathname);
  } catch { return false; }
}
const BLOCK_TAGS = new Set(['h2', 'h3', 'h4', 'p', 'li', 'blockquote', 'caption', 'tr', 'figcaption']);

export interface ShoppingStoryContent {
  html: string;
  imagePaths: string[];
  representativeImagePath: string | null;
  description: string;
  text: string;
  warnings: string[];
}

/** Saving, editor preview, cards, and public HTML all use this same allowlist.
 * Only verified upload paths are portable at rest; the public boundary additionally
 * restricts them to the paths attached to this story before expanding their URLs. */
export function sanitizeShoppingStoryContent(input: string, options: { imagePaths?: readonly string[]; renderImages?: boolean } = {}): ShoppingStoryContent {
  const allowedImages = options.imagePaths ? new Set(options.imagePaths) : null;
  const images = new Set<string>();
  const warnings = new Set<string>();
  let imageCount = 0;
  const html = sanitizeHtml(input, {
    allowedTags: TAGS, allowedAttributes: ATTRIBUTES, allowedSchemes: ['https', 'http'], allowProtocolRelative: false,
    parseStyleAttributes: false, nestingLimit: 30,
    nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript', 'iframe', 'object', 'embed', 'svg', 'math', 'template'],
    onOpenTag(tag, attrs) {
      if (tag !== 'h1' && tag !== 'div' && !TAGS.includes(tag)) warnings.add('지원하지 않는 태그는 제거됩니다. 문단·제목·목록·표·인용 서식을 사용해주세요.');
      if (Object.keys(attrs).some(key => !(ATTRIBUTES[tag] ?? []).includes(key))) warnings.add('스타일·이벤트 등 지원하지 않는 속성은 제거됩니다.');
      if (invalidContentFormat(tag, attrs)) warnings.add('지원하지 않는 본문 서식 값은 제거됩니다. 편집 도구에서 서식을 선택해주세요.');
    },
    transformTags: {
      h1: (_tag, attrs) => ({ tagName: 'h2', attribs: sanitizedContentFormat('h2', attrs) }),
      div: (_tag, attrs) => ({ tagName: 'p', attribs: sanitizedContentFormat('p', attrs) }),
      a(_tag, attrs): sanitizeHtml.Tag {
        const href = attrs.href && safeShoppingStoryLink(attrs.href) ? attrs.href : null;
        if (attrs.href && !href) warnings.add('외부 링크와 운영 화면 링크는 제거됩니다. 스토어 안의 공개 경로만 사용해주세요.');
        return { tagName: href ? 'a' : 'span', attribs: href ? { href, rel: 'noopener noreferrer' } : {} };
      },
      img(_tag, attrs): sanitizeHtml.Tag {
        const path = attrs.src ?? '';
        if (!SHOPPING_STORY_IMAGE_PATTERN.test(path) || (allowedImages && !allowedImages.has(path))) {
          warnings.add('스토리에서 업로드하고 검증한 이미지만 표시합니다. 외부 이미지와 확인되지 않은 경로는 제거됩니다.');
          return { tagName: 'img', attribs: {} };
        }
        imageCount += 1;
        if (imageCount > SHOPPING_STORY_IMAGE_MAX) {
          warnings.add(`본문 이미지는 최대 ${SHOPPING_STORY_IMAGE_MAX}장입니다. 초과 이미지는 제거됩니다.`);
          return { tagName: 'img', attribs: {} };
        }
        images.add(path);
        return { tagName: 'img', attribs: { src: options.renderImages ? publicMediaUrl(path) ?? '' : path,
          alt: Array.from(attrs.alt ?? '').slice(0, 200).join(''), loading: 'lazy', decoding: 'async' } };
      },
      '*'(tagName, attrs) {
        const attribs = cleanContentFormat(tagName, attrs);
        for (const key of ['colspan', 'rowspan']) if (attribs[key] && !/^(?:[1-9]|[1-9][0-9]|100)$/.test(attribs[key])) delete attribs[key];
        if (attribs.scope && !['row', 'col', 'rowgroup', 'colgroup'].includes(attribs.scope)) delete attribs.scope;
        return { tagName, attribs };
      },
    },
    exclusiveFilter: frame => frame.tag === 'img' && !frame.attribs.src,
  });
  let text = '';
  sanitizeHtml(html, { allowedTags: [], allowedAttributes: {}, textFilter(value) { text += value; return value; },
    onCloseTag(tag) { if (BLOCK_TAGS.has(tag) || tag === 'br' || tag === 'hr') text += ' '; } });
  // textFilter receives escaped text. Decode that one escaping layer without
  // reparsing it as markup or double-decoding literal entity examples.
  const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' };
  const decodedText = text.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_match, key: string) => entities[key]).replace(/\s+/g, ' ').trim();
  return { html, imagePaths: [...images], representativeImagePath: images.values().next().value ?? null,
    text: decodedText, description: Array.from(decodedText).slice(0, SHOPPING_STORY_DESCRIPTION_MAX).join(''), warnings: [...warnings] };
}
