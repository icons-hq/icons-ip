import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AdminLocalDraftNotice } from './AdminLocalDraftNotice';

describe('AdminLocalDraftNotice', () => {
  it('makes unavailable browser recovery visible without blocking server saves', () => {
    const html = renderToStaticMarkup(<AdminLocalDraftNotice recovery={false} unavailable pending={false} onRestore={vi.fn()} onDiscard={vi.fn()} />);
    expect(html).toContain('이 브라우저에서 입력을 자동 저장할 수 없습니다.');
    expect(html).toContain('이동하기 전에 저장해 주세요.');
    expect(html).not.toContain('<button');
  });
  it('offers explicit restore and discard controls with the browser retention policy', () => {
    const html = renderToStaticMarkup(<AdminLocalDraftNotice recovery pending={false} onRestore={vi.fn()} onDiscard={vi.fn()} />);
    expect(html).toContain('저장되지 않은 입력 복구');
    expect(html).toContain('이 브라우저에 최대 7일');
    expect(html).toContain('type="button"');
    expect(html).toContain('>복구</button>');
    expect(html).toContain('>버리기</button>');
    expect(html).toContain('wc-admin-kit');
    const pending = renderToStaticMarkup(<AdminLocalDraftNotice recovery pending onRestore={vi.fn()} onDiscard={vi.fn()} />);
    expect(pending.match(/disabled=""/g)).toHaveLength(2);
  });
});
