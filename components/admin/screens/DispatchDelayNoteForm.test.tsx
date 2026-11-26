import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/app/admin/order-actions', () => ({ saveAdminOrderDispatchDelayAction: vi.fn() }));
import { DispatchDelayNoteForm } from './DispatchDelayNoteForm';

/*
 * S-12: 지연 메모를 없애는 길은 [메모 지우기] 하나다. 예전에는 사유를 비우고 [메모 저장]을 누르면 말없이 지워졌고,
 * 입력칸의 예시 글이 그 규칙("비우면 해제")을 대신 설명했다.
 */
const ORDER = '50000000-0000-4000-8000-000000000001';
describe('발송지연 메모 줄', () => {
  it('저장된 메모가 있을 때만 [메모 지우기]를 따로 두고, 예시 글로 지우는 법을 설명하지 않는다', () => {
    const empty = renderToStaticMarkup(<DispatchDelayNoteForm note={null} orderId={ORDER} reference="2026111210000001" />);
    expect(empty).toContain('placeholder="지연 사유"'); expect(empty).not.toContain('비우면 해제');
    expect(empty).toMatch(/<button[^>]*type="submit"[^>]*>메모 저장<\/button>/); expect(empty).not.toContain('메모 지우기');
    const saved = renderToStaticMarkup(<DispatchDelayNoteForm note={{ reason: '제조사 입고 지연', expectedShipDate: '2026-12-03', updatedAt: '2026-11-20T00:00:00Z' }} orderId={ORDER} reference="2026111210000001" />);
    expect(saved).toContain('value="제조사 입고 지연"'); expect(saved).toContain('value="2026-12-03"');
    /* 지우기는 같은 양식의 다른 제출 버튼이다(intent=clear). 확인창을 거친 뒤 사유를 비워 보낸다. */
    const clear = saved.match(/<button[^>]*>메모 지우기<\/button>/)?.[0] ?? '';
    expect(clear).toContain('type="submit"'); expect(clear).toContain('name="intent"'); expect(clear).toContain('value="clear"');
    expect(clear).toContain('aria-label="주문 2026111210000001 지연 메모 지우기"');
  });
});
