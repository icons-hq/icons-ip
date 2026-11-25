import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubAdminConfirm } from '@/lib/admin/confirm.test-support';
import type { GoodsNoticePresetPageData } from '@/lib/admin/goods-notice-presets';
import { GOOD_EDITOR_HELP } from '@/lib/admin/help/good-editor';
import { GOODS_NOTICE_FIELDS, type GoodsNoticeInfo } from '@/lib/goods-notice';

const hooks = vi.hoisted(() => ({ state: [] as unknown[], stateIndex: 0, refs: [] as { current: unknown }[], refIndex: 0, effects: [] as (() => unknown)[] }));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useEffect: (effect: () => unknown) => { hooks.effects.push(effect); },
  useState: (initial: unknown) => {
    const index = hooks.stateIndex++;
    if (!(index in hooks.state)) hooks.state[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    return [hooks.state[index], (next: unknown) => { hooks.state[index] = typeof next === 'function' ? (next as (current: unknown) => unknown)(hooks.state[index]) : next; }];
  },
  useRef: (initial: unknown) => { const index = hooks.refIndex++; hooks.refs[index] ??= { current: initial }; return hooks.refs[index]; },
}));
const actions = vi.hoisted(() => ({ find: vi.fn(), loadOf: vi.fn() }));
vi.mock('@/app/admin/good-notice-actions', () => ({ findGoodNoticePresets: actions.find, loadGoodNoticeOf: actions.loadOf }));
/* 상품 선택창은 서버 액션에 닿는 부품이라 시험에서는 자리만 둔다(그 부품의 시험은 따로 있다). */
vi.mock('./AdminGoodsPicker', () => ({ AdminGoodsPicker: () => null }));

import { AdminHelpTip } from './console/AdminHelpTip';
import { AdminPickerDialog, type AdminPickerPanelProps } from './console/AdminPickerDialog';
import { AdminGoodsPicker, type AdminGoodsPickerRow } from './AdminGoodsPicker';
import { GoodNoticePicker, filledNoticeFields, noticeIsBlank, noticePresetRowView } from './GoodNoticePicker';

type Preset = GoodsNoticePresetPageData['presets'][number];
type Fn = (...args: unknown[]) => unknown;
type Props = {
  children?: ReactNode; className?: string; type?: string; role?: string; disabled?: boolean; help?: unknown; label?: string; ref?: { current: unknown };
  'aria-haspopup'?: string; 'data-good-notice-picker'?: string; 'data-good-notice-suggestion'?: string; onClick?: Fn;
};
type DialogProps = AdminPickerPanelProps<Preset> & { title: string };
type CopyProps = { title: string; description: string; footer: ReactNode; onSelect: (good: AdminGoodsPickerRow) => Promise<boolean | void>; onClose: () => void };

function all(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(all);
  return isValidElement<Props>(node) ? [node, ...all(node.props.children)] : [];
}
const texts = (node: ReactNode): string[] => Array.isArray(node) ? node.flatMap(texts)
  : typeof node === 'string' || typeof node === 'number' ? [String(node)]
    : isValidElement<Props>(node) ? texts(node.props.children) : [];

const notice = (patch: Partial<Preset['notice']> = {}): Preset['notice'] => ({ maker: '아이콘스', origin: '대한민국', material: '아크릴', size: '50mm', madeOn: '2026-11', asManager: '고객센터', asContact: '02-000-0000', ...patch });
const preset = (patch: Partial<Preset> = {}): Preset => ({ id: 'p1', name: '아크릴 키링', notice: notice(), updatedAt: '2026-11-01T00:00:00Z', kcTemplate: null, ...patch });
const kc = { family: 'living' as const, scheme: 'not_applicable' as const, publicNote: '' };
const good = (patch: Partial<AdminGoodsPickerRow> = {}): AdminGoodsPickerRow => ({ id: 'good-a', code: 'G-1', name: '볼펜', categoryName: '문구', imageUrl: null, published: true, ...patch });
const pageOf = (presets: Preset[], total = presets.length, page = 1) => ({ presets, total, filters: { query: '', page } });

const onApply = vi.fn();
let props: Partial<Parameters<typeof GoodNoticePicker>[0]> = {};
let confirm: ReturnType<typeof stubAdminConfirm>;
/** 폼에 지금 적혀 있는 값(칸 이름 → 값). null이면 폼을 찾지 못한 것이다. */
let formValues: Record<string, string> | null = {};

const reset = () => { hooks.stateIndex = 0; hooks.refIndex = 0; hooks.effects = []; };
function render() {
  reset();
  const tree = all(GoodNoticePicker({ onApply, ...props }));
  const root = tree.find((item) => item.props['data-good-notice-picker'] !== undefined)!;
  root.props.ref!.current = formValues ? { closest: (selector: string) => selector === 'form' ? { elements: { namedItem: (name: string) => name in formValues! ? { value: formValues![name] } : null } } : null } : { closest: () => null };
  return tree;
}
const buttons = () => render().filter((item) => item.type === 'button');
const button = (label: string) => buttons().find((item) => texts(item).join('') === label)!;
const templateDialog = () => render().find((item) => item.type === AdminPickerDialog) as ReactElement<DialogProps> | undefined;
const copyPicker = () => render().find((item) => item.type === AdminGoodsPicker) as ReactElement<CopyProps> | undefined;
const band = () => render().find((item) => item.props['data-good-notice-suggestion'] !== undefined);
const status = () => render().find((item) => item.props.role === 'status');
const filled = (...names: string[]) => { formValues = Object.fromEntries(names.map((name) => [name, '적어 둔 값'])); };
const settle = async () => { render(); for (const effect of hooks.effects) effect(); await new Promise((resolve) => setTimeout(resolve, 0)); };

beforeEach(() => {
  hooks.state = []; hooks.refs = []; hooks.effects = []; props = {}; formValues = {};
  onApply.mockReset(); actions.find.mockReset(); actions.loadOf.mockReset();
  confirm = stubAdminConfirm(true);
});
afterEach(() => confirm.restore());

describe('고시정보 가져오기 버튼', () => {
  it('두 버튼이 "?"와 함께 보이고, 늘 보이는 안내 문단이 없다', () => {
    const tree = render();
    expect(buttons().map((item) => texts(item).join(''))).toEqual(['템플릿에서 가져오기', '다른 상품에서 복사']);
    expect(buttons().every((item) => item.props.type === 'button')).toBe(true);
    const helps = tree.filter((item) => item.type === AdminHelpTip);
    expect(helps.map((item) => [item.props.label, item.props.help])).toEqual([
      ['템플릿에서 가져오기', GOOD_EDITOR_HELP.noticeTemplate],
      ['다른 상품에서 복사', GOOD_EDITOR_HELP.noticeCopy],
    ]);
    expect(tree.some((item) => item.type === 'p')).toBe(false);
    expect(tree.find((item) => item.props['data-good-notice-picker'] !== undefined)).toBeDefined();
  });

  it('옛 이름과 인라인 검색 목록·최근 저장 복사를 쓰지 않는다', () => {
    const source = readFileSync(join(process.cwd(), 'components/admin/GoodNoticePicker.tsx'), 'utf8');
    expect(source).not.toContain('loadLastSavedGoodNotice');
    expect(source).not.toContain('data-good-notice-presets');
    expect(source).not.toContain('최근 저장된 상품에서 복사');
    expect(source).not.toContain('type="search"');
    expect(texts(render()).join('|')).not.toContain('모두 바꿉니다');
  });

  it('고칠 수 없는 상품에서는 두 버튼이 모두 막힌다', () => {
    props = { readOnly: true };
    expect(buttons().map((item) => item.props.disabled)).toEqual([true, true]);
    expect(buttons().every((item) => item.props['aria-haspopup'] === 'dialog')).toBe(true);
  });
});

describe('템플릿 선택창', () => {
  it('[템플릿에서 가져오기]가 공용 선택창을 열고 닫으면 닫힌다', () => {
    expect(templateDialog()).toBeUndefined();
    button('템플릿에서 가져오기').props.onClick!();
    const dialog = templateDialog()!.props;
    expect(dialog).toMatchObject({ title: '상품정보제공고시 템플릿 선택', selectLabel: '적용', searchPlaceholder: '템플릿 이름으로 찾기', emptyText: '일치하는 템플릿이 없습니다.' });
    expect(dialog.description).toBe('고르면 상품정보제공고시 7개 칸이 템플릿 내용으로 바뀝니다.');
    dialog.onClose();
    expect(templateDialog()).toBeUndefined();
  });

  it('조회는 기존 템플릿 검색을 그대로 부르고 20개 단위 쪽을 돌려준다', async () => {
    button('템플릿에서 가져오기').props.onClick!();
    actions.find.mockResolvedValue(pageOf([preset(), preset({ id: 'p2', name: '면 파우치' })], 41, 2));
    const loaded = await templateDialog()!.props.load({ query: '키링', field: '', filter: '', page: 2 });
    expect(actions.find).toHaveBeenCalledExactlyOnceWith('키링', 2);
    expect(loaded).toMatchObject({ total: 41, page: 2, pageSize: 20 });
    expect('rows' in loaded && loaded.rows.map((row) => row.name)).toEqual(['아크릴 키링', '면 파우치']);
  });

  it('조회에 실패하면 서버가 준 문장을 그대로 창 안에 보이게 넘긴다', async () => {
    button('템플릿에서 가져오기').props.onClick!();
    actions.find.mockResolvedValue({ error: '템플릿을 불러오지 못했습니다. 다시 시도해주세요.' });
    await expect(templateDialog()!.props.load({ query: '', field: '', filter: '', page: 1 })).resolves.toEqual({ error: '템플릿을 불러오지 못했습니다. 다시 시도해주세요.' });
  });

  it('줄에는 이름 아래에 제조사·소재와 KC 유형 틀 여부가 보인다', () => {
    expect(noticePresetRowView(preset(), true)).toEqual({ title: '아크릴 키링', meta: '제조사 아이콘스 · 소재 아크릴' });
    expect(noticePresetRowView(preset({ kcTemplate: kc }), true).meta).toBe('제조사 아이콘스 · 소재 아크릴 · KC 유형 틀 포함');
    expect(noticePresetRowView(preset({ kcTemplate: kc }), false).meta).toBe('제조사 아이콘스 · 소재 아크릴');
    expect(noticePresetRowView(preset({ notice: notice({ maker: '', material: '  ' }), kcTemplate: kc }), true).meta).toBe('KC 유형 틀 포함');
    expect(noticePresetRowView(preset({ notice: notice({ maker: '', material: '' }) }), true).meta).toBeUndefined();
    expect(noticePresetRowView(preset({ notice: notice({ maker: '가'.repeat(60) }) }), true).meta).toBe(`제조사 ${'가'.repeat(24)}… · 소재 아크릴`);
  });

  it('줄을 그리는 쪽은 KC 틀을 가져오는지에 따라 달라진다', () => {
    props = { copyKcTemplate: false };
    button('템플릿에서 가져오기').props.onClick!();
    expect(templateDialog()!.props.rowView(preset({ kcTemplate: kc })).meta).toBe('제조사 아이콘스 · 소재 아크릴');
    expect(templateDialog()!.props.rowKey(preset({ id: 'p9' }))).toBe('p9');
  });
});

describe('템플릿 적용', () => {
  const open = () => { button('템플릿에서 가져오기').props.onClick!(); return templateDialog()!.props; };

  it('적어 둔 값이 없으면 묻지 않고 7칸과 KC 틀을 넘기고 결과를 알린다', async () => {
    const target = preset({ kcTemplate: kc });
    await expect(open().onSelect(target)).resolves.toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(onApply).toHaveBeenCalledExactlyOnceWith(target.notice, kc);
    expect(texts(status()!).join('')).toBe('‘아크릴 키링’ 템플릿의 7개 칸을 가져왔습니다. KC 정보에도 유형 틀이 들어갑니다. 모델·옵션·번호·사업자는 직접 입력해주세요.');
  });

  it('KC 틀이 없으면 7칸만 가져왔다고 알린다', async () => {
    await open().onSelect(preset());
    expect(onApply).toHaveBeenCalledExactlyOnceWith(notice(), null);
    expect(texts(status()!).join('')).toBe('‘아크릴 키링’ 템플릿의 7개 칸을 가져왔습니다.');
  });

  it('그룹 공통정보처럼 KC 틀을 가져오지 않는 화면은 KC 틀을 넘기지 않는다', async () => {
    props = { copyKcTemplate: false };
    await open().onSelect(preset({ kcTemplate: kc }));
    expect(onApply).toHaveBeenCalledExactlyOnceWith(notice(), undefined);
    expect(texts(status()!).join('')).not.toContain('KC');
  });

  it('적어 둔 값이 하나라도 있으면 어떤 값이 바뀌는지 확인받고, 확인하면 가져온다', async () => {
    filled('noticeMaker');
    await expect(open().onSelect(preset())).resolves.toBe(true);
    expect(confirm).toHaveBeenCalledExactlyOnceWith('지금 적어 둔 7개 칸이 모두 ‘아크릴 키링’ 내용으로 바뀝니다.');
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it('확인에서 취소하면 아무것도 바꾸지 않고 선택창을 그대로 둔다', async () => {
    confirm.restore(); confirm = stubAdminConfirm(false);
    filled('noticeSize', 'noticeMadeOn');
    await expect(open().onSelect(preset())).resolves.toBe(false);
    expect(onApply).not.toHaveBeenCalled();
    expect(status()).toBeUndefined();
  });

  it('공백만 있는 칸은 비어 있는 것으로 본다', async () => {
    formValues = { noticeMaker: '   ', noticeOrigin: '' };
    await open().onSelect(preset());
    expect(confirm).not.toHaveBeenCalled();
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it('폼을 찾지 못하면 칸이 비었는지 알 수 없으므로 확인받는다', async () => {
    formValues = null;
    await open().onSelect(preset());
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('확인창은 이름과 7개를 말하고 버튼은 [바꾸기]다', async () => {
    const requests: unknown[] = [];
    const { setAdminConfirmHandler } = await import('@/lib/admin/confirm');
    confirm.restore();
    const restore = setAdminConfirmHandler(async (request) => { requests.push(request); return true; });
    filled('noticeMaker');
    await open().onSelect(preset());
    restore();
    expect(requests).toEqual([{ title: '상품정보제공고시를 바꿀까요?', message: '지금 적어 둔 7개 칸이 모두 ‘아크릴 키링’ 내용으로 바뀝니다.', confirmLabel: '바꾸기' }]);
    confirm = stubAdminConfirm(true);
  });
});

describe('다른 상품에서 복사', () => {
  const open = () => { button('다른 상품에서 복사').props.onClick!(); return copyPicker()!.props; };
  const sevenValues: GoodsNoticeInfo = { maker: '메이커', origin: '한국', material: '면', size: 'L', madeOn: '2026-11', asManager: '이름', asContact: '02-000' };

  it('[다른 상품에서 복사]가 상품 선택창을 열고 닫으면 닫힌다', () => {
    expect(copyPicker()).toBeUndefined();
    const picker = open();
    expect(picker.title).toBe('상품정보제공고시를 가져올 상품 선택');
    expect(picker.description).toBe('고르면 상품정보제공고시 7개 칸이 그 상품의 내용으로 바뀝니다.');
    expect(picker.footer).toBeNull();
    picker.onClose();
    expect(copyPicker()).toBeUndefined();
  });

  it('고른 상품의 고시를 읽어 7칸만 넘기고(KC 틀 없음) 결과를 알린 뒤 창을 닫는다', async () => {
    actions.loadOf.mockResolvedValue({ name: '볼펜', notice: sevenValues });
    await expect(open().onSelect(good())).resolves.toBe(true);
    expect(actions.loadOf).toHaveBeenCalledExactlyOnceWith('good-a');
    expect(onApply).toHaveBeenCalledExactlyOnceWith(sevenValues);
    expect(onApply.mock.calls[0]).toHaveLength(1);
    expect(texts(status()!).join('')).toBe('‘볼펜’의 7개 칸을 가져왔습니다.');
  });

  it('고시가 비어 있는 상품은 가져오지 않고 선택창 안에 알리며 닫지 않는다', async () => {
    actions.loadOf.mockResolvedValue({ name: '볼펜', notice: { ...sevenValues, maker: null, origin: '', material: '  ', size: null, madeOn: null, asManager: '', asContact: null } });
    await expect(open().onSelect(good())).resolves.toBe(false);
    expect(onApply).not.toHaveBeenCalled(); expect(confirm).not.toHaveBeenCalled();
    const footer = copyPicker()!.props.footer as ReactElement<Props>;
    expect(footer.props.role).toBe('alert');
    expect(texts(footer)).toEqual(['이 상품에는 적어 둔 상품정보제공고시가 없습니다.']);
    expect(status()).toBeUndefined();
  });

  it('다른 상품을 고르면 앞의 안내는 지우고, 창을 닫으면 안내도 사라진다', async () => {
    actions.loadOf.mockResolvedValueOnce({ name: '빈 상품', notice: { ...sevenValues, maker: '', origin: '', material: '', size: '', madeOn: '', asManager: '', asContact: '' } });
    await open().onSelect(good({ id: 'good-empty' }));
    expect(copyPicker()!.props.footer).not.toBeNull();
    actions.loadOf.mockResolvedValueOnce({ name: '볼펜', notice: sevenValues });
    await expect(copyPicker()!.props.onSelect(good())).resolves.toBe(true);
    expect(copyPicker()!.props.footer).toBeNull();
    actions.loadOf.mockResolvedValueOnce({ error: '상품을 찾을 수 없습니다. 목록을 다시 열어 골라주세요.' });
    await copyPicker()!.props.onSelect(good());
    expect(copyPicker()!.props.footer).not.toBeNull();
    copyPicker()!.props.onClose();
    button('다른 상품에서 복사').props.onClick!();
    expect(copyPicker()!.props.footer).toBeNull();
  });

  it('읽지 못했으면 서버가 준 문장을 선택창 안에 보이고 창을 닫지 않는다', async () => {
    actions.loadOf.mockResolvedValue({ error: '상품정보제공고시를 불러오지 못했습니다. 다시 시도해주세요.' });
    await expect(open().onSelect(good())).resolves.toBe(false);
    expect(texts(copyPicker()!.props.footer as ReactElement<Props>)).toEqual(['상품정보제공고시를 불러오지 못했습니다. 다시 시도해주세요.']);
    expect(onApply).not.toHaveBeenCalled();
  });

  it('적어 둔 값이 있으면 상품 이름을 보이며 확인받고, 취소하면 그대로 둔다', async () => {
    filled('noticeOrigin');
    actions.loadOf.mockResolvedValue({ name: '볼펜', notice: sevenValues });
    confirm.restore(); confirm = stubAdminConfirm(false);
    await expect(open().onSelect(good())).resolves.toBe(false);
    expect(confirm).toHaveBeenCalledExactlyOnceWith('지금 적어 둔 7개 칸이 모두 ‘볼펜’ 내용으로 바뀝니다.');
    expect(onApply).not.toHaveBeenCalled();
    expect(copyPicker()!.props.footer).toBeNull();
    confirm.restore(); confirm = stubAdminConfirm(true);
    await expect(copyPicker()!.props.onSelect(good())).resolves.toBe(true);
    expect(onApply).toHaveBeenCalledExactlyOnceWith(sevenValues);
  });
});

describe('대표 카테고리에 맞는 템플릿 제안', () => {
  const suggested = preset({ id: 'suggest', name: '키링 템플릿', kcTemplate: kc });

  it('제안 띠는 템플릿이 있는 첫 이름으로 한 번만 조회해 보인다', async () => {
    props = { suggestNames: ['스페셜 키링', '키링', '문구'] };
    actions.find.mockImplementation(async (name: string) => name === '키링' ? pageOf([suggested]) : pageOf([]));
    await settle();
    expect(actions.find.mock.calls).toEqual([['스페셜 키링', 1], ['키링', 1]]);
    const shown = band()!;
    expect(texts(shown).join('')).toContain('카테고리 ‘키링’에 맞는 템플릿이 있습니다.');
    expect(texts(all(shown).find((item) => item.type === 'button')!).join('')).toBe('키링 템플릿 적용');
    await settle();
    expect(actions.find).toHaveBeenCalledTimes(2);
  });

  it('제안 띠의 버튼도 같은 확인을 거쳐 적용하고, 적용하면 띠가 사라진다', async () => {
    props = { suggestNames: ['키링'] };
    actions.find.mockResolvedValue(pageOf([suggested]));
    await settle();
    filled('noticeMaker', 'noticeSize');
    const apply = all(band()!).find((item) => item.type === 'button')!;
    apply.props.onClick!();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(confirm).toHaveBeenCalledExactlyOnceWith('지금 적어 둔 7개 칸이 모두 ‘키링 템플릿’ 내용으로 바뀝니다.');
    expect(onApply).toHaveBeenCalledExactlyOnceWith(suggested.notice, kc);
    expect(band()).toBeUndefined();
    await settle();
    expect(band()).toBeUndefined();
  });

  it('확인에서 취소하면 제안 띠가 남는다', async () => {
    props = { suggestNames: ['키링'] };
    actions.find.mockResolvedValue(pageOf([suggested]));
    await settle();
    filled('noticeMaker');
    confirm.restore(); confirm = stubAdminConfirm(false);
    all(band()!).find((item) => item.type === 'button')!.props.onClick!();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onApply).not.toHaveBeenCalled();
    expect(band()).toBeDefined();
  });

  it('이름이 없거나 고칠 수 없는 상품이면 조회도 띠도 없다', async () => {
    await settle();
    expect(actions.find).not.toHaveBeenCalled(); expect(band()).toBeUndefined();
    props = { suggestNames: ['키링'], readOnly: true };
    await settle();
    expect(actions.find).not.toHaveBeenCalled(); expect(band()).toBeUndefined();
  });

  it('조회에 실패하면 제안 없이 넘어간다', async () => {
    props = { suggestNames: ['키링'] };
    actions.find.mockResolvedValue({ error: '템플릿을 불러오지 못했습니다. 다시 시도해주세요.' });
    await settle();
    expect(band()).toBeUndefined();
  });
});

describe('도우미', () => {
  it('7칸이 모두 비었는지 본다', () => {
    const empty: GoodsNoticeInfo = { maker: null, origin: '', material: '  ', size: null, madeOn: null, asManager: '', asContact: null };
    expect(noticeIsBlank(empty)).toBe(true);
    expect(noticeIsBlank({ ...empty, asContact: '02-000' })).toBe(false);
  });

  it('폼에서 칸 이름으로 적혀 있는 칸 수를 센다', () => {
    const form = (values: Record<string, unknown>) => ({ elements: { namedItem: (name: string) => name in values ? { value: values[name] } : null } });
    expect(filledNoticeFields(null)).toBeNull();
    expect(filledNoticeFields(undefined)).toBeNull();
    expect(filledNoticeFields(form({}))).toBe(0);
    expect(filledNoticeFields(form(Object.fromEntries(GOODS_NOTICE_FIELDS.map((field) => [field.formName, '값']))))).toBe(7);
    expect(filledNoticeFields(form({ noticeMaker: ' 값 ', noticeOrigin: '   ', noticeSize: 5 }))).toBe(1);
  });
});
