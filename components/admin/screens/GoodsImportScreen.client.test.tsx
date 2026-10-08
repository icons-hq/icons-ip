import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { StorageClient } from '@supabase/storage-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({
  state: [] as unknown[],
  stateIndex: 0,
  refs: [] as { current: unknown }[],
  refIndex: 0,
  upload: vi.fn(),
  prepare: vi.fn(),
  preview: vi.fn(),
  inspect: vi.fn(),
}));

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useEffect: () => undefined,
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
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock('@/app/admin/goods-import-actions', () => ({
  prepareGoodsImport: hooks.prepare,
  previewGoodsImport: hooks.preview,
  commitNextGoodsImport: vi.fn(),
  inspectSabangnetGoodsImport: hooks.inspect,
  previewSabangnetGoodsImport: vi.fn(),
}));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ storage: { from: () => ({ upload: hooks.upload }) } }),
}));

const { GoodsImportScreen } = await import('./GoodsImportScreen');

type Props = { children?: ReactNode; id?: string; onClick?: () => Promise<void>; onChange?: (event: unknown) => void };
function find(node: ReactNode, predicate: (element: ReactElement<Props>) => boolean): ReactElement<Props>[] {
  if (!isValidElement<Props>(node)) return Array.isArray(node) ? node.flatMap((child) => find(child, predicate)) : [];
  const matches = predicate(node) ? [node] : [];
  const children = node.props.children;
  for (const child of Array.isArray(children) ? children : [children]) matches.push(...find(child, predicate));
  return matches;
}
function text(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(text).join('');
  return isValidElement<Props>(node) ? text(node.props.children) : '';
}
function render() {
  hooks.stateIndex = 0;
  hooks.refIndex = 0;
  return GoodsImportScreen({});
}
const button = (tree: ReactNode, label: string) =>
  find(tree, (element) => element.type === 'button' && text(element).includes(label))[0];
/* 화면의 useRef 순서: 상품 XLSX, 이미지 ZIP, 사방넷 파일, 중지 신호. */
const REF = { workbook: 0, zip: 1, sabangnet: 2 } as const;
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Storage가 버킷 허용 목록과 대조하는 값: storage-js가 Blob 본문을 보낼 때 쓰는 multipart part의 형식. */
async function storagePartType(body: Blob) {
  const types: string[] = [];
  const client = new StorageClient('https://storage.example.test/storage/v1', {}, async (_url, init) => {
    types.push(((init?.body as FormData).get('') as Blob).type);
    return new Response(JSON.stringify({ Id: 'id', Key: 'key' }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  await client.from('admin-goods-imports').upload('staff/batch/workbook.xlsx', body, { contentType: 'application/octet-stream' });
  return types[0];
}

describe('상품 엑셀 파일 업로드 본문 형식', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hooks.state = [];
    hooks.refs = [];
    hooks.prepare.mockResolvedValue({ ok: true, id: 'batch', prefix: 'staff/batch' });
    hooks.upload.mockResolvedValue({ error: null });
    hooks.inspect.mockResolvedValue({ ok: false, error: '열 확인은 이 테스트에서 멈춥니다.' });
    hooks.preview.mockResolvedValue({ ok: false, error: '검증은 이 테스트에서 멈춥니다.' });
  });

  it('storage-js는 contentType 옵션 대신 Blob 자체의 형식으로 올린다(이 화면이 형식을 다시 붙이는 이유)', async () => {
    const csv = new File(['상품명,판매가\n'], '사방넷.csv', { type: 'text/csv' });
    expect(await storagePartType(csv)).toBe('text/csv');
    expect(await storagePartType(csv.slice(0, csv.size, 'application/octet-stream'))).toBe('application/octet-stream');
  });

  it('사방넷 .csv는 브라우저가 붙인 text/csv·vnd.ms-excel 대신 버킷이 받는 octet-stream Blob으로 올린다', async () => {
    for (const type of ['text/csv', 'application/vnd.ms-excel', '']) {
      hooks.upload.mockClear();
      hooks.state = [];
      hooks.refs = [];
      const first = render();
      const format = find(first, (element) => element.type === 'select' && element.props.id === 'goods-import-format')[0];
      format.props.onChange?.({ target: { value: 'sabangnet' } });
      const file = new File(['상품명,판매가\n키링,9000\n'], '사방넷 상품.csv', { type });
      hooks.refs[REF.sabangnet].current = { files: [file] };
      await button(render(), '열 확인').props.onClick?.();

      expect(hooks.upload).toHaveBeenCalledTimes(1);
      const [path, body, options] = hooks.upload.mock.calls[0];
      expect(path).toBe('staff/batch/workbook.xlsx');
      expect(body).toBeInstanceOf(Blob);
      expect((body as Blob).type).toBe('application/octet-stream');
      expect(await (body as Blob).text()).toBe('상품명,판매가\n키링,9000\n');
      expect(options).toEqual({ contentType: 'application/octet-stream', upsert: false });
      expect(await storagePartType(body as Blob)).toBe('application/octet-stream');
    }
  });

  it('사방넷 .xlsx와 ICONS 양식 XLSX·이미지 ZIP도 버킷이 받는 형식의 Blob으로 올린다', async () => {
    const first = render();
    find(first, (element) => element.type === 'select' && element.props.id === 'goods-import-format')[0]
      .props.onChange?.({ target: { value: 'sabangnet' } });
    hooks.refs[REF.sabangnet].current = { files: [new File(['PK'], '사방넷.xlsx', { type: '' })] };
    await button(render(), '열 확인').props.onClick?.();
    expect((hooks.upload.mock.calls[0][1] as Blob).type).toBe(XLSX);

    hooks.upload.mockClear();
    hooks.state = [];
    hooks.refs = [];
    render();
    hooks.refs[REF.workbook].current = { files: [new File(['PK'], '상품.xlsx', { type: '' })] };
    // Windows Chrome은 .zip을 application/x-zip-compressed로 붙인다.
    hooks.refs[REF.zip].current = { files: [new File(['PK'], '이미지.zip', { type: 'application/x-zip-compressed' })] };
    await button(render(), '파일 검증').props.onClick?.();
    expect(hooks.upload.mock.calls.map(([path, body, options]) => [path, (body as Blob).type, options.contentType])).toEqual([
      ['staff/batch/workbook.xlsx', XLSX, XLSX],
      ['staff/batch/images.zip', 'application/zip', 'application/zip'],
    ]);
  });
});
