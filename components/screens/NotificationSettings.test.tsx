import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { NotificationSettings } from './NotificationSettings';

const mocks = vi.hoisted(() => ({ pending: false }));

vi.mock('@/components/ui/Icon', () => ({ Icon: () => <span aria-hidden /> }));
vi.mock('react-dom', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-dom')>(),
  useFormStatus: () => ({ pending: mocks.pending }),
}));

const preferences = [
  {
    ipId: 'hwasan',
    title: '화산강림',
    notifyDrops: true,
    notifyEvents: false,
  },
  {
    ipId: 'starfall',
    title: '스타폴',
    notifyDrops: false,
    notifyEvents: true,
  },
];

function render(items = preferences, error = false, saved = false) {
  return renderToStaticMarkup(
    <NotificationSettings action={vi.fn()} error={error} preferences={items} saved={saved} />,
  );
}

describe('NotificationSettings', () => {
  it('renders one two-channel settings form for every followed IP', () => {
    const html = render();

    expect(html).toContain('>IP 알림 설정</h1>');
    expect(html).toContain('화산강림');
    expect(html).toContain('스타폴');
    expect(html.match(/<form/g)).toHaveLength(2);
    expect(html.match(/name="setBoth" value="1"/g)).toHaveLength(2);
    expect(html.match(/name="next" value="\/notifications\/settings"/g)).toHaveLength(2);
    expect(html.match(/name="notifyDrops"/g)).toHaveLength(2);
    expect(html.match(/name="notifyEvents"/g)).toHaveLength(2);
    expect(html.match(/role="switch"/g)).toHaveLength(4);
  });

  it('preserves each channel default and submits true only for checked boxes', () => {
    const html = render([preferences[0]!]);

    expect(html).toMatch(/name="notifyDrops"[^>]*checked=""[^>]*value="true"/);
    expect(html).toMatch(/name="notifyEvents"[^>]*value="true"/);
    expect(html).not.toMatch(/name="notifyEvents"[^>]*checked=""/);
    expect(html).toContain('새 굿즈·드롭');
    expect(html).toContain('팝업·이벤트');
    expect(html).toContain('변경 저장');
  });

  it('renders an honest empty state when the user follows no IP', () => {
    const html = render([]);

    expect(html).toContain('아직 팔로우한 IP가 없어요');
    expect(html).toContain('IP 둘러보기');
    expect(html).toContain('href="/ip"');
    expect(html).not.toContain('<form');
  });

  it('provides a direct return link to the inbox', () => {
    expect(render()).toContain('href="/notifications"');
  });

  it('shows a visible error when the shared preference action redirects back with failure', () => {
    const html = render(preferences, true);

    expect(html).toContain('role="alert"');
    expect(html).toContain('알림 설정을 저장하지 못했습니다');
  });

  it('announces a successful save without competing with an error', () => {
    const html = render(preferences, false, true);

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('알림 설정을 저장했습니다');
  });

  it('locks the submitted preference form and announces progress', () => {
    mocks.pending = true;
    const html = render([preferences[0]!]);
    mocks.pending = false;

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('disabled=""');
    expect(html).toContain('저장 중…');
  });
});
