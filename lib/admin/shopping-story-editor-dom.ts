import { sanitizeShoppingStoryContent } from '@/lib/shopping-stories-content';
import { publicMediaUrl } from '@/lib/media';
import { SHOPPING_STORY_BODY_MAX, storyCharacterLength } from '@/lib/shopping-stories';

type EditorSelection = { start: number; end: number } | { childOffset: number };
type Result = { ok: true; html: string; warnings: string[]; selection?: EditorSelection } | { ok: false; error: string };
const BLOCKS = 'p,h2,h3,h4,li,blockquote,caption,th,td,figcaption';

/** Expand only canonical upload paths for the editing surface; keep paths at rest. */
export function renderStoryEditorHtml(html: string) {
  const template = document.createElement('template'); template.innerHTML = sanitizeShoppingStoryContent(html).html;
  template.content.querySelectorAll('img').forEach(image => { const path = image.getAttribute('src') ?? ''; image.dataset.storyImage = path; image.src = publicMediaUrl(path) ?? ''; });
  return template.innerHTML;
}
function serialized(node: ParentNode) {
  const container = document.createElement('div'); container.append(...Array.from(node.childNodes).map(child => child.cloneNode(true)));
  container.querySelectorAll('img').forEach(image => { image.setAttribute('src', image.dataset.storyImage ?? image.getAttribute('src') ?? ''); image.removeAttribute('data-story-image'); });
  return container.innerHTML;
}
export function storyEditorHtml(root: HTMLDivElement) { return sanitizeShoppingStoryContent(serialized(root)).html; }
export function storyEditorSelectedHtml(root: HTMLDivElement, range: Range) {
  return root.contains(range.startContainer) && root.contains(range.endContainer) ? sanitizeShoppingStoryContent(serialized(range.cloneContents())).html : '';
}
export function storyEditorRange(root: HTMLDivElement, previous?: Range | null) {
  const selection = window.getSelection(), current = selection?.rangeCount ? selection.getRangeAt(0) : null;
  for (const candidate of [current, previous]) if (candidate && root.contains(candidate.startContainer) && root.contains(candidate.endContainer)) return candidate.cloneRange();
  const range = document.createRange(); range.selectNodeContents(root); range.collapse(false); return range;
}
function finish(html: string, selection?: EditorSelection): Result {
  if (storyCharacterLength(html) > SHOPPING_STORY_BODY_MAX) return { ok: false, error: '본문은 30,000자까지입니다. 기존 본문은 유지됩니다.' };
  const clean = sanitizeShoppingStoryContent(html);
  if (storyCharacterLength(clean.html) > SHOPPING_STORY_BODY_MAX) return { ok: false, error: '정리한 본문이 30,000자를 넘습니다. 기존 본문은 유지됩니다.' };
  return { ok: true, html: clean.html, warnings: clean.warnings, selection };
}
export function storyEditorReplacement(html: string) { return finish(html); }
function liftedBoundary(root: Node, initial: Node, initialOffset: number): [Node, number] {
  let node = initial, offset = initialOffset;
  while (node !== root && node.parentNode) {
    const length = node.nodeType === Node.TEXT_NODE ? node.textContent?.length ?? 0 : node.childNodes.length;
    if (offset !== 0 && offset !== length) break;
    const index = Array.from(node.parentNode.childNodes).indexOf(node as ChildNode);
    offset = index + (offset === length && length > 0 ? 1 : 0); node = node.parentNode;
  }
  return [node, offset];
}
export function planStoryEditorInsertion(root: HTMLDivElement, range: Range, html: string): Result {
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return { ok: false, error: '본문 선택 위치가 바뀌었습니다. 다시 선택해주세요.' };
  const clean = sanitizeShoppingStoryContent(html), prefix = document.createRange(), suffix = document.createRange();
  prefix.selectNodeContents(root); prefix.setEnd(...liftedBoundary(root, range.startContainer, range.startOffset));
  suffix.selectNodeContents(root); suffix.setStart(...liftedBoundary(root, range.endContainer, range.endOffset));
  // Root-level prefix/fragment/suffix avoids nesting a paragraph, quote or table
  // inside another paragraph while preserving every unselected node and image.
  const before = prefix.cloneContents(), after = suffix.cloneContents();
  const inserted = document.createElement('template'); inserted.innerHTML = clean.html;
  const result = finish(serialized(before) + clean.html + serialized(after), { childOffset: before.childNodes.length + inserted.content.childNodes.length });
  return result.ok ? { ...result, warnings: [...new Set([...clean.warnings, ...result.warnings])] } : result;
}
function nodePath(root: Node, target: Node) {
  const path: number[] = []; let node: Node | null = target;
  while (node && node !== root) { const parent: Node | null = node.parentNode; if (!parent) return null; path.unshift(Array.from(parent.childNodes).indexOf(node as ChildNode)); node = parent; }
  return node === root ? path : null;
}
function follow(root: Node, path: number[]) { return path.reduce((node, index) => node.childNodes[index], root); }
function cloneSelection(root: HTMLDivElement, range: Range) {
  const start = nodePath(root, range.startContainer), end = nodePath(root, range.endContainer); if (!start || !end) return null;
  const copy = root.cloneNode(true) as HTMLDivElement, selected = document.createRange();
  selected.setStart(follow(copy, start), range.startOffset); selected.setEnd(follow(copy, end), range.endOffset);
  return { copy, selected };
}
function textOffsets(root: Node, range: Range) {
  const prefix = document.createRange(); prefix.selectNodeContents(root); prefix.setEnd(range.startContainer, range.startOffset);
  const start = prefix.toString().length; prefix.setEnd(range.endContainer, range.endOffset); return { start, end: prefix.toString().length };
}
function hasSelectedContent(range: Range, block: Element) {
  if (!range.intersectsNode(block)) return false;
  const contents = document.createRange(); contents.selectNodeContents(block);
  const intersection = range.cloneRange();
  if (intersection.compareBoundaryPoints(Range.START_TO_START, contents) < 0) intersection.setStart(contents.startContainer, contents.startOffset);
  if (intersection.compareBoundaryPoints(Range.END_TO_END, contents) > 0) intersection.setEnd(contents.endContainer, contents.endOffset);
  // intersectsNode includes an end boundary at the next paragraph's first text
  // offset 0. That empty intersection must not format the unselected paragraph.
  return intersection.toString().length > 0 || Boolean(intersection.cloneContents().querySelector('img,br,hr'));
}
export function planStoryEditorFormat(root: HTMLDivElement, range: Range, format: { attribute: 'data-icons-align' | 'data-icons-size'; value: string } | { tag: 'p' | 'h2' } | { emphasis: 'strong' | 'em' | 'u' | 's' }): Result {
  const cloned = cloneSelection(root, range); if (!cloned) return { ok: false, error: '본문 선택 위치를 다시 확인해주세요.' };
  const { copy, selected } = cloned, selection = textOffsets(root, range);
  if ('emphasis' in format) {
    if (selected.collapsed) return { ok: false, error: '강조할 글을 먼저 선택해주세요.' };
    const walker = document.createTreeWalker(copy, NodeFilter.SHOW_TEXT), targets: { node: Text; start: number; end: number }[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const text = node as Text;
      if (!selected.intersectsNode(text)) continue;
      const start = text === selected.startContainer ? selected.startOffset : 0, end = text === selected.endContainer ? selected.endOffset : text.length;
      if (end > start && selected.comparePoint(text, end) !== -1 && selected.comparePoint(text, start) !== 1) targets.push({ node: text, start, end });
    }
    for (const item of targets.reverse()) {
      if (item.end < item.node.length) item.node.splitText(item.end);
      const content = item.start ? item.node.splitText(item.start) : item.node, wrapper = document.createElement(format.emphasis);
      content.replaceWith(wrapper); wrapper.append(content);
    }
  } else {
    let anchor = selected.startContainer.nodeType === Node.ELEMENT_NODE ? selected.startContainer as Element : selected.startContainer.parentElement;
    if (anchor === copy && selected.collapsed) {
      for (let index = Math.min(selected.startOffset, copy.childNodes.length) - 1; index >= 0; index--) {
        const candidate = copy.childNodes[index];
        if (candidate.nodeType === Node.ELEMENT_NODE && (candidate as Element).matches(BLOCKS)) { anchor = candidate as Element; break; }
      }
    }
    const candidates = selected.collapsed ? [anchor?.closest(BLOCKS)].filter((node): node is Element => Boolean(node && copy.contains(node)))
      : Array.from(copy.querySelectorAll(BLOCKS)).filter(node => hasSelectedContent(selected, node));
    if (!candidates.length) {
      if (!copy.textContent?.trim()) return { ok: false, error: '서식을 적용할 본문을 먼저 입력해주세요.' };
      let paragraph: HTMLParagraphElement | null = null;
      for (const node of Array.from(copy.childNodes)) {
        if (node.nodeType === Node.ELEMENT_NODE && (node as Element).matches('p,h2,h3,h4,ul,ol,blockquote,table,figure,hr')) { paragraph = null; continue; }
        if (!paragraph) { paragraph = document.createElement('p'); copy.insertBefore(paragraph, node); candidates.push(paragraph); }
        paragraph.append(node);
      }
      if (!candidates.length) return { ok: false, error: '서식을 적용할 문단을 클릭하거나 글을 선택해주세요.' };
    }
    for (const block of candidates) {
      if ('attribute' in format) block.setAttribute(format.attribute, format.value);
      else if (['P', 'H2', 'H3', 'H4'].includes(block.tagName)) { const replacement = document.createElement(format.tag); for (const attr of Array.from(block.attributes)) replacement.setAttribute(attr.name, attr.value); replacement.append(...Array.from(block.childNodes)); block.replaceWith(replacement); }
    }
  }
  return finish(serialized(copy), selection);
}
export function restoreStoryEditorSelection(root: HTMLDivElement, offsets: EditorSelection) {
  if ('childOffset' in offsets) {
    const range = document.createRange(); range.setStart(root, Math.min(offsets.childOffset, root.childNodes.length)); range.collapse(true);
    const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range); return range;
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), nodes: Text[] = []; let node: Node | null;
  while ((node = walker.nextNode())) nodes.push(node as Text);
  const point = (offset: number): [Node, number] => { for (const text of nodes) { if (offset <= text.length) return [text, offset]; offset -= text.length; } return [root, root.childNodes.length]; };
  const range = document.createRange(); range.setStart(...point(offsets.start)); range.setEnd(...point(offsets.end));
  const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range); return range;
}
