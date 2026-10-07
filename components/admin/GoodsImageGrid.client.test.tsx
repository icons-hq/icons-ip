import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { uploadAdminArtwork } from '@/lib/admin/artwork-upload.client';
import { GoodsImageGrid } from './GoodsImageGrid';
import { GOODS_IMAGE_SLOT_COUNT } from '@/lib/admin/goods-image-grid';

/* 컴포넌트 함수를 직접 호출하는 최소 훅 하네스 — DOM 없이 핸들러와 hidden input 값을 검증한다. */
const hooks = vi.hoisted(() => ({
  effects: [] as (() => void | (() => void))[],
  refs: [] as { current: unknown }[],
  refIndex: 0,
  state: [] as unknown[],
  stateIndex: 0,
}));

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useEffect: (effect: () => void | (() => void)) => { hooks.effects.push(effect); },
    useRef: (initial: unknown) => {
      const index = hooks.refIndex++;
      hooks.refs[index] ??= { current: initial };
      return hooks.refs[index];
    },
    useState: (initial: unknown) => {
      const index = hooks.stateIndex++;
      if (!(index in hooks.state)) hooks.state[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
      return [hooks.state[index], (next: unknown) => {
        hooks.state[index] = typeof next === 'function' ? (next as (current: unknown) => unknown)(hooks.state[index]) : next;
      }];
    },
  };
});

vi.mock('@/lib/admin/artwork-upload.client', () => ({ uploadAdminArtwork: vi.fn() }));

const upload = vi.mocked(uploadAdminArtwork);
const path = (name: string) => `public-media/catalog/good/${name}.webp`;
/** 대표 이미지부터 자리 순서대로 채우고 나머지 자리는 빈 값이다. */
const slots = (...names: string[]) => Array.from({ length: GOODS_IMAGE_SLOT_COUNT }, (_, index) => names[index] ?? '');
const previews: Record<string, string | null> = {};
let initial: string[] = [];

function render() {
  hooks.refIndex = 0;
  hooks.stateIndex = 0;
  hooks.effects = [];
  return GoodsImageGrid({
    initialPaths: initial.map((name) => name && path(name)),
    initialUrls: initial.map((name) => name && `https://cdn.example/${name}.webp`),
    onPreviewChange: (name, url) => { previews[name] = url; },
  });
}

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  const props = node.props as { children?: ReactNode };
  return [node as ReactElement<Record<string, unknown>>, ...elements(props.children)];
}

function byLabel(label: string) {
  const found = elements(render()).find((element) => element.props['aria-label'] === label);
  if (!found) throw new Error(`no element labelled ${label}`);
  return found.props as Record<string, (...args: unknown[]) => unknown>;
}

function hiddenValues() {
  return elements(render()).filter((element) => element.type === 'input' && element.props.type === 'hidden')
    .map((element) => String(element.props.value).replace(/^public-media\/catalog\/good\/|\.webp$/g, ''));
}

function tileFrame(position: number) {
  const tile = elements(render()).find((element) => element.type === 'li' && element.props['data-image-position'] === position);
  const frame = elements(tile?.props.children as ReactNode).find((element) => element.type === 'label');
  return frame!.props as Record<string, (...args: unknown[]) => unknown>;
}

function tileHandle(position: number) {
  const handle = elements(render()).find((element) => element.props.className === 'wc-admin-image-tile__handle'
    && String(element.props['aria-label']).startsWith(`추가 이미지 ${position} `));
  if (!handle) throw new Error(`no handle for ${position}`);
  return handle.props as Record<string, (...args: unknown[]) => unknown>;
}

function chooseFiles(label: string, files: File[]) {
  byLabel(label).onChange({ currentTarget: { files, value: 'C:\\fakepath\\x' } });
}

/** 파일 입력 ref에 가짜 요소를 붙이고 렌더 뒤 effect를 실행해 저장 차단 메시지를 읽는다. */
function validity() {
  const tree = render();
  const messages: string[] = [];
  for (const element of elements(tree)) {
    if (element.type !== 'input' || element.props.type !== 'file') continue;
    const position = messages.length;
    (element.props.ref as (node: unknown) => void)({ focus: () => undefined, setCustomValidity: (message: string) => { messages[position] = message; } });
    messages.push('');
  }
  for (const effect of hooks.effects) effect();
  return messages;
}

const file = (name: string, type = 'image/png') => new File(['x'], name, { type });
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  hooks.refs = [];
  hooks.state = [];
  for (const key of Object.keys(previews)) delete previews[key];
  upload.mockReset();
  let counter = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:local-${++counter}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('상품 이미지 그리드 상호작용', () => {
  it('앞으로·뒤로·키보드 화살표로 추가 이미지 순서를 바꾸고 미리보기 순서도 함께 바꾼다', () => {
    initial = slots('main', 'a', 'b', 'c');
    byLabel('추가 이미지 1을 뒤로').onClick();
    expect(hiddenValues()).toEqual(slots('main', 'b', 'a', 'c'));
    expect(previews.galleryPath0).toBe('https://cdn.example/b.webp');

    const preventDefault = vi.fn();
    byLabel('추가 이미지 3 교체').onKeyDown({ key: 'ArrowLeft', preventDefault });
    expect(preventDefault).toHaveBeenCalled();
    expect(hiddenValues()).toEqual(slots('main', 'b', 'c', 'a'));
  });

  it('대표로 지정하면 대표 이미지와 자리를 맞바꾼다', () => {
    initial = slots('main', 'a', 'b');
    byLabel('추가 이미지 2를 대표로 지정').onClick();
    expect(hiddenValues()).toEqual(slots('b', 'a', 'main'));
    expect(previews.imagePath).toBe('https://cdn.example/b.webp');
  });

  it('마우스로 타일을 끌어 놓은 자리로 옮기고, 끌기 뒤의 click은 파일 선택을 열지 않는다', () => {
    initial = slots('main', 'a', 'b', 'c');
    vi.stubGlobal('document', { elementFromPoint: () => ({ closest: () => ({ dataset: { imagePosition: '3' } }) }) });
    const setPointerCapture = vi.fn();
    const releasePointerCapture = vi.fn();
    const currentTarget = { setPointerCapture, releasePointerCapture };
    tileFrame(1).onPointerDown({ isPrimary: true, button: 0, pointerId: 7, pointerType: 'mouse', clientX: 10, clientY: 10, currentTarget });
    tileFrame(1).onPointerMove({ pointerId: 7, clientX: 80, clientY: 12, currentTarget });
    expect(setPointerCapture).toHaveBeenCalledWith(7);
    expect(elements(render()).find((element) => element.props['data-drop-target'] === 'true')?.props['data-image-position']).toBe(3);
    tileFrame(1).onPointerUp({ pointerId: 7, clientX: 80, clientY: 12, currentTarget });
    const preventDefault = vi.fn();
    tileFrame(1).onClick({ preventDefault });
    expect(preventDefault).toHaveBeenCalled();
    expect(hiddenValues()).toEqual(slots('main', 'b', 'c', 'a'));
  });

  /* openRisks 재현: 타일 본문에서 시작한 터치가 끌기로 잡히면(touch-action:none) 모바일에서 세로 스크롤이 막혔다. */
  it('터치로 타일 본문을 쓸면 끌기를 시작하지 않아 스크롤로 남고, 탭은 파일 선택(교체)으로 이어진다', () => {
    initial = slots('main', 'a', 'b', 'c');
    vi.stubGlobal('document', { elementFromPoint: () => ({ closest: () => ({ dataset: { imagePosition: '3' } }) }) });
    const setPointerCapture = vi.fn();
    const currentTarget = { setPointerCapture, releasePointerCapture: vi.fn() };
    for (const pointerType of ['touch', 'pen']) {
      tileFrame(1).onPointerDown({ isPrimary: true, button: 0, pointerId: 9, pointerType, clientX: 10, clientY: 10, currentTarget });
      tileFrame(1).onPointerMove({ pointerId: 9, clientX: 12, clientY: 160, currentTarget });
      tileFrame(1).onPointerUp({ pointerId: 9, clientX: 12, clientY: 160, currentTarget });
    }
    const preventDefault = vi.fn();
    tileFrame(1).onClick({ preventDefault });

    expect(setPointerCapture).not.toHaveBeenCalled();
    expect(elements(render()).some((element) => element.props['data-drop-target'] === 'true')).toBe(false);
    expect(preventDefault).not.toHaveBeenCalled();
    expect(hiddenValues()).toEqual(slots('main', 'a', 'b', 'c'));
  });

  it('터치로 손잡이를 끌면 놓은 자리로 옮기고 순서 변경을 알린다', () => {
    initial = slots('main', 'a', 'b', 'c');
    vi.stubGlobal('document', { elementFromPoint: () => ({ closest: () => ({ dataset: { imagePosition: '1' } }) }) });
    const setPointerCapture = vi.fn();
    const currentTarget = { setPointerCapture, releasePointerCapture: vi.fn() };
    tileHandle(3).onPointerDown({ isPrimary: true, button: 0, pointerId: 4, pointerType: 'touch', clientX: 200, clientY: 10, currentTarget });
    tileHandle(3).onPointerMove({ pointerId: 4, clientX: 20, clientY: 14, currentTarget });
    expect(setPointerCapture).toHaveBeenCalledWith(4);
    expect(elements(render()).find((element) => element.props['data-dragging'])?.props['data-image-position']).toBe(3);
    tileHandle(3).onPointerUp({ pointerId: 4, clientX: 20, clientY: 14, currentTarget });

    expect(hiddenValues()).toEqual(slots('main', 'c', 'a', 'b'));
    expect(elements(render()).find((element) => element.props.role === 'status')?.props.children).toBe('추가 이미지 3을 1번째 추가 이미지로 옮겼습니다.');
  });

  it('손잡이에 초점을 두고 ←·→ 키로 순서를 바꾸면 초점이 옮긴 자리의 손잡이를 따라간다', () => {
    initial = slots('main', 'a', 'b');
    const preventDefault = vi.fn();
    tileHandle(1).onKeyDown({ key: 'ArrowRight', preventDefault });
    expect(preventDefault).toHaveBeenCalled();
    expect(hiddenValues()).toEqual(slots('main', 'b', 'a'));

    const focus = vi.fn();
    (tileHandle(2).ref as unknown as (node: unknown) => void)({ disabled: false, focus });
    for (const effect of hooks.effects) effect();
    expect(focus).toHaveBeenCalled();
  });

  it('여러 파일을 빈 추가 이미지 자리에 순서대로 올리고, 업로드가 끝나기 전에는 저장을 막는다', async () => {
    initial = slots('main', 'a');
    let finishFirst!: (value: { ok: true; imagePath: string }) => void;
    upload
      .mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }))
      .mockResolvedValueOnce({ ok: true, imagePath: path('second') });
    chooseFiles('이미지 추가 (추가 이미지, 여러 장 선택 가능)', [file('first.png'), file('second.png')]);
    await settle();

    expect(upload).toHaveBeenCalledTimes(2);
    expect(hiddenValues()).toEqual(slots('main', 'a', '', 'second'));
    expect(previews.galleryPath1).toBe('blob:local-1');
    expect(validity()).toEqual(['', '', '이미지 업로드가 끝난 뒤 저장해주세요.', '', '']);

    finishFirst({ ok: true, imagePath: path('first') });
    await settle();
    expect(hiddenValues()).toEqual(slots('main', 'a', 'first', 'second'));
    expect(validity().every((message) => message === '')).toBe(true);
  });

  it('업로드 중에 자리를 옮겨도 결과는 그 이미지를 따라간다', async () => {
    initial = slots('main', 'a');
    let finish!: (value: { ok: true; imagePath: string }) => void;
    upload.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    chooseFiles('이미지 추가 (추가 이미지, 여러 장 선택 가능)', [file('late.png')]);
    byLabel('추가 이미지 2를 앞으로').onClick();
    finish({ ok: true, imagePath: path('late') });
    await settle();
    expect(hiddenValues()).toEqual(slots('main', 'late', 'a'));
  });

  it('교체 업로드가 실패하면 원래 이미지 경로를 유지하고 타일에 이유를 보여준다', async () => {
    initial = slots('main', 'a');
    upload.mockResolvedValueOnce({ ok: false, error: '이미지를 업로드하지 못했습니다. 다시 시도해주세요.' });
    chooseFiles('추가 이미지 1 교체', [file('next.png')]);
    expect(hiddenValues()).toEqual(slots('main', 'a'));
    await settle();
    expect(hiddenValues()).toEqual(slots('main', 'a'));
    expect(previews.galleryPath0).toBe('https://cdn.example/a.webp');
    expect(elements(render()).some((element) => element.props.role === 'alert' && String(element.props.children).includes('원래 이미지를 유지합니다'))).toBe(true);
  });

  it('새 이미지 업로드가 실패하면 다시 시도하거나 삭제할 때까지 저장을 막는다', async () => {
    initial = slots();
    upload.mockResolvedValueOnce({ ok: false, error: '업로드 실패' }).mockResolvedValueOnce({ ok: true, imagePath: path('retry') });
    chooseFiles('대표 이미지 추가', [file('main.png')]);
    await settle();
    expect(validity()[0]).toBe('업로드하지 못한 이미지를 다시 시도하거나 삭제해주세요.');

    const retry = elements(render()).find((element) => element.type === 'button' && element.props.children === '다시 시도');
    (retry!.props.onClick as () => void)();
    await settle();
    expect(hiddenValues()).toEqual(slots('retry'));
  });

  it('업로드 중에 삭제한 이미지의 늦은 결과는 버린다', async () => {
    initial = slots('main');
    let finish!: (value: { ok: true; imagePath: string }) => void;
    upload.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    chooseFiles('이미지 추가 (추가 이미지, 여러 장 선택 가능)', [file('gone.png')]);
    byLabel('추가 이미지 1 삭제').onClick();
    finish({ ok: true, imagePath: path('gone') });
    await settle();
    expect(hiddenValues()).toEqual(slots('main'));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:local-1');
  });

  it('최대 장수를 넘거나 형식이 맞지 않는 파일은 넣지 않고 이유를 알린다', async () => {
    initial = slots('main', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h');
    upload.mockResolvedValue({ ok: true, imagePath: path('i') });
    chooseFiles('이미지 추가 (추가 이미지, 여러 장 선택 가능)', [file('i.png'), file('j.png'), file('x.gif', 'image/gif')]);
    await settle();
    expect(upload).toHaveBeenCalledTimes(1);
    expect(hiddenValues()).toEqual(slots('main', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'));
    const notice = elements(render()).find((element) => element.type === 'p' && element.props.role === 'alert');
    expect(notice?.props.children).toContain('추가 이미지는 최대 9장입니다. 선택한 파일 중 1개는 넣지 않았습니다.');
    expect(notice?.props.children).toContain('형식·크기 조건에 맞지 않는 파일 1개는 넣지 않았습니다.');
    /* 9장이 차면 "이미지 추가" 타일은 사라지고 10번째 자리는 hidden input만 남는다. */
    expect(elements(render()).some((element) => element.props['aria-label'] === '이미지 추가 (추가 이미지, 여러 장 선택 가능)')).toBe(false);
  });

  it('추가 이미지 9장을 한 번에 골라 빈 자리에 순서대로 넣고 10번째 파일은 넣지 않는다', async () => {
    initial = slots('main');
    upload.mockImplementation(async ({ file: chosen }) => ({ ok: true, imagePath: path(chosen.name.replace(/\.png$/, '')) }));
    const names = ['g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7', 'g8', 'g9', 'g10'];
    chooseFiles('이미지 추가 (추가 이미지, 여러 장 선택 가능)', names.map((name) => file(`${name}.png`)));
    await settle();
    expect(upload).toHaveBeenCalledTimes(9);
    expect(hiddenValues()).toEqual(slots('main', ...names.slice(0, 9)));
    expect(previews.galleryPath8).toBe('blob:local-9');
    const notice = elements(render()).find((element) => element.type === 'p' && element.props.role === 'alert');
    expect(notice?.props.children).toContain('추가 이미지는 최대 9장입니다. 선택한 파일 중 1개는 넣지 않았습니다.');
  });
});
