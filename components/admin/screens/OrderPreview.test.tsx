import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('./OrderDetailScreen', () => ({ OrderDetailScreen: () => null }));
import { OrderDetailScreen } from './OrderDetailScreen';
import { OrderPreviewDialog, OrderPreviewLink, OrderPreviewNewTabLink } from './OrderPreview';
import { OrderPreviewPopup } from './OrderPreviewPopup';
import { adminOrderPreviewHref, adminOrderPreviewId } from '@/lib/admin/order-preview';
import type { AdminOrderDetail } from '@/lib/admin/order-detail';

type Element = ReactElement<Record<string, unknown>>;
const ORDER = '50000000-0000-4000-8000-000000000001';
const LIST = '/admin/sales/dispatch?tab=ready&page=2&query=maple';
function nodes(value: ReactNode): Element[] { return Children.toArray(value).flatMap(node => isValidElement<Record<string, unknown>>(node) ? [node, ...nodes(node.props.children as ReactNode)] : []); }

describe('목록 위 주문 상세 팝업 (S36-075)', () => {
  it('팝업 주소는 목록 조건을 그대로 두고 orderId만 더하며, UUID가 아닌 값은 열지 않는다', () => {
    expect(adminOrderPreviewHref(LIST, ORDER)).toBe(`/admin/sales/dispatch?tab=ready&page=2&query=maple&orderId=${ORDER}`);
    expect(adminOrderPreviewHref(`${LIST}&orderId=60000000-0000-4000-8000-000000000001`, ORDER)).toBe(`/admin/sales/dispatch?tab=ready&page=2&query=maple&orderId=${ORDER}`);
    expect(adminOrderPreviewId(ORDER.toUpperCase())).toBe(ORDER);
    expect(adminOrderPreviewId([ORDER, ORDER])).toBeNull(); expect(adminOrderPreviewId('nope')).toBeNull(); expect(adminOrderPreviewId(undefined)).toBeNull();
  });

  it('주문번호 링크는 같은 화면 팝업을 스크롤 유지·미리 읽기 없이 열고, 새 탭 링크는 보조로 남는다', () => {
    const link = renderToStaticMarkup(<OrderPreviewLink href={adminOrderPreviewHref(LIST, ORDER)} label="주문 2026111110000001 상세 팝업 열기">2026111110000001</OrderPreviewLink>);
    expect(link).toContain(`href="/admin/sales/dispatch?tab=ready&amp;page=2&amp;query=maple&amp;orderId=${ORDER}"`);
    expect(link).toContain('aria-label="주문 2026111110000001 상세 팝업 열기"'); expect(link).not.toContain('target=');
    expect(link).toContain('data-order-preview-link=""');
    const tab = renderToStaticMarkup(<OrderPreviewNewTabLink href={`/admin/sales/orders/${ORDER}`} label="주문 2026111110000001 상세 열기 (새 탭)" />);
    expect(tab).toContain('target="_blank"'); expect(tab).toContain('rel="noopener noreferrer"'); expect(tab).toContain('title="새 탭으로 열기"');
  });

  it('불러오면 전용 상세 화면을 팝업 안에 그리고, 머리의 목록 버튼은 팝업을 닫는 주소로 돌아간다', () => {
    const detail = { order: { id: ORDER, orderNumber: '2026111110000001' } } as unknown as AdminOrderDetail;
    const popup = OrderPreviewPopup({ preview: { kind: 'loaded', detail, production: null, downloads: null, canManage: true, canViewCustomer: false }, orderId: ORDER, closeHref: LIST, backLabel: '발주·발송 목록', actorId: 'actor' }) as Element;
    expect(popup.type).toBe(OrderPreviewDialog);
    expect(popup.props).toMatchObject({ closeHref: LIST, title: '주문 2026111110000001 상세', detailHref: `/admin/sales/orders/${ORDER}?back=${encodeURIComponent(LIST)}` });
    const screen = nodes(popup.props.children as ReactNode).find(node => node.type === OrderDetailScreen)!;
    expect(screen.props).toMatchObject({ backHref: LIST, backLabel: '발주·발송 목록', canManage: true, canViewCustomer: false, actorId: 'actor', detail });
  });

  it.each([['forbidden', '권한이 없습니다'], ['not_found', '주문을 찾을 수 없습니다'], ['error', '불러오지 못했습니다']] as const)('읽지 못하면(%s) 목록은 두고 팝업에 이유를 보인다', (kind, text) => {
    const popup = OrderPreviewPopup({ preview: { kind }, orderId: ORDER, closeHref: LIST, backLabel: '목록' }) as Element;
    expect(popup.type).toBe(OrderPreviewDialog);
    expect(JSON.stringify(nodes(popup.props.children as ReactNode).map(node => node.props.children))).toContain(text);
  });
});
