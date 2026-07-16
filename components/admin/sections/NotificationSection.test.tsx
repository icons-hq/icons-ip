import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminNotificationConsoleData } from '@/lib/admin/notifications';
import { NotificationSection } from './NotificationSection';

const hooks = vi.hoisted(() => ({
  actionState: {} as Record<string, unknown>,
  action: vi.fn(),
  actionReducer: null as null | ((state: Record<string, unknown>, formData: FormData) => Promise<Record<string, unknown>>),
  pending: false,
  setters: [] as ReturnType<typeof vi.fn>[],
  stateValues: [] as unknown[],
}));

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useActionState: (actionReducer: typeof hooks.actionReducer) => {
      hooks.actionReducer = actionReducer;
      return [hooks.actionState, vi.fn(), hooks.pending];
    },
    useState: (initial: unknown) => {
      const value = hooks.stateValues.length
        ? hooks.stateValues.shift()
        : typeof initial === 'function'
          ? (initial as () => unknown)()
          : initial;
      const setter = vi.fn();
      hooks.setters.push(setter);
      return [value, setter];
    },
  };
});

vi.mock('@/app/admin/notification-actions', () => ({
  sendAdminNotificationAction: hooks.action,
}));
vi.mock('@/components/ui/Icon', () => ({ Icon: () => null }));

const data: AdminNotificationConsoleData = {
  audiences: [
    {
      scope: 'all',
      ipId: null,
      ipTitle: null,
      recipientCount: 18,
      canSend: true,
    },
    {
      scope: 'ip_followers',
      ipId: 'rilakkuma',
      ipTitle: '리락쿠마',
      recipientCount: 7,
      canSend: true,
    },
  ],
  history: [
    {
      operationId: '22222222-2222-4222-8222-222222222222',
      actorName: '운영자',
      scope: 'ip_followers',
      ipId: 'rilakkuma',
      ipTitle: '리락쿠마',
      title: '새로운 콜렉션이 열렸어요',
      body: '오늘부터 새 콜렉션을 만나보세요.',
      recipientCount: 7,
      sentAt: '2026-07-16T01:00:00.000Z',
    },
  ],
};

function setComposerState({
  body = '',
  confirmed = false,
  ipId = '',
  operationId = '11111111-1111-4111-8111-111111111111',
  scope = 'all',
  title = '',
}: {
  body?: string;
  confirmed?: boolean;
  ipId?: string;
  operationId?: string;
  scope?: 'all' | 'ip_followers';
  title?: string;
} = {}) {
  hooks.stateValues = [scope, ipId, title, body, confirmed, operationId];
}

function findElement(node: ReactNode, predicate: (element: ReactElement) => boolean): ReactElement | null {
  if (!isValidElement(node)) return null;
  if (predicate(node)) return node;

  const children = (node.props as { children?: ReactNode }).children;
  if (Array.isArray(children)) {
    for (const child of children) {
      const found = findElement(child, predicate);
      if (found) return found;
    }
    return null;
  }

  return findElement(children, predicate);
}

describe('NotificationSection', () => {
  beforeEach(() => {
    hooks.actionState = {};
    hooks.action.mockReset();
    hooks.actionReducer = null;
    hooks.pending = false;
    hooks.setters = [];
    setComposerState();
  });

  it('정확한 추정치와 채널 경계, 미리보기, 최근 이력을 보여준다', () => {
    const html = renderToStaticMarkup(
      <NotificationSection data={data} operationId="11111111-1111-4111-8111-111111111111" />,
    );

    expect(html).toContain('전체 사용자');
    expect(html).toContain('특정 IP 팔로워');
    expect(html).toContain('현재 추정 수신자');
    expect(html).toContain('18명');
    expect(html).toContain('인앱 알림함에 즉시 발송됩니다. 이메일·푸시는 발송하지 않습니다.');
    expect(html).toContain('사용자 알림 미리보기');
    expect(html).toContain('제목을 입력하면 여기에 보여요.');
    expect(html).toContain('최근 발송 이력');
    expect(html).toContain('리락쿠마 팔로워');
    expect(html).toContain('실제 7명');
    expect(html).not.toContain('22222222-2222-4222-8222-222222222222');
  });

  it('완성된 입력을 2단계로 확인하고 복구 불가 경고를 표시한다', () => {
    setComposerState({ body: '오늘 새 소식을 확인해주세요.', confirmed: true, title: '새로운 공지' });

    const html = renderToStaticMarkup(
      <NotificationSection data={data} operationId="11111111-1111-4111-8111-111111111111" />,
    );

    expect(html).toContain('예상 18명에게 즉시 발송하며 회수할 수 없습니다.');
    expect(html).toContain('즉시 발송 확정');
    expect(html).toContain('내용 다시 수정');
  });

  it('입력이나 대상이 바뀌면 최종 확인 상태를 해제한다', () => {
    setComposerState({
      body: '본문',
      confirmed: true,
      ipId: 'rilakkuma',
      scope: 'ip_followers',
      title: '제목',
    });
    const tree = NotificationSection({ data, operationId: '11111111-1111-4111-8111-111111111111' });
    const titleInput = findElement(
      tree,
      (element) => element.type === 'input' && (element.props as { name?: string }).name === 'title',
    );
    const scopeSelect = findElement(
      tree,
      (element) => element.type === 'select' && (element.props as { name?: string }).name === 'scope',
    );

    (titleInput?.props as { onChange: (event: { target: { value: string } }) => void }).onChange({ target: { value: '바꾼 제목' } });
    (scopeSelect?.props as { onChange: (event: { target: { value: string } }) => void }).onChange({ target: { value: 'ip_followers' } });

    expect(hooks.setters[2]).toHaveBeenCalledWith('바꾼 제목');
    expect(hooks.setters[0]).toHaveBeenCalledWith('ip_followers');
    expect(hooks.setters[4]).toHaveBeenCalledWith(false);
  });

  it('확인 전 Enter 제출을 발송하지 않고 최종 확인 단계로 전환한다', () => {
    setComposerState({ body: '본문', title: '제목' });
    const tree = NotificationSection({ data, operationId: '11111111-1111-4111-8111-111111111111' });
    const form = findElement(tree, (element) => element.type === 'form');
    const preventDefault = vi.fn();

    (form?.props as { onSubmit: (event: { preventDefault: () => void }) => void })
      .onSubmit({ preventDefault });

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(hooks.setters[4]).toHaveBeenCalledWith(true);
  });

  it('0명 대상과 pending 상태에서 중복 발송을 막는다', () => {
    const blockedData: AdminNotificationConsoleData = {
      audiences: [{ ...data.audiences[0], recipientCount: 0, canSend: false }],
      history: [],
    };
    setComposerState({ body: '본문', title: '제목' });
    hooks.pending = true;

    const html = renderToStaticMarkup(
      <NotificationSection data={blockedData} operationId="11111111-1111-4111-8111-111111111111" />,
    );

    expect(html).toContain('현재 대상에게 발송할 수 없습니다.');
    expect(html).toContain('disabled=""');
    expect(html).toContain('발송 처리 중');
  });

  it('성공 후 실제 수신자 수를 알리고 다음 operation ID로 교체한다', async () => {
    hooks.actionState = {
      message: '공지를 발송했습니다.',
      nextOperationId: '33333333-3333-4333-8333-333333333333',
      recipientCount: 19,
    };
    setComposerState({
      body: '본문',
      confirmed: true,
      ipId: 'rilakkuma',
      scope: 'ip_followers',
      title: '제목',
    });

    const html = renderToStaticMarkup(
      <NotificationSection data={data} operationId="11111111-1111-4111-8111-111111111111" />,
    );
    hooks.action.mockResolvedValue(hooks.actionState);
    await hooks.actionReducer?.({}, new FormData());

    expect(html).toContain('실제 19명에게 발송했습니다.');
    expect(hooks.setters[5]).toHaveBeenCalledWith('33333333-3333-4333-8333-333333333333');
    expect(hooks.setters[0]).toHaveBeenCalledWith('all');
    expect(hooks.setters[1]).toHaveBeenCalledWith('');
    expect(hooks.setters[4]).toHaveBeenCalledWith(false);
  });
});
