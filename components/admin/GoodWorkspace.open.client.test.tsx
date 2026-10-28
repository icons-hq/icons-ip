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
import { GOOD_UNSAVED_BASE_COPY, GoodEditorSection, GoodOperationDisabledNotice, GoodOperationSection } from './GoodWorkspace';

type Details = ReactElement<{ open: boolean; onToggle: (event: { currentTarget: { open: boolean } }) => void }>;
const setOpen = vi.fn();
beforeEach(() => { setOpen.mockReset(); hooks.jobs = []; hooks.context = { open: {}, setOpen }; });

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
  const section = GoodEditorSection({ id: 'good-section-price', title: '판매가', children: null }) as Details;
  section.props.onToggle({ currentTarget: { open: true } });
  expect(setOpen).not.toHaveBeenCalled();
  section.props.onToggle({ currentTarget: { open: false } });
  expect(setOpen).toHaveBeenCalledWith('good-section-price', false);
  const operation = GoodOperationSection({ id: 'prices', title: '기간 할인', description: '기간 할인' }) as Details;
  expect(operation.props.open).toBe(false);
  operation.props.onToggle({ currentTarget: { open: true } });
  expect(setOpen).toHaveBeenLastCalledWith('good-operation-prices', true);
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
