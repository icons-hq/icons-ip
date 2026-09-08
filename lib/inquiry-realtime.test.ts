import { describe, expect, it, vi } from 'vitest';
import { observeInquiryChanges, type InquiryRealtimeClient } from './inquiry-realtime';

function transport() {
  const handlers: { type: string; filter: Record<string, string>; callback: (value: unknown) => void }[] = [];
  let status: (value: string) => void = () => {};
  const channel = {
    on: (type: string, filter: Record<string, string>, callback: (value: unknown) => void) => { handlers.push({ type, filter, callback }); return channel; },
    subscribe: (callback: typeof status) => { status = callback; return channel; },
  };
  const removeChannel = vi.fn();
  return { handlers, joined: () => status('SUBSCRIBED'), ready: () => handlers.find((handler) => handler.type === 'system')?.callback({ extension: 'postgres_changes', status: 'ok' }), removeChannel,
    client: { channel: () => channel, removeChannel } as unknown as InquiryRealtimeClient };
}
describe('실시간 문의 화면 구독', () => {
  it('WebSocket 입장만으로 DB 구독을 완료했다고 판단하지 않는다', () => {
    const test = transport(); const ready = vi.fn();
    observeInquiryChanges(test.client, { onChange: vi.fn(), onReady: ready });
    test.joined(); expect(ready).not.toHaveBeenCalled();
    test.ready(); expect(ready).toHaveBeenCalledOnce();
  });
  it('주입된 채널이 답글과 상태 변경을 알리고 본문은 화면 상태로 전달하지 않는다', () => {
    const test = transport(); const changed = vi.fn(); const ready = vi.fn();
    observeInquiryChanges(test.client, { inquiryId: 'thread-a', onChange: changed, onReady: ready });
    test.ready(); expect(ready).toHaveBeenCalledOnce();
    const message = test.handlers.find((handler) => handler.filter.table === 'inquiry_messages')!;
    expect(message.filter.filter).toBe('inquiry_id=eq.thread-a');
    message.callback({ new: { id: 'message-a', inquiry_id: 'thread-a', author: 'staff', body: 'raw payload' } });
    expect(changed).toHaveBeenCalledWith({ kind: 'message', inquiryId: 'thread-a', messageId: 'message-a', author: 'staff' });
    expect(JSON.stringify(changed.mock.calls)).not.toContain('raw payload');
  });
  it('화면을 닫으면 구독을 제거하고 늦은 이벤트가 새 화면을 갱신하지 않는다', () => {
    const test = transport(); const changed = vi.fn(); const ready = vi.fn();
    const close = observeInquiryChanges(test.client, { onChange: changed, onReady: ready });
    close(); test.ready(); test.handlers[0].callback({ new: { id: 'old-thread' } });
    expect(test.removeChannel).toHaveBeenCalledOnce(); expect(changed).not.toHaveBeenCalled(); expect(ready).not.toHaveBeenCalled();
  });
});
