import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubAdminConfirm } from '@/lib/admin/confirm.test-support';

/* 창마다 상태·ref 칸을 따로 둔다(scope). 창은 함수로 불러 그린 요소 트리를 걷는다. */
const hooks = vi.hoisted(() => ({ scopes: {} as Record<string, unknown[]>, refs: {} as Record<string, { current: unknown }[]>, scope: 'editor', index: 0, refIndex: 0, context: null as unknown }));
const mocks = vi.hoisted(() => ({ save: vi.fn(), read: vi.fn(), apply: vi.fn(), refresh: vi.fn() }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useId: () => 'f',
  useContext: () => hooks.context,
  useRef: (initial: unknown) => { const refs = hooks.refs[hooks.scope] ??= []; const index = hooks.refIndex++; return refs[index] ??= { current: initial }; },
  useState: (initial: unknown) => {
    const state = hooks.scopes[hooks.scope] ??= []; const index = hooks.index++;
    if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
    return [state[index], (next: unknown) => { state[index] = typeof next === 'function' ? next(state[index]) : next; }];
  },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('@/app/admin/shipping-notice-template-actions', () => ({
  saveShippingNoticeTemplateAction: mocks.save, readShippingNoticeTemplateAction: mocks.read, applyShippingNoticeTemplateToGoodsAction: mocks.apply,
}));

import { AdminGoodsPicker, type AdminGoodsPickerRow } from '@/components/admin/AdminGoodsPicker';
import { AdminField, AdminNotice } from '@/components/admin/console/AdminKit';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { Textarea } from '@/components/admin/kit/ui/textarea';
import { SAVE_UNKNOWN_MESSAGE, TEMPLATE_CLOSE_DIRTY_CONFIRM, TEMPLATE_DISCARD_INPUT_CONFIRM, TEMPLATE_SAVE_OVER_LATEST_NOTE } from '@/lib/admin/goods-template-save';
import type { ShippingNoticeTemplate } from '@/lib/admin/shipping-notice-templates';
import { CustomerServiceDialog } from './CustomerServiceDialog';
import {
  ShippingNoticeTemplateApplyDialog, ShippingNoticeTemplateCreateButton, ShippingNoticeTemplateEditor, ShippingNoticeTemplateResultLine,
  ShippingNoticeTemplateRowActions, ShippingNoticeTemplateWorkspace, type ShippingNoticeTemplateFlash,
} from './ShippingNoticeTemplateForm';

type Props = {
  children?: ReactNode; type?: string; name?: string; value?: string; disabled?: boolean; label?: string; error?: string; hint?: string; title?: string; busy?: boolean;
  onClick?: () => void; onClose?: () => void; onChange?: (event: { target: { value: string } }) => void; onSubmit?: (event: { preventDefault: () => void }) => void;
  'data-shipping-notice-template-pending'?: string; 'data-goods-template-latest'?: string; 'data-goods-template-overwrite-note'?: string;
};
type Element = ReactElement<Props>;
function all(node: ReactNode): Element[] { return Array.isArray(node) ? node.flatMap(all) : isValidElement<Props>(node) ? [node, ...all(node.props.children)] : []; }
function text(node: ReactNode): string { return Array.isArray(node) ? node.map(text).join('') : isValidElement<Props>(node) ? text(node.props.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : ''; }
async function settle() { for (let i = 0; i < 32; i++) await Promise.resolve(); }

const TEMPLATE: ShippingNoticeTemplate = {
  id: 'b9000000-0000-4000-8000-000000000001', code: 'n-3fa9c21b7d04', version: 2, name: '기본 배송 안내',
  shippingNotice: '결제한 날부터 2~3일 안에 보냅니다.', returnExchangeNotice: '주문 상세에서 신청해 주세요.', remoteAreaNotice: '',
  csName: '엑스스퀘어 CS', csPhone: '02-000-0000', csEmail: '', status: 'active', updatedAt: '2026-11-26T01:00:00.123456+00:00', goodsCount: 12,
};
const LATEST: ShippingNoticeTemplate = { ...TEMPLATE, id: 'b9000000-0000-4000-8000-000000000009', version: 3, shippingNotice: '다른 사람이 고친 안내', updatedAt: '2026-11-26T02:00:00+00:00', goodsCount: 12 };
const saved = (overrides: Record<string, unknown> = {}) => ({ saved: { id: TEMPLATE.id, name: '기본 배송 안내', created: false, appliedGoods: 12, ...overrides } });
const sent = (call = 0) => Object.fromEntries((mocks.save.mock.calls[call][1] as FormData).entries());

let confirm: ReturnType<typeof stubAdminConfirm>;
beforeEach(() => {
  vi.clearAllMocks(); hooks.scopes = {}; hooks.refs = {}; hooks.context = null; confirm = stubAdminConfirm(true);
  mocks.read.mockResolvedValue({ ok: true, template: TEMPLATE });
  mocks.save.mockResolvedValue(saved());
});
afterEach(() => { confirm.restore(); });

describe('등록·수정 창', () => {
  const done = vi.fn(), closed = vi.fn();
  let template: ShippingNoticeTemplate | null = TEMPLATE;
  const editor = () => { hooks.scope = 'editor'; hooks.index = 0; hooks.refIndex = 0; return all(ShippingNoticeTemplateEditor({ template, onClose: closed, onDone: done })); };
  const control = (name: string) => { const item = editor().find((node) => (node.type === Input || node.type === Textarea) && node.props.name === name); if (!item) throw new Error(name); return item; };
  const write = (name: string, value: string) => control(name).props.onChange!({ target: { value } });
  const button = (label: string) => { const item = editor().find((node) => node.type === Button && text(node) === label); if (!item) throw new Error(label); return item; };
  const hasButton = (label: string) => editor().some((node) => node.type === Button && text(node) === label);
  const submit = async () => { editor().find((node) => node.type === 'form')!.props.onSubmit!({ preventDefault() {} }); await settle(); };
  const fieldError = (label: string) => (editor().find((node) => node.type === AdminField && node.props.label === label)!.props.error);
  const alertText = () => text(editor().filter((node) => node.type === 'p' && (node.props as { role?: string }).role === 'alert'));
  const dialog = () => editor().find((node) => node.type === CustomerServiceDialog)!;
  beforeEach(() => { template = TEMPLATE; done.mockClear(); closed.mockClear(); });

  /* N-1: 운영자는 이름과 본문만 다룬다. 코드·버전·확인 근거 칸은 없다. */
  it('칸은 이름과 안내 글, 고객센터 연락처뿐이다', () => {
    template = null;
    const tree = editor();
    expect(dialog().props.title).toBe('배송 안내 템플릿 등록');
    expect(tree.filter((node) => node.type === AdminField).map((node) => node.props.label))
      .toEqual(['템플릿 이름', '배송 안내', '도서산간 안내 (선택)', '교환·반품 안내', '고객센터 이름', '고객센터 전화', '고객센터 이메일']);
    expect(tree.filter((node) => node.type === Input || node.type === Textarea).map((node) => node.props.name))
      .toEqual(['name', 'shippingNotice', 'remoteAreaNotice', 'returnExchangeNotice', 'csName', 'csPhone', 'csEmail']);
    expect(text(tree)).not.toMatch(/코드|버전|근거|초안|활성/);
    expect(tree.filter((node) => node.type === Button).map((node) => text(node))).toEqual(['닫기', '저장']);
    expect(button('저장').props.type).toBe('submit');
    expect(button('닫기').props.type).toBe('button');
    template = TEMPLATE; hooks.scopes = {};
    expect(dialog().props.title).toBe('배송 안내 템플릿 수정');
    expect(control('shippingNotice').props.value).toBe('결제한 날부터 2~3일 안에 보냅니다.');
  });

  /* S7-1: 금액이 상세에 나오는 것은 지역별 추가배송비를 적용 중인 출고지의 상품뿐이다(`get_good_shipping_region_fees`가 listed일 때). 없거나 안 붙으면 주문서에서 주소를 넣은 뒤 확인한다. */
  it('도서산간 안내 칸의 도움말은 금액이 언제 상세에 나오는지 사실대로 말한다', () => {
    const hint = String(editor().find((node) => node.type === AdminField && node.props.label === '도서산간 안내 (선택)')!.props.hint);
    expect(hint).toContain('추가배송비 금액은 적지 않습니다.');
    expect(hint).toContain('지역별 추가배송비를 적용 중인 출고지의 상품은 금액이 상품 상세에 따로 나오고');
    expect(hint).toContain('정확한 금액은 주문서에서 주소를 넣으면 나옵니다');
    /* 적용 중인 설정이 없는 출고지의 상품에는 금액이 나오지 않으므로 '넣은 금액이 나온다'고 단정하지 않는다. */
    expect(hint).not.toContain('‘지역별 추가배송비 관리’에 넣은 금액이 상품 상세에 따로 나옵니다');
  });

  it('빠진 칸은 저장을 누를 때 그 칸에서 말하고, 아무것도 보내지 않는다', async () => {
    template = null;
    write('name', '새 안내');
    await submit();
    expect(fieldError('배송 안내')).toBe('배송 안내를 적어 주세요. 상품 상세에 그대로 보입니다.');
    expect(fieldError('교환·반품 안내')).toBe('교환·반품 안내를 적어 주세요. 상품 상세에 그대로 보입니다.');
    expect(fieldError('고객센터 전화')).toBe('고객센터 전화와 이메일 가운데 하나는 적어 주세요.');
    expect(fieldError('템플릿 이름')).toBeUndefined();
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });

  /* N-3: 새 템플릿은 쓰는 상품이 없어 묻지 않고 저장한다. 저장하면 바로 고를 수 있다. */
  it('새 템플릿은 확인창 없이 한 번에 저장하고, 결과 문장을 목록에 넘긴다', async () => {
    template = null;
    mocks.save.mockResolvedValue(saved({ name: '새 안내', created: true, appliedGoods: 0 }));
    for (const [name, value] of [['name', '새 안내'], ['shippingNotice', '배송'], ['returnExchangeNotice', '반품'], ['csName', 'CS'], ['csEmail', 'help@example.com']]) write(name, value);
    await submit();
    expect(mocks.read).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(sent()).toMatchObject({ id: '', updatedAt: '', name: '새 안내', shippingNotice: '배송', returnExchangeNotice: '반품', remoteAreaNotice: '', csName: 'CS', csPhone: '', csEmail: 'help@example.com' });
    expect(sent().operationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(Object.keys(sent())).not.toEqual(expect.arrayContaining(['code', 'version', 'confirmationEvidence']));
    expect(done).toHaveBeenCalledWith('‘새 안내’ 템플릿을 등록했습니다. 상품등록의 [템플릿 고르기]에서 바로 고를 수 있습니다.');
  });

  /* N-2·N-4: 저장하면 이 템플릿을 쓰는 상품의 안내가 바뀐다. 몇 개인지 지금 다시 읽어 확인창에 보인다. */
  it('고칠 때는 쓰는 상품 수를 다시 읽어 확인받은 뒤 저장한다', async () => {
    mocks.read.mockResolvedValue({ ok: true, template: { ...TEMPLATE, goodsCount: 1234 } });
    write('shippingNotice', '결제한 날부터 3일 안에 보냅니다.');
    await submit();
    expect(mocks.read).toHaveBeenCalledWith('n-3fa9c21b7d04');
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith('이 템플릿을 쓰는 상품 1,234개의 배송·교환·반품 안내가 새 내용으로 바뀝니다. 공개 중인 상품은 고객이 보는 상품 상세에 바로 반영됩니다.');
    expect(sent()).toMatchObject({ id: TEMPLATE.id, updatedAt: '2026-11-26T01:00:00.123456+00:00', shippingNotice: '결제한 날부터 3일 안에 보냅니다.' });
    expect(done).toHaveBeenCalledWith('‘기본 배송 안내’ 템플릿을 저장했습니다. 이 템플릿을 쓰는 상품 12개의 안내를 새 내용으로 바꿨습니다.');
  });

  it('확인창에서 돌아가면 저장하지 않고 적은 내용은 그대로다', async () => {
    confirm.restore(); confirm = stubAdminConfirm(false);
    write('shippingNotice', '고친 안내');
    await submit();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(done).not.toHaveBeenCalled();
    expect(control('shippingNotice').props.value).toBe('고친 안내');
    expect(hasButton('저장')).toBe(true);
  });

  it('쓰는 상품이 없으면 묻지 않는다', async () => {
    mocks.read.mockResolvedValue({ ok: true, template: { ...TEMPLATE, goodsCount: 0 } });
    mocks.save.mockResolvedValue(saved({ appliedGoods: 0 }));
    write('name', '이름만 바꿈');
    await submit();
    expect(confirm).not.toHaveBeenCalled();
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledWith('‘기본 배송 안내’ 템플릿을 저장했습니다.');
  });

  it('쓰는 상품 수를 읽지 못하면 저장하지 않는다 — 모르는 채로 상품의 안내를 바꾸지 않는다', async () => {
    mocks.read.mockResolvedValue({ ok: false, error: '읽지 못함' });
    write('shippingNotice', '고친 안내');
    await submit();
    expect(alertText()).toBe('이 템플릿을 쓰는 상품 수를 읽지 못해 저장하지 않았습니다. 잠시 뒤 다시 저장해 주세요.');
    mocks.read.mockRejectedValue(new Error('network'));
    await submit();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });

  describe('다른 사람이 먼저 바꿨을 때', () => {
    const conflicted = async () => { mocks.read.mockResolvedValue({ ok: true, template: LATEST }); write('shippingNotice', '내가 고친 안내'); await submit(); };

    it('저장 전에 알아채면 보내지 않고, 지금 저장된 내용과 두 길을 보인다', async () => {
      await conflicted();
      expect(mocks.save).not.toHaveBeenCalled();
      expect(confirm).not.toHaveBeenCalled();
      const notice = editor().find((node) => node.type === AdminNotice)!;
      expect(text(notice)).toContain('다른 사람이 먼저 바꿨습니다.');
      expect(text(editor().find((node) => node.props['data-goods-template-latest'] !== undefined))).toContain('다른 사람이 고친 안내');
      expect(text(editor().find((node) => node.props['data-goods-template-overwrite-note'] !== undefined))).toBe(TEMPLATE_SAVE_OVER_LATEST_NOTE);
      expect(editor().filter((node) => node.type === Button).map((node) => text(node))).toEqual(['내 입력으로 덮어쓰기', '내 입력 버리기', '닫기']);
      expect(control('shippingNotice').props.value).toBe('내가 고친 안내');
    });

    it('[내 입력으로 덮어쓰기]는 쓰는 상품 수를 확인받고, 지금 저장된 줄을 딛고 저장한다', async () => {
      await conflicted();
      button('내 입력으로 덮어쓰기').props.onClick!(); await settle();
      expect(confirm).toHaveBeenCalledWith(expect.stringContaining('상품 12개'));
      expect(sent()).toMatchObject({ id: LATEST.id, updatedAt: LATEST.updatedAt, shippingNotice: '내가 고친 안내' });
      expect(done).toHaveBeenCalledWith(expect.stringContaining('저장했습니다'));
    });

    it('다른 사람이 저장한 내용이 내 입력과 같으면 덮어쓰지 않고 목록만 다시 읽는다', async () => {
      mocks.read.mockResolvedValue({ ok: true, template: LATEST });
      write('shippingNotice', LATEST.shippingNotice);
      await submit();
      button('내 입력으로 덮어쓰기').props.onClick!(); await settle();
      expect(confirm).not.toHaveBeenCalled();
      expect(mocks.save).not.toHaveBeenCalled();
      expect(done).toHaveBeenCalledWith(null);
    });

    it('[내 입력 버리기]는 사라지는 것을 묻고, 목록을 다시 읽게 한다', async () => {
      await conflicted();
      button('내 입력 버리기').props.onClick!(); await settle();
      expect(confirm).toHaveBeenCalledWith(TEMPLATE_DISCARD_INPUT_CONFIRM.message);
      expect(done).toHaveBeenCalledWith(null);
      expect(mocks.save).not.toHaveBeenCalled();
    });

    it('저장이 거절돼 알게 된 경우에도 지금 내용을 읽어 같은 두 길을 보인다', async () => {
      mocks.read.mockResolvedValueOnce({ ok: true, template: TEMPLATE }).mockResolvedValue({ ok: true, template: LATEST });
      mocks.save.mockResolvedValueOnce({ conflict: true, errors: { form: '다른 사람이 먼저 바꿨습니다.' } });
      write('shippingNotice', '내가 고친 안내');
      await submit();
      expect(mocks.read).toHaveBeenCalledTimes(2);
      expect(hasButton('내 입력으로 덮어쓰기')).toBe(true);
      expect(hasButton('저장')).toBe(false);
      expect(text(editor().find((node) => node.props['data-goods-template-latest'] !== undefined))).toContain('다른 사람이 고친 안내');
      expect(done).not.toHaveBeenCalled();
    });
  });

  describe('저장됐는지 모를 때', () => {
    it('칸을 잠그고 [저장됐는지 확인]으로 같은 작업을 다시 보낸다 — 다시 묻지 않는다', async () => {
      mocks.save.mockResolvedValueOnce({ uncertain: true, errors: { form: SAVE_UNKNOWN_MESSAGE } });
      write('shippingNotice', '고친 안내');
      await submit();
      expect(alertText()).toBe(SAVE_UNKNOWN_MESSAGE);
      expect(editor().find((node) => node.type === 'fieldset')!.props.disabled).toBe(true);
      expect(hasButton('저장')).toBe(false);
      button('저장됐는지 확인').props.onClick!(); await settle();
      expect(mocks.save).toHaveBeenCalledTimes(2);
      expect(sent(1)).toEqual(sent(0));
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(done).toHaveBeenCalledWith(expect.stringContaining('저장했습니다'));
    });

    it('연결이 끊겨도 같은 길이다. 그대로 닫으려 하면 목록에서 확인하라고 묻는다', async () => {
      mocks.save.mockRejectedValueOnce(new Error('network'));
      write('shippingNotice', '고친 안내');
      await submit();
      expect(hasButton('저장됐는지 확인')).toBe(true);
      dialog().props.onClose!(); await settle();
      expect(confirm).toHaveBeenLastCalledWith(expect.stringContaining('닫으면 목록을 다시 불러옵니다.'));
      expect(done).toHaveBeenCalledWith(null);
      expect(closed).not.toHaveBeenCalled();
    });
  });

  it('서버가 돌려준 칸별 오류와 저장 실패 문장을 보인다', async () => {
    mocks.read.mockResolvedValue({ ok: true, template: { ...TEMPLATE, goodsCount: 0 } });
    mocks.save.mockResolvedValueOnce({ errors: { csEmail: '고객센터 이메일을 name@example.com처럼 적어 주세요.' } })
      .mockResolvedValueOnce({ errors: { form: '템플릿을 찾을 수 없습니다. 창을 닫고 목록을 새로고침해 주세요.' } });
    write('shippingNotice', '고친 안내');
    await submit();
    expect(fieldError('고객센터 이메일')).toBe('고객센터 이메일을 name@example.com처럼 적어 주세요.');
    expect(alertText()).toBe('');
    await submit();
    expect(alertText()).toBe('템플릿을 찾을 수 없습니다. 창을 닫고 목록을 새로고침해 주세요.');
    expect(hasButton('저장')).toBe(true);
    expect(done).not.toHaveBeenCalled();
  });

  it('저장하는 동안에는 창을 닫지 못한다', async () => {
    let finish!: (value: unknown) => void;
    mocks.read.mockResolvedValue({ ok: true, template: { ...TEMPLATE, goodsCount: 0 } });
    mocks.save.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    write('shippingNotice', '고친 안내');
    await submit();
    expect(dialog().props.busy).toBe(true);
    expect(button('저장 중…').props.disabled).toBe(true);
    dialog().props.onClose!(); await settle();
    expect(closed).not.toHaveBeenCalled();
    finish(saved({ appliedGoods: 0 })); await settle();
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('고친 것이 없으면 그냥 닫고, 고친 것이 있으면 사라진다고 묻는다', async () => {
    button('닫기').props.onClick!(); await settle();
    expect(confirm).not.toHaveBeenCalled();
    expect(closed).toHaveBeenCalledTimes(1);
    write('csPhone', '02-111-1111');
    confirm.restore(); confirm = stubAdminConfirm(false);
    dialog().props.onClose!(); await settle();
    expect(confirm).toHaveBeenCalledWith(TEMPLATE_CLOSE_DIRTY_CONFIRM.message);
    expect(closed).toHaveBeenCalledTimes(1);
    confirm.restore(); confirm = stubAdminConfirm(true);
    dialog().props.onClose!(); await settle();
    expect(closed).toHaveBeenCalledTimes(2);
  });

  /* 고친 것이 없으면 바뀌는 것도 없다. 확인창이 '상품 N개가 바뀐다'고 틀리게 말하지 않게 보내지 않는다. */
  it('사용 중인 템플릿을 고친 것 없이 저장하면 묻지도 보내지도 않는다', async () => {
    await submit();
    expect(alertText()).toBe('고친 내용이 없습니다.');
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    /* 앞뒤 공백만 다른 것도 고친 것이 아니다(저장할 때 지운다). */
    write('csName', ' 엑스스퀘어 CS ');
    await submit();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('준비 중인 템플릿은 저장하면 바로 고를 수 있다고 알리고, 고친 것이 없어도 저장한다', async () => {
    expect(editor().some((node) => node.props['data-shipping-notice-template-pending'] !== undefined)).toBe(false);
    template = { ...TEMPLATE, status: 'draft', goodsCount: 0 };
    hooks.scopes = {};
    mocks.read.mockResolvedValue({ ok: true, template });
    mocks.save.mockResolvedValue(saved({ appliedGoods: 0 }));
    expect(text(editor().find((node) => node.props['data-shipping-notice-template-pending'] !== undefined)))
      .toBe('아직 상품에서 고를 수 없는 템플릿입니다. [저장]하면 바로 고를 수 있습니다.');
    await submit();
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(sent()).toMatchObject({ id: TEMPLATE.id, updatedAt: TEMPLATE.updatedAt });
    expect(done).toHaveBeenCalledWith('‘기본 배송 안내’ 템플릿을 저장했습니다.');
  });
});

describe('[상품에 적용] 창', () => {
  const done = vi.fn<(flash: ShippingNoticeTemplateFlash) => void>(), closed = vi.fn();
  type PickerProps = Parameters<typeof AdminGoodsPicker>[0];
  const good = (id: string, name = `${id} 이름`) => ({ id, name }) as AdminGoodsPickerRow;
  const picker = () => {
    hooks.scope = 'apply'; hooks.index = 0; hooks.refIndex = 0;
    return all(ShippingNoticeTemplateApplyDialog({ template: TEMPLATE, onClose: closed, onDone: done })).find((node) => node.type === AdminGoodsPicker) as unknown as ReactElement<PickerProps>;
  };
  const footer = () => all(picker().props.footer);
  const applyButton = () => footer().find((node) => node.type === Button)!;
  beforeEach(() => { done.mockClear(); closed.mockClear(); });

  it('공용 상품 선택창에서 여러 개를 고르고, 고르기 전에 무엇이 바뀌는지 말한다', () => {
    const props = picker().props;
    expect(props).toMatchObject({ title: '상품 고르기', multiple: true, closeLabel: '닫기', selectedKeys: [] });
    expect(props.description).toBe('고른 상품의 배송·교환·반품 안내가 ‘기본 배송 안내’ 템플릿 내용으로 바뀝니다. 다른 템플릿을 쓰던 상품도 이 템플릿으로 바뀝니다.');
    expect(text(footer())).toContain('적용할 상품을 골라 주세요.');
    expect(applyButton().props.disabled).toBe(true);
  });

  it('고른 수가 버튼에 보이고, [N개에 적용]은 고른 상품을 한 번에 보낸다', async () => {
    mocks.apply.mockResolvedValue({ ok: true, result: { applied: 2, unchanged: 0, failed: [] } });
    picker().props.onSelect(good('good-1')); picker().props.onSelect(good('good-2')); picker().props.onSelect(good('good-1'));
    picker().props.onSelect(good('good-3')); picker().props.onDeselect!(good('good-3'));
    expect(picker().props.selectedKeys).toEqual(['good-1', 'good-2']);
    expect(text(footer())).toContain('고른 상품 2개');
    expect(text(applyButton())).toBe('2개에 적용');
    applyButton().props.onClick!(); await settle();
    expect(mocks.apply).toHaveBeenCalledWith({ id: TEMPLATE.id, code: TEMPLATE.code }, [{ id: 'good-1', name: 'good-1 이름' }, { id: 'good-2', name: 'good-2 이름' }]);
    expect(done).toHaveBeenCalledWith({ tone: 'success', text: '‘기본 배송 안내’ 템플릿을 상품 2개에 적용했습니다.' });
  });

  it('안 된 상품이 있으면 결과 한 줄이 주의 색으로 이유를 함께 말한다', async () => {
    mocks.apply.mockResolvedValue({ ok: true, result: { applied: 1, unchanged: 0, failed: [{ name: '키링', reason: '보관한 상품' }] } });
    picker().props.onSelect(good('good-1'));
    applyButton().props.onClick!(); await settle();
    expect(done).toHaveBeenCalledWith({ tone: 'warning', text: '‘기본 배송 안내’ 템플릿을 상품 1개에 적용했습니다. 적용하지 못한 상품 1개: 키링(보관한 상품).' });
  });

  it('적용하지 못하면 창을 닫지 않고 이유를 보인다. 결과를 모르면 다시 눌러도 된다고 말한다', async () => {
    mocks.apply.mockResolvedValueOnce({ ok: false, error: '준비 중인 템플릿은 상품에 적용할 수 없습니다. 먼저 [수정]을 눌러 저장해 주세요.' }).mockRejectedValueOnce(new Error('network'));
    picker().props.onSelect(good('good-1'));
    applyButton().props.onClick!(); await settle();
    expect(text(footer())).toContain('준비 중인 템플릿은 상품에 적용할 수 없습니다.');
    applyButton().props.onClick!(); await settle();
    expect(text(footer())).toContain('적용됐는지 확인하지 못했습니다. 다시 눌러도 같은 상품에 두 번 적용되지 않습니다.');
    expect(done).not.toHaveBeenCalled();
    expect(picker().props.selectedKeys).toEqual(['good-1']);
  });

  it('100개를 채우면 더 고를 수 없다고 줄에서 말한다', () => {
    for (let index = 0; index < 100; index += 1) picker().props.onSelect(good(`good-${index}`));
    expect(picker().props.selectedKeys).toHaveLength(100);
    expect(picker().props.rowBlocked!(good('good-extra'))).toBe('한 번에 100개까지');
    expect(picker().props.rowBlocked!(good('good-5'))).toBeNull();
    picker().props.onSelect(good('good-extra'));
    expect(picker().props.selectedKeys).toHaveLength(100);
  });

  it('고른 상품이 있는데 닫으려 하면 적용되지 않는다고 묻는다', async () => {
    picker().props.onClose(); await settle();
    expect(confirm).not.toHaveBeenCalled();
    expect(closed).toHaveBeenCalledTimes(1);
    picker().props.onSelect(good('good-1'));
    confirm.restore(); confirm = stubAdminConfirm(false);
    picker().props.onClose(); await settle();
    expect(confirm).toHaveBeenCalledWith('고른 상품 1개는 적용되지 않습니다.');
    expect(closed).toHaveBeenCalledTimes(1);
  });
});

describe('화면 묶음(결과 한 줄과 창 열기)', () => {
  type Workspace = { flash: ShippingNoticeTemplateFlash | null; openEditor: (template: ShippingNoticeTemplate | null) => void; openApply: (template: ShippingNoticeTemplate) => void };
  type Host = ReactElement<{ value: Workspace; children: ReactNode }>;
  const workspace = () => { hooks.scope = 'workspace'; hooks.index = 0; hooks.refIndex = 0; return ShippingNoticeTemplateWorkspace({ children: null }) as Host; };
  const opened = (type: unknown) => all(workspace().props.children).find((node) => node.type === type) as unknown as ReactElement<{
    template: ShippingNoticeTemplate | null; onClose: () => void; onDone: (value: never) => void }> | undefined;

  it('[등록]·[수정]은 편집 창을, [상품에 적용]은 적용 창을 연다', () => {
    expect(opened(ShippingNoticeTemplateEditor)).toBeUndefined();
    workspace().props.value.openEditor(null);
    expect(opened(ShippingNoticeTemplateEditor)!.props.template).toBeNull();
    opened(ShippingNoticeTemplateEditor)!.props.onClose();
    expect(opened(ShippingNoticeTemplateEditor)).toBeUndefined();
    workspace().props.value.openEditor(TEMPLATE);
    expect(opened(ShippingNoticeTemplateEditor)!.props.template).toBe(TEMPLATE);
    workspace().props.value.openApply(TEMPLATE);
    expect(opened(ShippingNoticeTemplateApplyDialog)!.props.template).toBe(TEMPLATE);
  });

  it('저장하면 창을 닫고 결과 한 줄을 남긴다. 저장하지 않고 목록이 달라졌을 수 있으면 목록을 다시 읽는다', () => {
    workspace().props.value.openEditor(TEMPLATE);
    (opened(ShippingNoticeTemplateEditor)!.props.onDone as (notice: string | null) => void)('‘기본 배송 안내’ 템플릿을 저장했습니다.');
    expect(opened(ShippingNoticeTemplateEditor)).toBeUndefined();
    expect(workspace().props.value.flash).toEqual({ tone: 'success', text: '‘기본 배송 안내’ 템플릿을 저장했습니다.' });
    expect(mocks.refresh).not.toHaveBeenCalled();
    /* 다음 창을 열면 지난 결과는 지운다. */
    workspace().props.value.openEditor(TEMPLATE);
    expect(workspace().props.value.flash).toBeNull();
    (opened(ShippingNoticeTemplateEditor)!.props.onDone as (notice: string | null) => void)(null);
    expect(workspace().props.value.flash).toBeNull();
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    workspace().props.value.openApply(TEMPLATE);
    (opened(ShippingNoticeTemplateApplyDialog)!.props.onDone as (flash: ShippingNoticeTemplateFlash) => void)({ tone: 'warning', text: '일부만 적용' });
    expect(opened(ShippingNoticeTemplateApplyDialog)).toBeUndefined();
    expect(workspace().props.value.flash).toEqual({ tone: 'warning', text: '일부만 적용' });
  });

  it('결과 한 줄은 결과가 있을 때만 상자를 그린다', () => {
    hooks.context = { flash: null };
    expect(all(ShippingNoticeTemplateResultLine()).some((node) => node.type === AdminNotice)).toBe(false);
    hooks.context = { flash: { tone: 'success', text: '저장했습니다.' } };
    expect(text(all(ShippingNoticeTemplateResultLine()).find((node) => node.type === AdminNotice))).toBe('저장했습니다.');
  });

  it('줄 버튼은 그 줄의 템플릿으로 창을 연다. 준비 중인 템플릿에는 [상품에 적용]이 없다', () => {
    const openEditor = vi.fn(), openApply = vi.fn();
    hooks.context = { flash: null, openEditor, openApply };
    const row = all(ShippingNoticeTemplateRowActions({ template: TEMPLATE })).filter((node) => node.type === Button);
    expect(row.map((node) => text(node))).toEqual(['수정', '상품에 적용']);
    expect(row.every((node) => node.props.type === 'button')).toBe(true);
    row[0].props.onClick!(); row[1].props.onClick!();
    expect(openEditor).toHaveBeenCalledWith(TEMPLATE);
    expect(openApply).toHaveBeenCalledWith(TEMPLATE);
    expect(all(ShippingNoticeTemplateRowActions({ template: { ...TEMPLATE, status: 'draft' } })).filter((node) => node.type === Button).map((node) => text(node))).toEqual(['수정']);
    const create = all(ShippingNoticeTemplateCreateButton()).find((node) => node.type === Button)!;
    expect(text(create)).toBe('배송 안내 템플릿 등록');
    create.props.onClick!();
    expect(openEditor).toHaveBeenLastCalledWith(null);
  });
});
