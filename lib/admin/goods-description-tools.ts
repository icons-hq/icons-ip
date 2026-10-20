import { GOODS_HTML_MAX_LENGTH, goodsHtmlCleanedLengthWarning, safeGoodsDescriptionLink, sanitizeGoodsDescription } from '@/lib/goods-description';
import { CONTENT_ALIGNMENTS, CONTENT_DIVIDER_STYLES, CONTENT_FONT_SIZES, CONTENT_QUOTE_STYLES, type ContentAlignment, type ContentDividerStyle, type ContentFontSize, type ContentQuoteStyle } from '@/lib/content-format';

export type GoodsDescriptionTool = { kind: 'quote'; text: string; style?: ContentQuoteStyle } | { kind: 'divider'; style?: ContentDividerStyle }
  | { kind: 'link'; text: string; href: string }
  | { kind: 'text'; text: string; alignment: ContentAlignment; size: ContentFontSize; emphasis: ('strong' | 'em' | 'u' | 's')[] };
type Result<T> = { ok: true; value: T } | { ok: false; error: string };
const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/** Tool text is always literal; the full document still uses the existing HTML sanitizer. */
export function goodsDescriptionToolFragment(tool: GoodsDescriptionTool): Result<string> {
  if (tool.kind === 'divider') {
    if (tool.style !== undefined && !CONTENT_DIVIDER_STYLES.includes(tool.style)) return { ok: false, error: '구분선 모양을 다시 선택해주세요.' };
    return { ok: true, value: `<hr${tool.style ? ` data-icons-divider="${tool.style}"` : ''}>\n` };
  }
  if (!tool.text.trim()) return { ok: false, error: tool.kind === 'quote' ? '인용할 내용을 입력해주세요.' : tool.kind === 'text' ? '서식을 적용할 내용을 입력해주세요.' : '링크에 표시할 문구를 입력해주세요.' };
  if (tool.kind === 'quote') {
    if (tool.style !== undefined && !CONTENT_QUOTE_STYLES.includes(tool.style)) return { ok: false, error: '인용 모양을 다시 선택해주세요.' };
    return { ok: true, value: `<blockquote${tool.style ? ` data-icons-quote="${tool.style}"` : ''}>${escape(tool.text).replace(/\r\n?|\n/g, '<br>')}</blockquote>\n` };
  }
  if (tool.kind === 'text') {
    if (!CONTENT_ALIGNMENTS.includes(tool.alignment) || !CONTENT_FONT_SIZES.includes(tool.size)
      || tool.emphasis.length > 4 || new Set(tool.emphasis).size !== tool.emphasis.length || tool.emphasis.some(tag => !['strong', 'em', 'u', 's'].includes(tag)))
      return { ok: false, error: '본문 정렬·크기·강조 서식을 다시 선택해주세요.' };
    let content = escape(tool.text).replace(/\r\n?|\n/g, '<br>');
    for (const tag of tool.emphasis) content = `<${tag}>${content}</${tag}>`;
    return { ok: true, value: `<p data-icons-align="${tool.alignment}" data-icons-size="${tool.size}">${content}</p>\n` };
  }
  if (!safeGoodsDescriptionLink(tool.href)) return { ok: false, error: 'https·http·mailto·tel 주소 또는 /로 시작하는 내부 경로를 입력해주세요. 공백·역슬래시·로그인 정보가 들어간 주소는 사용할 수 없습니다.' };
  return { ok: true, value: sanitizeGoodsDescription(`<a href="${escape(tool.href)}">${escape(tool.text)}</a>`).html };
}

export function planGoodsDescriptionInsertion(source: string, start: number, end: number, fragment: string): Result<{ value: string; cursor: number }> {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > source.length)
    return { ok: false, error: '입력 위치가 바뀌었습니다. 상세설명에서 위치를 다시 선택해주세요.' };
  if (source.length > GOODS_HTML_MAX_LENGTH || fragment.length > GOODS_HTML_MAX_LENGTH)
    return { ok: false, error: '입력 원문이 30,000자를 넘어 넣을 수 없습니다. 기존 내용은 유지됩니다.' };
  const left = descriptionHtmlBoundary(source, start), right = descriptionHtmlBoundary(source, end);
  if (!left || !right || JSON.stringify(left) !== JSON.stringify(right)) return { ok: false, error: 'HTML 태그·속성·문자 참조의 중간이나 서로 다른 문단에 걸쳐 넣을 수 없습니다. 문단 전체의 HTML 또는 태그 밖 위치를 선택해주세요.' };
  // A reusable body can begin with inline text and still contain later block
  // elements or links. Check the entire fragment before allowing an insertion.
  const parents = left.map(element => element.tag), parent = parents.at(-1), block = /<(?:p|blockquote|hr|div|h[1-6]|ul|ol|li|table|caption|thead|tbody|tfoot|tr|th|td|figure|figcaption)\b/i.test(fragment);
  if (parents.some(tag => ['script', 'style', 'textarea', 'title', 'template', 'svg', 'math'].includes(tag))
    || block && parent && !['div', 'blockquote', 'li', 'td', 'th', 'figure'].includes(parent)
    || /<a\b/i.test(fragment) && parents.includes('a')) return { ok: false, error: '이 태그 안에는 해당 서식을 넣을 수 없습니다. 문단 전체의 HTML을 선택하거나 닫는 태그 뒤에서 넣어주세요.' };
  const value = source.slice(0, start) + fragment + source.slice(end);
  if (value.length > GOODS_HTML_MAX_LENGTH) return { ok: false, error: '입력 원문이 30,000자를 넘어 넣을 수 없습니다. 기존 내용은 유지됩니다.' };
  const cleaned = sanitizeGoodsDescription(value).html;
  if (cleaned.length > GOODS_HTML_MAX_LENGTH) return { ok: false, error: goodsHtmlCleanedLengthWarning(cleaned.length) };
  return { ok: true, value: { value, cursor: start + fragment.length } };
}

/** A conservative editing guard, not an HTML sanitizer. It never rewrites the
 * source to repair an ambiguous selection; saving still uses the real parser. */
function descriptionHtmlBoundary(source: string, position: number): { tag: string; start: number }[] | null {
  const stack: { tag: string; start: number }[] = [], voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  let index = 0;
  while (index < source.length) {
    if (index === position) return [...stack];
    if (source[index] === '<' && /[A-Za-z!/?]/.test(source[index + 1] ?? '')) {
      let end = index + 1, complete = false;
      if (source.startsWith('<!--', index)) {
        const closing = source.indexOf('-->', index + 4); end = closing < 0 ? source.length : closing + 3; complete = closing >= 0;
      } else {
        let quote = '';
        while (end < source.length) {
          const character = source[end++];
          if (quote) { if (character === quote) quote = ''; }
          else if (character === '"' || character === "'") quote = character;
          else if (character === '>') { complete = true; break; }
        }
      }
      if (position > index && position < end) return null;
      // An unfinished token cannot be used as an append position either.
      if (!complete && position === end) return null;
      const token = source.slice(index, end), match = /^<\s*(\/?)\s*([A-Za-z][\w:-]*)\b/.exec(token);
      if (match) {
        const tag = match[2].toLowerCase();
        if (match[1]) { const open = stack.findLastIndex(element => element.tag === tag); if (open >= 0) stack.splice(open); }
        else if (!voidTags.has(tag)) stack.push({ tag, start: index });
      }
      index = end;
    } else if (source[index] === '&') {
      const entity = /^&(?:#[xX][\da-fA-F]+|#\d+|[A-Za-z][A-Za-z\d]*);?/.exec(source.slice(index))?.[0];
      if (entity) {
        const end = index + entity.length;
        if (position > index && (position < end || !entity.endsWith(';') && position === end)) return null;
        index = end;
      } else index++;
    } else index++;
  }
  return index === position ? [...stack] : null;
}

export interface GoodsDescriptionToolTicket { owner: symbol; epoch: number }
/** A local dialog can never survive a reset, submission or login change. No authorization is inferred here. */
export function createGoodsDescriptionToolScope(accountId: string) {
  const owner = Symbol('goods-description-tool'), listeners = new Set<() => void>();
  const initial = { ready: false, blocked: false, enabled: false, epoch: 0 };
  let snapshot = initial, mounted = false, session: string | null = null;
  const update = (patch: Partial<typeof initial>) => { snapshot = { ...snapshot, ...patch }; listeners.forEach(listener => listener()); };
  const invalidate = () => update({ epoch: snapshot.epoch + 1 });
  const available = () => mounted && snapshot.ready && !snapshot.blocked && snapshot.enabled;
  return {
    getSnapshot: () => snapshot, getServerSnapshot: () => initial,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    activate() { mounted = true; session = null; update({ ...initial, enabled: snapshot.enabled, epoch: snapshot.epoch + 1 }); },
    dispose() { mounted = false; invalidate(); },
    invalidate,
    setEnabled(enabled: boolean) { if (snapshot.enabled !== enabled) update({ enabled, epoch: snapshot.epoch + 1 }); },
    authenticate(userId: string | null, sessionId: string | null) {
      if (!mounted || snapshot.blocked) return;
      if (!accountId || accountId !== userId || !sessionId || session !== null && session !== sessionId) {
        update({ ready: true, blocked: true, epoch: snapshot.epoch + 1 }); return;
      }
      session = sessionId;
      if (!snapshot.ready) update({ ready: true });
    },
    capture: (): GoodsDescriptionToolTicket | null => available() ? { owner, epoch: snapshot.epoch } : null,
    canApply: (ticket: GoodsDescriptionToolTicket) => available() && ticket.owner === owner && ticket.epoch === snapshot.epoch,
  };
}
