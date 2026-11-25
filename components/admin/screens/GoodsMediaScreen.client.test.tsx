import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/* 상품 동영상·숏클립 화면: 머리말은 상품명과 상품 자동코드, 저장 안 하고 떠나면 묻고, 칸 이름은 '제목', 결과를 모를 때 버튼은 [저장됐는지 확인]. */
const hooks = vi.hoisted(() => ({ states: [] as unknown[], index: 0, refs: [] as { current: unknown }[], refIndex: 0 }));
const mocks = vi.hoisted(() => ({ save: vi.fn(), guard: vi.fn() }));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.states)) hooks.states[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    return [hooks.states[index], (next: unknown) => { hooks.states[index] = typeof next === 'function' ? (next as (value: unknown) => unknown)(hooks.states[index]) : next; }];
  },
  useRef: (initial: unknown) => { const index = hooks.refIndex++; hooks.refs[index] ??= { current: initial }; return hooks.refs[index]; },
}));
vi.mock('@/components/admin/useAdminLeaveGuard', () => ({ useAdminLeaveGuard: mocks.guard }));
vi.mock('@/app/admin/goods-media-actions', () => ({ saveGoodMediaAction: mocks.save, cancelGoodsMediaAction: vi.fn(), verifyGoodsMediaAction: vi.fn(), prepareGoodsMediaAction: vi.fn() }));

import { AdminPageHeader } from '@/components/admin/console/AdminKit';
import { GoodsMediaUploadField } from '@/components/admin/GoodsMediaUploadField';
import { Input } from '@/components/admin/kit/ui/input';
import type { GoodMediaSnapshot, GoodsMediaAsset, GoodsMediaKind } from '@/lib/goods-media';
import { GoodsMediaScreen } from './GoodsMediaScreen';

type Element = ReactElement<Record<string, unknown>>;
const nodes = (node: ReactNode): Element[] => Children.toArray(node).flatMap(value => isValidElement<Record<string, unknown>>(value) ? [value, ...nodes(value.props.children as ReactNode)] : []);
const text = (node: ReactNode): string => Children.toArray(node).map(value => isValidElement<Record<string, unknown>>(value) ? text(value.props.children as ReactNode) : String(value)).join('');
const flush = async () => { for (let turn = 0; turn < 5; turn += 1) await Promise.resolve(); };

const asset = (kind: GoodsMediaKind, title = kind === 'video' ? '상품 동영상' : '상품 숏클립'): GoodsMediaAsset => ({
  id: kind === 'video' ? '90000000-0000-4000-8000-000000000001' : '90000000-0000-4000-8000-000000000002', kind, path: `${kind}/x.mp4`, title, url: `https://example.test/${kind}.mp4`,
  width: 1080, height: 1920, durationMs: 12_000, byteSize: 1_048_576, sha256: 'a'.repeat(64), videoCodec: 'h264', audioCodec: null,
});
const initial: GoodMediaSnapshot = { goodId: 'g-internal-10', goodName: '미니 피규어팩', revision: 0, video: null, shortclip: null };

let current: GoodMediaSnapshot = initial, goodCode: string | null | undefined = 'G10';
function view() {
  hooks.index = 0; hooks.refIndex = 0;
  const tree = GoodsMediaScreen({ initial: current, goodCode });
  const all = nodes(tree);
  return {
    all, text: text(tree),
    header: all.find(node => node.type === AdminPageHeader)!,
    field: (kind: GoodsMediaKind) => all.find(node => node.type === GoodsMediaUploadField && node.props.kind === kind)!,
    form: all.find(node => node.type === 'form')!,
    submit: all.find(node => node.type === 'button' && node.props.type === 'submit')!,
    guard: () => mocks.guard.mock.lastCall![0] as { dirty: boolean; message: string },
  };
}
const attach = (kind: GoodsMediaKind, next: GoodsMediaAsset | null) => (view().field(kind).props.onAsset as (asset: GoodsMediaAsset | null) => void)(next);

beforeEach(() => { hooks.states = []; hooks.index = 0; hooks.refs = []; hooks.refIndex = 0; mocks.save.mockReset(); mocks.guard.mockReset(); current = initial; goodCode = 'G10'; });

describe('머리말', () => {
  it('상품명과 상품 자동코드로 보이고 내부 번호는 보이지 않는다', () => {
    const { header, text: shown } = view();
    expect(header.props.description).toBe('미니 피규어팩 · G10');
    expect(shown).not.toContain('g-internal-10');
  });
  it('상품 자동코드를 읽지 못했으면 상품명만 보인다', () => {
    goodCode = null;
    expect(view().header.props.description).toBe('미니 피규어팩');
  });
  it('영상 구성을 읽지 못한 화면은 내부 번호로 채워진 이름을 보이지 않는다', () => {
    current = { ...initial, goodName: 'g-internal-10', unavailable: true };
    expect(view().header.props.description).toBeUndefined();
  });
});

describe('저장 안 하고 떠날 때', () => {
  it('바꾼 것이 없으면 묻지 않는다', () => {
    expect(view().guard().dirty).toBe(false);
  });
  it('영상을 올리면 묻고, 사라지는 것의 이름을 보인다', () => {
    attach('video', asset('video'));
    const guard = view().guard();
    expect(guard.dirty).toBe(true);
    expect(guard.message).toContain('저장하지 않은 동영상 변경이 있습니다');
    expect(guard.message).toContain('이동하면 바꾼 내용이 상품에 적용되지 않습니다');
    attach('shortclip', asset('shortclip'));
    expect(view().guard().message).toContain('저장하지 않은 동영상·숏클립 변경이 있습니다');
  });
  it('올린 영상을 다시 빼서 저장된 모습과 같아지면 묻지 않는다', () => {
    attach('video', asset('video'));
    attach('video', null);
    expect(view().guard().dirty).toBe(false);
  });
  it('저장된 영상을 빼도 물어본다(빼는 것도 저장해야 적용된다)', () => {
    current = { ...initial, video: asset('video') };
    expect(view().guard().dirty).toBe(false);
    attach('video', null);
    expect(view().guard().dirty).toBe(true);
  });
  it('제목만 바꿔도 묻는다', () => {
    current = { ...initial, shortclip: asset('shortclip', '신상 소개') };
    const input = view().all.find(node => node.type === Input)!;
    (input.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: '신상 소개 영상' } });
    const guard = view().guard();
    expect(guard.dirty).toBe(true);
    expect(guard.message).toContain('저장하지 않은 숏클립 변경이 있습니다');
  });
  it('영상을 올리는 중이거나 올린 결과를 아직 모르면 묻는다', () => {
    (view().field('shortclip').props.onBusy as (busy: boolean) => void)(true);
    expect(view().guard().dirty).toBe(true);
    (view().field('shortclip').props.onBusy as (busy: boolean) => void)(false);
    expect(view().guard().dirty).toBe(false);
  });
});

describe('칸 이름과 결과를 모를 때', () => {
  it('제목 칸은 타이틀이 아니라 제목이다', () => {
    attach('video', asset('video'));
    const shown = view().text;
    expect(shown).toContain('동영상 제목');
    expect(shown).not.toContain('타이틀');
  });
  it('전송이 끊기면 [저장됐는지 확인]으로 다시 보내 같은 내용을 두 번 저장하지 않는다', async () => {
    attach('video', asset('video'));
    mocks.save.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ error: '아직 모름', uncertain: true });
    const submit = async () => { (view().form.props.onSubmit as (event: { preventDefault(): void }) => void)({ preventDefault() {} }); await flush(); };
    await submit();
    const shown = view();
    expect(text(shown.submit.props.children as ReactNode)).toBe('저장됐는지 확인');
    expect(shown.text).toContain('저장됐는지 확인하지 못했습니다. [저장됐는지 확인]을 누르면 같은 내용이 두 번 저장되지 않습니다.');
    expect(shown.text).not.toContain('같은 요청 결과 확인');
    const firstArgs = mocks.save.mock.calls[0];
    await submit();
    expect(mocks.save.mock.calls[1]).toEqual(firstArgs);
  });
});
