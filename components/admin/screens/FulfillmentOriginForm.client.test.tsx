import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubAdminConfirm } from '@/lib/admin/confirm.test-support';
import { fulfillmentOriginFormValues, type FulfillmentOrigin, type FulfillmentOriginConflict, type OriginSaveImpact } from '@/lib/admin/fulfillment-origins';

/*
 * 출고지 저장 폼의 확인창·충돌 두 길·영향 안내. 폼 안의 상태(저장 결과·고른 값)는 훅을 정해 둔 값으로 돌려 재현한다.
 * 마크업은 실제 훅으로 그리고(indexed=false), 눌렀을 때의 동작은 컴포넌트를 함수로 불러(indexed=true) 폼·버튼의 핸들러를 직접 실행한다.
 */
const hooks = vi.hoisted(() => ({ indexed: false, index: 0, values: {} as Record<number, unknown>, setters: [] as ReturnType<typeof vi.fn>[], state: {} as Record<string, unknown>, pending: false }));
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useActionState: () => [hooks.state, vi.fn(), hooks.pending],
    useState: (initial: unknown) => {
      if (!hooks.indexed) return actual.useState(initial as never);
      const index = hooks.index++;
      const setter = vi.fn();
      hooks.setters[index] = setter;
      return [index in hooks.values ? hooks.values[index] : typeof initial === 'function' ? (initial as () => unknown)() : initial, setter];
    },
  };
});
vi.mock('../useAdminLeaveGuard', () => ({ useAdminLeaveGuard: () => ({ formRef: undefined, dirty: false }) }));
vi.mock('@/app/admin/fulfillment-actions', () => ({ saveFulfillmentOriginAction: vi.fn() }));
import { FulfillmentOriginForm } from './FulfillmentOriginForm';

const origin: FulfillmentOrigin = { id: '00000000-0000-4000-8000-000000042201', code: 'gimpo', name: '김포', defaultCarrier: 'hanjin', baseFee: 4700, freeThreshold: 62000,
  returnAddress: '김포 주소', cutoff: '17:00', exportTemplate: 'wms_csv', active: true, updatedAt: '2026-09-01T00:00:00Z' };
const carriers = [
  { code: 'hanjin', label: '한진택배', active: true, trackingUrlTemplate: 'https://example.test/{trackingNumber}', updatedAt: '2026-09-01T00:00:00Z' },
  { code: 'cj', label: 'CJ대한통운', active: true, trackingUrlTemplate: 'https://example.test/{trackingNumber}', updatedAt: '2026-09-01T00:00:00Z' },
  { code: 'old', label: '옛 택배', active: false, trackingUrlTemplate: 'https://example.test/{trackingNumber}', updatedAt: '2026-09-01T00:00:00Z' },
];
const impact: OriginSaveImpact = { goods: { publicGoods: 12, policyFeeGoods: 7 }, regionalFee: { managed: true, inEffectCarrierCodes: ['hanjin'], scheduledCarrierCodes: [] } };
const conflictState = (): { conflict: FulfillmentOriginConflict } => ({ conflict: { updatedAt: '2026-09-03T00:00:00Z',
  values: { ...fulfillmentOriginFormValues(origin), baseFee: '5000', active: 'false' } } });
const plain = (html: string) => html.replaceAll('&#x27;', "'").replaceAll('&quot;', '"');

beforeEach(() => { hooks.indexed = false; hooks.index = 0; hooks.values = {}; hooks.setters = []; hooks.state = {}; hooks.pending = false; });

/** 마크업: 실제 훅으로 그린다. */
function markup(props: Partial<Parameters<typeof FulfillmentOriginForm>[0]> = {}) {
  return plain(renderToStaticMarkup(<FulfillmentOriginForm canEdit carriers={carriers} origin={origin} {...props} />));
}
/** 핸들러: 컴포넌트를 함수로 불러 `<form>`을 얻는다. 훅 순서는 저장 시각·버린 입력·고른 값이다. */
function formElement(values: Record<number, unknown> = {}, props: Partial<Parameters<typeof FulfillmentOriginForm>[0]> = {}) {
  hooks.indexed = true; hooks.index = 0; hooks.values = values; hooks.setters = [];
  try { return FulfillmentOriginForm({ canEdit: true, carriers, origin, impact, ...props }) as ReactElement<{ onSubmit?: (event: unknown) => void; children?: ReactNode }>; }
  finally { hooks.indexed = false; }
}
const draftOf = (patch: Record<string, string>) => ({ active: 'true', defaultCarrier: 'hanjin', baseFee: '4700', freeThreshold: '62000', exportTemplate: 'wms_csv', ...patch });
function findAll(node: ReactNode, test: (element: ReactElement<{ type?: string; onClick?: (event: unknown) => void; children?: ReactNode }>) => boolean): ReactElement<{ type?: string; onClick?: (event: unknown) => void; children?: ReactNode }>[] {
  if (Array.isArray(node)) return node.flatMap(child => findAll(child, test));
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as ReactElement<{ type?: string; onClick?: (event: unknown) => void; children?: ReactNode }>;
  return [...(test(element) ? [element] : []), ...findAll(element.props.children, test)];
}
const textOf = (node: ReactNode): string => Array.isArray(node) ? node.map(textOf).join('') : typeof node === 'string' || typeof node === 'number' ? String(node) : '';
const buttonNamed = (form: ReactElement, name: string) => findAll(form, element => element.props.type === 'button' && textOf(element.props.children).includes(name))[0];
async function submit(form: ReactElement<{ onSubmit?: (event: unknown) => void }>) {
  const target = { isConnected: true, requestSubmit: vi.fn() }, submitter = { name: 'submit' }, preventDefault = vi.fn();
  form.props.onSubmit?.({ currentTarget: target, preventDefault, nativeEvent: { submitter } });
  await new Promise(resolve => setTimeout(resolve, 0));
  return { target, submitter, preventDefault };
}

let confirm: ReturnType<typeof stubAdminConfirm> | null = null;
afterEach(() => { confirm?.restore(); confirm = null; });

describe('칸 이름과 안내', () => {
  it('사용 여부는 사용 / 사용 안 함이고, 비활성·새 주문 사용은 쓰지 않는다', () => {
    const html = markup();
    expect(html).toContain('사용 여부');
    expect(html).toMatch(/<option value="true" selected="">사용<\/option><option value="false">사용 안 함<\/option>/);
    expect(html).not.toMatch(/비활성|새 주문 사용|활성 출고지/);
  });
  it('출고지 코드는 상품 엑셀의 어느 열에 적는 값인지 말하고, 등록하면 바꿀 수 없다고 한 줄로 말한다', () => {
    const html = markup({ origin: undefined });
    expect(html).toContain("상품 엑셀의 '출고지 코드' 열에 적는 값입니다. 등록하면 바꿀 수 없습니다.");
    expect(html).toContain('placeholder="예: gimpo"');
    expect(html).not.toContain('출고지 코드는 등록 후 바꿀 수 없습니다');
    expect(html).not.toContain('readOnly');
    expect(markup()).toContain('readOnly=""');
  });
  it('사용으로 두면 기본 택배사는 필수이고, 사용 안 하는 택배사는 목록에서 뺀다(지금 저장된 값이면 남긴다)', () => {
    const html = markup();
    expect(html).toContain('기본 택배사 (필수)');
    expect(html).toContain('<option value="">고르지 않음</option>');
    expect(html).not.toContain('설정 전');
    expect(html).toContain('한진택배');
    expect(html).toContain('CJ대한통운');
    expect(html).not.toContain('옛 택배');
    const stored = markup({ origin: { ...origin, defaultCarrier: 'old' } });
    expect(stored).toContain('<option value="old" selected="">옛 택배 · 사용 안 함</option>');
    expect(stored).toContain('사용 안 함인 택배사는 고를 수 없습니다. 다른 택배사를 골라 주세요.');
  });
  it('사용으로 저장하려는데 택배사가 비었으면 그 칸 아래에서 바로 말한다', () => {
    const html = markup({ origin: { ...origin, defaultCarrier: null } });
    expect(html).toContain('사용으로 저장하려면 기본 택배사를 골라 주세요.');
    const inactive = markup({ origin: { ...origin, defaultCarrier: null, active: false } });
    expect(inactive).not.toContain('사용으로 저장하려면 기본 택배사를 골라 주세요.');
    expect(inactive).toContain('>기본 택배사<');
  });
  it('금액 아래에 고객이 내는 배송비를 한 줄로 되읽고, 긴 설명 힌트는 한 줄로 줄었다', () => {
    const html = markup();
    expect(html).toContain("'출고지 정책 따름' 상품은 주문마다 배송비 4,700원을 받고, 상품 금액이 62,000원 이상이면 무료입니다(쿠폰·적립금을 쓰기 전 금액).");
    expect(html).toContain('비우면 금액과 관계없이 배송비를 받습니다.');
    expect(html).not.toContain('기간 할인 후, 쿠폰·적립금 차감 전 정책 적용 상품 소계 기준입니다');
    expect(markup({ origin: { ...origin, freeThreshold: null } })).toContain("'출고지 정책 따름' 상품은 금액과 관계없이 주문마다 배송비 4,700원을 받습니다.");
  });
  it('사용 안 함인 출고지는 상품에서 고를 수 없다고 말하고, 사용 중인 출고지에는 그 안내가 없다', () => {
    expect(markup()).not.toContain('상품에서 이 출고지를 고를 수 없습니다');
    const html = markup({ origin: { ...origin, active: false } });
    expect(html).toContain('사용 안 함이라 상품에서 이 출고지를 고를 수 없습니다');
    expect(html).toContain("상품에 쓰려면 '사용'으로 바꾸고 기본 택배사를 골라 주세요.");
    expect(markup({ origin: undefined })).toContain('사용 안 함이라 상품에서 이 출고지를 고를 수 없습니다');
  });
  it('저장 결과를 한 줄로 보인다', () => {
    hooks.state = { message: "사용 안 함으로 저장했습니다. 상품에서 고르려면 '사용'으로 바꿔 주세요." };
    expect(markup()).toContain("사용 안 함으로 저장했습니다. 상품에서 고르려면 '사용'으로 바꿔 주세요.");
  });
});

describe('저장 전에 알리는 영향', () => {
  it('사용 중인 출고지를 사용 안 함으로 고르면 영향받는 공개 상품 수를 바로 보인다', () => {
    hooks.indexed = true; hooks.index = 0; hooks.values = { 2: draftOf({ active: 'false' }) };
    const element = FulfillmentOriginForm({ canEdit: true, carriers, origin, impact }) as ReactElement; hooks.indexed = false;
    const html = plain(renderToStaticMarkup(element));
    expect(html).toContain('저장하면 이 출고지는 새 주문을 받지 않습니다');
    expect(html).toContain('공개 상품 12개는 고객에게 계속 보이지만 새 주문은 받을 수 없습니다.');
  });
  it('지역별 추가배송비가 막는 택배사를 고르면 칸 아래에서 알리고 바꾸는 곳을 새 탭으로 연다', () => {
    hooks.indexed = true; hooks.index = 0; hooks.values = { 2: draftOf({ defaultCarrier: 'cj' }) };
    const element = FulfillmentOriginForm({ canEdit: true, carriers, origin, impact }) as ReactElement; hooks.indexed = false;
    const html = plain(renderToStaticMarkup(element));
    expect(html).toContain('바꾸면 이 출고지의 새 주문이 막힙니다');
    expect(html).toContain('지역별 추가배송비가 한진택배 기준으로 정해져 있어 CJ대한통운에는 적용되지 않습니다.');
    expect(html).toMatch(/<a [^>]*href="\/admin\/settings\/shipping-regions"[^>]*target="_blank"[^>]*>지역별 추가배송비 \(새 탭\)<\/a>/);
    /* 택배사가 그대로면 경고가 없다. */
    expect(markup({ impact })).not.toContain('새 주문이 막힙니다');
  });
});

describe('저장 전 확인창', () => {
  it('사용 안 함으로 바꾸는 저장은 대상·공개 상품 수·남는 제한을 보인 뒤에만 제출한다', async () => {
    confirm = stubAdminConfirm(true);
    const { target, submitter, preventDefault } = await submit(formElement({ 2: draftOf({ active: 'false' }) }));
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(confirm).toHaveBeenCalledOnce();
    expect(confirm.mock.calls[0][0]).toContain('사용 여부: 사용 → 사용 안 함');
    expect(confirm.mock.calls[0][0]).toContain('공개 상품 12개는 고객에게 계속 보이지만 새 주문은 받을 수 없습니다.');
    expect(confirm.mock.calls[0][0]).toContain('기존 창고 양식으로 운송장 회신을 올릴 수 없고');
    expect(target.requestSubmit).toHaveBeenCalledWith(submitter);
  });
  it('확인창에서 돌아가면 제출하지 않는다', async () => {
    confirm = stubAdminConfirm(false);
    const { target } = await submit(formElement({ 2: draftOf({ active: 'false' }) }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(target.requestSubmit).not.toHaveBeenCalled();
  });
  it('기본 배송비를 바꾸는 저장은 이전 값 → 새 값과 적용 범위를 보인다', async () => {
    confirm = stubAdminConfirm(true);
    await submit(formElement({ 2: draftOf({ baseFee: '5000' }) }));
    expect(confirm.mock.calls[0][0]).toBe("기본 배송비 4,700원 → 5,000원\n'출고지 정책 따름' 공개 상품 7개\n\n지금부터 새 주문에 적용됩니다. 이미 들어온 주문의 배송비는 그대로입니다.");
  });
  it('막히는 택배사로 바꾸는 저장은 무엇이 막히는지 보이고, 안 막히는 저장은 묻지 않는다', async () => {
    confirm = stubAdminConfirm(true);
    await submit(formElement({ 2: draftOf({ defaultCarrier: 'cj' }) }));
    expect(confirm.mock.calls[0][0]).toContain('기본 택배사: 한진택배 → CJ대한통운');
    confirm.mockClear();
    const { preventDefault, target } = await submit(formElement({}));
    expect(confirm).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
    expect(target.requestSubmit).not.toHaveBeenCalled();
  });
  it('새 출고지를 만드는 저장은 묻지 않는다', async () => {
    confirm = stubAdminConfirm(true);
    const { preventDefault } = await submit(formElement({ 2: draftOf({ active: 'true', baseFee: '3000' }) }, { origin: undefined, impact: undefined }));
    expect(confirm).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });
  it('다른 사람이 먼저 바꾼 뒤에는 그 사람이 저장한 값과 견준다 — 다시 사용으로 바꾸는 덮어쓰기는 묻지 않는다', async () => {
    hooks.state = conflictState();
    confirm = stubAdminConfirm(true);
    /* 저장돼 있는 값은 이미 사용 안 함이다. 내 입력(사용)으로 덮어써도 새 주문을 막지 않는다. */
    await submit(formElement({ 2: draftOf({ active: 'true' }) }));
    expect(confirm).not.toHaveBeenCalled();
    /* 내 입력이 사용 안 함이어도 저장돼 있는 값과 같으니 새 주문이 막히는 변화가 아니다. */
    await submit(formElement({ 2: draftOf({ active: 'false' }) }));
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe('다른 사람이 먼저 바꿨을 때 두 길', () => {
  it('다른 사람이 먼저 바꿨다는 말과 바뀐 항목, 두 길을 보이고 제출 버튼은 없다', () => {
    hooks.state = { ...conflictState(), errors: { form: '다른 사람이 먼저 바꿨습니다.' }, values: { ...fulfillmentOriginFormValues(origin), baseFee: '4200' }, attempt: 1 };
    const html = markup();
    expect(html).toContain('다른 사람이 먼저 바꿨습니다.');
    expect(html).toContain('바뀐 항목: 기본 배송비 · 사용 여부');
    expect(html).toContain('[내 입력으로 덮어쓰기]를 누르면 다른 사람이 저장한 내용이 사라지고 내 입력으로 바뀝니다.');
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>내 입력으로 덮어쓰기<\/button>/);
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>내 입력 버리기<\/button>/);
    expect(html).not.toMatch(/type="submit"/);
    expect(html).not.toContain('출고지 저장');
    /* 숨은 저장 시각은 지금 저장된 값이라, 덮어쓰면 그 위에 저장된다. */
    expect(html).toMatch(/<input type="hidden" name="updatedAt" value="2026-09-03T00:00:00Z"\/>/);
    /* 같은 말을 오류 상자로도 한 번 더 보이지 않는다. */
    expect(html.split('다른 사람이 먼저 바꿨습니다.')).toHaveLength(2);
  });
  it('지금 저장된 내용을 읽지 못했으면 새로고침해 확인하라고 말하고 저장 버튼은 그대로다', () => {
    hooks.state = { errors: { form: '다른 사람이 먼저 바꿨습니다. 적은 내용을 따로 복사해 둔 뒤 새로고침해 지금 저장된 내용을 확인해 주세요.' }, values: {}, attempt: 1 };
    const html = markup();
    expect(html).toContain('새로고침해 지금 저장된 내용을 확인해 주세요.');
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>(?:(?!<\/button>)[\s\S])*출고지 저장<\/button>/);
    expect(html).not.toContain('내 입력 버리기');
  });
  it('입력을 버리면 지금 저장된 값이 되고 정상 저장 버튼으로 돌아온다', () => {
    const state = conflictState();
    hooks.state = { ...state, errors: { form: '다른 사람이 먼저 바꿨습니다.' }, values: { ...fulfillmentOriginFormValues(origin), baseFee: '4200' }, attempt: 1 };
    hooks.indexed = true; hooks.index = 0; hooks.values = { 1: state.conflict, 2: draftOf({ baseFee: '5000', active: 'false' }) };
    const element = FulfillmentOriginForm({ canEdit: true, carriers, origin, impact }) as ReactElement; hooks.indexed = false;
    const html = plain(renderToStaticMarkup(element));
    expect(html).not.toContain('바뀐 항목');
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>(?:(?!<\/button>)[\s\S])*출고지 저장<\/button>/);
    expect(html).toContain('value="5000"');
  });
  it('[내 입력 버리기]는 확인한 뒤에만 입력을 버리고 지금 저장된 값을 불러온다', async () => {
    const state = conflictState();
    hooks.state = { ...state, attempt: 1 };
    confirm = stubAdminConfirm(false);
    let form = formElement({ 2: draftOf({ baseFee: '4200' }) });
    buttonNamed(form, '내 입력 버리기').props.onClick?.({});
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(confirm.mock.calls[0][0]).toBe('지금 적은 내용이 사라지고, 다른 사람이 저장한 내용이 그대로 남습니다.');
    expect(hooks.setters[1]).not.toHaveBeenCalled();
    confirm.restore(); confirm = stubAdminConfirm(true);
    form = formElement({ 2: draftOf({ baseFee: '4200' }) });
    buttonNamed(form, '내 입력 버리기').props.onClick?.({});
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(hooks.setters[1]).toHaveBeenCalledWith(state.conflict);
    expect(hooks.setters[2]).toHaveBeenCalledWith({ active: 'false', defaultCarrier: 'hanjin', baseFee: '5000', freeThreshold: '62000', exportTemplate: 'wms_csv' });
  });
  it('[내 입력으로 덮어쓰기]는 폼을 다시 제출한다(입력칸에서 Enter를 눌러도 덮어쓰지 않는다)', () => {
    hooks.state = { ...conflictState(), attempt: 1 };
    const form = formElement({ 2: draftOf({}) });
    const requestSubmit = vi.fn();
    buttonNamed(form, '내 입력으로 덮어쓰기').props.onClick?.({ currentTarget: { form: { requestSubmit } } });
    expect(requestSubmit).toHaveBeenCalledOnce();
    expect(findAll(form, element => element.props.type === 'submit')).toHaveLength(0);
  });
});
