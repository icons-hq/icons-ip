import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { stubAdminConfirm } from '@/lib/admin/confirm.test-support';
import { emptyGoodWorkspaceProduction } from '@/lib/admin/good-workspace-extra-sections';
import { EMPTY_GOOD_WORKSPACE_SECTIONS, type GoodWorkspaceSectionsDraft } from '@/lib/admin/good-workspace-sections';
import { goodsOptionRowKey, type GoodsOptionRow } from '@/lib/admin/goods-option-editor';
import { emptyPreorderPlan, type PreorderPlan } from '@/lib/admin/goods-preorders';

/*
 * 판매 시기(화면 규칙 5, 2026-11-25): 판매기간과 예약판매는 함께 쓸 수 없어 DB가 양방향으로 거절한다. 둘을 나란히 열어 두고 저장할 때
 * 오류로 알리던 화면을, 셋 중 하나를 고르고 고른 것의 입력만 여는 선택으로 바꿨다. 정적 렌더에서는 provider 상태를 직접 넣는다.
 */
const workspace = vi.hoisted(() => ({ sections: null as unknown }));
const rows: GoodsOptionRow[] = [
  { name: '빨강', code: '', attributes: { 색상: '빨강' }, extraPrice: 0, stockQty: 500 },
  { name: '파랑', code: '', attributes: { 색상: '파랑' }, extraPrice: 0, stockQty: 300 },
];
vi.mock('./GoodWorkspace', async () => {
  const actual = await vi.importActual<typeof import('./GoodWorkspace')>('./GoodWorkspace');
  return { ...actual, useGoodWorkspaceSections: () => ({
    sections: workspace.sections, setSections: vi.fn(), optionRows: rows, publishOptionRows: vi.fn(), sectionErrors: {}, setSectionErrors: vi.fn(),
    operationId: () => 'op', readKcPanelStash: () => null, rememberKcPanel: vi.fn(), readPanelStash: () => undefined, rememberPanel: vi.fn(),
  }) };
});
vi.mock('@/app/admin/goods-kc-actions', () => ({ readGoodsKcAction: vi.fn(), saveGoodsKcAction: vi.fn(),
  readGoodsOtherCertificationsAction: vi.fn(), saveGoodsOtherCertificationsAction: vi.fn() }));
const { GOOD_SALE_TIMING_CHOICES, GoodSaleTiming, chooseGoodSaleTiming, goodSaleTimingCardStates, saleTimingDiscardConfirm } = await import('./GoodSaleTiming');
const { GoodSavedPreorderSection, GoodWorkspacePreorderRow } = await import('./GoodWorkspaceSections');

const period = { saleStartsAt: '2099-12-01T10:00', saleEndsAt: '2099-12-07T23:59', salePeriodRevision: '3' };
function render(values: Record<string, string>, { sections = EMPTY_GOOD_WORKSPACE_SECTIONS, slot = <GoodWorkspacePreorderRow title="예약판매" /> as React.ReactNode, error }: {
  sections?: GoodWorkspaceSectionsDraft; slot?: React.ReactNode; error?: string } = {}) {
  workspace.sections = sections;
  return renderToStaticMarkup(<GoodSaleTiming values={values} error={error} errorCount={0} onChange={() => {}} preorderSlot={slot} />);
}
const radio = (html: string, value: string) => html.match(new RegExp(`<input type="radio"[^>]*value="${value}"[^>]*>`))?.[0] ?? '';
const named = (html: string, name: string) => [...html.matchAll(new RegExp(`<input[^>]*name="${name}"[^>]*>`, 'g'))].map((match) => match[0]);

describe('판매 시기 — 바로 판매 · 기간을 정해 판매 · 예약판매 가운데 하나', () => {
  it('카드 세 장이 이름과 한 줄 설명으로 스스로 말하고, 고르지 않은 쪽의 입력과 설명 문단은 보이지 않는다', () => {
    const html = render({ salePeriodEnabled: 'false', salePeriodRevision: '0' });
    expect(html).toMatch(/<section aria-labelledby="good-section-period-title"[^>]*id="good-section-period"/);
    expect(html).toContain('id="good-section-period-title">판매 시기</h2>');
    expect(GOOD_SALE_TIMING_CHOICES.map(([value, title]) => [value, title])).toEqual([['now', '바로 판매'], ['period', '기간을 정해 판매'], ['preorder', '예약판매']]);
    for (const [, title, description] of GOOD_SALE_TIMING_CHOICES) { expect(html).toContain(title); expect(html).toContain(description); }
    expect(html.match(/data-good-choice-card=""/g)).toHaveLength(3);
    expect(radio(html, 'now')).toContain('checked=""');
    expect(radio(html, 'period')).not.toContain('checked=""');
    expect(radio(html, 'preorder')).not.toContain('checked=""');
    for (const gone of ['type="datetime-local"', '판매기간 설정', '설정함', '설정안함', '할인 기간과 별개', '함께 설정할 수 없습니다', 'data-good-workspace-preorders', 'data-good-readback']) expect(html).not.toContain(gone);
    /* 설명 문단(회색 글)은 카드의 한 줄 설명뿐이다. "?" 도움말은 제목에 하나만 단다. */
    expect(html).not.toMatch(/<p class="text-sm text-muted-foreground">/);
    expect(html.match(/data-admin-help=""/g)).toHaveLength(1);
    expect(html).toContain('aria-label="판매 시기 도움말"');
  });

  it('상품 폼의 판매기간 칸 이름은 그대로 하나씩 제출하고, 판매 시기 라디오는 폼에 섞이지 않는다', () => {
    for (const values of [{ salePeriodEnabled: 'false', ...period }, { salePeriodEnabled: 'true', ...period }]) {
      const html = render(values);
      for (const name of ['salePeriodEnabled', 'saleStartsAt', 'saleEndsAt', 'salePeriodRevision']) expect(named(html, name)).toHaveLength(1);
      expect(named(html, 'salePeriodEnabled')[0]).toContain(`type="hidden" name="salePeriodEnabled" value="${values.salePeriodEnabled}"`);
      expect(named(html, 'salePeriodRevision')[0]).toContain('value="3"');
      expect(named(html, 'saleStartsAt')[0]).toContain('value="2099-12-01T10:00"');
      expect(html.match(/<input type="radio"[^>]*>/g)?.every((input) => input.includes('form="good-detached-controls"') && input.includes('name="saleTimingChoice"'))).toBe(true);
    }
    /* 바로 판매·예약판매는 판매기간을 끈 채 제출한다. 넣어 둔 기간은 숨은 칸에 남아 다시 고르면 되살아난다. */
    const preorder = render({ salePeriodEnabled: 'false', ...period }, { sections: { ...EMPTY_GOOD_WORKSPACE_SECTIONS, preorderPlan: emptyPreorderPlan() } });
    expect(named(preorder, 'salePeriodEnabled')[0]).toContain('value="false"');
    expect(named(preorder, 'saleStartsAt')[0]).toContain('type="hidden"');
  });

  it('기간을 정해 판매를 고르면 판매 시작·종료 (KST)와 빠른 선택이 열리고, 입력을 한 줄로 되읽는다', () => {
    const html = render({ salePeriodEnabled: 'true', ...period });
    expect(radio(html, 'period')).toContain('checked=""');
    expect(html).toContain('>판매 시작 (KST)<');
    expect(html).toContain('>판매 종료 (KST)<');
    expect(named(html, 'saleStartsAt')[0]).toContain('type="datetime-local"');
    expect(named(html, 'saleEndsAt')[0]).toContain('required=""');
    expect(html).toContain('aria-label="판매기간 빠른 선택"');
    expect(html).toMatch(/data-good-readback=""[^>]*>2099년 12월 1일 10:00부터 7일 23:59까지 팝니다\.</);
    expect(html).not.toContain('data-good-workspace-preorders');
    /* 종료가 시작보다 앞이면 저장을 누르기 전에 그 자리에서 말한다. */
    expect(render({ salePeriodEnabled: 'true', ...period, saleEndsAt: '2099-11-30T00:00' })).toContain('판매 종료가 판매 시작보다 앞입니다. 날짜를 다시 확인해주세요.');
  });

  it('등록 화면에서 예약판매를 고르면 같은 자리에 예약 입력만 열린다', () => {
    const html = render({ salePeriodEnabled: 'false', salePeriodRevision: '0' }, { sections: { ...EMPTY_GOOD_WORKSPACE_SECTIONS, preorderPlan: emptyPreorderPlan() } });
    expect(radio(html, 'preorder')).toContain('checked=""');
    expect(html).toContain('data-good-workspace-preorders=""');
    expect(html).toMatch(/data-good-preorder-slot=""><section aria-labelledby="good-operation-preorders-title"[^>]*id="good-operation-preorders"/);
    expect(html.indexOf('id="good-section-period"')).toBeLessThan(html.indexOf('id="good-operation-preorders"'));
    expect(html).not.toContain('>판매 시작 (KST)<');
    /* 고르지 않았을 때도 같은 id의 자리는 남는다(오류 포커스·'예약판매로 이동' 링크). */
    expect(render({ salePeriodEnabled: 'false' })).toMatch(/<section[^>]*id="good-operation-preorders"[^>]*><\/section>/);
  });

  it('판매기간 오류는 기간을 고르지 않았어도 같은 자리에서 보인다', () => {
    expect(render({ salePeriodEnabled: 'false' }, { error: '기간 오류' })).toMatch(/role="alert">기간 오류</);
    expect(render({ salePeriodEnabled: 'true', ...period }, { error: '기간 오류' })).toContain('기간 오류');
  });

  it('저장된 상품은 예약 조건을 읽기 전에는 어느 쪽인지 알 수 없어 고르지 못하게 잠근다', () => {
    const saved = <GoodSavedPreorderSection title="예약판매"><i>예약 조건을 불러오는 중입니다…</i></GoodSavedPreorderSection>;
    const html = render({ salePeriodEnabled: 'false' }, { slot: saved });
    expect(html).toContain('data-good-sale-timing="unknown"');
    for (const value of ['now', 'period', 'preorder']) { expect(radio(html, value)).toContain('disabled=""'); expect(radio(html, value)).not.toContain('checked=""'); }
    /* 패널은 고르지 않았을 때도 마운트돼 있어 불러온 상태를 알린다. 제목('별도 저장')은 예약판매를 골랐을 때만 붙는다. */
    expect(html).toContain('<i>예약 조건을 불러오는 중입니다…</i>');
    expect(html).not.toContain('good-operation-preorders-title');
    /* 판매기간이 저장돼 있으면 예약 연결이 없다는 뜻이라 읽기 전에도 기간을 보인다. */
    const withPeriod = render({ salePeriodEnabled: 'true', ...period }, { slot: saved });
    expect(radio(withPeriod, 'period')).toContain('checked=""');
    expect(withPeriod).toContain('>판매 시작 (KST)<');
    /* 보관한 상품은 예약판매 자리가 없다. */
    const archived = render({ salePeriodEnabled: 'false' }, { slot: null });
    expect(radio(archived, 'preorder')).toContain('disabled=""');
    expect(archived).toContain('보관한 상품은 예약판매를 바꿀 수 없습니다.');
    expect(archived).not.toContain('data-good-preorder-slot');
  });
});

describe('판매 시기 — 고를 수 없는 카드는 이유와 푸는 방법을 적는다', () => {
  const card = (states: ReturnType<typeof goodSaleTimingCardStates>, value: string) => states.cards.find((item) => item.value === value)!;
  it('저장된 상품에 예약을 건 옵션이 남아 있으면 바로 판매·기간을 정해 판매를 막고 [일반 재고 판매로 전환]을 가리킨다', () => {
    const linked = goodSaleTimingCardStates({ mode: 'preorder', kind: 'saved', saved: { state: 'ready', linked: 2, stockSwitchLabel: '일반 재고 판매로 전환' } });
    expect(linked.locked).toBe(false);
    for (const value of ['now', 'period']) {
      expect(card(linked, value)).toMatchObject({ disabled: true, checked: false });
      expect(card(linked, value).blockedReason).toBe('예약판매가 걸린 옵션이 있어 고를 수 없습니다. 아래 예약 조건에서 [일반 재고 판매로 전환]을 누르면 고를 수 있습니다.');
    }
    expect(card(linked, 'preorder')).toMatchObject({ disabled: false, checked: true, blockedReason: undefined });
    /* 랜덤 판매는 모든 옵션 묶음 버튼 이름을 든다. */
    expect(card(goodSaleTimingCardStates({ mode: 'preorder', kind: 'saved', saved: { state: 'ready', linked: 3, stockSwitchLabel: '모든 옵션 일반 재고 판매로 전환' } }), 'period').blockedReason)
      .toContain('[모든 옵션 일반 재고 판매로 전환]');
    /* 예약 연결이 없으면 셋 다 고를 수 있다. */
    const free = goodSaleTimingCardStates({ mode: 'now', kind: 'saved', saved: { state: 'ready', linked: 0, stockSwitchLabel: '일반 재고 판매로 전환' } });
    expect(free.cards.map((item) => item.disabled)).toEqual([false, false, false]);
  });
  it('예약 조건을 불러오는 중이거나 불러오지 못했으면 모두 잠근다', () => {
    for (const saved of [null, { state: 'loading' as const, linked: 0, stockSwitchLabel: '' }, { state: 'error' as const, linked: 0, stockSwitchLabel: '' }]) {
      const states = goodSaleTimingCardStates({ mode: null, kind: 'saved', saved });
      expect(states.locked).toBe(true);
      expect(states.cards.every((item) => item.disabled && !item.checked)).toBe(true);
    }
  });
  it("등록 화면에서 '주문 후 제작'을 켰으면 예약판매를 막고 끄는 곳을 알린다", () => {
    const production = { ...EMPTY_GOOD_WORKSPACE_SECTIONS, extras: { production: { ...emptyGoodWorkspaceProduction(), enabled: true } } };
    const states = goodSaleTimingCardStates({ mode: 'now', kind: 'draft', sections: production });
    expect(card(states, 'preorder')).toMatchObject({ disabled: true });
    expect(card(states, 'preorder').blockedReason).toContain("아래 '주문 후 제작'의 체크를 끄면 고를 수 있습니다.");
    expect(card(states, 'period').disabled).toBe(false);
    expect(goodSaleTimingCardStates({ mode: 'now', kind: 'draft', sections: EMPTY_GOOD_WORKSPACE_SECTIONS }).cards.every((item) => !item.disabled)).toBe(true);
    const html = render({ salePeriodEnabled: 'false' }, { sections: production });
    expect(html).toMatch(/data-good-choice-blocked="">&#x27;주문 후 제작&#x27;을 쓰는 상품은 예약판매를 함께 쓸 수 없습니다\./);
    expect(html.match(/<input type="radio"[^>]*value="preorder"[^>]*>/)?.[0]).toContain('disabled=""');
  });
});

/* 규칙 7: 내용을 지우는 동작은 누르기 전에 무엇이 사라지는지 말한다. */
describe('판매 시기 전환', () => {
  let confirm: ReturnType<typeof stubAdminConfirm> | undefined;
  afterEach(() => { confirm?.restore(); confirm = undefined; });
  const red = goodsOptionRowKey(rows[0]);
  const typed: PreorderPlan = { ...emptyPreorderPlan(), startsAt: '2099-12-01T10:00', options: { [red]: { capacityQty: '120' } } };
  function setup(sections: GoodWorkspaceSectionsDraft) {
    let current = sections;
    const setSections = vi.fn((update: GoodWorkspaceSectionsDraft | ((value: GoodWorkspaceSectionsDraft) => GoodWorkspaceSectionsDraft)) => { current = typeof update === 'function' ? update(current) : update; });
    const onChange = vi.fn();
    return { setSections, onChange, read: () => current };
  }

  it('등록 화면에서 예약판매를 그만두면 입력한 예약 조건 수를 보여 주고 묻고, 취소하면 아무것도 바꾸지 않는다', async () => {
    const sections = { ...EMPTY_GOOD_WORKSPACE_SECTIONS, preorderPlan: typed };
    confirm = stubAdminConfirm(false);
    const declined = setup(sections);
    expect(await chooseGoodSaleTiming('period', { mode: 'preorder', kind: 'draft', sections, optionRows: rows, ...declined })).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toBe('입력한 예약 조건 2개가 사라집니다.');
    expect(saleTimingDiscardConfirm(1200).message).toBe('입력한 예약 조건 1,200개가 사라집니다.');
    expect(declined.setSections).not.toHaveBeenCalled();
    expect(declined.onChange).not.toHaveBeenCalled();
    confirm.restore();
    confirm = stubAdminConfirm(true);
    const accepted = setup(sections);
    expect(await chooseGoodSaleTiming('period', { mode: 'preorder', kind: 'draft', sections, optionRows: rows, ...accepted })).toBe(true);
    expect(accepted.read()).not.toHaveProperty('preorderPlan');
    expect(accepted.read().preorders).toEqual([]);
    expect(accepted.onChange).toHaveBeenCalledWith({ salePeriodEnabled: 'true' });
  });

  it('다시 넣을 값이 없으면 묻지 않고 바꾼다', async () => {
    confirm = stubAdminConfirm(false);
    const sections = { ...EMPTY_GOOD_WORKSPACE_SECTIONS, preorderPlan: emptyPreorderPlan() };
    const state = setup(sections);
    expect(await chooseGoodSaleTiming('now', { mode: 'preorder', kind: 'draft', sections, optionRows: rows, ...state })).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(state.read()).not.toHaveProperty('preorderPlan');
    expect(state.onChange).toHaveBeenCalledWith({ salePeriodEnabled: 'false' });
  });

  it('예약판매를 고르면 판매기간을 끄고 예약 입력을 연다 — 모든 사용 중 옵션이 재고수량을 물량으로 들어간다', async () => {
    confirm = stubAdminConfirm(false);
    const state = setup(EMPTY_GOOD_WORKSPACE_SECTIONS);
    expect(await chooseGoodSaleTiming('preorder', { mode: 'period', kind: 'draft', sections: EMPTY_GOOD_WORKSPACE_SECTIONS, optionRows: rows, ...state })).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(state.read().preorderPlan).toEqual(emptyPreorderPlan());
    expect(state.read().preorders.map((entry) => entry.optionKey)).toEqual(rows.map(goodsOptionRowKey));
    expect(state.onChange).toHaveBeenCalledWith({ salePeriodEnabled: 'false' });
    /* 같은 것을 다시 고르면 아무 일도 없다. */
    const same = setup(EMPTY_GOOD_WORKSPACE_SECTIONS);
    expect(await chooseGoodSaleTiming('now', { mode: 'now', kind: 'draft', sections: EMPTY_GOOD_WORKSPACE_SECTIONS, optionRows: rows, ...same })).toBe(false);
    expect(same.onChange).not.toHaveBeenCalled();
  });

  it('저장된 상품은 고른 예약판매를 패널 쪽에 남기고(입력은 버리지 않는다) 판매기간 값만 폼에 싣는다', async () => {
    confirm = stubAdminConfirm(false);
    const setWanted = vi.fn(), onChange = vi.fn();
    expect(await chooseGoodSaleTiming('preorder', { mode: 'period', kind: 'saved', saved: { setWanted }, onChange })).toBe(true);
    expect(setWanted).toHaveBeenLastCalledWith(true);
    expect(onChange).toHaveBeenLastCalledWith({ salePeriodEnabled: 'false' });
    expect(await chooseGoodSaleTiming('period', { mode: 'preorder', kind: 'saved', saved: { setWanted }, onChange })).toBe(true);
    expect(setWanted).toHaveBeenLastCalledWith(false);
    expect(onChange).toHaveBeenLastCalledWith({ salePeriodEnabled: 'true' });
    expect(confirm).not.toHaveBeenCalled();
  });
});
