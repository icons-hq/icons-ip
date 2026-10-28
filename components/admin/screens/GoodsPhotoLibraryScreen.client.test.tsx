import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ state: [] as unknown[], index: 0, refs: [] as { current: unknown }[], refIndex: 0 }));
const mocks = vi.hoisted(() => ({ find: vi.fn(), save: vi.fn(), upload: vi.fn() }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useEffect: () => {},
  useRef: (initial: unknown) => { const index = hooks.refIndex++; hooks.refs[index] ??= { current: initial }; return hooks.refs[index]; },
  useState: (initial: unknown) => { const index = hooks.index++; if (!(index in hooks.state)) hooks.state[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial; return [hooks.state[index], (next: unknown) => { hooks.state[index] = typeof next === 'function' ? (next as (value: unknown) => unknown)(hooks.state[index]) : next; }]; },
}));
vi.mock('@/app/admin/goods-photo-library-actions', () => ({ findGoodsPhotosAction: mocks.find, saveGoodsPhotoAction: mocks.save }));
vi.mock('@/lib/admin/artwork-upload.client', () => ({ uploadAdminArtwork: mocks.upload }));
vi.mock('./CustomerServiceDialog', () => ({ CustomerServiceDialog: ({ children }: { children: ReactNode }) => children }));

import { GoodsPhotoLibraryScreen } from './GoodsPhotoLibraryScreen';

type Element = ReactElement<{ children?: ReactNode; onClick?: () => void; onChange?: (event: unknown) => void; onKeyDown?: (event: unknown) => void; 'aria-label'?: string; value?: string; loading?: string; src?: string; alt?: string }>;
function all(node: ReactNode): Element[] { return Array.isArray(node) ? node.flatMap(all) : isValidElement(node) ? [node as Element, ...all((node.props as { children?: ReactNode }).children)] : []; }
function text(node: ReactNode): string { return Array.isArray(node) ? node.map(text).join('') : isValidElement(node) ? text((node.props as { children?: ReactNode }).children) : typeof node === 'string' || typeof node === 'number' ? String(node) : ''; }
function photo(id: string, name: string, references: { id: string; name: string; kind: string }[] = []) {
  return { id: `00000000-0000-4000-8000-0000000713${id}`, name, imagePath: `public-media/catalog/good/00000000-0000-4000-8000-0000000714${id}.webp`, revision: 1, archived: false, createdAt: '2026-10-28T00:00:00Z', references };
}
const older = photo('01', '노트 표지', [{ id: 't1', name: '운영자 테스트 메시지', kind: 'marketing_test' }, { id: 'x', name: '새 화면', kind: 'future_surface' }]);
const page = { rows: [older], total: 1, page: 1, pageSize: 20 as const };
function render(onSelect?: () => void) { hooks.index = 0; hooks.refIndex = 0; return GoodsPhotoLibraryScreen({ initial: page, onSelect }); }
function input(label: string) { const node = all(render()).find(item => item.type === 'input' && item.props['aria-label'] === label); if (!node) throw new Error(label); return node; }
async function settle() { for (let i = 0; i < 30; i++) await Promise.resolve(); }

beforeEach(() => { vi.clearAllMocks(); hooks.state = []; hooks.refs = []; });

it('보관함 상단에 용도와 편집기 업로드가 자동 등록되지 않는다는 안내를 보인다', () => {
  const tree = render();
  expect(text(tree)).toContain('여러 상품에 다시 쓸 사진을 모아 두는 곳입니다. 상품 편집기에서 직접 올린 사진은 여기에 자동으로 등록되지 않습니다.');
  /* 상품 편집기의 선택 팝업에는 보관함 용도 안내를 다시 보이지 않는다. */
  expect(text(render(() => {}))).not.toContain('여러 상품에 다시 쓸 사진을');
});

it('사용처에 참조 종류를 붙이고 모르는 종류는 기타 참조로 표시한다', () => {
  const tree = text(render());
  expect(tree).toContain('고객 안내 메시지 테스트 발송 · 운영자 테스트 메시지');
  expect(tree).toContain('기타 참조 · 새 화면');
});

it('목록 썸네일은 화면에 들어올 때 불러온다', () => {
  const image = all(render()).find(item => item.type === 'img');
  expect(image?.props.loading).toBe('lazy');
});

/* MD-0025: 검색어가 남은 채 업로드하면 새 사진이 검색 조건에 걸러져 '사라진' 것처럼 보였다. */
it('업로드 뒤 검색어를 비우고 전체 목록을 다시 읽어 새 사진을 맨 앞에 보인다', async () => {
  const first = photo('11', 'a.png');
  const second = photo('12', 'b.png');
  mocks.upload.mockResolvedValueOnce({ ok: true, imagePath: first.imagePath }).mockResolvedValueOnce({ ok: true, imagePath: second.imagePath });
  let saved = 0;
  mocks.save.mockImplementation(async (value: { id: string }) => { saved++; if (saved === 1) first.id = value.id; else second.id = value.id; return { id: value.id, revision: 1 }; });
  /* 다른 운영자가 같은 순간에 올린 사진이 더 최신이어도 내가 방금 올린 사진이 앞에 온다. */
  const someoneElse = photo('13', '다른 운영자 사진');
  mocks.find.mockImplementation(async () => ({ data: { rows: [someoneElse, second, first, older], total: 4, page: 1, pageSize: 20 } }));

  input('사진 이름 검색').props.onChange?.({ target: { value: '노트' } });
  expect(input('사진 이름 검색').props.value).toBe('노트');
  input('사진 업로드').props.onChange?.({ currentTarget: { files: [new File(['a'], 'a.png'), new File(['b'], 'b.png')], value: 'C:\\fakepath\\a.png' } });
  await settle();

  expect(mocks.find).toHaveBeenCalledWith('', false, 1);
  expect(input('사진 이름 검색').props.value).toBe('');
  const names = all(render()).filter(item => item.type === 'img').map(item => item.props.alt);
  expect(names.slice(0, 2).sort()).toEqual(['a.png', 'b.png']);
  expect(names).toContain('다른 운영자 사진');
  expect(text(render())).toContain('2장 저장');
});

it('직접 다시 조회하면 방금 올린 사진 고정을 풀고 검색 결과 순서를 그대로 보인다', async () => {
  const fresh = photo('21', 'c.png');
  mocks.upload.mockResolvedValueOnce({ ok: true, imagePath: fresh.imagePath });
  mocks.save.mockImplementation(async (value: { id: string }) => { fresh.id = value.id; return { id: value.id, revision: 1 }; });
  const latest = photo('22', '최신');
  mocks.find.mockResolvedValue({ data: { rows: [latest, fresh, older], total: 3, page: 1, pageSize: 20 } });
  input('사진 업로드').props.onChange?.({ currentTarget: { files: [new File(['c'], 'c.png')], value: '' } });
  await settle();
  expect(all(render()).filter(item => item.type === 'img')[0].props.alt).toBe('c.png');
  all(render()).find(item => item.type === 'button' && text(item) === '조회')?.props.onClick?.();
  await settle();
  expect(all(render()).filter(item => item.type === 'img')[0].props.alt).toBe('최신');
});
