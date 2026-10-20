import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ states: [] as unknown[], memos: [] as { value: unknown; deps: unknown[] }[], effects: [] as { deps: unknown[]; effect: () => void | (() => void); cleanup?: () => void }[], changed: [] as number[], stateIndex: 0, memoIndex: 0, effectIndex: 0 }));
const mocks = vi.hoisted(() => ({ portal: vi.fn((child: unknown) => child), unsubscribe: vi.fn(), auth: null as null | ((event: string, session: { user: { id: string }; access_token: string } | null) => void) }));
vi.mock('react', async () => {
  const effect = (callback: () => void | (() => void), deps: unknown[] = []) => {
    const index = hooks.effectIndex++, previous = hooks.effects[index];
    if (!previous || deps.some((dep, i) => dep !== previous.deps[i])) { hooks.effects[index] = { deps, effect: callback, cleanup: previous?.cleanup }; hooks.changed.push(index); }
  };
  return { ...await vi.importActual<typeof import('react')>('react'),
    useState: (value: unknown) => { const i = hooks.stateIndex++; if (!(i in hooks.states)) hooks.states[i] = typeof value === 'function' ? value() : value; return [hooks.states[i], (next: unknown) => { hooks.states[i] = typeof next === 'function' ? next(hooks.states[i]) : next; }]; },
    useMemo: (fn: () => unknown, deps: unknown[]) => { const i = hooks.memoIndex++; if (!hooks.memos[i] || deps.some((dep, n) => dep !== hooks.memos[i].deps[n])) hooks.memos[i] = { value: fn(), deps }; return hooks.memos[i].value; },
    useSyncExternalStore: (_subscribe: unknown, read: () => unknown) => read(), useEffect: effect, useLayoutEffect: effect,
  };
});
vi.mock('react-dom', () => ({ createPortal: mocks.portal }));
vi.mock('./BodyTemplateTools', () => ({ BodyTemplateTools: () => null }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock('@/lib/supabase/config', () => ({ getSupabaseConfig: () => ({ isConfigured: true }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { onAuthStateChange: (callback: typeof mocks.auth) => { mocks.auth = callback; return { data: { subscription: { unsubscribe: mocks.unsubscribe } } }; } } }) }));
import { GoodsDescriptionTools } from './GoodsDescriptionTools';
import type { GoodsDescriptionTool } from '@/lib/admin/goods-description-tools';
import type { BodyTemplateEditorTarget } from '@/lib/admin/body-templates';

type Element = ReactElement<Record<string, unknown>>;
const all = (node: ReactNode): Element[] => Children.toArray(node).flatMap(value => isValidElement<Record<string, unknown>>(value) ? [value, ...all(value.props.children as ReactNode)] : []);
const text = (node: ReactNode): string => Children.toArray(node).map(value => isValidElement<Record<string, unknown>>(value) ? text(value.props.children as ReactNode) : String(value)).join('');
class FakeSelect { value = 'html'; }
class FakeArea extends EventTarget {
  value = '앞-교체-뒤'; selectionStart = 2; selectionEnd = 4; disabled = false; readOnly = false; isConnected = true;
  form: FakeForm | null = null; focus = vi.fn();
  setRangeText(fragment: string, start: number, end: number) { this.value = this.value.slice(0, start) + fragment + this.value.slice(end); }
}
class FakeForm extends EventTarget {
  area = new FakeArea(); format = new FakeSelect();
  elements = { namedItem: (name: string) => name === 'description' ? this.area : name === 'descriptionFormat' ? this.format : null };
  constructor() { super(); this.area.form = this; }
}
let props: Parameters<typeof GoodsDescriptionTools>[0], form: FakeForm;
function render() { hooks.stateIndex = 0; hooks.memoIndex = 0; hooks.effectIndex = 0; return GoodsDescriptionTools(props); }
function effects() { for (const index of hooks.changed.splice(0)) { const item = hooks.effects[index]; item.cleanup?.(); item.cleanup = item.effect() || undefined; } }
function button(label: string) { return all(render()).find(item => item.type === 'button' && text(item) === label)!; }
function click(label: string) { (button(label).props.onClick as () => void)(); }
function dialog() { return all(render()).find(item => typeof item.type === 'function' && typeof item.props.onApply === 'function' && typeof item.props.kind === 'string')!; }
function templateTarget() { return (all(render()).find(item => typeof item.props.captureEditor === 'function')!.props.captureEditor as () => BodyTemplateEditorTarget | null)(); }
function apply(item: Element, tool: GoodsDescriptionTool) { return (item.props.onApply as (tool: GoodsDescriptionTool) => string | null)(tool); }
function close(item: Element) { (item.props.onClose as () => void)(); }
function auth(actor = 'actor', session = '99000000-0000-4000-8000-000000000010') {
  mocks.auth?.('SIGNED_IN', { user: { id: actor }, access_token: `x.${Buffer.from(JSON.stringify({ session_id: session })).toString('base64url')}.x` });
}
beforeEach(() => {
  hooks.states = []; hooks.memos = []; hooks.effects = []; hooks.changed = []; vi.clearAllMocks();
  vi.stubGlobal('window', new EventTarget()); vi.stubGlobal('document', { body: {} });
  vi.stubGlobal('HTMLTextAreaElement', FakeArea); vi.stubGlobal('HTMLSelectElement', FakeSelect);
  form = new FakeForm(); props = { accountId: 'actor', formRef: { current: form as unknown as HTMLFormElement }, disabled: false };
  render(); effects(); auth();
});
afterEach(() => { for (const item of hooks.effects) item.cleanup?.(); vi.unstubAllGlobals(); });
it('선택 위치에 링크를 넣고 기존 input 감지로만 상품 입력을 갱신한다', () => {
  const input = vi.fn(), submit = vi.fn(); form.area.addEventListener('input', input); form.addEventListener('submit', submit);
  click('링크 넣기'); const current = dialog();
  expect(mocks.portal).toHaveBeenCalledWith(expect.anything(), document.body);
  expect(apply(current, { kind: 'link', text: '상품 안내', href: '/shop' })).toBeNull();
  expect(form.area.value).toBe('앞-<a href="/shop" rel="noopener noreferrer">상품 안내</a>-뒤');
  expect(input).toHaveBeenCalledTimes(1); expect(submit).not.toHaveBeenCalled();
});
it('새 글자 서식도 같은 계정·폼 삽입 경계에서만 적용한다', () => {
  form.area.selectionStart = form.area.selectionEnd = form.area.value.length;
  click('글자 서식'); const current = dialog();
  expect(current.props.kind).toBe('text'); expect(current.props.initialText).toBe('');
  expect(apply(current, { kind: 'text', text: '정렬한 글', alignment: 'right', size: '20', emphasis: ['em'] })).toBeNull();
  expect(form.area.value).toContain('<p data-icons-align="right" data-icons-size="20"><em>정렬한 글</em></p>');
  close(current); click('글자 서식'); const stale = dialog(); auth('other');
  expect(apply(stale, { kind: 'text', text: '늦음', alignment: 'left', size: '16', emphasis: [] })).toContain('바뀌었습니다');
  expect(form.area.value).not.toContain('늦음');
});
it('구분선 모양 선택은 폼 입력으로 전파하지 않고 넣기를 눌렀을 때만 본문을 바꾼다', () => {
  const before = form.area.value, stopPropagation = vi.fn();
  const select = all(render()).find(item => item.type === 'select')!;
  (select.props.onChange as (event: unknown) => void)({ target: { value: 'diamond' }, stopPropagation });
  expect(stopPropagation).toHaveBeenCalledOnce(); expect(form.area.value).toBe(before);
  click('구분선 넣기'); expect(form.area.value).toContain('<hr data-icons-divider="diamond">');
});
it('인용과 구분선은 삽입 경계를 따르고 허용하지 않는 링크와 한도 초과는 원문을 보존한다', () => {
  click('인용 넣기'); expect(apply(dialog(), { kind: 'quote', text: '줄1\n줄2' })).toBeNull();
  expect(form.area.value).toContain('<blockquote>줄1<br>줄2</blockquote>');
  form.area.value = '가'.repeat(30000); form.area.selectionStart = form.area.selectionEnd = 30000;
  click('구분선 넣기'); expect(form.area.value).toHaveLength(30000); expect(text(render())).toContain('30,000자');
  click('링크 넣기'); expect(apply(dialog(), { kind: 'link', text: '위험', href: 'javascript:alert(1)' })).toContain('주소');
  expect(form.area.value).toHaveLength(30000);
});
it.each(['reset', 'submit'])('폼 %s 뒤 늦은 적용은 새 입력에 들어가지 않는다', event => {
  click('링크 넣기'); const stale = dialog(); form.dispatchEvent(new Event(event));
  expect(apply(stale, { kind: 'link', text: '늦음', href: '/shop' })).toContain('바뀌었습니다'); expect(form.area.value).toBe('앞-교체-뒤');
});
it('저장 중 또는 형식 변경으로 숨긴 창은 활성 상태로 돌아와도 되살리지 않는다', () => {
  click('인용 넣기'); const stale = dialog(); props.disabled = true; render(); effects(); props.disabled = false; render(); effects();
  expect(dialog()).toBeUndefined(); expect(apply(stale, { kind: 'quote', text: '늦음' })).toContain('바뀌었습니다');
});
it('취소한 창의 callback과 close가 다음 창을 바꾸지 않는다', () => {
  click('링크 넣기'); const stale = dialog(); close(stale); click('인용 넣기'); const current = dialog();
  expect(apply(stale, { kind: 'link', text: '늦음', href: '/shop' })).toContain('바뀌었습니다'); close(stale);
  expect(dialog().props.kind).toBe('quote'); expect(apply(current, { kind: 'quote', text: '새 내용' })).toBeNull();
});
it.each(['source', 'element', 'form', 'plain', 'readonly'])('대상 %s 변경 후에는 이전 범위로 덮어쓰지 않는다', change => {
  click('링크 넣기'); const stale = dialog();
  if (change === 'source') form.area.value = '다른 입력';
  if (change === 'element') form.area = new FakeArea();
  if (change === 'form') props.formRef.current = new FakeForm() as unknown as HTMLFormElement;
  if (change === 'plain') form.format.value = 'plain';
  if (change === 'readonly') form.area.readOnly = true;
  const value = form.area.value;
  expect(apply(stale, { kind: 'link', text: '늦음', href: '/shop' })).toContain('바뀌었습니다'); expect(form.area.value).toBe(value);
});
it.each(['account', 'session', 'signout', 'unmount'])('%s 뒤의 늦은 적용을 거부한다', change => {
  click('인용 넣기'); const stale = dialog();
  if (change === 'account') auth('other');
  if (change === 'session') auth('actor', '99000000-0000-4000-8000-000000000011');
  if (change === 'signout') window.dispatchEvent(new Event('icons:inquiry-drafts:signed-out'));
  if (change === 'unmount') for (const item of hooks.effects) { item.cleanup?.(); item.cleanup = undefined; }
  expect(apply(stale, { kind: 'quote', text: '늦음' })).toContain('바뀌었습니다'); expect(form.area.value).toBe('앞-교체-뒤');
});
it('템플릿은 선택 위치에 넣고 전체 교체와 복구는 기존 이미지·입력 원문을 정확히 보존한다', () => {
  const input = vi.fn(); form.area.addEventListener('input', input);
  const original = '<p data-icons-align="center">기존 &amp; 안내</p><img src="https://example.com/own.png" alt="기존">';
  form.area.value = original; form.area.selectionStart = form.area.selectionEnd = original.length;
  const insert = templateTarget()!;
  expect(insert.bodyHtml).toBe(original);
  expect(insert.apply('<p>배송 안내</p>', 'insert')).toEqual({ ok: true, bodyHtml: original + '<p>배송 안내</p>' });
  const replace = templateTarget()!;
  expect(replace.apply('<p>새 본문</p>', 'replace')).toEqual({ ok: true, bodyHtml: '<p>새 본문</p>' });
  const restore = templateTarget()!;
  expect(restore.apply(original, 'replace')).toEqual({ ok: true, bodyHtml: original });
  expect(form.area.value).toBe(original); expect(input).toHaveBeenCalledTimes(3);
});
it('템플릿 전체 교체는 손상된 기존 HTML을 고칠 수 있지만 원문·정리 후 한도는 지킨다', () => {
  form.area.value = '<p title="닫히지 않은 속성';
  expect(templateTarget()!.apply('<p>복구한 본문</p>', 'replace').ok).toBe(true);
  const previous = form.area.value;
  expect(templateTarget()!.apply('가'.repeat(30001), 'replace').ok).toBe(false);
  expect(templateTarget()!.apply('<a href="/">가</a>'.repeat(1000), 'replace').ok).toBe(false);
  expect(form.area.value).toBe(previous);
});
it.each(['source', 'reset', 'submit', 'account', 'session', 'format'])('템플릿도 %s 변경 뒤의 늦은 적용을 막는다', change => {
  const target = templateTarget()!;
  if (change === 'source') form.area.value = '새로 입력한 원문';
  if (change === 'reset' || change === 'submit') form.dispatchEvent(new Event(change));
  if (change === 'account') auth('other');
  if (change === 'session') auth('actor', '99000000-0000-4000-8000-000000000011');
  if (change === 'format') form.format.value = 'plain';
  const before = form.area.value;
  expect(target.apply('<p>늦은 템플릿</p>', 'replace').ok).toBe(false);
  expect(form.area.value).toBe(before);
});
