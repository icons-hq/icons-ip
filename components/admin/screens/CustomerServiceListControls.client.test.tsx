import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomerServiceListView } from './CustomerServiceListControls';

const hooks = vi.hoisted(() => ({ view: 'list' }));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useState: () => [hooks.view, (value: string) => { hooks.view = value; }],
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

function buttons(node: ReactNode): ReactElement<{ children?: ReactNode; onClick?: () => void }>[] {
  if (Array.isArray(node)) return node.flatMap(buttons);
  if (!isValidElement<{ children?: ReactNode; onClick?: () => void }>(node)) return [];
  return node.type === 'button' ? [node] : buttons(node.props.children);
}

describe('CustomerServiceListView', () => {
  beforeEach(() => { hooks.view = 'list'; });

  it('목록과 기존 표를 전환할 때 한쪽 처리 UI만 마운트한다', () => {
    const render = () => CustomerServiceListView({ list: <div>문의 목록 처리</div>, table: <div>기존 표 열 설정</div> });
    const initial = render();
    expect(renderToStaticMarkup(initial)).toContain('문의 목록 처리');
    expect(renderToStaticMarkup(initial)).not.toContain('기존 표 열 설정');

    buttons(initial)[1].props.onClick?.();
    const table = render();
    expect(renderToStaticMarkup(table)).toContain('기존 표 열 설정');
    expect(renderToStaticMarkup(table)).not.toContain('문의 목록 처리');
    expect(renderToStaticMarkup(table)).toContain('aria-pressed="true">표형');

    buttons(table)[0].props.onClick?.();
    expect(renderToStaticMarkup(render())).toContain('문의 목록 처리');
  });
});
