import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ state: [] as unknown[], index: 0, refs: [] as { current: unknown }[], refIndex: 0 }));
const mocks = vi.hoisted(() => ({ find: vi.fn(), finish: vi.fn(), save: vi.fn(), upload: vi.fn() }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useEffect: () => {},
  useRef: (initial: unknown) => { const index = hooks.refIndex++; hooks.refs[index] ??= { current: initial }; return hooks.refs[index]; },
  useState: (initial: unknown) => { const index = hooks.index++; if (!(index in hooks.state)) hooks.state[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial; return [hooks.state[index], (next: unknown) => { hooks.state[index] = typeof next === 'function' ? (next as (value: unknown) => unknown)(hooks.state[index]) : next; }]; },
}));
vi.mock('@/app/admin/goods-photo-library-actions', () => ({ findGoodsPhotosAction: mocks.find, finishGoodsPhotoUploadsAction: mocks.finish, saveGoodsPhotoAction: mocks.save }));
vi.mock('@/lib/admin/artwork-upload.client', () => ({ uploadAdminArtwork: mocks.upload }));
vi.mock('./CustomerServiceDialog', () => ({ CustomerServiceDialog: ({ children }: { children: ReactNode }) => children }));

import { GOODS_PHOTO_UPLOAD_GUIDE, GoodsPhotoLibraryScreen, GoodsPhotoPicker } from './GoodsPhotoLibraryScreen';
import { AdminPickerDialog, type AdminPickerPanelProps } from '../console/AdminPickerDialog';
import { AdminSelect } from '../console/AdminSelect';
import { ConsolePagination } from '../console/ConsolePagination';
import { Button } from '../kit/ui/button';
import { Input } from '../kit/ui/input';
import type { GoodsPhoto, GoodsPhotoPage } from '@/lib/admin/goods-photo-library';

type Element = ReactElement<{ children?: ReactNode; onClick?: () => void; onChange?: (event: unknown) => void; onKeyDown?: (event: unknown) => void; onPageChange?: (page: number) => void; 'aria-label'?: string; value?: string; loading?: string; src?: string; alt?: string; title?: string; disabled?: boolean }>;
/* 화면 머리(AdminPageHeader)의 설명·동작 자리도 이 화면이 그리는 요소다. */
type Slots = { description?: ReactNode; actions?: ReactNode; children?: ReactNode };
function all(node: ReactNode): Element[] { return Array.isArray(node) ? node.flatMap(all) : isValidElement(node) ? [node as Element, ...all((node.props as Slots).description), ...all((node.props as Slots).actions), ...all((node.props as Slots).children)] : []; }
function text(node: ReactNode): string { return Array.isArray(node) ? node.map(text).join('') : isValidElement(node) ? [(node.props as Slots).description, (node.props as Slots).actions, (node.props as Slots).children].map(text).join('') : typeof node === 'string' || typeof node === 'number' ? String(node) : ''; }
function photo(id: string, name: string, references: { id: string; name: string; kind: string }[] = []): GoodsPhoto {
  return { id: `00000000-0000-4000-8000-0000000713${id}`, name, imagePath: `public-media/catalog/good/00000000-0000-4000-8000-0000000714${id}.webp`, revision: 1, archived: false, createdAt: '2026-10-28T00:00:00Z', references };
}
const older = photo('01', '노트 표지', [{ id: 't1', name: '운영자 테스트 메시지', kind: 'marketing_test' }, { id: 'x', name: '새 화면', kind: 'future_surface' }]);
const page: GoodsPhotoPage = { rows: [older], total: 1, page: 1, pageSize: 20 };
let initial = page;
function render() { hooks.index = 0; hooks.refIndex = 0; return GoodsPhotoLibraryScreen({ initial }); }
function input(label: string) { const node = all(render()).find(item => (item.type === 'input' || item.type === Input) && item.props['aria-label'] === label); if (!node) throw new Error(label); return node; }
function buttons(label: string) { return all(render()).filter(item => (item.type === 'button' || item.type === Button) && text(item) === label); }
function click(label: string) { const [found] = buttons(label); if (!found) throw new Error(label); found.props.onClick?.(); }
function pagination() { return all(render()).find(item => item.type === ConsolePagination)!; }
function archiveFilter() { return all(render()).find(item => item.type === AdminSelect)!; }
async function settle() { for (let i = 0; i < 30; i++) await Promise.resolve(); }

beforeEach(() => { vi.clearAllMocks(); hooks.state = []; hooks.refs = []; initial = page; });

it('보관함 상단에 용도와 상품 이미지 칸에 올린 사진도 들어온다는 안내를 운영자 말로 보인다', () => {
  const tree = render();
  expect(text(tree)).toContain('여러 상품에 다시 쓸 사진을 모아 두는 곳입니다. 상품 등록 화면의 상품 이미지 칸에 올린 사진도 여기에 들어옵니다.');
  /* '타일'·'편집기'는 운영자가 쓰는 말이 아니다. */
  expect(text(tree)).not.toMatch(/타일|편집기/);
  expect(text(tree)).not.toContain('자동으로 등록되지 않습니다');
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

/*
 * 리뷰 재현(T3B-RV-7): height={180} 속성이 CSS의 aspect-ratio:1보다 먼저 높이를 정해, 칸이 180px보다 넓은
 * 데스크톱 그리드에서 정사각 썸네일이 213x180 직사각형이 됐다. 크기는 CSS(width:100%·aspect-ratio:1)만 정한다.
 */
it('목록 썸네일에 높이 속성을 두지 않아 CSS의 정사각 비율을 따른다', () => {
  const image = all(render()).find(item => item.type === 'img') as ReactElement<Record<string, unknown>> | undefined;
  expect(image).toBeDefined();
  expect(image?.props).not.toHaveProperty('height');
  expect(image?.props).not.toHaveProperty('width');
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
  expect(text(render())).toContain('2장을 올렸습니다.');
  /* R19: 사진마다 서버 화면 전체를 다시 그리지 않고 마지막에 한 번만 갱신한다. */
  expect(mocks.save.mock.calls.map(([, options]) => options)).toEqual([{ revalidate: false }, { revalidate: false }]);
  expect(mocks.finish).toHaveBeenCalledOnce();
  expect(mocks.finish.mock.invocationCallOrder[0]).toBeGreaterThan(Math.max(...mocks.save.mock.invocationCallOrder));
});

/* R20: macOS는 한글 파일 이름을 NFD로 넘겨 NFC 검색어에 걸리지 않았다. */
it('파일 이름을 NFC로 바꿔 저장하고, 저장한 사진이 없으면 화면 갱신을 부르지 않는다', async () => {
  const nfd = '메이플 키링.png'.normalize('NFD');
  mocks.upload.mockResolvedValueOnce({ ok: true, imagePath: photo('31', 'x').imagePath }).mockResolvedValueOnce({ ok: false, error: '1분에 올릴 수 있는 사진 수를 넘었습니다. 잠시 뒤 다시 시도해주세요.' });
  mocks.save.mockImplementation(async (value: { id: string }) => ({ id: value.id, revision: 1 }));
  mocks.find.mockResolvedValue({ data: page });
  input('사진 업로드').props.onChange?.({ currentTarget: { files: [new File(['a'], nfd), new File(['b'], 'b.png')], value: '' } });
  await settle();
  expect(mocks.save).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ name: '메이플 키링.png'.normalize('NFC') }), { revalidate: false });
  expect(text(render())).toContain('b.png: 1분에 올릴 수 있는 사진 수를 넘었습니다.');
  /* 올린 장수는 실제로 저장한 사진만 센다. */
  expect(text(render())).toContain('1장을 올렸습니다.');

  vi.clearAllMocks(); hooks.state = []; hooks.refs = [];
  mocks.upload.mockResolvedValue({ ok: false, error: '다른 사진을 올리는 중입니다. 끝난 뒤 다시 시도해주세요.' });
  mocks.find.mockResolvedValue({ data: page });
  input('사진 업로드').props.onChange?.({ currentTarget: { files: [new File(['c'], 'c.png')], value: '' } });
  await settle();
  expect(mocks.finish).not.toHaveBeenCalled();
  /* 한 장도 올리지 못했으면 "0장 저장" 같은 성공 문구를 내지 않고 파일마다 이유만 보인다. */
  expect(text(render())).not.toContain('장을 올렸습니다');
  expect(text(render())).not.toContain('0장 저장');
  expect(all(render()).find(item => (item.props as { role?: string }).role === 'status')?.props.children).toBe('');
  expect(text(render())).toContain('c.png: 다른 사진을 올리는 중입니다.');
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
  click('검색');
  await settle();
  expect(all(render()).filter(item => item.type === 'img')[0].props.alt).toBe('최신');
});

describe('화면 규칙 정리 (사진 보관함)', () => {
  /* 규칙 8: 저장 버전은 운영자가 할 일이 없는 내부 값이다. */
  it('사진 이름에 마우스를 올려도 이름만 보이고 내부 값은 나오지 않는다', () => {
    const name = all(render()).find(item => item.type === 'strong');
    expect(name?.props.title).toBe('노트 표지');
    expect(all(render()).map(item => item.props.title).filter(Boolean).join(' ')).not.toContain('버전');
    expect(text(render())).not.toContain('버전');
  });

  it('보관 조건의 이름은 템플릿 화면과 같은 보관 상태 · 사용 중 / 보관됨이다', () => {
    const filter = archiveFilter();
    expect(filter.props['aria-label']).toBe('보관 상태');
    expect(all(filter.props.children).map(option => text(option))).toEqual(['사용 중', '보관됨']);
    expect(text(render())).not.toContain('사용 가능한 사진');
  });

  /* 늘 깔려 있던 안내 세 문장을 걷고, 필요한 것만 제자리에 둔다. */
  it('업로드 규격은 [사진 업로드] 옆 한 줄이고 실제 한도(상품 이미지 20MB)를 말한다', () => {
    expect(GOODS_PHOTO_UPLOAD_GUIDE).toBe('한 번에 10장 · 장당 20MB 이하 JPEG·PNG·WebP');
    const tree = render();
    expect(text(tree)).toContain(GOODS_PHOTO_UPLOAD_GUIDE);
    expect(text(tree)).not.toContain('보관해도 파일은 유지됩니다');
    expect(text(tree)).not.toContain('연결을 해제해야');
    expect(text(tree)).not.toContain('5MB');
  });

  it('쓰는 중인 사진은 잠긴 [보관] 대신 이유를 글로 보이고, 쓰는 곳이 없는 사진만 [보관]이 있다', async () => {
    const unused = photo('41', '안 쓰는 사진');
    initial = { rows: [older, unused], total: 2, page: 1, pageSize: 20 };
    expect(text(render())).toContain('쓰는 중이라 보관할 수 없음');
    expect(buttons('보관')).toHaveLength(1);
    expect(buttons('이름 수정')).toHaveLength(2);
    mocks.save.mockResolvedValue({ id: unused.id, revision: 2 });
    mocks.find.mockResolvedValue({ data: page });
    click('보관');
    await settle();
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith({ ...unused, archived: true });
    /* 보관한 사진은 지금 목록에서 사라진다. 어디서 다시 보는지 알린다. */
    expect(text(render())).toContain("보관했습니다. 보관 상태에서 '보관됨'을 고르면 다시 볼 수 있습니다.");
  });

  it('보관한 사진은 보관됨으로 보이고 [복원]으로 되돌린다', async () => {
    const archived = { ...photo('51', '옛 사진'), archived: true };
    initial = { rows: [archived], total: 1, page: 1, pageSize: 20 };
    expect(text(render())).toContain('보관됨');
    expect(buttons('복구')).toHaveLength(0);
    mocks.save.mockResolvedValue({ id: archived.id, revision: 2 });
    mocks.find.mockResolvedValue({ data: { rows: [], total: 0, page: 1, pageSize: 20 } });
    click('복원');
    await settle();
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith({ ...archived, archived: false });
    expect(text(render())).toContain("복원했습니다. 보관 상태 '사용 중' 목록에서 볼 수 있습니다.");
  });

  /* 적다 만 검색어로 2쪽을 조회하면 다른 결과의 2쪽이 나왔다. 템플릿 화면처럼 적용한 검색어를 따로 둔다. */
  it('페이지 이동과 보관 상태 바꾸기는 칸에 적다 만 글자가 아니라 적용한 검색어로 조회한다', async () => {
    mocks.find.mockResolvedValue({ data: { rows: [older], total: 45, page: 1, pageSize: 20 } });
    /* 아직 [검색]을 누르지 않았다 — 페이지 이동은 처음 조건(검색어 없음) 그대로다. */
    input('사진 이름 검색').props.onChange?.({ target: { value: '노' } });
    pagination().props.onPageChange?.(2);
    await settle();
    expect(mocks.find).toHaveBeenLastCalledWith('', false, 2);

    input('사진 이름 검색').props.onChange?.({ target: { value: '노트' } });
    click('검색');
    await settle();
    expect(mocks.find).toHaveBeenLastCalledWith('노트', false, 1);

    input('사진 이름 검색').props.onChange?.({ target: { value: '노트 뒷면' } });
    pagination().props.onPageChange?.(3);
    await settle();
    expect(mocks.find).toHaveBeenLastCalledWith('노트', false, 3);
    archiveFilter().props.onChange?.({ target: { value: 'archived' } });
    await settle();
    expect(mocks.find).toHaveBeenLastCalledWith('노트', true, 1);
    /* 적던 글자는 지우지 않는다. Enter를 누르면 그때 적용한다. */
    expect(input('사진 이름 검색').props.value).toBe('노트 뒷면');
    input('사진 이름 검색').props.onKeyDown?.({ key: 'Enter', preventDefault: () => {} });
    await settle();
    expect(mocks.find).toHaveBeenLastCalledWith('노트 뒷면', true, 1);
  });

  it('이름을 바꾼 뒤에도 적용한 검색어와 보던 페이지로 목록을 다시 읽는다', async () => {
    mocks.find.mockResolvedValue({ data: { rows: [older], total: 45, page: 2, pageSize: 20 } });
    input('사진 이름 검색').props.onChange?.({ target: { value: '노트' } });
    click('검색');
    await settle();
    input('사진 이름 검색').props.onChange?.({ target: { value: '적다 만 글자' } });
    click('이름 수정');
    input('새 사진 이름').props.onChange?.({ target: { value: '노트 앞표지' } });
    mocks.save.mockResolvedValue({ id: older.id, revision: 2 });
    click('이름 저장');
    await settle();
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith({ ...older, name: '노트 앞표지', archived: false });
    expect(mocks.find).toHaveBeenLastCalledWith('노트', false, 2);
    expect(text(render())).toContain('이름을 바꿨습니다.');
  });

  it('빈 목록은 검색했을 때와 아닐 때를 다르게 말한다', async () => {
    initial = { rows: [], total: 0, page: 1, pageSize: 20 };
    expect(text(render())).toContain('올린 사진이 없습니다.');
    mocks.find.mockResolvedValue({ data: initial });
    input('사진 이름 검색').props.onChange?.({ target: { value: '없는 이름' } });
    click('검색');
    await settle();
    expect(text(render())).toContain('조건에 맞는 사진이 없습니다.');
    click('초기화');
    await settle();
    archiveFilter().props.onChange?.({ target: { value: 'archived' } });
    await settle();
    expect(text(render())).toContain('보관한 사진이 없습니다.');
  });
});

/* 화면 규칙 1: 사진을 골라 넣는 창은 공용 선택창이다(사진을 구분할 수 있게 격자 배치). */
describe('사진 선택창 (GoodsPhotoPicker)', () => {
  type DialogProps = AdminPickerPanelProps<GoodsPhoto> & { title: string };
  const close = vi.fn(), select = vi.fn();
  function dialog(props: Partial<Parameters<typeof GoodsPhotoPicker>[0]> = {}) {
    const element = GoodsPhotoPicker({ onClose: close, onSelect: select, ...props }) as ReactElement<DialogProps>;
    expect(element.type).toBe(AdminPickerDialog);
    return element.props;
  }
  const request = (query: string, pageNumber: number) => ({ query, field: '', filter: '', page: pageNumber });

  it('공용 선택창의 격자 배치로 열고, 고르면 닫히는 한 장 고르기가 기본이다', () => {
    const props = dialog();
    expect(props).toMatchObject({ title: '사진 보관함에서 고르기', layout: 'grid', multiple: false, unit: '장', onSelect: select, onClose: close });
    expect(props.description).toBeUndefined();
    expect(props.rowBlocked).toBeUndefined();
    expect(props.selectedKeys).toEqual([]);
  });

  /* 화면 규칙 2: 보관한 사진은 고를 수 없어 조회에서 빼고 한 줄로 알린다(예전에는 잠긴 버튼 조건이 죽은 코드로 남아 있었다). */
  it('보관하지 않은 사진만 적용한 검색어로 20장씩 읽고, 뺀 것을 알린다', async () => {
    const props = dialog();
    expect(props.excludedNote).toBe('보관한 사진은 목록에서 뺐습니다.');
    const second = { rows: [older], total: 21, page: 2, pageSize: 20 as const };
    mocks.find.mockResolvedValueOnce({ data: second });
    expect(await props.load(request('노트', 2))).toEqual(second);
    expect(mocks.find).toHaveBeenCalledExactlyOnceWith('노트', false, 2);
    mocks.find.mockResolvedValueOnce({ error: '사진 보관함을 불러오지 못했습니다. 다시 조회해주세요.' });
    expect(await props.load(request('', 1))).toEqual({ error: '사진 보관함을 불러오지 못했습니다. 다시 조회해주세요.' });
  });

  /* 상품을 등록하다 사용처 링크를 누르면 등록 화면을 떠났다. 선택창에서는 건수만 글자로 보인다. */
  it('사용처는 건수 글자로만 보이고 다른 화면으로 가는 링크를 두지 않는다', () => {
    const props = dialog();
    expect(props.rowView(older)).toMatchObject({ title: '노트 표지', meta: '연결 2건' });
    expect(props.rowView(photo('61', '새 사진')).meta).toBeUndefined();
    expect(props.rowAction).toBeUndefined();
  });

  it('여러 장 고르기: 이미 넣은 사진은 선택됨으로 보이고 남은 자리를 알린다', () => {
    const props = dialog({ multiple: true, pickedPaths: [older.imagePath], remaining: 4 });
    expect(props.multiple).toBe(true);
    expect(props.description).toBe('빈 칸에 앞에서부터 들어갑니다. 남은 자리 4장.');
    expect(props.selectedKeys).toEqual([props.rowKey(older)]);
    /* 자리가 남아 있으면 나머지 사진은 그대로 고를 수 있다. */
    expect(props.rowBlocked).toBeUndefined();
    /* 자리 이름·빼기를 넘기지 않으면 예전처럼 '선택됨'만 보인다. */
    expect(props.selectedLabel).toBeUndefined(); expect(props.onDeselect).toBeUndefined(); expect(props.deselectBlocked).toBeUndefined();
  });

  /* G8(2026-11-25 리뷰): 사진은 첫 빈 칸에 들어가는데 창 안에서는 어느 칸인지 알 수 없었고, 잘못 고르면 창을 닫고 이미지 칸의 ×로 빼야 했다. */
  it('여러 장 고르기: 대표 이미지 칸이 비어 있으면 미리 알리고, 넣은 자리 이름과 [빼기]를 선택창에 넘긴다', () => {
    const placeOf = vi.fn(() => '추가 이미지 2'), onDeselect = vi.fn(), deselectBlocked = vi.fn(() => '공개 중이라 뺄 수 없음');
    const props = dialog({ multiple: true, pickedPaths: [older.imagePath], remaining: 9, nextIsMain: true, placeOf, onDeselect, deselectBlocked });
    expect(props.description).toBe('빈 칸에 앞에서부터 들어갑니다. 남은 자리 9장. 다음에 고르는 사진이 대표 이미지가 됩니다.');
    expect(props.selectedLabel?.(older)).toBe('추가 이미지 2');
    expect(props.deselectBlocked?.(older)).toBe('공개 중이라 뺄 수 없음');
    props.onDeselect?.(older);
    expect(onDeselect).toHaveBeenCalledExactlyOnceWith(older);
    /* 대표 이미지가 이미 있으면 그 말을 하지 않는다. */
    expect(dialog({ multiple: true, pickedPaths: [older.imagePath], remaining: 8 }).description).toBe('빈 칸에 앞에서부터 들어갑니다. 남은 자리 8장.');
  });

  it('자리가 다 차면 아직 넣지 않은 사진의 [선택]을 잠그고 [완료]를 안내한다', () => {
    /* 상품 폼의 경로는 앞머리(public-media/)가 없을 수도 있다. 같은 사진으로 본다. */
    const props = dialog({ multiple: true, pickedPaths: [older.imagePath.replace('public-media/', '')], remaining: 0 });
    expect(props.description).toBe('자리가 다 찼습니다. [완료]를 눌러 닫아 주세요.');
    expect(props.selectedKeys).toEqual([props.rowKey(older)]);
    expect(props.rowBlocked?.(photo('62', '다른 사진'))).toBe('자리 없음');
    expect(props.rowBlocked?.(older)).toBeNull();
  });
});
