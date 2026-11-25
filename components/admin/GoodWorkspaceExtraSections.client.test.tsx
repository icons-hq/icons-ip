import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * 등록 화면 '상품과 함께 저장할 설정' 섹션 가운데 이 파일에 문구·입력이 직접 적힌 것들(2026-11-25 상품등록 UX 개선).
 * 얕은 렌더로 섹션을 함수처럼 불러 요소 트리를 걷는다 — 워크스페이스 상태와 로그인 세션만 가짜로 둔다.
 */
const hooks = vi.hoisted(() => ({ ids: 0 }));
const mocks = vi.hoisted(() => ({
  workspace: null as unknown, session: { identity: null, blocked: false } as { identity: unknown; blocked: boolean },
}));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useCallback: (callback: unknown) => callback,
  useRef: (initial: unknown) => ({ current: initial }),
  useId: () => `sale-mode-${hooks.ids}`,
  /* 상태를 오래 들고 있어야 하는 검사는 없다 — 처음 값만 준다. */
  useState: (initial: unknown) => [typeof initial === 'function' ? (initial as () => unknown)() : initial, () => undefined],
}));
vi.mock('./GoodWorkspace', async (original) => ({ ...await original<typeof import('./GoodWorkspace')>(), useGoodWorkspaceSections: () => mocks.workspace }));
vi.mock('./shipping-charge-groups/useShippingChargeGroupOperation', () => ({ useShippingChargeGroupSession: () => mocks.session }));
vi.mock('@/app/admin/goods-additional-actions', () => ({ checkGoodsAdditionalCandidateAction: vi.fn(), readGoodsAdditionalAction: vi.fn(), saveGoodsAdditionalAction: vi.fn() }));
vi.mock('@/app/admin/goods-option-import-actions', () => ({ searchGoodsOptionImportAction: vi.fn() }));
vi.mock('@/app/admin/shipping-charge-group-actions', () => ({ getShippingChargeGroupAction: vi.fn(), listShippingChargeGroupsAction: vi.fn() }));

import { GOOD_PICKERS_B_HELP } from '@/lib/admin/help/good-pickers-b';
import type { AdminAdditionalGood } from '@/lib/admin/goods-additional';
import { emptyGoodWorkspaceTerms, type GoodWorkspaceExtraDraft } from '@/lib/admin/good-workspace-extra-sections';
import { Label } from '@/components/admin/kit/ui/label';
import { AdminHelpTip, AdminLabelWithHelp } from './console/AdminHelpTip';
import { GoodChoiceCard, GoodChoiceCards } from './GoodEditorParts';
import { GOODS_ADDITIONAL_INTRO, GoodsAdditionalLinks } from './GoodsAdditionalLinks';
import { GoodsAfterSalesFields } from './GoodsAfterSalesFields';
import { GoodsListingColorFields } from './GoodsListingColorsPanel';
import { GoodsSubscriptionPolicyFields } from './GoodsSubscriptionPolicyPanel';
import { GoodsDeliveryPricingFields, GoodsDeliveryRuleFields, GoodsVolumeDiscountFields } from './GoodsTransactionTermsPanel';
import { ShippingChargeGroupField } from './ShippingChargeGroupField';
import {
  GoodWorkspaceAdditionalSection, GoodWorkspaceAfterSalesSection, GoodWorkspaceBenefitsSection, GoodWorkspaceListingColorsSection, GoodWorkspacePricePeriodsSection, GoodWorkspacePurchaseCostsSection,
  GoodWorkspaceFulfillmentSection, GoodWorkspaceProductionSection, GoodWorkspaceSaleModeSection, GoodWorkspaceShippingChargeGroupSection, GoodWorkspaceSizeChartSection,
  GoodWorkspaceSubscriptionSection, GoodWorkspaceTransactionTermsSection,
} from './GoodWorkspaceExtraSections';

type Element = ReactElement<Record<string, unknown>>;
const nodes = (node: ReactNode): Element[] => Children.toArray(node).flatMap(value => isValidElement<Record<string, unknown>>(value) ? [value, ...nodes(value.props.children as ReactNode)] : []);
const text = (node: ReactNode): string => Children.toArray(node).map(value => isValidElement<Record<string, unknown>>(value) ? text(value.props.children as ReactNode) : String(value)).join('');

type Workspace = { sections: { extras: Partial<GoodWorkspaceExtraDraft> }; setSections: (update: (current: { extras: Partial<GoodWorkspaceExtraDraft> }) => { extras: Partial<GoodWorkspaceExtraDraft> }) => void;
  sectionErrors: Record<string, string>; optionRows: unknown[]; originId: string };
let workspace: Workspace;
beforeEach(() => {
  workspace = { sections: { extras: {} }, setSections: (update) => { workspace.sections = update(workspace.sections); }, sectionErrors: {}, optionRows: [], originId: '' };
  mocks.workspace = workspace; mocks.session = { identity: null, blocked: false };
});
/** 같은 workspace 객체를 계속 쓴다(setSections가 sections만 바꾼다). */
const extras = () => workspace.sections.extras;

describe('추가 구성 상품 섹션', () => {
  const linked: AdminAdditionalGood = { goodId: 'hw-a', name: '키링', available: true, code: 'HW-0001', imageUrl: null };
  it('옛 인라인 검색 대신 공용 선택창을 여는 연결 목록을 쓰고 안내는 한 줄이다', () => {
    workspace.sections = { extras: { additional: [linked] } };
    const tree = GoodWorkspaceAdditionalSection({});
    const all = nodes(tree);
    const links = all.find(node => node.type === GoodsAdditionalLinks)!;
    expect(links.props).toMatchObject({ baseGoodId: null, items: [linked] });
    expect(all.some(node => node.type === 'form' || node.type === 'input')).toBe(false);
    expect(text(tree)).toBe(GOODS_ADDITIONAL_INTRO);
  });
  it('연결 목록의 변경은 등록 화면의 추가 구성 입력으로 들어간다', () => {
    const links = nodes(GoodWorkspaceAdditionalSection({})).find(node => node.type === GoodsAdditionalLinks)!;
    (links.props.onChange as (update: (current: AdminAdditionalGood[]) => AdminAdditionalGood[]) => void)(current => [...current, linked]);
    expect(extras().additional).toEqual([linked]);
  });
  it('저장 오류는 섹션 맨 아래에 알린다', () => {
    workspace.sectionErrors = { workspaceAdditional: '추가 구성 상품은 서로 다른 상품 50개까지 연결할 수 있습니다.' };
    /* 오류 줄은 SectionError(함수 부품)라 얕은 렌더에서는 message prop으로 보인다. */
    expect(nodes(GoodWorkspaceAdditionalSection({})).some(node => node.props.message === '추가 구성 상품은 서로 다른 상품 50개까지 연결할 수 있습니다.')).toBe(true);
  });
});

describe('판매 방식 섹션', () => {
  it('긴 설명 문단 대신 선택지마다 이름과 한 줄 설명을 카드로 보인다', () => {
    const tree = GoodWorkspaceSaleModeSection({});
    const cards = nodes(tree).filter(node => node.type === GoodChoiceCard);
    expect(nodes(tree).some(node => node.type === GoodChoiceCards)).toBe(true);
    expect(cards.map(card => [card.props.title, card.props.checked])).toEqual([['옵션 선택 판매', true], ['랜덤 판매', false]]);
    expect(cards[0].props.description).toBe('고객이 옵션을 직접 고릅니다.');
    expect(cards[1].props.description).toBe('고객은 옵션을 고르지 않고, 주문할 때 남은 재고에 비례해 옵션이 무작위로 정해집니다.');
    expect(nodes(tree).some(node => node.type === 'p')).toBe(false);
  });
  it('랜덤 판매를 고르면 지켜야 할 조건을 한 줄로 알리고 두 카드는 같은 묶음이다', () => {
    const cards = () => nodes(GoodWorkspaceSaleModeSection({})).filter(node => node.type === GoodChoiceCard);
    expect(cards()[0].props.name).toBe(cards()[1].props.name);
    (cards()[1].props.onChange as () => void)();
    expect(extras().optionSaleMode).toBe('random');
    const tree = GoodWorkspaceSaleModeSection({});
    expect(nodes(tree).filter(node => node.type === GoodChoiceCard).map(card => card.props.checked)).toEqual([false, true]);
    expect(text(tree)).toContain('주문 상세와 출고 파일에는 정해진 옵션이 보이고, 고객 화면에는 ‘랜덤’으로만 보입니다. 판매 중인 옵션이 2개 이상이고 판매가가 모두 같아야 하며, 정기배송과는 함께 쓸 수 없습니다.');
    (nodes(tree).filter(node => node.type === GoodChoiceCard)[0].props.onChange as () => void)();
    expect(extras().optionSaleMode).toBe('select');
  });
});

describe('공급가 섹션', () => {
  const rows = [{ name: '빨강', attributes: { 색상: '빨강' }, isActive: true }, { name: '파랑', attributes: { 색상: '파랑' }, isActive: false }];
  it('안내는 두 문장 이내로 줄이고 세금 처리 "?"는 첫 줄에만 단다', () => {
    workspace.optionRows = rows;
    const tree = GoodWorkspacePurchaseCostsSection({});
    expect(text(nodes(tree).find(node => node.type === 'p')!.props.children as ReactNode)).toBe('공급처에서 사 오는 옵션 1개의 값입니다. 금액과 세금 처리는 함께 넣거나 함께 비웁니다. 0원도 넣을 수 있습니다.');
    const labels = nodes(tree).filter(node => node.type === AdminLabelWithHelp);
    expect(labels.map(node => node.props.help)).toEqual([GOOD_PICKERS_B_HELP.purchaseTaxBasis, undefined]);
    expect(labels.map(node => node.props.label)).toEqual(['세금 처리', '세금 처리']);
  });
  it('저장된 상품 패널과 같은 이름·선택지(세금 처리: 선택 안 함·세금 포함·세금 별도·면세)를 쓰고 옛 이름 세금 구분은 없다', () => {
    workspace.optionRows = rows;
    const tree = GoodWorkspacePurchaseCostsSection({});
    const all = nodes(tree);
    const options = all.filter(node => node.type === 'option').map(node => text(node.props.children as ReactNode));
    expect(options).toEqual(['선택 안 함', '세금 포함', '세금 별도', '면세', '선택 안 함', '세금 포함', '세금 별도', '면세']);
    expect(all.filter(node => node.type === 'label').map(node => text(node.props.children as ReactNode))).toContain('세금 처리');
    expect(all.map(node => node.props['aria-label']).filter(Boolean)).toContain('빨강 공급가(매입단가) 세금 처리');
    expect(JSON.stringify(tree)).not.toContain('세금 구분');
  });
  it('세금 처리 도움말은 세 가지 뜻과 금액과 함께 고르는 조건을 말한다', () => {
    expect(GOOD_PICKERS_B_HELP.purchaseTaxBasis.what).toContain('세금 포함');
    expect(GOOD_PICKERS_B_HELP.purchaseTaxBasis.what).toContain('세금 별도');
    expect(GOOD_PICKERS_B_HELP.purchaseTaxBasis.what).toContain('면세');
    expect(GOOD_PICKERS_B_HELP.purchaseTaxBasis.when).toContain('금액을 넣을 때 함께 고릅니다');
  });
  it('금액과 세금 처리 입력은 옵션별로 저장 입력(extras.purchaseCosts)에 들어간다', () => {
    workspace.optionRows = rows;
    const tree = GoodWorkspacePurchaseCostsSection({});
    const input = nodes(tree).find(node => node.type === 'input' && node.props['aria-label'] === '빨강 공급가(매입단가)')!;
    (input.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: '1200' } });
    expect(extras().purchaseCosts).toEqual([{ optionKey: 'new:[["색상","빨강"]]', unitCostKrw: '1200', taxBasis: '' }]);
  });
});

describe('배송비 묶음그룹 섹션', () => {
  const session = { identity: { expectedActorId: 'actor', expectedSessionId: 'session' }, blocked: false };
  const group = { id: '00000000-0000-4000-8000-000000000001', originId: '00000000-0000-4000-8000-0000000000aa', revision: 3, name: '묶음 A' };
  it('긴 안내 문단 없이 선택 필드만 보이고(고른 그룹의 뜻은 필드의 요약이, "?"는 섹션 제목이 맡는다) 같은 "?"를 또 달지 않는다', () => {
    mocks.session = session; workspace.originId = group.originId;
    const tree = GoodWorkspaceShippingChargeGroupSection({ accountId: 'actor' });
    const field = nodes(tree).find(node => node.type === ShippingChargeGroupField)!;
    expect(field.props).toMatchObject({ originId: group.originId, value: null, selectedGroup: null });
    expect(field.props.help).toBeUndefined();
    expect(nodes(tree).some(node => node.type === 'p' || node.type === AdminHelpTip)).toBe(false);
  });
  it('고르면 그룹 번호·출고지·고를 때 본 설정과 요약용 값을 넣고, 해제하면 비운다', () => {
    mocks.session = session; workspace.originId = group.originId;
    const onChange = () => nodes(GoodWorkspaceShippingChargeGroupSection({ accountId: 'actor' })).find(node => node.type === ShippingChargeGroupField)!.props.onChange as (id: string | null, group: unknown) => void;
    onChange()(group.id, group);
    expect(extras().shippingChargeGroup).toEqual({ id: group.id, revision: 3, originId: group.originId, display: group });
    const field = nodes(GoodWorkspaceShippingChargeGroupSection({ accountId: 'actor' })).find(node => node.type === ShippingChargeGroupField)!;
    expect(field.props).toMatchObject({ value: group.id, selectedGroup: group });
    onChange()(null, null);
    expect(extras().shippingChargeGroup).toBeNull();
  });
  it('출고지와 그룹이 다르다는 경고는 필드가 한 번만 보인다(섹션에 같은 경고를 또 두지 않는다)', () => {
    mocks.session = session; workspace.originId = 'other-origin'; workspace.sections = { extras: { shippingChargeGroup: { id: group.id, revision: 3, originId: group.originId, display: group } } };
    const tree = GoodWorkspaceShippingChargeGroupSection({ accountId: 'actor' });
    expect(nodes(tree).some(node => node.props.role === 'status' || node.props.role === 'alert')).toBe(false);
  });
  it('로그인을 확인하는 동안과 계정이 바뀐 뒤에는 필드 대신 이유를 보인다', () => {
    expect(text(GoodWorkspaceShippingChargeGroupSection({ accountId: 'actor' }))).toBe('현재 로그인 상태를 확인하고 있습니다.');
    mocks.session = { identity: null, blocked: true };
    const shown = GoodWorkspaceShippingChargeGroupSection({ accountId: 'actor' });
    expect(text(shown)).toContain('로그인한 계정이 바뀌었거나 다시 로그인했습니다.');
    expect(nodes(shown).some(node => node.type === ShippingChargeGroupField)).toBe(false);
  });
});

describe('복수구매 할인·착불·수량별 배송비 섹션', () => {
  it('도입 문장 없이 새 입력 부품만 둔다(복수구매 할인 입력과 이 상품만의 배송비 규칙 입력) — 옛 확장 배송비 선택칸은 쓰지 않는다', () => {
    const tree = GoodWorkspaceTransactionTermsSection({});
    const all = nodes(tree);
    expect(all.some(node => node.type === GoodsVolumeDiscountFields)).toBe(true);
    expect(all.some(node => node.type === GoodsDeliveryRuleFields)).toBe(true);
    expect(all.some(node => node.type === GoodsDeliveryPricingFields)).toBe(false);
    expect(all.some(node => node.type === 'p')).toBe(false);
    expect(all.filter(node => node.type === 'h3').map(node => text(node.props.children as ReactNode))).toEqual(['복수구매 할인', '착불·수량별 배송비']);
    expect(text(tree)).not.toContain('확장 배송비');
  });
  it('기본 입력은 사용 안 함이고, 두 입력의 변경은 저장 입력(extras.transactionTerms)의 같은 칸으로 들어가 다른 쪽을 지우지 않는다', () => {
    const empty = emptyGoodWorkspaceTerms();
    const pick = (type: unknown) => nodes(GoodWorkspaceTransactionTermsSection({})).find(node => node.type === type)!;
    expect(pick(GoodsDeliveryRuleFields).props.value).toEqual(empty.delivery);
    expect(pick(GoodsVolumeDiscountFields).props.value).toEqual(empty.volume);
    (pick(GoodsDeliveryRuleFields).props.onChange as (value: unknown) => void)({ ...empty.delivery, status: 'active', fields: { ...empty.delivery.fields, kind: 'repeat', baseFee: '3000', interval: '2' } });
    expect(extras().transactionTerms?.delivery).toMatchObject({ status: 'active', fields: { kind: 'repeat', baseFee: '3000', interval: '2' } });
    expect(extras().transactionTerms?.volume).toEqual(empty.volume);
    (pick(GoodsVolumeDiscountFields).props.onChange as (value: unknown) => void)({ ...empty.volume, status: 'active' });
    expect(extras().transactionTerms?.volume).toMatchObject({ status: 'active' });
    expect(extras().transactionTerms?.delivery).toMatchObject({ status: 'active', fields: { kind: 'repeat' } });
  });
  it('저장 오류는 섹션 맨 아래에 알린다', () => {
    workspace.sectionErrors = { workspaceTransactionTerms: '수량별 배송비를 확인해주세요.' };
    expect(nodes(GoodWorkspaceTransactionTermsSection({})).some(node => node.props.message === '수량별 배송비를 확인해주세요.')).toBe(true);
  });
});

describe('나머지 섹션의 안내 글', () => {
  const intro = (tree: ReactNode) => nodes(tree).filter(node => node.type === 'p' && String(node.props.className).includes('text-muted-foreground')).map(node => text(node.props.children as ReactNode));
  it('입력 부품이 이미 한 줄로 말하는 섹션(색상칩·정기배송·A/S)은 도입 문장을 두지 않아 같은 말이 두 번 나오지 않는다', () => {
    const colors = GoodWorkspaceListingColorsSection({}), subscription = GoodWorkspaceSubscriptionSection({}), afterSales = GoodWorkspaceAfterSalesSection({});
    for (const tree of [colors, subscription, afterSales]) expect(intro(tree)).toEqual([]);
    expect(nodes(colors).some(node => node.type === GoodsListingColorFields)).toBe(true);
    expect(nodes(subscription).find(node => node.type === GoodsSubscriptionPolicyFields)!.props.value).toEqual({ enabled: false, intervals: [], message: '' });
    expect(nodes(afterSales).some(node => node.type === GoodsAfterSalesFields)).toBe(true);
    expect(nodes(colors).some(node => node.type === AdminHelpTip)).toBe(false);
  });
  it('A/S: 스토어 기본 연락처를 채웠을 때만 그 사실을 한 줄로 알린다', () => {
    const note = (tree: ReactNode) => nodes(tree).filter(node => node.props['data-good-workspace-after-sales-prefill'] !== undefined).map(node => text(node.props.children as ReactNode));
    expect(note(GoodWorkspaceAfterSalesSection({}))).toEqual([]);
    const filled = GoodWorkspaceAfterSalesSection({ phoneDefault: '02-123-4567' });
    expect(note(filled)).toEqual(['전화번호는 스토어 기본 A/S 연락처로 채웠습니다. A/S 안내를 쓰면 함께 저장됩니다.']);
    expect(nodes(filled).find(node => node.type === GoodsAfterSalesFields)!.props.values).toMatchObject({ phone: '02-123-4567' });
  });
  it('수령 방식·주문 후 제작: 입력 부품 안의 제목과 겹치는 바깥 legend는 화면에서 줄인다(저장된 상품의 패널과 같다)', () => {
    const production = GoodWorkspaceProductionSection({});
    const productionLegend = nodes(production).find(node => node.type === 'legend')!;
    expect([productionLegend.props.className, text(productionLegend.props.children as ReactNode)]).toEqual(['sr-only', '주문 후 제작']);
    const session = GoodWorkspaceFulfillmentSection({ accountId: 'actor' }) as Element;
    const draft = (session.props.children as (identity: unknown, scope: unknown) => Element)({}, {});
    const fulfillment = (draft.type as (props: unknown) => ReactNode)(draft.props);
    const fulfillmentLegend = nodes(fulfillment).find(node => node.type === 'legend')!;
    expect([fulfillmentLegend.props.className, text(fulfillmentLegend.props.children as ReactNode)]).toEqual(['sr-only', '상품 제공 방식']);
    expect(intro(fulfillment)).toEqual(['택배만 쓰면 바꿀 것이 없습니다. 다른 수령 방식을 쓰려면 아래 근거 칸과 확인 체크도 채워야 합니다.']);
    expect(intro(production)).toEqual(['쓰지 않으면 바꿀 것이 없습니다. 쓰려면 아래 근거 칸과 확인 체크도 채워야 합니다.']);
  });
  it('사이즈 안내: 저장된 상품의 패널과 같은 이름(고객 화면 표시·표시 안 함·템플릿에서 가져오기)을 쓴다', () => {
    const tree = GoodWorkspaceSizeChartSection({});
    expect(intro(tree)).toEqual(['상품의 측정 치수를 표로 보여 줍니다. 사이즈 이름은 구매 옵션과 이어지지 않습니다.']);
    const all = nodes(tree);
    expect(all.filter(node => node.type === Label).map(node => text(node.props.children as ReactNode))).toEqual(['고객 화면 표시']);
    expect(all.filter(node => node.type === 'option').map(node => text(node.props.children as ReactNode))).toEqual(['표시 안 함 · 표는 그대로 보관', '표시']);
    expect(all.some(node => node.type === 'button' && text(node.props.children as ReactNode) === '사이즈 템플릿에서 가져오기')).toBe(true);
    const shown = text(tree); expect(shown).not.toContain('공개 표시'); expect(shown).not.toContain('설정안함');
  });
  it('기간 할인: 입력이 없을 때 따로 말하지 않고 안내는 한 줄이다', () => {
    const tree = GoodWorkspacePricePeriodsSection({});
    expect(intro(tree)).toEqual(['정한 기간 동안 옵션을 기간 할인가로 팝니다. 같은 옵션의 기간은 겹칠 수 없습니다.']);
  });
  it('사은품: 두 문장 이내', () => {
    expect(intro(GoodWorkspaceBenefitsSection({}))).toEqual(['상품 상세에 보이는 안내입니다. 사은품 재고와 출고는 따로 준비해야 합니다.']);
  });
  it('화면에 쓰지 않는 표현(개발 용어·번역투·내부 값·옛 이름)이 없다', () => {
    workspace.optionRows = [{ name: '빨강', attributes: { 색상: '빨강' } }];
    mocks.session = { identity: { expectedActorId: 'actor', expectedSessionId: 'session' }, blocked: false };
    const shown = [GoodWorkspaceAdditionalSection({}), GoodWorkspaceSaleModeSection({}), GoodWorkspacePurchaseCostsSection({}), GoodWorkspacePricePeriodsSection({}),
      GoodWorkspaceBenefitsSection({}), GoodWorkspaceListingColorsSection({}), GoodWorkspaceTransactionTermsSection({}), GoodWorkspaceSubscriptionSection({}),
      GoodWorkspaceAfterSalesSection({}), GoodWorkspaceSizeChartSection({}), GoodWorkspaceProductionSection({})].map(tree => text(tree)).join('\n');
    expect(shown).not.toMatch(/미설정|저장 버전|묶음 기본료|에 대한|을 통해|에 의해|것이 가능|해당 |상기|의 경우[ ,]|에 한하여|확장 배송비|색상값|세금 구분/);
  });
});
