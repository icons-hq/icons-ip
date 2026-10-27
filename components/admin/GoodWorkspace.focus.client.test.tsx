import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ refs: [] as { current: unknown }[], index: 0, jobs: [] as (() => void)[] }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useRef: (initial: unknown) => { const index = hooks.index++; return hooks.refs[index] ??= { current: initial }; },
  useEffect: (callback: () => void) => { hooks.jobs.push(callback); },
}));
import { useFocusFirstGoodError } from './GoodWorkspace';

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
