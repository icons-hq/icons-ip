import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import AdminShellNotFound from '@/app/admin/(shell)/not-found';
import AdminContentNotFound from '@/app/admin/(content)/not-found';
import PublicNotFound from '@/app/not-found';

vi.mock('next/navigation', () => ({ useRouter: () => ({ back: vi.fn(), push: vi.fn() }) }));

/* QA 라운드 1 m6: 어드민 안의 notFound()는 권한 판정에도 쓰이므로 권한이 없을 수 있다고 알린다. 공개 404 문구는 그대로다. */
describe('어드민 안의 찾을 수 없는 화면', () => {
  it.each([['커머스', AdminShellNotFound], ['콘텐츠', AdminContentNotFound]])('%s 셸은 주소 문제와 권한 문제를 함께 알리고 어드민 홈으로 보낸다', (_label, Page) => {
    const html = renderToStaticMarkup(<Page />);
    expect(html).toContain('이 화면을 열 수 없습니다');
    expect(html).toContain('지금 계정의 권한으로는 열 수 없는 화면');
    expect(html).toContain('계정 주매니저에게 요청');
    expect(html).toContain('href="/admin"');
    expect(html).not.toContain('주소가 바뀌었거나 삭제된 페이지예요.');
  });
  it('공개 404 문구는 바꾸지 않는다', () => {
    const html = renderToStaticMarkup(<PublicNotFound />);
    expect(html).toContain('주소가 바뀌었거나 삭제된 페이지예요.');
    expect(html).not.toContain('권한');
  });
});
