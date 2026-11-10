/** Closed document formatting vocabulary shared by product and story HTML.
 * No arbitrary CSS, classes, URLs or event handlers are accepted by this layer. */
export const CONTENT_ALIGNMENTS = ['left', 'center', 'right'] as const;
export const CONTENT_FONT_SIZES = ['12', '14', '16', '20', '24', '32', '40'] as const;
export const CONTENT_QUOTE_STYLES = ['line', 'quotes', 'bubble', 'note', 'frame'] as const;
export const CONTENT_DIVIDER_STYLES = ['line', 'short', 'bold', 'chevron', 'diamond', 'dots', 'slash', 'vertical'] as const;
export type ContentAlignment = typeof CONTENT_ALIGNMENTS[number];
export type ContentFontSize = typeof CONTENT_FONT_SIZES[number];
export type ContentQuoteStyle = typeof CONTENT_QUOTE_STYLES[number];
export type ContentDividerStyle = typeof CONTENT_DIVIDER_STYLES[number];
const TEXT_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'div', 'span', 'li', 'blockquote', 'caption', 'figcaption', 'th', 'td']);
const ATTRIBUTE_VALUES: Record<string, readonly string[]> = {
  'data-icons-align': CONTENT_ALIGNMENTS, 'data-icons-size': CONTENT_FONT_SIZES,
  'data-icons-quote': CONTENT_QUOTE_STYLES, 'data-icons-divider': CONTENT_DIVIDER_STYLES,
};

export function contentFormatAttributeNames(tag: string): string[] {
  if (tag === 'hr') return ['data-icons-divider'];
  return [...(TEXT_TAGS.has(tag) ? ['data-icons-align', 'data-icons-size'] : []), ...(tag === 'blockquote' ? ['data-icons-quote'] : [])];
}

export function withContentFormatAllowlist(base: Record<string, string[]>): Record<string, string[]> {
  const result = { ...base };
  for (const tag of [...TEXT_TAGS, 'hr']) result[tag] = [...(base[tag] ?? []), ...contentFormatAttributeNames(tag)];
  return result;
}

export function sanitizedContentFormat(tag: string, attrs: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of contentFormatAttributeNames(tag)) {
    if (Object.hasOwn(attrs, key) && ATTRIBUTE_VALUES[key].includes(attrs[key])) result[key] = attrs[key];
  }
  return result;
}

/** Keep existing non-format attributes for the caller's own URL/image allowlist. */
export function cleanContentFormat(tag: string, attrs: Record<string, string>): Record<string, string> {
  const result = { ...attrs };
  for (const key of Object.keys(result)) if (key.startsWith('data-icons-')) delete result[key];
  return { ...result, ...sanitizedContentFormat(tag, attrs) };
}

export function invalidContentFormat(tag: string, attrs: Record<string, string>): boolean {
  const clean = sanitizedContentFormat(tag, attrs);
  return Object.keys(attrs).some(key => key.startsWith('data-icons-') && !Object.hasOwn(clean, key));
}
