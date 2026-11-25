import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { GoodsSubscriptionDraft } from '@/lib/admin/goods-subscription-policy';

/* 입력 부품만 그린다 — 로그인 확인·서버 액션·스토리지 클라이언트는 쓰지 않는다. */
vi.mock('@/components/claim-contact/ClaimContactSession', () => ({
  ClaimContactSession: ({ children }: { children: (identity: unknown, scope: unknown) => ReactNode }) => children({}, {}),
}));
vi.mock('@/app/admin/production-actions', () => ({ readGoodsProductionAction: vi.fn(), saveGoodsProductionAction: vi.fn() }));
vi.mock('@/app/admin/goods-fulfillment-actions', () => ({ readGoodsFulfillmentAction: vi.fn(), saveGoodsFulfillmentAction: vi.fn(), prepareDigitalAssetAction: vi.fn(), verifyDigitalAssetAction: vi.fn() }));
vi.mock('@/app/admin/goods-subscription-policy-actions', () => ({ readGoodsSubscriptionPolicyAction: vi.fn(), saveGoodsSubscriptionPolicyAction: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));
import { GoodsFulfillmentDraftFields } from './GoodsFulfillmentPanel';
import { GoodsProductionFields } from './GoodsProductionPanel';
import { GoodsSubscriptionPolicyFields } from './GoodsSubscriptionPolicyPanel';

type FulfillmentDraft = Parameters<typeof GoodsFulfillmentDraftFields>[0]['draft'];
type ProductionDraft = Parameters<typeof GoodsProductionFields>[0]['draft'];
const METHODS = ['parcel', 'quick', 'pickup', 'direct', 'freight'] as const;
const fulfillment = (patch: Partial<FulfillmentDraft> & { enabled?: readonly string[] } = {}): FulfillmentDraft => ({
  mode: 'shipping', files: [], publicNote: '', evidence: '', confirmed: false, ...patch,
  methods: METHODS.map(method => ({ method, enabled: (patch.enabled ?? ['parcel']).includes(method), amount: '0', basis: 'per_order' as const, installation: '0' })),
});
const production = (patch: Partial<ProductionDraft> = {}): ProductionDraft => ({ enabled: false, leadDays: '', dayBasis: 'calendar', closedDates: '', publicNote: '', evidence: '', confirmed: false, ...patch });
const subscription = (patch: Partial<GoodsSubscriptionDraft> = {}): GoodsSubscriptionDraft => ({ enabled: false, intervals: ['month_1'], message: '', ...patch });
const renderFulfillment = (draft: FulfillmentDraft) => renderToStaticMarkup(<GoodsFulfillmentDraftFields draft={draft} onChange={() => {}} onUpload={() => {}} fieldId="f1" />);
const renderProduction = (draft: ProductionDraft) => renderToStaticMarkup(<GoodsProductionFields draft={draft} onChange={() => {}} idPrefix="p1" />);
const renderSubscription = (value: GoodsSubscriptionDraft) => renderToStaticMarkup(<GoodsSubscriptionPolicyFields value={value} onChange={() => {}} />);

describe('수령 방식 입력', () => {
  it('"제공 구분" 대신 상품 제공 방식을 선택 카드로 고르고, 고르면 그에 필요한 입력만 연다', () => {
    const shipping = renderFulfillment(fulfillment());
    expect(shipping).toContain('상품 제공 방식');
    expect(shipping).not.toContain('제공 구분');
    expect(shipping.match(/data-good-choice-card=""/g)).toHaveLength(3);
    expect(shipping).toMatch(/<input type="radio" name="f1-mode" checked="" value="shipping"\/>배송 또는 방문수령/);
    expect(shipping.match(/data-fulfillment-method=/g)).toHaveLength(5);
    expect(shipping).not.toContain('type="file"');
    const none = renderFulfillment(fulfillment({ mode: 'no_delivery' }));
    expect(none).not.toContain('data-fulfillment-method');
    expect(none).not.toContain('type="file"');
    expect(none).toContain('배송비 없이 주문받고, 직접 전달한 뒤 전달 근거를 기록합니다.');
  });

  it('디지털 파일은 파일 칸과 형식·개수 한 줄, "?" 한 곳으로 안내한다', () => {
    const digital = renderFulfillment(fulfillment({ mode: 'digital' }));
    expect(digital).toContain('type="file"');
    expect(digital).toContain('PDF·ZIP·PNG·JPG·MP3·MP4·TXT 파일, 최대 10개, 개당 50MB까지 올릴 수 있습니다.');
    expect(digital).toContain('aria-label="제공 파일 도움말"');
    expect(digital).not.toContain('data-fulfillment-method');
  });

  it('택배 외 방식·직접 전달일 때만 출고지 준비 안내와 이동 링크를 보인다', () => {
    expect(renderFulfillment(fulfillment())).not.toContain('data-good-fulfillment-origin-note');
    expect(renderFulfillment(fulfillment({ mode: 'digital' }))).not.toContain('data-good-fulfillment-origin-note');
    for (const html of [renderFulfillment(fulfillment({ enabled: ['parcel', 'quick'] })), renderFulfillment(fulfillment({ mode: 'no_delivery' }))]) {
      expect(html).toMatch(/data-good-fulfillment-origin-note=""[^>]*>택배 외 방식은 <a[^>]*href="\/admin\/settings\/origins"[^>]*>배송정보 관리<\/a>에서/);
    }
  });

  it('고객 안내가 어디에 보이는지 말하고, 서버가 요구하는 설정 근거·확인 체크는 그대로 필수다', () => {
    const html = renderFulfillment(fulfillment());
    expect(html).toContain('고객 안내 (선택)');
    expect(html).toContain('상품 상세의 제공 방식과 주문서의 받을 방식 아래에 보입니다.');
    expect(html).toMatch(/<input[^>]*id="f1-evidence"[^>]*required=""|<input[^>]*required=""[^>]*id="f1-evidence"/);
    expect(html).toContain('placeholder="예: 설치 기사가 방문하는 상품이라 설치비를 받습니다"');
    expect(html).toMatch(/<input type="checkbox"[^>]*required=""[^>]*\/>수령 방식·금액·파일 제공 조건을 확인했습니다\./);
  });
});

describe('주문 후 제작 입력', () => {
  it('사용하지 않으면 기간·휴무일·안내 입력을 닫는다', () => {
    const off = renderProduction(production({ leadDays: '5' }));
    expect(off).toContain('이 상품은 주문을 받은 뒤에 제작합니다');
    expect(off).not.toContain('type="number"');
    expect(off).not.toContain('data-good-readback');
    expect(off).not.toContain('발송하지 않는 날');
    expect(off).toContain('id="p1-evidence"');
  });

  it('달력일이면 휴무일 칸이 없고, 입력한 기간을 고객 화면 문장으로 되읽는다', () => {
    const html = renderProduction(production({ enabled: true, leadDays: '5' }));
    expect(html).toContain('type="number"');
    expect(html).not.toContain('발송하지 않는 날');
    expect(html).toContain('상품 상세에는 ‘결제 확인 후 5일 내 발송 예정입니다. 배송 기간은 별도입니다.’로 보입니다.');
    expect(html).toContain('결제 확인 당일은 세지 않고, 마지막 날 자정(KST) 전까지가 발송 예정 기한입니다.');
  });

  it('영업일이면 휴무일 칸이 열리고, 읽는 방법과 예시를 보인다', () => {
    const html = renderProduction(production({ enabled: true, leadDays: '5', dayBasis: 'business' }));
    expect(html).toContain('결제 확인 후 5영업일(토·일·설정 휴무일 제외) 내 발송 예정입니다.');
    expect(html).toContain('발송하지 않는 날 (휴무일)');
    expect(html).toContain('토·일은 자동으로 뺍니다. 공휴일은 빼지 않으니 쉬는 날을 직접 적어 주세요.');
    expect(html).toContain('placeholder="한 줄에 하루씩\n2026-12-25\n2027-01-01"');
    expect(html).not.toContain('YYYY-MM-DD');
  });

  it('기간이 비었거나 범위 밖이면 틀린 문장을 말하지 않고, 근거·확인 체크는 그대로 필수다', () => {
    for (const leadDays of ['', '0', '400', '2.5']) expect(renderProduction(production({ enabled: true, leadDays })), leadDays).not.toContain('data-good-readback');
    const html = renderProduction(production({ enabled: true, leadDays: '3' }));
    expect(html).toContain('고객 안내 (선택)');
    expect(html).toContain('상품 상세·주문서·주문 상세에 보입니다.');
    expect(html).toMatch(/<input[^>]*id="p1-evidence"[^>]*required=""|<input[^>]*required=""[^>]*id="p1-evidence"/);
    expect(html).toMatch(/<input type="checkbox"[^>]*required=""[^>]*\/>위 발송 예정 기간이 맞고/);
  });
});

describe('정기배송 입력', () => {
  it('사용하지 않으면 주기·안내 칸을 닫고, 사용하면 열면서 신청 버튼 조건을 한 줄로 말한다', () => {
    const off = renderSubscription(subscription());
    expect(off).toContain('정기배송 판매');
    expect(off).not.toContain('고객이 고를 수 있는 주기');
    expect(off).not.toContain('data-good-subscription-gate');
    const on = renderSubscription(subscription({ enabled: true }));
    expect(on).toContain('고객이 고를 수 있는 주기');
    expect(on).toContain('정기배송 안내 문구 (선택)');
    expect(on).toMatch(/data-good-subscription-gate=""[^>]*>켜도 카드 자동결제 연결과 서비스 공개 준비가 끝나기 전에는 고객 화면에 신청 버튼이 보이지 않습니다\./);
    expect(on).not.toContain('첫 회차와 다음 회차의 결제 금액');
  });

  it('주기를 모두 지운 채 사용 안 함이면 막힌 칸이 보이도록 주기 칸을 계속 연다', () => {
    expect(renderSubscription(subscription({ intervals: [] }))).toContain('고객이 고를 수 있는 주기');
  });

  it('긴 설명은 "?"에 있고 이름 옆에 달려 있다', () => {
    expect(renderSubscription(subscription())).toContain('aria-label="정기배송 판매 도움말"');
  });
});

/* 입력 부품은 훅이 없는 함수라 그 자리에서 불러 같은 입력을 찾는다. */
type Node = { type?: unknown; props?: { children?: unknown; [key: string]: unknown } };
const walk = (node: unknown): Node[] => Array.isArray(node) ? node.flatMap(walk) : node && typeof node === 'object' && 'props' in node ? [node as Node, ...walk((node as Node).props?.children)] : [];

describe('주문 후 제작 칸을 끌 때', () => {
  it('끄면 닫히는 칸에 규칙에 맞지 않는 기간이 남아 저장이 막히지 않도록 그런 값만 비운다', () => {
    const changes: ProductionDraft[] = [];
    const checkbox = (draft: ProductionDraft) => walk(GoodsProductionFields({ draft, onChange: (next) => changes.push(next), idPrefix: 'p1' }))
      .find((node) => node.type === 'input' && node.props?.type === 'checkbox')!;
    const off = (draft: ProductionDraft) => (checkbox(draft).props!.onChange as (event: { target: { checked: boolean } }) => void)({ target: { checked: false } });
    off(production({ enabled: true, leadDays: '5' })); off(production({ enabled: true, leadDays: '0' })); off(production({ enabled: true, leadDays: '' })); off(production({ enabled: true, leadDays: '400' }));
    expect(changes.map((draft) => [draft.enabled, draft.leadDays])).toEqual([[false, '5'], [false, ''], [false, ''], [false, '']]);
    (checkbox(production({ leadDays: '0' })).props!.onChange as (event: { target: { checked: boolean } }) => void)({ target: { checked: true } });
    expect(changes.at(-1)).toMatchObject({ enabled: true, leadDays: '0' });
  });
});
