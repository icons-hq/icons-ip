import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ preview: vi.fn(), force: vi.fn(), refresh: vi.fn(), states: [] as unknown[], refs: [] as { current: unknown }[], index: 0, refIndex: 0, fake: false }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('@/app/admin/forced-delivery-actions', () => ({ previewForcedDeliveryAction: mocks.preview, forceOrderDeliveredAction: mocks.force }));
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return { ...actual,
    useState: (initial: unknown) => {
      if (!mocks.fake) return actual.useState(initial);
      const index = mocks.index++;
      if (!(index in mocks.states)) mocks.states[index] = typeof initial === 'function' ? initial() : initial;
      return [mocks.states[index], (next: unknown) => { mocks.states[index] = typeof next === 'function' ? next(mocks.states[index]) : next; }];
    },
    useRef: (initial: unknown) => { if (!mocks.fake) return actual.useRef(initial); const index = mocks.refIndex++; mocks.refs[index] ??= { current: initial }; return mocks.refs[index]; },
  };
});
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { Textarea } from '@/components/admin/kit/ui/textarea';
import { CustomerServiceDialog } from './CustomerServiceDialog';
import { ForcedDeliveryPanel } from './ForcedDeliveryPanel';

type Element = ReactElement<Record<string, unknown>>;
const orderNumber = '2026111110000001', orderId = 'f0dd0000-0000-4001-8000-000000000001';
const preview = { orderId, orderNumber, status: 'confirmed', createdAt: '2026-11-11T00:00:00Z', buyerName: '시험 구매자', itemCount: 2, firstItemName: '시험 굿즈', orderCount: 2,
  shipments: [{ id: 'f0dd0000-0000-4002-8000-000000000001', shipmentNumber: '2026111130000001', orderNumber, originName: '김포', status: 'ready' as const, method: 'parcel' as const, carrier: null, trackingNumber: null, exportedAt: null as string | null },
    { id: 'f0dd0000-0000-4002-8000-000000000002', shipmentNumber: '2026111130000002', orderNumber, originName: '김포', status: 'ready' as const, method: 'quick' as const, carrier: null, trackingNumber: null, exportedAt: null as string | null }], blockers: [] as string[] };
function nodes(value: ReactNode): Element[] { return Children.toArray(value).flatMap(node => isValidElement<Record<string, unknown>>(node) ? [node, ...nodes(node.props.children as ReactNode)] : []); }
function text(value: ReactNode): string { return Children.toArray(value).map(node => isValidElement<Record<string, unknown>>(node) ? text(node.props.children as ReactNode) : String(node)).join(''); }
function render() { mocks.index = 0; mocks.refIndex = 0; return ForcedDeliveryPanel() as Element; }
function change(type: unknown, value: string) { (nodes(render()).find(node => node.type === type)!.props.onChange as (event: { target: { value: string } }) => void)({ target: { value } }); }
async function review() { (nodes(render()).find(node => node.type === 'form')!.props.onSubmit as (event: { preventDefault: () => void }) => void)({ preventDefault: () => {} }); await Promise.resolve(); await new Promise(resolve => setTimeout(resolve, 0)); }
function dialog() { return nodes(render()).find(node => node.type === CustomerServiceDialog); }
function confirmButton() { return nodes(dialog()!.props.children as ReactNode).find(node => node.type === Button && text(node.props.children as ReactNode).includes('강제 배송완료'))!; }
beforeEach(() => { vi.clearAllMocks(); mocks.states = []; mocks.refs = []; mocks.fake = true; });

it('접힌 카드에 영향(고객 앱 알림·메일 미발송·구매확정 기한·예외·감사 기록)을 적고 운영 환경에서도 그린다', () => {
  mocks.fake = false;
  const html = renderToStaticMarkup(<ForcedDeliveryPanel />);
  expect(html).toContain('강제 배송완료'); expect(html).toContain('배송 메일은 보내지 않습니다'); expect(html).toContain('구매확정·반품 기한');
  expect(html).toContain('앱 알림 &quot;배송이 완료됐어요&quot;'); expect(html).toContain('디지털 파일 배송 건은'); expect(html).toContain('퀵·직접배송·화물배송·방문수령·배송없음');
  expect(html).toContain('감사 기록'); expect(html).toContain('사유 (필수)'); expect(html).not.toContain('스테이징');
  expect(html).toMatch(/<details (?:(?!open)[^>])*data-sales-disclosure=""/);
});

it('주문 상세에서 연 주문번호를 채우고 카드를 펼친 채 사유 칸으로 간다(QA1 S-T04-05)', () => {
  mocks.fake = false;
  const html = renderToStaticMarkup(<ForcedDeliveryPanel initialOrderNumber="20261112140010000034" />);
  expect(html).toMatch(/<details[^>]*id="forced-delivery"[^>]*open=""/);
  expect(html).toContain('value="20261112140010000034"');
  expect(html).toContain('주문 상세에서 고른 주문');
  expect(html).toMatch(/<textarea[^>]*autofocus=""[^>]*id="forced-delivery-reason"|<textarea[^>]*id="forced-delivery-reason"[^>]*autofocus=""/);
  const plain = renderToStaticMarkup(<ForcedDeliveryPanel />);
  expect(plain).toMatch(/<details[^>]*id="forced-delivery"/);
  expect(plain).not.toContain('주문 상세에서 고른 주문');
  expect(plain).not.toContain('autofocus');
});

it('사유 없이는 대상 확인도 하지 않고, 확인창은 대상·합포장 동반 주문을 보이며 확인 체크 전에는 실행하지 않는다', async () => {
  change(Input, orderNumber);
  await review();
  expect(mocks.preview).not.toHaveBeenCalled(); expect(text(render())).toContain('사유를 1~500자로 입력해주세요.');
  change(Textarea, '구매확정·리뷰 시험');
  mocks.preview.mockResolvedValue({ preview });
  await review();
  expect(mocks.preview).toHaveBeenCalledWith(orderNumber);
  const body = text(dialog()!.props.children as ReactNode);
  expect(body).toContain('시험 구매자'); expect(body).toContain('시험 굿즈 외 1건'); expect(body).toContain('구매확정·리뷰 시험');
  expect(body).toContain('2026111130000001'); expect(body).toContain('모두 2개 주문이 함께 배송완료됩니다');
  expect(body).toContain('퀵'); expect(body).toContain('배송이 완료됐어요'); expect(body).not.toContain('출고지시를 이미 전달한');
  expect(text(confirmButton().props.children as ReactNode)).toBe('2건 강제 배송완료');
  expect(confirmButton().props.disabled).toBe(true);
  (confirmButton().props.onClick as () => void)();
  expect(mocks.force).not.toHaveBeenCalled();
});

it('확인 체크 뒤 같은 요청 번호로 실행하고, 결과를 알린 뒤 입력을 비운다', async () => {
  change(Input, orderNumber); change(Textarea, '구매확정·리뷰 시험');
  mocks.preview.mockResolvedValue({ preview });
  await review();
  const checkbox = nodes(dialog()!.props.children as ReactNode).find(node => node.type === 'input' && node.props.type === 'checkbox')!;
  (checkbox.props.onChange as (event: { target: { checked: boolean } }) => void)({ target: { checked: true } });
  mocks.force.mockRejectedValueOnce(new Error('network'));
  (confirmButton().props.onClick as () => void)(); await new Promise(resolve => setTimeout(resolve, 0));
  expect(text(dialog()!.props.children as ReactNode)).toContain('같은 요청으로 확인합니다');
  mocks.force.mockResolvedValue({ receipt: { orderId, orderNumber, status: 'delivered', deliveredShipments: 1, orderCount: 2, deliveredAt: '2026-11-11T02:00:00Z' } });
  (confirmButton().props.onClick as () => void)(); await new Promise(resolve => setTimeout(resolve, 0));
  expect(mocks.force.mock.calls[1][2]).toBe(mocks.force.mock.calls[0][2]);
  expect(mocks.force.mock.calls[1].slice(0, 2)).toEqual([orderNumber, '구매확정·리뷰 시험']);
  expect(dialog()).toBeUndefined();
  expect(text(render())).toContain('합포장으로 묶인 주문 2건을 함께 처리했습니다'); expect(text(render())).toContain('고객에게 앱 알림 "배송이 완료됐어요"가 갔습니다');
  expect(mocks.refresh).toHaveBeenCalledOnce();
});

it('출고지시를 전달한 발송 전 배송 건이 있으면 창고 출고 경고와 추가 확인 체크 없이는 실행하지 않는다', async () => {
  change(Input, orderNumber); change(Textarea, '구매확정·리뷰 시험');
  mocks.preview.mockResolvedValue({ preview: { ...preview, shipments: [{ ...preview.shipments[0], exportedAt: '2026-11-11T01:00:00Z' }, { ...preview.shipments[1], method: 'digital' as const }] } });
  await review();
  expect(text(dialog()!.props.children as ReactNode)).toContain('창고가 실제 출고할 수 있습니다');
  expect(text(dialog()!.props.children as ReactNode)).toContain('구매자 내려받기로 완료');
  expect(text(confirmButton().props.children as ReactNode)).toBe('1건 강제 배송완료');
  const checks = () => nodes(dialog()!.props.children as ReactNode).filter(node => node.type === 'input' && node.props.type === 'checkbox');
  expect(checks()).toHaveLength(2);
  (checks()[0].props.onChange as (event: { target: { checked: boolean } }) => void)({ target: { checked: true } });
  expect(confirmButton().props.disabled).toBe(true);
  (confirmButton().props.onClick as () => void)(); expect(mocks.force).not.toHaveBeenCalled();
  (checks()[1].props.onChange as (event: { target: { checked: boolean } }) => void)({ target: { checked: true } });
  expect(confirmButton().props.disabled).toBe(false);
});

it('막는 사유가 있으면 실행 버튼 없이 이유만 보인다', async () => {
  change(Input, orderNumber); change(Textarea, '시험');
  mocks.preview.mockResolvedValue({ preview: { ...preview, blockers: ['requires_confirmed', 'preorder_allocation_required'] } });
  await review();
  const body = text(dialog()!.props.children as ReactNode);
  expect(body).toContain('신규주문은 먼저 발주확인해주세요'); expect(body).toContain('실물이 없는 배송 건은 재고 기준상 배송완료로 기록하지 않습니다(예외)');
  expect(nodes(dialog()!.props.children as ReactNode).some(node => node.type === Button && text(node.props.children as ReactNode).includes('강제 배송완료'))).toBe(false);
});
