import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import AdminLayout from './layout';

function Suspended(): never {
  throw new Promise(() => {});
}

it('셸이 오기 전에는 쇼핑몰 뼈대 대신 어드민용 빈 바탕을 보인다', () => {
  const html = renderToStaticMarkup(<AdminLayout><Suspended /></AdminLayout>);
  expect(html).toContain('data-admin-entry-fallback=""');
  expect(html).not.toContain('wc-root');
  expect(html).not.toContain('wc-loading');
});

it('준비된 화면은 바뀌지 않고 그대로 그린다', () => {
  const html = renderToStaticMarkup(<AdminLayout><main>검표</main></AdminLayout>);
  expect(html).toBe('<main>검표</main>');
});

/* loading.tsx의 경계는 자식 칸마다 key가 달려 (shell)↔(content) 콘솔 전환 때 사이드바까지 fallback으로 바뀐다. */
it('콘솔 전환에서 발동하지 않도록 loading.tsx가 아니라 레이아웃 경계로 둔다', () => {
  expect(existsSync(join(process.cwd(), 'app/admin/loading.tsx'))).toBe(false);
});
