import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';

/* 펼침 상태는 폼 키 밖 provider가 지킨다(10/27 회의 R14). 훅은 위에서 순서대로 흉내 낸다. */
const hooks = vi.hoisted(() => ({ context: null as null | { open: Record<string, boolean>; setOpen: (id: string, open: boolean) => void }, jobs: [] as (() => void)[] }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useContext: () => hooks.context,
  useEffect: (callback: () => void) => { hooks.jobs.push(callback); },
}));
vi.mock('@/components/ui/Icon', () => ({ Icon: () => null }));
import { GOOD_UNSAVED_BASE_COPY, GoodEditorSection, GoodOperationDisabledNotice, GoodOperationSection, GoodOptionalFields, GoodWorkspaceDetails } from './GoodWorkspace';

interface FakeDetails { open: boolean; dataset: Record<string, string | undefined> }
type Details = ReactElement<{ open: boolean; 'data-known-open': string; onToggle: (event: { currentTarget: FakeDetails }) => void }>;
const setOpen = vi.fn();
beforeEach(() => { setOpen.mockReset(); hooks.jobs = []; hooks.context = { open: {}, setOpen }; });

/** 함수 컴포넌트 한 겹(GoodOptionalFields → GoodWorkspaceDetails)을 풀어 실제 details 요소를 얻는다. */
function details(element: ReactElement): Details {
  return (typeof element.type === 'function' ? (element.type as (props: unknown) => ReactElement)(element.props) : element) as Details;
}

/*
 * 브라우저 details를 흉내 낸다. React는 open prop이 바뀐 커밋에서만 open·data-known-open을 함께 고치고,
 * 사용자가 summary를 누르면 open만 바뀐 뒤 toggle 이벤트가 온다.
 */
function mount(element: Details) {
  const dom: FakeDetails = { open: element.props.open, dataset: { knownOpen: element.props['data-known-open'] } };
  let current = element;
  const fire = () => current.props.onToggle({ currentTarget: dom });
  return {
    dom,
    /** React가 다시 그린다. prop이 바뀐 경우에만 DOM을 고치고 toggle 이벤트가 온다. */
    rerender(next: Details) {
      const changed = next.props.open !== current.props.open;
      current = next;
      if (changed) { dom.open = next.props.open; dom.dataset.knownOpen = next.props['data-known-open']; fire(); }
    },
    /** 사용자가 summary를 눌러 접거나 펼친다. */
    click() { dom.open = !dom.open; fire(); },
    mountToggle: fire,
  };
}

it('저장 시도로 폼이 다시 그려져도 사용자가 펼치거나 접은 섹션 상태를 따른다', () => {
  hooks.context = { open: { 'good-section-sale': true, 'good-section-limits': false }, setOpen };
  const sale = GoodEditorSection({ id: 'good-section-sale', title: '결제·판매 제한', defaultOpen: false, children: null }) as Details;
  const limits = GoodEditorSection({ id: 'good-section-limits', title: '구매 제한', children: null }) as Details;
  const untouched = GoodEditorSection({ id: 'good-section-claims', title: '반품·교환', defaultOpen: false, children: null }) as Details;
  expect([sale.props.open, limits.props.open, untouched.props.open]).toEqual([true, false, false]);
  // 오류가 있으면 접어 둔 섹션도 연다.
  expect((GoodEditorSection({ id: 'good-section-limits', title: '구매 제한', errorCount: 1, children: null }) as Details).props.open).toBe(true);
});

it('사용자가 바꾼 펼침만 기록하고, 마운트 때 그린 값과 같은 토글 알림은 기록하지 않는다', () => {
  const section = mount(GoodEditorSection({ id: 'good-section-price', title: '판매가', children: null }) as Details);
  section.mountToggle();
  expect(setOpen).not.toHaveBeenCalled();
  section.click();
  expect(setOpen).toHaveBeenCalledWith('good-section-price', false);
  const operation = mount(GoodOperationSection({ id: 'prices', title: '기간 할인', description: '기간 할인' }) as Details);
  expect(operation.dom.open).toBe(false);
  operation.click();
  expect(setOpen).toHaveBeenLastCalledWith('good-operation-prices', true);
});

/* 리뷰 T3a-4 — 오류로 강제로 열린 섹션을 접었다 다시 펼친 것도 기록해, 오류를 고친 다음 저장 시도에도 펼친 채로 둔다. */
it('오류로 강제로 열린 섹션을 접었다 다시 펼치면 펼침을 기록한다', () => {
  const store: Record<string, boolean> = {};
  hooks.context = { open: store, setOpen: (id, value) => { store[id] = value; } };
  const render = (errorCount: number) => GoodEditorSection({ id: 'good-section-price', title: '판매가', errorCount, children: null }) as Details;
  const section = mount(render(1));
  section.mountToggle();
  expect(store).toEqual({});
  section.click(); // 사용자가 접음
  expect(store['good-section-price']).toBe(false);
  section.rerender(render(1)); // 오류가 남아 여전히 강제로 열린 값으로 그린다(DOM은 그대로 접힘)
  expect(section.dom.open).toBe(false);
  section.click(); // 사용자가 다시 펼침
  expect(store['good-section-price']).toBe(true);
  // 오류를 고쳐 다시 저장 → 폼이 다시 마운트되고 오류가 없다.
  expect(render(0).props.open).toBe(true);
});

it('오류가 생기거나 사라져 React가 바꾼 펼침은 사용자 선택으로 기록하지 않는다', () => {
  const store: Record<string, boolean> = { 'good-section-sale': false };
  hooks.context = { open: store, setOpen: (id, value) => { store[id] = value; } };
  const render = (errorCount: number) => GoodEditorSection({ id: 'good-section-sale', title: '결제·판매 제한', defaultOpen: false, errorCount, children: null }) as Details;
  const section = mount(render(0));
  section.rerender(render(1));
  expect(section.dom.open).toBe(true);
  section.rerender(render(0));
  expect(section.dom.open).toBe(false);
  expect(store).toEqual({ 'good-section-sale': false });
});

/* 리뷰 T3a-2 — 상세설명 편집·긴 상세 이미지·검색설정, 옵션 상세 정보, 미리보기 같은 편집기 안 접이식 영역도 저장 시도 뒤 펼침을 지킨다. */
it('편집기 안 선택 입력 영역도 키 밖 펼침 상태를 따르고 사용자가 바꾼 것을 기록한다', () => {
  hooks.context = { open: { 'good-optional-description': true }, setOpen };
  const description = details(GoodOptionalFields({ id: 'good-optional-description', title: '상세설명 편집', summary: 'HTML', children: null }));
  expect(description.props.open).toBe(true);
  const search = mount(details(GoodOptionalFields({ id: 'good-optional-search', title: '검색설정·판매자상품코드', summary: '', children: null })));
  expect(search.dom.open).toBe(false);
  search.click();
  expect(setOpen).toHaveBeenLastCalledWith('good-optional-search', true);
  expect(details(GoodOptionalFields({ id: 'good-optional-search', title: '검색설정', summary: '', hasErrors: true, children: null })).props.open).toBe(true);

  hooks.context = { open: { 'good-preview': true }, setOpen };
  const preview = GoodWorkspaceDetails({ stateId: 'good-preview', id: 'good-preview', className: 'admin-good-preview', children: null }) as Details;
  expect(preview.props.open).toBe(true);
  expect(renderToStaticMarkup(preview)).toMatch(/^<details id="good-preview" class="admin-good-preview" open="" data-known-open="true">/);
});

it('등록 화면에서 펼쳐 둔 KC·예약판매는 저장 뒤 같은 자리 패널도 펼친 채로 기억한다', () => {
  GoodOperationSection({ id: 'kc', title: 'KC', description: 'KC', mode: 'inline', defaultOpen: true });
  GoodOperationSection({ id: 'prices', title: '기간 할인', description: '기간 할인', mode: 'placeholder' });
  for (const job of hooks.jobs.splice(0)) job();
  expect(setOpen.mock.calls).toEqual([['good-operation-kc', true]]);
});

it('기본 입력 미저장으로 잠긴 패널은 맨 위에 이유와 저장 바로가기를 보인다', () => {
  const unsaved = renderToStaticMarkup(<GoodOperationDisabledNotice reason="무시되는 문구" unsaved />);
  expect(unsaved).toContain(GOOD_UNSAVED_BASE_COPY);
  expect(unsaved).toContain('저장 위치로 이동');
  const busy = renderToStaticMarkup(<GoodOperationDisabledNotice reason="기본 상품을 저장하는 중입니다." />);
  expect(busy).toContain('기본 상품을 저장하는 중입니다.');
  expect(busy).not.toContain('저장 위치로 이동');
  expect(renderToStaticMarkup(<GoodOperationDisabledNotice reason="" />)).toBe('');
});
