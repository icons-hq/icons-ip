import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ refs: [] as { current: unknown }[], index: 0, jobs: [] as (() => void)[] }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useRef: (initial: unknown) => { const index = hooks.index++; return hooks.refs[index] ??= { current: initial }; },
  useEffect: (callback: () => void) => { hooks.jobs.push(callback); },
}));
import { GoodWorkspaceNavigation, useFocusFirstGoodError } from './GoodWorkspace';

/** 훅을 쓰는 가짜 컴포넌트를 한 번 그리고 effect를 실행한다(React 훅은 위에서 순서대로 흉내 낸다). */
function Probe({ attempt, errors }: { attempt: number | undefined; errors?: Record<string, string | undefined> }) {
  useFocusFirstGoodError(attempt, errors);
  return null;
}
function render(attempt: number | undefined, errors?: Record<string, string | undefined>) {
  hooks.index = 0; Probe({ attempt, errors }); for (const job of hooks.jobs.splice(0)) job();
}
function input(name: string) {
  return { getAttribute: (key: string) => key === 'name' ? name : null, hasAttribute: () => false, closest: () => null, parentElement: null,
    scrollIntoView: vi.fn(), focus: vi.fn() };
}
const inputs = { name: input('name'), price: input('price') };
const summary = { focus: vi.fn() };
const sections: string[] = [];
beforeEach(() => {
  hooks.refs = []; hooks.jobs = []; sections.length = 0; vi.clearAllMocks();
  vi.stubGlobal('HTMLDetailsElement', class {});
  vi.stubGlobal('document', {
    getElementById: (id: string) => { sections.push(id); return { closest: () => ({ querySelectorAll: () => Object.values(inputs) }), querySelector: () => null }; },
    querySelector: (selector: string) => selector === '.admin-good-workspace__errors' ? summary : null,
  });
});
afterEach(() => vi.unstubAllGlobals());

it('서버 검증 실패마다 한 번 섹션 순서상 첫 오류 필드로 스크롤·포커스한다', () => {
  render(undefined, {});
  expect(sections).toEqual([]);
  render(1, { price: '판매가를 입력해주세요.', name: '상품명을 입력해주세요.' });
  expect(sections).toEqual(['good-section-basic']);
  expect(inputs.name.scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'instant' });
  expect(inputs.name.focus).toHaveBeenCalledWith({ preventScroll: true });
  expect(inputs.price.focus).not.toHaveBeenCalled();
  // 같은 시도로 다시 그려져도 사용자가 옮긴 포커스를 빼앗지 않는다.
  render(1, { price: '판매가를 입력해주세요.', name: '상품명을 입력해주세요.' });
  expect(inputs.name.focus).toHaveBeenCalledTimes(1);
});

it('섹션에 속하지 않는 오류만 있으면 상단 오류 요약으로 간다', () => {
  render(2, { form: '저장하지 못했습니다.' });
  expect(sections).toEqual([]);
  expect(summary.focus).toHaveBeenCalledOnce();
  render(3, {});
  expect(summary.focus).toHaveBeenCalledOnce();
});

it('등록 화면 KC·예약판매 섹션 오류는 기본 입력 오류 뒤에 두고, 그것만 있으면 같은 자리의 운영 섹션으로 간다(R13)', () => {
  const card = { closest: () => null, querySelector: () => null, parentElement: null, scrollIntoView: vi.fn(), focus: vi.fn() };
  vi.stubGlobal('document', { getElementById: (id: string) => { sections.push(id); return card; }, querySelector: () => null });
  render(4, { workspacePreorders: '예약 오류', workspaceKc: 'KC 오류' });
  expect(sections).toEqual(['good-operation-kc']);
  expect(card.scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'instant' });
  expect(card.focus).toHaveBeenCalledWith({ preventScroll: true });
});

/* 10/27 회의 R15 — 목록의 상품번호가 공개 전 상품이면 편집기 미리보기(#good-preview)로 온다. 접힌 채로 두지 않고 연다. */
it('주소 해시가 #good-preview이면 접힌 공개 화면 미리보기를 열고 그 자리로 이동한다', () => {
  class Details { open = false; parentElement = null; scrollIntoView = vi.fn(); focus = vi.fn(); querySelector = () => null; closest = () => null; }
  vi.stubGlobal('HTMLDetailsElement', Details);
  const preview = new Details();
  const listeners: Record<string, () => void> = {};
  const hash = { value: '#good-preview' };
  vi.stubGlobal('window', { location: { get hash() { return hash.value; } }, addEventListener: (type: string, listener: () => void) => { listeners[type] = listener; }, removeEventListener: vi.fn() });
  vi.stubGlobal('document', { getElementById: (id: string) => { sections.push(id); return id === 'good-preview' ? preview : null; }, querySelector: () => null });
  hooks.index = 0; GoodWorkspaceNavigation(); for (const job of hooks.jobs.splice(0)) job();
  expect(sections).toEqual(['good-preview']);
  expect(preview.open).toBe(true);
  expect(preview.scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'instant' });
  expect(preview.focus).toHaveBeenCalledWith({ preventScroll: true });
  /* 같은 화면에서 해시만 바뀌어도 연다. 편집기와 관계없는 해시는 건드리지 않는다. */
  preview.open = false; hash.value = '#good-preview'; listeners.hashchange();
  expect(preview.open).toBe(true);
  hash.value = '#somewhere-else'; listeners.hashchange();
  expect(sections).toEqual(['good-preview', 'good-preview']);
});
