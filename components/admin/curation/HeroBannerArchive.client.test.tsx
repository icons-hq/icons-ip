import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { AdminCurationActionState } from '@/lib/admin/curations';
import type { ArchivedHeroPage } from '@/lib/admin/curation-archive';

const hooks = vi.hoisted(() => ({
  active: '',
  stores: {} as Record<string, {
    state: unknown[]; refs: { current: unknown }[]; stateIndex: number; refIndex: number; pending: number;
  }>,
}));
const mocks = vi.hoisted(() => ({ save: vi.fn(), read: vi.fn(), refresh: vi.fn(), deleted: vi.fn(), restored: vi.fn() }));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => {
    const store = hooks.stores[hooks.active]; const index = store.stateIndex++;
    if (!(index in store.state)) store.state[index] = initial;
    return [store.state[index], (next: unknown) => {
      store.state[index] = typeof next === 'function' ? next(store.state[index]) : next;
    }];
  },
  useRef: (initial: unknown) => {
    const store = hooks.stores[hooks.active]; const index = store.refIndex++;
    store.refs[index] ??= { current: initial }; return store.refs[index];
  },
  useTransition: () => {
    const store = hooks.stores[hooks.active];
    return [store.pending > 0, (work: () => Promise<void>) => {
      store.pending++;
      void work().finally(() => { store.pending--; });
    }];
  },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('@/app/admin/curation-archive-actions', () => ({ setHeroBannerArchivedAction: mocks.save, readArchivedHeroBannersAction: mocks.read }));
vi.mock('./CurationProductPicker', () => ({ CurationEditorDialog: () => null }));
import { ArchivedHeroBanners, HeroBannerDeleteButton } from './HeroBannerArchive';

type Element = ReactElement<{
  children?: ReactNode; title?: string; disabled?: boolean; closeDisabled?: boolean;
  archive?: boolean; onClick?: () => void; onClose?: () => void;
}>;
const target = {
  id: 'bf212903-7454-4e08-8249-0cc4438eb1d5', title: '합성 삭제 배너', imageUrl: null,
  updatedAt: '2026-10-14T00:00:00.123456Z', archivedAt: '2026-10-13T00:00:00Z',
};
const page: ArchivedHeroPage = { rows: [target], total: 1, page: 1 };
function all(node: ReactNode): Element[] {
  return Array.isArray(node) ? node.flatMap(all) : isValidElement(node)
    ? [node as Element, ...all((node.props as { children?: ReactNode }).children)] : [];
}
function text(node: ReactNode): string {
  return Array.isArray(node) ? node.map(text).join('') : isValidElement(node)
    ? text((node.props as { children?: ReactNode }).children) : typeof node === 'string' ? node : '';
}
function render(key: string, component: () => ReactNode) {
  const store = hooks.stores[key] ??= { state: [], refs: [], stateIndex: 0, refIndex: 0, pending: 0 };
  hooks.active = key; store.stateIndex = 0; store.refIndex = 0;
  return component();
}
function deletion() {
  return render('delete', () => HeroBannerDeleteButton({ target, dirty: false, disabled: false, onDeleted: mocks.deleted }));
}
function archiveList() { return render('list', () => ArchivedHeroBanners({ onRestored: mocks.restored })); }
function confirmation(parent: ReactNode) {
  const element = all(parent).find(node => typeof node.props.archive === 'boolean');
  if (!element || typeof element.type !== 'function') throw new Error('Expected actual archive confirmation component');
  const component = element.type as (props: Element['props']) => ReactNode;
  return render('confirmation', () => component(element.props));
}
function button(node: ReactNode, label: string) {
  const element = all(node).find(value => value.type === 'button' && text(value) === label);
  if (!element) throw new Error(`Missing button: ${label}`);
  return element;
}
function dialog(node: ReactNode, title: string) {
  const element = all(node).find(value => value.props.title === title);
  if (!element) throw new Error(`Missing dialog: ${title}`);
  return element;
}
async function settle() { for (let index = 0; index < 8; index++) await Promise.resolve(); }
beforeEach(() => { hooks.stores = {}; hooks.active = ''; vi.clearAllMocks(); mocks.read.mockResolvedValue({ page }); });

it.each([
  { errors: { form: '권한을 확인해주세요.' } },
  { errors: { form: '다른 변경이 먼저 반영됐습니다.' }, conflict: true },
])('응답 유실 뒤 $errors.form 거절은 고정 요청과 닫기 차단을 유지한다', async rejection => {
  mocks.save.mockResolvedValueOnce({ errors: { form: '응답 유실' }, uncertain: true })
    .mockResolvedValueOnce(rejection).mockResolvedValueOnce({ message: '저장 결과 확인됨' });
  button(deletion(), '배너 삭제').props.onClick?.();
  button(confirmation(deletion()), '배너 삭제').props.onClick?.(); await settle();
  const original = mocks.save.mock.calls[0][0] as FormData;
  const body = [...original.entries()];
  expect(original.get('expectedUpdatedAt')).toBe(target.updatedAt);
  expect(dialog(confirmation(deletion()), '배너를 삭제할까요?').props.closeDisabled).toBe(true);
  expect(button(confirmation(deletion()), '취소').props.disabled).toBe(true);

  button(confirmation(deletion()), '같은 요청 결과 확인').props.onClick?.(); await settle();
  const denied = confirmation(deletion());
  expect(dialog(denied, '배너를 삭제할까요?').props.closeDisabled).toBe(true);
  expect(button(denied, '취소').props.disabled).toBe(true);
  expect(text(denied)).not.toContain('닫고 최신 저장본 불러오기');
  expect(mocks.save.mock.calls[1][0]).toBe(original);
  expect([...(mocks.save.mock.calls[1][0] as FormData).entries()]).toEqual(body);
  expect(mocks.deleted).not.toHaveBeenCalled(); expect(mocks.refresh).not.toHaveBeenCalled();

  button(denied, '같은 요청 결과 확인').props.onClick?.(); await settle();
  expect(mocks.save.mock.calls[2][0]).toBe(original);
  expect(mocks.deleted).toHaveBeenCalledOnce(); expect(mocks.refresh).toHaveBeenCalledOnce();
  expect(all(deletion()).some(node => node.props.archive === true)).toBe(false);
});

it('렌더 전 연속 제출에도 한 번만 전송하고 처리 중 닫기를 차단한다', async () => {
  let finish!: (state: AdminCurationActionState) => void;
  mocks.save.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  button(deletion(), '배너 삭제').props.onClick?.();
  const submit = button(confirmation(deletion()), '배너 삭제');
  submit.props.onClick?.(); submit.props.onClick?.();
  expect(mocks.save).toHaveBeenCalledOnce();
  const pending = confirmation(deletion());
  expect(dialog(pending, '배너를 삭제할까요?').props.closeDisabled).toBe(true);
  expect(button(pending, '취소').props.disabled).toBe(true);
  expect(button(pending, '처리 중…').props.disabled).toBe(true);
  finish({ message: '완료' }); await settle(); expect(mocks.deleted).toHaveBeenCalledOnce();
});

it('복구 확인창이 열려 있으면 부모 닫기 콜백으로도 고정 요청을 버릴 수 없다', async () => {
  let finish!: (state: AdminCurationActionState) => void;
  mocks.save.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  button(archiveList(), '삭제한 배너').props.onClick?.(); await settle();
  button(archiveList(), '합성 삭제 배너 복구').props.onClick?.();
  const parent = archiveList();
  expect(dialog(parent, '삭제한 배너').props.closeDisabled).toBe(true);
  expect(button(parent, '닫기').props.disabled).toBe(true);
  // Direct invocation also models a stale parent callback, beyond disabled UI.
  dialog(parent, '삭제한 배너').props.onClose?.();
  expect(all(archiveList()).some(node => node.props.archive === false)).toBe(true);

  button(confirmation(archiveList()), '비노출로 복구').props.onClick?.();
  const original = mocks.save.mock.calls[0][0] as FormData;
  expect(original.get('archive')).toBe('false');
  dialog(archiveList(), '삭제한 배너').props.onClose?.();
  expect(dialog(confirmation(archiveList()), '배너를 복구할까요?').props.closeDisabled).toBe(true);
  finish({ errors: { form: '응답 유실' }, uncertain: true }); await settle();
  dialog(archiveList(), '삭제한 배너').props.onClose?.();
  expect(button(archiveList(), '닫기').props.disabled).toBe(true);
  expect(dialog(confirmation(archiveList()), '배너를 복구할까요?').props.closeDisabled).toBe(true);
  mocks.save.mockResolvedValueOnce({ message: '복구 결과 확인됨' });
  button(confirmation(archiveList()), '같은 요청 결과 확인').props.onClick?.(); await settle();
  expect(mocks.save.mock.calls[1][0]).toBe(original);
  expect(mocks.restored).toHaveBeenCalledOnce();
  expect(all(archiveList()).some(node => node.props.archive === false)).toBe(false);
  expect(dialog(archiveList(), '삭제한 배너').props.closeDisabled).toBe(false);
});
